'use client'

/**
 * Internal ops dashboard — deliberately NOT linked from any nav or footer.
 * All data shown is public on-chain state; the wallet gate (connected wallet
 * must equal the contract's admin()) exists to keep the page useless to
 * passers-by, while the contract itself enforces onlyAdmin on writes.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { SiteNav } from '@/components/ui/site-nav'
import { useWallet } from '@/hooks/useWallet'
import { createContractClient } from '@/lib/contract'
import { formatToken } from '@/lib/format'

function getContractClient() {
  const network = (process.env.NEXT_PUBLIC_NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
  const address = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}` | undefined
  if (!address) return null
  return createContractClient({ contractAddress: address, network })
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'

const STATUS_NAMES = ['Waiting', 'Starting', 'Active', 'Ended'] as const
const PHASE_NAMES  = ['Infection', 'Discussion', 'Voting', 'Reveal', 'Ended'] as const

// An Active room whose current phase hasn't advanced in this long is
// probably wedged (backend missed a resolveRound) — flag it for a look.
const STUCK_PHASE_MS = 15 * 60 * 1000

type AdminInfo = {
  admin: `0x${string}`
  backendSigner: `0x${string}`
  platformFees: bigint
  platformReceiver: `0x${string}`
  activeRoomCount: bigint
  maxActiveRooms: bigint
}

type RoomRow = {
  id: bigint
  status: number
  phase: number
  players: number
  maxPlayers: number
  pot: bigint
  phaseStartedAt: number
  expiresAt: number
  stuck: boolean
}

type BotState = { online: boolean; available: number; total: number }

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function ago(tsSecs: number): string {
  if (tsSecs <= 0) return '—'
  const mins = Math.floor((Date.now() / 1000 - tsSecs) / 60)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function Card({ title, children, accent = 'rgba(107,142,35,0.18)' }: Readonly<{
  title: string
  children: React.ReactNode
  accent?: string
}>) {
  return (
    <div className="rounded-xl border p-5" style={{ backgroundColor: '#0a100a', borderColor: accent }}>
      <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#6b8e23' }}>{title}</p>
      <div className="mt-3">{children}</div>
    </div>
  )
}

export default function AdminPage() {
  const { isConnected, address } = useWallet()
  const [info, setInfo] = useState<AdminInfo | null>(null)
  const [rooms, setRooms] = useState<RoomRow[]>([])
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [bots, setBots] = useState<BotState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)

  const load = useCallback(async () => {
    const client = getContractClient()
    if (!client) { setError('Contract not configured.'); setLoading(false); return }
    try {
      setLoading(true)
      const [adminInfo, roomCount] = await Promise.all([
        client.getAdminInfo(),
        client.getRoomCount(),
      ])
      setInfo(adminInfo)

      // Recent rooms only — old ended rooms aren't ops-relevant.
      const from = roomCount > 20n ? roomCount - 19n : 1n
      const ids: bigint[] = []
      for (let id = from; id <= roomCount; id++) ids.push(id)
      const fetched = await client.getRooms(ids.reverse())
      const now = Date.now()
      setRooms(fetched.flatMap(({ id, room }) => {
        if (!room) return []
        const phaseStartedAt = Number(room.phaseStartedAt)
        return [{
          id,
          status: Number(room.status),
          phase: Number(room.currentPhase),
          players: room.players.length,
          maxPlayers: Number(room.config.maxPlayers),
          pot: BigInt(room.pot),
          phaseStartedAt,
          expiresAt: Number(room.expiresAt),
          stuck: Number(room.status) === 2 && now - phaseStartedAt * 1000 > STUCK_PHASE_MS,
        }]
      }))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contract state.')
    } finally {
      setLoading(false)
    }

    // Off-chain probes are independent of the RPC path — never block on them.
    try {
      const r = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(5000) })
      setBackendOk(r.ok)
    } catch { setBackendOk(false) }
    try {
      const r = await fetch(`${BACKEND_URL}/api/bots/availability`, { signal: AbortSignal.timeout(5000) })
      setBots(r.ok ? await r.json() : null)
    } catch { setBots(null) }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  const isAdmin = !!address && !!info && address.toLowerCase() === info.admin.toLowerCase()

  const handleWithdraw = useCallback(async () => {
    const client = getContractClient()
    if (!client || !address) return
    setWithdrawing(true)
    try {
      await client.withdrawPlatformFees(address)
      toast.success('Platform fees swept to the receiver.')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Withdraw failed.')
    } finally {
      setWithdrawing(false)
    }
  }, [address, load])

  const gated = !isConnected || (info !== null && !isAdmin)

  return (
    <main className="min-h-screen" style={{ backgroundColor: '#060b06', color: '#d4c9b2' }}>
      <div className="sticky top-0 z-50 px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="mx-auto w-full max-w-6xl">
          <SiteNav currentPath="/admin" />
        </div>
      </div>

      <div className="px-4 py-10 sm:px-6">
        <div className="mx-auto w-full max-w-6xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="font-heading text-3xl font-bold" style={{ color: '#d4c9b2' }}>Ops Console</h1>
              <p className="mt-1 font-mono text-xs" style={{ color: '#4a5e44' }}>
                Internal — contract, backend and bot-pool state at a glance. Refreshes every 30s.
              </p>
            </div>
            <button
              onClick={() => void load()}
              className="rounded-lg border px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all hover:opacity-90"
              style={{ borderColor: 'rgba(107,142,35,0.3)', color: '#6b8e23' }}
            >
              ↺ Refresh
            </button>
          </div>

          {gated ? (
            <div
              className="mt-8 rounded-xl border p-8 text-center font-mono text-sm"
              style={{ borderColor: 'rgba(230,51,41,0.25)', color: '#8fa882' }}
            >
              {!isConnected
                ? 'Connect the admin wallet (top right) to open the console.'
                : 'This wallet is not the contract admin. Nothing to see here — the door stays shut.'}
            </div>
          ) : (
            <>
              {error && (
                <div className="mt-6 rounded-xl border p-4 font-mono text-sm" style={{ borderColor: 'rgba(230,51,41,0.3)', color: '#e63329' }}>
                  {error}
                </div>
              )}

              {/* Status cards */}
              <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card title="Backend API">
                  <p className="font-heading text-2xl leading-none" style={{ color: backendOk ? '#1a7a4a' : '#e63329' }}>
                    {backendOk === null ? '…' : backendOk ? 'Healthy' : 'DOWN'}
                  </p>
                  <p className="mt-2 break-all font-mono text-[10px]" style={{ color: '#4a5e44' }}>{BACKEND_URL}</p>
                </Card>

                <Card title="Bot Pool">
                  <p className="font-heading text-2xl leading-none" style={{ color: bots?.online ? '#1a7a4a' : '#e63329' }}>
                    {bots === null ? 'unreachable' : bots.online ? `${bots.available} / ${bots.total} ready` : 'offline'}
                  </p>
                  <p className="mt-2 font-mono text-[10px]" style={{ color: '#4a5e44' }}>
                    Availability after pending requests
                  </p>
                </Card>

                <Card title="Platform Fees" accent="rgba(245,197,24,0.25)">
                  <p className="font-heading text-2xl leading-none" style={{ color: '#f5c518' }}>
                    {info ? `${formatToken(info.platformFees)} USDm` : '…'}
                  </p>
                  <button
                    onClick={() => void handleWithdraw()}
                    disabled={withdrawing || !info || info.platformFees === 0n}
                    className="mt-3 rounded border px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-30"
                    style={{ borderColor: '#f5c518', color: '#f5c518' }}
                  >
                    {withdrawing ? 'Sweeping…' : 'Withdraw to receiver'}
                  </button>
                  {info && (
                    <p className="mt-2 font-mono text-[10px]" style={{ color: '#4a5e44' }}>
                      → {short(info.platformReceiver)}
                    </p>
                  )}
                </Card>

                <Card title="Rooms">
                  <p className="font-heading text-2xl leading-none" style={{ color: '#6b8e23' }}>
                    {info ? `${info.activeRoomCount.toString()} / ${info.maxActiveRooms.toString()} active` : '…'}
                  </p>
                  <p className="mt-2 font-mono text-[10px]" style={{ color: '#4a5e44' }}>
                    Backend signer {info ? short(info.backendSigner) : '…'}
                  </p>
                </Card>
              </div>

              {/* Recent rooms */}
              <div className="mt-8 rounded-xl border p-5" style={{ backgroundColor: '#0a100a', borderColor: 'rgba(107,142,35,0.18)' }}>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#6b8e23' }}>
                  Last {rooms.length} rooms {loading ? '· loading…' : ''}
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left font-mono text-xs">
                    <thead>
                      <tr style={{ color: '#4a5e44' }}>
                        <th className="py-2 pr-4">Room</th>
                        <th className="py-2 pr-4">Status</th>
                        <th className="py-2 pr-4">Phase</th>
                        <th className="py-2 pr-4">Players</th>
                        <th className="py-2 pr-4">Pot</th>
                        <th className="py-2 pr-4">Phase age</th>
                        <th className="py-2">Flag</th>
                      </tr>
                    </thead>
                    <tbody style={{ color: '#8fa882' }}>
                      {rooms.map(r => (
                        <tr key={r.id.toString()} className="border-t" style={{ borderColor: 'rgba(107,142,35,0.1)' }}>
                          <td className="py-2 pr-4">#{r.id.toString()}</td>
                          <td className="py-2 pr-4" style={{ color: r.status === 2 ? '#f5c518' : r.status === 3 ? '#4a5e44' : '#1a7a4a' }}>
                            {STATUS_NAMES[r.status] ?? r.status}
                          </td>
                          <td className="py-2 pr-4">{r.status === 2 ? (PHASE_NAMES[r.phase] ?? r.phase) : '—'}</td>
                          <td className="py-2 pr-4">{r.players}/{r.maxPlayers}</td>
                          <td className="py-2 pr-4">{formatToken(r.pot)}</td>
                          <td className="py-2 pr-4">{r.status === 2 ? ago(r.phaseStartedAt) : '—'}</td>
                          <td className="py-2" style={{ color: '#e63329' }}>{r.stuck ? '⚠ STUCK?' : ''}</td>
                        </tr>
                      ))}
                      {!loading && rooms.length === 0 && (
                        <tr><td colSpan={7} className="py-4" style={{ color: '#4a5e44' }}>No rooms found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 font-mono text-[10px] leading-relaxed" style={{ color: '#4a5e44' }}>
                  ⚠ STUCK? = Active room whose phase hasn&apos;t advanced in 15+ minutes — see
                  docs/TROUBLESHOOTING.md (stuck game phases) before touching anything.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
