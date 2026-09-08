/**
 * containment-sweep.ts — timing + ordering math for the round-opening
 * "contact trace" beat (see components/game/ContainmentSweep usage in
 * PlayersGrid).
 *
 * WHY THIS EXISTS
 * The Infection phase used to be a silent state flip: the round turned over,
 * a 1.4 s phase card flashed, and the only thing that actually *happened* to a
 * player happened privately in their own browser (MomentOverlay's "YOU ARE
 * INFECTED"). Everyone else watched nothing. This module drives a shared,
 * synchronised beat so the table experiences the round turning over together.
 *
 * 🚨 THE SAFETY PROPERTY — READ BEFORE CHANGING
 * The sweep order is derived from `roomId + round` ONLY. It is deliberately
 * UNCORRELATED with who is actually infected, and nothing in this file — or in
 * the props of the components that use it — can see player status.
 *
 * That is not a stylistic choice. `buildRoomSnapshot` in the backend ships every
 * player's real `status` to every client in the room, and the UI redacts it in
 * exactly one place: `visibleStatus()` in PlayersGrid ("infection status is
 * never animated for other players"). An animation keyed to real status would
 * walk straight around that redaction and broadcast the game's central secret
 * to the whole table, in public, at full opacity.
 *
 * So the seat highlight is theatre over a seeded permutation. The only truthful
 * infection signal stays where it already is: private, local, MomentOverlay.
 * If you ever find yourself wanting to pass a `Player[]` in here — don't. Pass
 * a count.
 *
 * SYNCHRONISATION
 * Timing is anchored to `currentRound.startedAt`, which is the chain's
 * `phaseStartedAt` (see useGameState). Every client computes the same frame from
 * the same anchor, so the beat lands together on every screen with no new socket
 * traffic and no egress cost — which matters against the VPS's 512 GB/month
 * outbound cap.
 */

/** Total wall-clock budget for the whole sweep. Kept short: the Infection phase
 *  is transient (the backend advances to Discussion as soon as assignInfection
 *  lands), so this is a beat, not a cutscene. */
const SWEEP_BUDGET_MS = 3_000
/** Per-seat dwell is derived from the budget but clamped so a 3-seat room isn't
 *  a slideshow and a 12-seat room isn't a strobe. */
const MIN_STEP_MS = 140
const MAX_STEP_MS = 420
/** Quiet beat after the last seat clears, before the overlay lets go. */
const TAIL_MS = 900

export type SeatScanState = 'idle' | 'scanning' | 'cleared'

/** FNV-1a, 32-bit — same hash the room-modifier buckets use. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Mulberry32 — small deterministic PRNG so the shuffle is reproducible across
 *  clients and runtimes from the same seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Seeded Fisher-Yates over seat indices. Identical on every client for a given
 * (roomId, round) — and, by construction, carrying no information about anyone.
 */
export function sweepOrder(seatCount: number, seed: string): number[] {
  const order = Array.from({ length: Math.max(0, seatCount) }, (_, i) => i)
  const next = rng(hash(seed))
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

export function stepMs(seatCount: number): number {
  if (seatCount <= 0) return MAX_STEP_MS
  return Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, Math.round(SWEEP_BUDGET_MS / seatCount)))
}

/** Total on-screen lifetime of the beat, including the tail. */
export function sweepDurationMs(seatCount: number): number {
  return seatCount * stepMs(seatCount) + TAIL_MS
}

/**
 * Per-seat state at `elapsed` ms into the sweep.
 *
 * Returns an array indexed by SEAT index (not scan order), so a caller can map
 * it straight onto the rendered grid.
 */
export function seatStatesAt(seatCount: number, seed: string, elapsed: number): SeatScanState[] {
  const states: SeatScanState[] = Array.from({ length: Math.max(0, seatCount) }, () => 'idle')
  if (seatCount <= 0 || elapsed < 0) return states
  const order = sweepOrder(seatCount, seed)
  const step = stepMs(seatCount)
  const cursor = Math.floor(elapsed / step)
  for (let i = 0; i < order.length; i++) {
    if (i < cursor) states[order[i]] = 'cleared'
    else if (i === cursor) states[order[i]] = 'scanning'
  }
  return states
}
