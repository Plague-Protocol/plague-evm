import { Router } from 'express'
import { chainAdapter } from '../services/chainAdapter'
import { logger } from '../lib/logger'

/**
 * Browser-facing JSON-RPC read proxy.
 *
 * The frontend reads chain state directly from the browser. Public Celo RPCs
 * (forno, drpc) rate-limit by origin and drop CORS headers on throttled
 * responses, so a busy game floor produces a storm of
 * "No 'Access-Control-Allow-Origin' header" failures in users' consoles and a
 * frozen UI. Routing reads through THIS endpoint fixes both: it is same-origin
 * (our own CORS allowlist covers it) and forwards server-to-server to the
 * backend's already-configured, healthy upstreams (no CORS server-side).
 *
 * Read-only plus one write: a method allowlist keeps this from being a
 * general-purpose relay. External wallets broadcast through their own provider,
 * but thirdweb's in-app (social/email) wallet broadcasts through the chain's RPC
 * — which we now point at this proxy (see frontend lib/thirdweb.ts). So
 * eth_sendRawTransaction is allowed: a signed raw tx is self-authenticating,
 * so relaying it server-side is safe (we can neither forge nor alter it).
 */
export const rpcRouter = Router()

const ALLOWED_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_call',
  'eth_getBalance',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getLogs',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getTransactionCount',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_sendRawTransaction',
  'net_version',
  'web3_clientVersion',
])

const UPSTREAM_TIMEOUT_MS = Number(process.env.RPC_PROXY_TIMEOUT_MS ?? 12_000)

/** A JSON-RPC payload is a single request or a batch array; extract methods. */
function methodsOf(body: unknown): string[] {
  const items = Array.isArray(body) ? body : [body]
  return items.map(it =>
    (it && typeof it === 'object' && 'method' in it)
      ? String((it as { method: unknown }).method)
      : '',
  )
}

rpcRouter.post('/', async (req, res) => {
  const methods = methodsOf(req.body)
  if (methods.length === 0 || methods.some(m => !ALLOWED_METHODS.has(m))) {
    const bad = methods.find(m => !ALLOWED_METHODS.has(m)) ?? '(empty)'
    return res.status(403).json({ error: `Method not allowed via proxy: ${bad}` })
  }

  const upstreams = chainAdapter.getRpcUrls()
  const payload = JSON.stringify(req.body)

  for (const url of upstreams) {
    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
      if (!upstream.ok) continue // try the next upstream on 4xx/5xx
      const json = await upstream.json()
      return res.json(json)
    } catch {
      // network error / timeout — fall through to the next upstream
    }
  }

  logger.warn(`[rpc-proxy] all ${upstreams.length} upstream(s) failed for [${methods.join(', ')}]`)
  return res.status(502).json({ error: 'All upstream RPCs failed' })
})
