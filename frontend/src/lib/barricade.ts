/**
 * barricade.ts — client mirror of the Discussion-phase minigame's SHAPE.
 *
 * ⚠ MIRRORED from backend/src/lib/barricade.ts. `STATIONS`, `assignedStation`
 * and `targetStation` must stay byte-identical across the two copies or a player
 * will be shown defending a station the server has them nowhere near. If you
 * change the hash, the station list, or either derivation, change both files in
 * the same commit. (Same convention, and the same reasoning, as
 * lib/roomModifiers.ts.)
 *
 * 🚨 ONLY THE SHAPE IS MIRRORED — NOT THE RESOLUTION.
 * Whether a station held, and who gets named for it, is decided exclusively by
 * the server and arrives over the wire. Nothing here computes an outcome. That
 * asymmetry is deliberate: assignment is public information every client is
 * entitled to derive for itself, while resolution depends on who is actually
 * infected — which no client may know.
 */

export const STATIONS = ['North Door', 'East Window', 'Roof Hatch'] as const
export type StationId = 0 | 1 | 2

export type BarricadeAction =
  | { kind: 'hold' }
  | { kind: 'move'; station: StationId }
  | { kind: 'sabotage' }

export interface PushOutcome {
  push: number
  station: StationId
  held: boolean
  /** Bodies present. Public whatever the result. */
  present: number
  /** Populated only on a breach — a station that holds names nobody. */
  exposed: string[]
  at: number
}

export interface BarricadeState {
  roomId: string
  round: number
  stations: readonly string[]
  /** Defenders needed to hold, at this round's level. Server-decided. */
  threshold: number
  /** Pushes coming this round. Rises as the night gets worse. */
  pushes: number
  /** The night's condition, e.g. "Spreading". Player-facing. */
  level: string
  /**
   * Bodies at each station, by station index. COUNTS ONLY, never identities —
   * this is what lets the quarantine cam place figures truthfully in aggregate
   * while staying anonymous about who is who.
   */
  occupancy: number[]
  next: { push: number; station: StationId; at: number } | null
  outcomes: PushOutcome[]
}

/**
 * ── The difficulty arc ───────────────────────────────────────────────────────
 *
 * ⚠ IN THE LIVE GAME, NEVER CALL THIS. Read `threshold`, `pushes` and `level`
 * off the BarricadeState the server sent. Those values decide what counts as
 * holding, so the authority is the server and a local copy could only ever
 * disagree with it.
 *
 * This exists for /demo, which has no server and simulates the whole game
 * itself. Mirrored rather than reinvented so that someone who tries the demo and
 * then plays for real meets the same arc, on the same rounds, under the same
 * names.
 *
 * ⚠ Must stay in step with LEVELS in backend/src/lib/barricade.ts.
 */
const LEVELS = [
  { from: 1, pushes: 3, threshold: 2, label: 'Contained' },
  { from: 3, pushes: 4, threshold: 2, label: 'Spreading' },
  { from: 5, pushes: 4, threshold: 3, label: 'Overrun' },
] as const

export interface BarricadeLevel {
  readonly pushes: number
  readonly threshold: number
  readonly label: string
}

export function levelForRound(round: number): BarricadeLevel {
  let level: BarricadeLevel = LEVELS[0]
  for (const l of LEVELS) if (round >= l.from) level = l
  return level
}

/** FNV-1a, 32-bit. Must match the backend copy exactly. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** A player's starting station for a round. Derived, never transmitted. */
export function assignedStation(roomId: string, round: number, seatIndex: number): StationId {
  return (hash(`${roomId}:${round}:${seatIndex}`) % STATIONS.length) as StationId
}

/** Which station the horde hits on a given push. */
export function targetStation(roomId: string, round: number, push: number): StationId {
  return (hash(`push:${roomId}:${round}:${push}`) % STATIONS.length) as StationId
}
