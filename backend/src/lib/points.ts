/**
 * points.ts — the scoring formula.
 *
 * Moved out of routes/leaderboard.ts (which still re-exports it, so existing
 * importers are unaffected) because it is a pure constant that two other things
 * now depend on: the rank ladder in lib/ranks.ts, and that ladder's tests. A
 * test importing it from the route pulled the whole express + prisma chain into
 * the test runner, which is a lot of machinery to reach four numbers.
 */

/**
 * Aggregate points formula. Weighs every way a player engages: winning,
 * fighting to a draw, showing up at all, spending money on shields
 * (innocence proofs), and surviving to the end of a game. Mirrored in the
 * frontend's "How points work" card — keep the two in sync.
 *
 * ⚠ lib/ranks.ts thresholds are tuned to these exact values and to the game's
 * real cadence (one or two games a day). Changing a number here means re-tuning
 * the ladder, or every player quietly stops advancing.
 */
export const POINTS = {
  win: 7,
  draw: 5,   // draws (surviving to max rounds) are rarer and harder than
             // wins in practice — score them as near-wins
  loss: 2,
  shield: 3, // per innocence proof submitted — costs real USDm (proof fee)
             // and is capped at one per round, so it can't be grinded
  // No separate survival bonus: winners are always alive at game end
  // (the contract only pays living players), so it double-counted wins
  // and only ever distinguished surviving losers from eliminated ones.
} as const
