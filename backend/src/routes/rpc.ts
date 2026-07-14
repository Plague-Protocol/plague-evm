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

/**
 * Short-lived server-side cache for hot, parameterless read methods.
 *
 * Every connected browser polls chain state (thirdweb watches block number and
 * chain id for the whole session; our own reads poll too), and it ALL funnels
 * through this one backend IP. Public Celo RPCs rate-limit by IP, so under a
 * busy floor the upstreams start returning 5xx and the proxy 502s. Caching the
 * high-frequency, low-cardinality calls collapses N users' polling into at most
 * one upstream call per TTL — the difference between staying under the rate
 * limit and tripping it. Only methods with no meaningful params are cached;
 * eth_call (getRoom/getPlayer) is never cached, so game state stays live.
 */
const CACHE_TTL_MS: Record<string, number> = {
  eth_chainId:              3_600_000, // immutable
  net_version:              3_600_000, // immutable
  web3_clientVersion:       3_600_000, // immutable
  eth_blockNumber:          2_000,     // < Celo block time
  eth_gasPrice:             5_000,
  eth_maxPriorityFeePerGas: 5_000,
}
const cache = new Map<string, { at: number; body: unknown }>()

/** A JSON-RPC payload is a single request or a batch array; extract methods. */
function methodsOf(body: unknown): string[] {
  const items = Array.isArray(body) ? body : [body]
  return items.map(it =>
    (it && typeof it === 'object' && 'method' in it)
      ? String((it as { method: unknown }).method)
      : '',
  )
}

/** Cache key for a single cacheable request — method only (params are empty). */
function cacheKeyFor(body: unknown): string | null {
  if (Array.isArray(body) || !body || typeof body !== 'object') return null
  const { method, params } = body as { method?: string; params?: unknown[] }
  if (!method || CACHE_TTL_MS[method] === undefined) return null
  if (Array.isArray(params) && params.length > 0) return null // only parameterless
  return method
}

/** Forward the payload to the first healthy upstream; null if all fail. */
async function forwardToUpstreams(payload: string, upstreams: string[]): Promise<unknown | null> {
  for (const url of upstreams) {
    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
      if (!upstream.ok) continue // try the next upstream on 4xx/5xx
      return await upstream.json()
    } catch {
      // network error / timeout — fall through to the next upstream
    }
  }
  return null
}

rpcRouter.post('/', async (req, res) => {
  const methods = methodsOf(req.body)
  if (methods.length === 0 || methods.some(m => !ALLOWED_METHODS.has(m))) {
    const bad = methods.find(m => !ALLOWED_METHODS.has(m)) ?? '(empty)'
    return res.status(403).json({ error: `Method not allowed via proxy: ${bad}` })
  }

  // Serve hot parameterless reads from the short-TTL cache when fresh, rewriting
  // the cached result's `id` to match this request so the JSON-RPC client pairs
  // the response correctly.
  const key = cacheKeyFor(req.body)
  if (key) {
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS[key]) {
      const cached = hit.body
      if (cached && typeof cached === 'object') {
        return res.json({ ...(cached as object), id: (req.body as { id?: unknown }).id })
      }
    }
  }

  const upstreams = chainAdapter.getRpcUrls()
  const json = await forwardToUpstreams(JSON.stringify(req.body), upstreams)

  if (json === null) {
    logger.warn(`[rpc-proxy] all ${upstreams.length} upstream(s) failed for [${methods.join(', ')}]`)
    return res.status(502).json({ error: 'All upstream RPCs failed' })
  }

  // Only cache a successful (error-free) JSON-RPC result.
  if (key && json && typeof json === 'object' && !('error' in json)) {
    cache.set(key, { at: Date.now(), body: json })
  }
  return res.json(json)
})
