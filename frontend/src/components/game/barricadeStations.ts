/**
 * barricadeStations.ts — where the barricade lives inside the quarantine cam.
 *
 * WHY THE CAM AND THE BARRICADE HAD TO MERGE
 * They shipped as two panels describing the same room and disagreeing about it.
 * The cam is a diorama of one open chamber where figures wander freely; the
 * barricade said you were posted at one of three fixed stations. Your figure
 * drifted around aimlessly while a panel beside it insisted you were holding the
 * East Window. They could not be reconciled by tuning, because they were
 * different geometry — so the cam becomes the barricade instead.
 *
 * That also fixes the harder half of the problem. The rules were not legible
 * from the panel; they are legible from the picture. Nobody needs the hold
 * threshold explained once they can see four bodies at a window and the window
 * holding.
 *
 * 🚨 ANONYMITY IS PRESERVED, AND THE MECHANISM MATTERS.
 * OutbreakDirector guarantees that only YOUR figure tells your truth — every
 * other figure's identity is per-client fiction, so two players' screens can
 * never be correlated to deanonymize anyone. Placing figures at stations must
 * not break that.
 *
 * It does not, because the server publishes COUNTS, not names. This module
 * places your figure at your real station and then distributes anonymous
 * figures to match the published occupancy. The picture is therefore truthful
 * in aggregate — the wall you can see thinning really is thinning — and says
 * nothing about who anyone is.
 *
 * Identities surface in exactly one place, and only because the rules say so:
 * a station that BREAKS names everyone who was standing there.
 */

/** Station anchors sit along the FAR wall — the horde comes from outside, and
 *  depth-sorting then draws defenders in front of the thing they are holding. */
const STATION_XS = [0.22, 0.5, 0.78] as const
/** Fraction of the usable depth at which defenders stand. Not flush against the
 *  wall: figures need room to brace, and a body flat on the boards reads as
 *  scenery rather than a person. */
const STAND_DEPTH = 0.26

export interface StationAnchor { x: number; y: number }

export function stationAnchor(
  station: number, w: number, h: number, padTop: number, padBottom: number,
): StationAnchor {
  const usable = Math.max(1, h - padTop - padBottom)
  return {
    x: w * (STATION_XS[station] ?? 0.5),
    y: padTop + usable * STAND_DEPTH,
  }
}

/** Where the barricade itself is drawn: hard against the far wall. */
export function stationWallY(padTop: number): number {
  return padTop - 6
}

export interface AssignInput {
  /** Body ids currently alive, in stable order. */
  readonly ids: readonly number[]
  /** Body id that is the local player, or null when spectating. */
  readonly myId: number | null
  /** The local player's REAL station — the one truthful placement. */
  readonly myStation: number | null
  /** Server-published headcount per station. */
  readonly occupancy: readonly number[];
  /** Previous assignment, so figures do not teleport between frames. */
  readonly previous: ReadonlyMap<number, number>
}

/**
 * Assigns each living figure to a station so the per-station totals match
 * `occupancy` exactly.
 *
 * Stability is the point of `previous`: recomputing freely every time the
 * server speaks would have figures swapping walls for no visible reason, which
 * reads as a bug and also destroys the one thing this is for — watching a wall
 * thin out. Existing placements are kept wherever the counts still allow, and
 * only the surplus is moved.
 */
export function assignStations(input: AssignInput): Map<number, number> {
  const { ids, myId, myStation, occupancy, previous } = input
  const stations = occupancy.length || 3
  const remaining = Array.from({ length: stations }, (_, i) => occupancy[i] ?? 0)
  const out = new Map<number, number>()

  // 1. The local player first and unconditionally — their placement is the only
  //    truthful one on this screen, so it is never traded away to satisfy a count.
  if (myId !== null && myStation !== null && ids.includes(myId)) {
    out.set(myId, myStation)
    remaining[myStation] = Math.max(0, remaining[myStation] - 1)
  }

  // 2. Everyone already standing somewhere that still has room stays put.
  for (const id of ids) {
    if (out.has(id)) continue
    const prev = previous.get(id)
    if (prev !== undefined && remaining[prev] > 0) {
      out.set(id, prev)
      remaining[prev]--
    }
  }

  // 3. Whoever is left fills the gaps, in order, so the totals come out exact.
  let cursor = 0
  for (const id of ids) {
    if (out.has(id)) continue
    while (cursor < stations && remaining[cursor] <= 0) cursor++
    // Counts can under-cover the roster for a frame or two — a figure the
    // director has not retired yet, a snapshot in flight. Park the remainder
    // rather than dropping them off the board.
    const station = cursor < stations ? cursor : (stations - 1)
    out.set(id, station)
    if (cursor < stations) remaining[cursor]--
  }

  return out
}
