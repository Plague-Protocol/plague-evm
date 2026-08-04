/**
 * Aggregate activity, for the drafts that want a real number in them.
 *
 * Everything here is deliberately aggregate. No addresses, no display names, no
 * per-seat detail, so a draft can say "14 games this week" without implying
 * anything about who played them. That is not a limitation worked around, it is
 * the point: the account posts about the game, not about a roster.
 *
 * A week rather than a day because a daily number on a young game reads as
 * small even when the trend is fine, and because a quiet Tuesday should not
 * produce a draft that argues against playing.
 */

import { query } from './store.js'

export interface Pulse {
  /** Games settled in the last 7 days. */
  gamesThisWeek: number
  /** Largest single pot in the last 7 days, wei. Zero when there were none. */
  biggestPotWei: string
  /** Total staked across those games, wei. */
  totalStakedWei: string
  /** Longest game of the week, in rounds. */
  longestRounds: number
  /** Games settled since the beginning, all time. */
  gamesAllTime: number
}

export async function readPulse(): Promise<Pulse> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000)

  const week = await query(
    `SELECT count(*)::int                                   AS games,
            coalesce(max("totalPot"::numeric), 0)::text     AS biggest,
            coalesce(sum("totalPot"::numeric), 0)::text     AS total,
            coalesce(max("totalRounds"), 0)::int            AS rounds
       FROM "GameSummary"
      WHERE "endedAt" >= $1`,
    [weekAgo],
  )

  const all = await query(`SELECT count(*)::int AS games FROM "GameSummary"`)

  const w = week.rows[0]
  return {
    gamesThisWeek: Number(w.games ?? 0),
    // numeric::text can come back with a decimal tail; wei is an integer.
    biggestPotWei: String(w.biggest ?? '0').split('.')[0],
    totalStakedWei: String(w.total ?? '0').split('.')[0],
    longestRounds: Number(w.rounds ?? 0),
    gamesAllTime: Number(all.rows[0]?.games ?? 0),
  }
}
