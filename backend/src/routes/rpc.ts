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
 * Short-lived server-side cache for hot read methods.
 *
 * Every connected browser polls chain state (thirdweb watches block number and
 * chain id for the whole session; our own reads poll too), and it ALL funnels
 * through this one backend IP. Public Celo RPCs rate-limit by IP, so under a
 * busy floor the upstreams start returning 5xx and the proxy 502s. Caching the
 * high-frequency calls collapses N users' polling into at most one upstream
 * call per TTL — the difference between staying under the rate limit and
 * tripping it.
 *
 * Two tiers:
 *  - Parameterless hot methods (block number, gas, chain id) — see CACHE_TTL_MS.
 *  - eth_call reads (getRoom/getRoomCount + the lobby getRooms multicall), keyed
 *    by (to, data, block) with a short TTL. Many browsers viewing the same
 *    lobby/game re-fetch identical contract reads; this collapses them into one
 *    upstream call per window. Safe for game flow: the backend phase-advance
 *    monitor uses chainAdapter's OWN transport (not this proxy), so a stale
 *    browser read never delays on-chain phase advancement. The browser also
 *    gets authoritative state pushed over the socket (room_snapshot), so its own
 *    getRoom polling is only a backup — a few seconds of staleness is invisible.
 */
const CACHE_TTL_MS: Record<string, number> = {
  eth_chainId:              3_600_000, // immutable
  net_version:              3_600_000, // immutable
  web3_clientVersion:       3_600_000, // immutable
  eth_blockNumber:          2_000,     // < Celo block time
  eth_gasPrice:             5_000,
  eth_maxPriorityFeePerGas: 5_000,
}
// eth_call TTL — 0 disables the eth_call tier entirely.
const ETH_CALL_TTL_MS = Number(process.env.RPC_ETH_CALL_CACHE_MS ?? 3_000)
// eth_call keys are high-cardinality (per room / per calldata), unlike the ~6
// parameterless keys, so the cache needs a bound. Short TTLs keep churn cheap.
const CACHE_MAX_ENTRIES = Number(process.env.RPC_CACHE_MAX_ENTRIES ?? 2_000)

const cache = new Map<string, { at: number; ttl: number; body: unknown }>()

/** Evict expired entries, then oldest-first (insertion order), back under cap. */
function pruneCache(): void {
  if (cache.size <= CACHE_MAX_ENTRIES) return
  const now = Date.now()
  for (const [k, v] of cache) {
    if (now - v.at >= v.ttl) cache.delete(k)
  }
  for (const k of cache.keys()) {
    if (cache.size <= CACHE_MAX_ENTRIES) break
    cache.delete(k)
  }
}

/** A JSON-RPC payload is a single request or a batch array; extract methods. */
function methodsOf(body: unknown): string[] {
  const items = Array.isArray(body) ? body : [body]
  return items.map(it =>
    (it && typeof it === 'object' && 'method' in it)
      ? String((it as { method: unknown }).method)
      : '',
  )
}

/** Cache key + TTL for a single cacheable request, or null if not cacheable. */
function cacheKeyFor(body: unknown): { key: string; ttl: number } | null {
  if (Array.isArray(body) || !body || typeof body !== 'object') return null
  const { method, params } = body as { method?: string; params?: unknown[] }
  if (!method) return null

  // Tier 1: parameterless hot methods, keyed by method name.
  if (CACHE_TTL_MS[method] !== undefined) {
    if (Array.isArray(params) && params.length > 0) return null
    return { key: method, ttl: CACHE_TTL_MS[method] }
  }

  // Tier 2: eth_call, keyed by target + calldata + block.
  if (method === 'eth_call' && ETH_CALL_TTL_MS > 0 && Array.isArray(params)) {
    if (params.length > 2) return null // state-override calls — don't cache
    const callObj = params[0]
    if (!callObj || typeof callObj !== 'object') return null
    const to   = String((callObj as { to?: unknown }).to ?? '').toLowerCase()
    const data = String((callObj as { data?: unknown; input?: unknown }).data
      ?? (callObj as { input?: unknown }).input ?? '').toLowerCase()
    if (!to || !data) return null
    const block = params.length >= 2 ? params[1] : 'latest'
    if (block === 'pending') return null // volatile — never cache
    const blockKey = typeof block === 'string' ? block : JSON.stringify(block)
    return { key: `eth_call:${to}:${data}:${blockKey}`, ttl: ETH_CALL_TTL_MS }
  }

  return null
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

  // Serve hot reads from the short-TTL cache when fresh, rewriting the cached
  // result's `id` to match this request so the JSON-RPC client pairs the
  // response correctly.
  const entry = cacheKeyFor(req.body)
  if (entry) {
    const hit = cache.get(entry.key)
    if (hit && Date.now() - hit.at < entry.ttl) {
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
  if (entry && json && typeof json === 'object' && !('error' in json)) {
    cache.set(entry.key, { at: Date.now(), ttl: entry.ttl, body: json })
    pruneCache()
  }
  return res.json(json)
})
