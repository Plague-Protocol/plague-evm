'use client'

/**
 * Temporary wallet capability probe. Rendered only with `?diag=1`.
 *
 * Six rounds of fixes failed to get a transaction through MiniPay, and the last
 * one proved the request is already textbook-clean:
 *   keys=[data,from,to] data=0x095ea7b3 len=138  →  Permission denied
 *
 * A standard ERC-20 approve, refused. That points at MiniPay restricting the
 * OPERATION rather than the encoding — its Mini App sheet only ever renders
 * "Send <token> <amount>", and every payment template in the MiniPay docs uses
 * `transfer`, never `approve`.
 *
 * If that is right the game is architecturally blocked: PlagueGame stakes via
 * `_safeTransferFrom`, so an allowance is mandatory to enter a room, and the
 * contract is not upgradeable. That conclusion costs a redeploy and a
 * migration, so it needs evidence rather than inference — hence three probes
 * that between them decide the whole question:
 *
 *   1. SIGN     — eth_signTypedData_v4 over an EIP-2612 permit.
 *                 If MiniPay signs, the allowance can be set by a permit the
 *                 BACKEND submits, and the user never sends an approve at all.
 *                 No contract change needed. USDm supports permit (verified:
 *                 DOMAIN_SEPARATOR and nonces both respond on mainnet).
 *   2. TRANSFER — a 0.0001 USDm transfer to yourself. The baseline: this is the
 *                 one operation MiniPay's own templates use, so if even this is
 *                 refused the problem is not approve-specific and a redeploy
 *                 would have been the wrong call.
 *   3. CALL     — a contract call that is not a token operation. Answers the
 *                 question a transfer cannot: whether MiniPay permits arbitrary
 *                 contract interaction, or only value movement. If it only
 *                 allows transfers, permit does not save us and the entry path
 *                 has to change on-chain.
 *
 * Delete this file once the answer is recorded in docs/TROUBLESHOOTING.md.
 */

import { useState } from 'react'
import { useWallet } from '@/hooks/useWallet'

const USDM = '0x765DE816845861e75A25fCA122bb6898B8B1282a'
const GAME = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? '') as `0x${string}`

type Result = { label: string; ok: boolean; detail: string }

function short(err: unknown): string {
  const seen = new Set<unknown>()
  const parts: string[] = []
  let cur: unknown = err
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur)
    const o = cur as Record<string, unknown>
    if (typeof o.shortMessage === 'string') parts.push(o.shortMessage)
    if (o.code !== undefined) parts.push(`code ${String(o.code)}`)
    if (typeof o.message === 'string') parts.push(o.message.split('\n')[0])
    cur = o.cause
  }
  const uniq = [...new Set(parts.map(p => p.trim()).filter(Boolean))]
  return uniq.join(' · ').slice(0, 180) || String(err).slice(0, 180)
}

export function WalletDiagnostics() {
  const { address, isMiniPay } = useWallet()
  const [results, setResults] = useState<Result[]>([])
  const [running, setRunning] = useState(false)

  const run = async () => {
    if (!address) return
    setRunning(true)
    setResults([])
    const out: Result[] = []
    const eth = globalThis.window?.ethereum
    if (!eth) {
      setResults([{ label: 'provider', ok: false, detail: 'no window.ethereum' }])
      setRunning(false)
      return
    }

    // ── 1. Typed-data signing (EIP-2612 permit) ──────────────────────────────
    try {
      const deadline = Math.floor(Date.now() / 1000) + 3600
      const typed = {
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit',
        domain: { name: 'Celo Dollar', version: '1', chainId: 42220, verifyingContract: USDM },
        message: { owner: address, spender: GAME, value: '1000000000000000', nonce: '0', deadline: String(deadline) },
      }
      const sig = await eth.request({
        method: 'eth_signTypedData_v4',
        params: [address, JSON.stringify(typed)],
      })
      out.push({ label: '1 SIGN typed-data', ok: true, detail: `signed (${String(sig).slice(0, 14)}…)` })
    } catch (err) {
      out.push({ label: '1 SIGN typed-data', ok: false, detail: short(err) })
    }
    setResults([...out])

    // ── 2. Plain ERC-20 transfer to self ─────────────────────────────────────
    try {
      // transfer(address,uint256) = 0xa9059cbb
      const to = address.slice(2).padStart(64, '0')
      const amt = (100000000000000n).toString(16).padStart(64, '0') // 0.0001 USDm
      const hash = await eth.request({
        method: 'eth_sendTransaction',
        params: [{ from: address, to: USDM, data: `0xa9059cbb${to}${amt}` }],
      })
      out.push({ label: '2 TRANSFER self', ok: true, detail: `sent ${String(hash).slice(0, 14)}…` })
    } catch (err) {
      out.push({ label: '2 TRANSFER self', ok: false, detail: short(err) })
    }
    setResults([...out])

    // ── 3. Non-token contract call ───────────────────────────────────────────
    try {
      // expireRoom(uint256) = 0x7a1f3d3b-ish; encoded here for room 1. Expected
      // to REVERT on-chain (room 1 is long ended) — irrelevant. The question is
      // only whether MiniPay will broadcast a call that is not a token
      // operation, so a revert counts as success for this probe.
      const roomId = (1n).toString(16).padStart(64, '0')
      const hash = await eth.request({
        method: 'eth_sendTransaction',
        params: [{ from: address, to: GAME, data: `0x2f52ff7b${roomId}` }],
      })
      out.push({ label: '3 CONTRACT call', ok: true, detail: `accepted ${String(hash).slice(0, 14)}…` })
    } catch (err) {
      out.push({ label: '3 CONTRACT call', ok: false, detail: short(err) })
    }
    setResults([...out])
    setRunning(false)
  }

  return (
    <div className="mb-6 rounded-lg border p-4" style={{ borderColor: 'rgba(245,197,24,0.5)', backgroundColor: 'rgba(245,197,24,0.06)' }}>
      <p className="font-mono text-xs font-bold uppercase tracking-wider" style={{ color: '#f5c518' }}>
        Wallet diagnostics {isMiniPay ? '(MiniPay)' : '(non-MiniPay)'}
      </p>
      <p className="mt-1 font-mono text-[11px]" style={{ color: '#d4c9b2' }}>
        Probes 2 and 3 send real transactions (0.0001 USDm, and one call expected to revert).
      </p>
      <button
        onClick={run}
        disabled={running || !address}
        className="mt-3 rounded px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider disabled:opacity-50"
        style={{ backgroundColor: '#f5c518', color: '#0a0e27' }}
      >
        {running ? 'Running…' : 'Run probes'}
      </button>
      {results.length > 0 && (
        <div className="mt-3 space-y-2">
          {results.map(r => (
            <p key={r.label} className="font-mono text-[11px] leading-snug" style={{ color: r.ok ? '#6b8e23' : '#ff6b5e' }}>
              {r.ok ? '✅' : '❌'} {r.label}: {r.detail}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
