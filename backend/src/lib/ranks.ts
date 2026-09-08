/**
 * ranks.ts — the progression ladder, and the "one more game" hook.
 *
 * WHAT IT IS FOR
 * A finished game currently ends in a result card and nothing else: the player
 * learns whether they won and closes the tab. This turns the accumulated points
 * the leaderboard already computes into a visible ladder, so the exit moment can
 * say something concrete about what coming back is worth.
 *
 * 🚨 THE THRESHOLDS ARE TUNED TO THIS GAME'S ACTUAL VOLUME, NOT A GENERIC CURVE.
 * Scoring is deliberately small — a win is 7 points, a loss 2, a shield 3 — and
 * the room plays one or two games a day. Drop a conventional ladder on top of
 * that (100/500/1000) and every player sits at rank one forever, which
 * DEMOTIVATES: a progress bar that never visibly moves is worse than no progress
 * bar. So the early rungs are deliberately close together — the second is
 * reachable in about two games — and they widen from there. If POINTS in
 * routes/leaderboard.ts ever changes, these have to be re-tuned with it.
 *
 * 🚨 The ladder is COSMETIC. It confers no advantage, changes no odds, and never
 * touches stakes or payout. A rank that bought anything would turn a game with
 * real money in it into one where established players are advantaged over new
 * ones, which is both unfair and a different regulatory shape entirely.
 *
 * Names avoid the in-game role words ("Patient Zero", "carrier", "clean") on
 * purpose — a rank badge reading "Patient Zero" next to a live game where that
 * means something specific is a bug report waiting to happen.
 */

export interface Rank {
  /** Ladder position, 1-based. */
  readonly tier: number
  readonly name: string
  /** Points needed to reach it. */
  readonly at: number
}

export const RANKS: readonly Rank[] = [
  { tier: 1, name: 'Exposed',     at: 0 },
  { tier: 2, name: 'Survivor',    at: 10 },
  { tier: 3, name: 'Scavenger',   at: 25 },
  { tier: 4, name: 'Holdout',     at: 50 },
  { tier: 5, name: 'Warden',      at: 90 },
  { tier: 6, name: 'Immune',      at: 150 },
  { tier: 7, name: 'Untouchable', at: 240 },
]

export interface Progress {
  readonly rank: Rank
  /** The next rung, or null at the top of the ladder. */
  readonly next: Rank | null
  /** Points still needed for `next`; 0 at the top. */
  readonly toNext: number
  /** Progress through the CURRENT band, 0..1. 1 at the top. */
  readonly fraction: number
}

export function rankFor(points: number): Rank {
  let rank = RANKS[0]
  for (const r of RANKS) if (points >= r.at) rank = r
  return rank
}

/**
 * Where a player stands, and how far the next rung is.
 *
 * `fraction` measures progress across the current band rather than toward the
 * ladder as a whole, so it moves visibly after a single game even at the top
 * end — which is the entire point of showing it.
 */
export function progressFor(points: number): Progress {
  const safe = Number.isFinite(points) && points > 0 ? points : 0
  const rank = rankFor(safe)
  const next = RANKS.find(r => r.at > safe) ?? null
  if (!next) return { rank, next: null, toNext: 0, fraction: 1 }
  const band = next.at - rank.at
  return {
    rank,
    next,
    toNext: next.at - safe,
    fraction: band > 0 ? Math.min(1, Math.max(0, (safe - rank.at) / band)) : 0,
  }
}
