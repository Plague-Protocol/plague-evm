/**
 * Short-TTL memo for the computed /api/leaderboard response.
 *
 * The route loads EVERY GameSummary row (with players) and aggregates global,
 * monthly, per-month and per-season boards in JS on each request. Games finish
 * every few hours; the leaderboard is a public page that gets shared. Without
 * a memo, N viewers = N full-table scans + N aggregations of identical data.
 *
 * Kept in its own module (not the route) so the write paths — game-end
 * summary upserts and nickname changes, both of which alter leaderboard
 * output — can invalidate it without importing the router (route → repository
 * → route would cycle).
 *
 * In-process only, same trade-off as the RPC proxy cache: fine for the single
 * backend container this stack runs, revisit if it's ever scaled out.
 */

const TTL_MS = Number(process.env.LEADERBOARD_CACHE_MS ?? 30_000)

let cached: { at: number; body: unknown } | null = null

/** The memoized response body, or null when absent/expired/disabled. */
export function getCachedLeaderboard(): unknown | null {
  if (TTL_MS <= 0 || !cached) return null
  if (Date.now() - cached.at >= TTL_MS) {
    cached = null
    return null
  }
  return cached.body
}

export function setCachedLeaderboard(body: unknown): void {
  if (TTL_MS <= 0) return
  cached = { at: Date.now(), body }
}

/** Call whenever underlying data changes (game summary upsert, nickname). */
export function invalidateLeaderboardCache(): void {
  cached = null
}
