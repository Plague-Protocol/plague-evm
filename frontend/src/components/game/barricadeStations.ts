/**
 * barricadeStations.ts — the compound: four walls, an inside, and an outside.
 *
 * WHY THE CAM AND THE BARRICADE ARE ONE THING
 * They shipped as two panels describing the same room and disagreeing about it.
 * The cam was a diorama of an open chamber where figures wandered freely; the
 * barricade said you were posted at a fixed station. No tuning reconciles that,
 * because it is different geometry — so the cam became the barricade.
 *
 * The enclosure is the second half of that fix. Three marks on a back wall are
 * a fence: nothing is coming, so holding them means nothing. Four walls with a
 * horde pressing from outside make the stakes visible without a word of
 * explanation, and four walls cannot be covered by five players, so where you
 * stand is finally a decision with a cost.
 *
 * 🚨 EVERYONE INSIDE LOOKS THE SAME. THIS IS LOad-BEARING.
 * The cam places figures TRUTHFULLY in aggregate — station occupancy is real —
 * and players announce their positions in chat constantly. Add any visible mark
 * on infected figures and those three facts combine: a wall shows three bodies,
 * three players claimed that wall, one body is marked, and the suspect pool just
 * went from five to three with nobody having said anything true. Two rounds of
 * that and the game is solved by watching instead of reasoning.
 *
 * So inside the compound there are no marks, no colours, no tells. The dread is
 * that the figures are indistinguishable and one of them is lying. The only
 * truthful figure on any screen is the local player's own, which reveals
 * nothing to anyone else — the guarantee OutbreakDirector already makes.
 *
 * The zombies stay outside, where being visibly zombies costs nothing.
 */

/** Fraction of the canvas the compound occupies. The margin is the outside
 *  world — treeline, fog, and the horde — and it has to be wide enough to read
 *  as somewhere rather than as a border. */
const INSET_X = 0.19
const INSET_TOP = 0.3
const INSET_BOTTOM = 0.13

export interface Rect { x: number; y: number; w: number; h: number }

/** The compound's footprint in canvas pixels. */
export function compoundRect(w: number, h: number, padTop: number, padBottom: number): Rect {
  const top = padTop + (h - padTop - padBottom) * INSET_TOP
  const bottom = h - padBottom - (h - padTop - padBottom) * INSET_BOTTOM
  return { x: w * INSET_X, y: top, w: w * (1 - INSET_X * 2), h: Math.max(24, bottom - top) }
}

export interface StationAnchor { x: number; y: number }

/**
 * Where defenders of a given wall stand: just inside it, not flush against it.
 * A figure pressed into the boards reads as scenery; a figure standing off them
 * reads as someone bracing.
 */
export function stationAnchor(station: number, rect: Rect): StationAnchor {
  const inset = Math.min(26, rect.h * 0.22)
  switch (station) {
    case 0: return { x: rect.x + rect.w / 2, y: rect.y + inset }              // North
    case 1: return { x: rect.x + rect.w - inset, y: rect.y + rect.h / 2 }     // East
    case 2: return { x: rect.x + rect.w / 2, y: rect.y + rect.h - inset }     // South
    default: return { x: rect.x + inset, y: rect.y + rect.h / 2 }             // West
  }
}

/** The wall segment itself, as a line, for drawing and for pressure effects. */
export function wallSegment(station: number, rect: Rect): { x1: number; y1: number; x2: number; y2: number } {
  const { x, y, w, h } = rect
  switch (station) {
    case 0: return { x1: x, y1: y, x2: x + w, y2: y }
    case 1: return { x1: x + w, y1: y, x2: x + w, y2: y + h }
    case 2: return { x1: x, y1: y + h, x2: x + w, y2: y + h }
    default: return { x1: x, y1: y, x2: x, y2: y + h }
  }
}

/** Outward-facing normal, so the horde masses on the correct side of a wall. */
export function wallOutward(station: number): { dx: number; dy: number } {
  switch (station) {
    case 0: return { dx: 0, dy: -1 }
    case 1: return { dx: 1, dy: 0 }
    case 2: return { dx: 0, dy: 1 }
    default: return { dx: -1, dy: 0 }
  }
}

export interface AssignInput {
  readonly ids: readonly number[]
  readonly myId: number | null
  /** The local player's REAL wall — the one truthful placement. */
  readonly myStation: number | null
  /** Server-published headcount per wall. Counts only, never names. */
  readonly occupancy: readonly number[]
  /** Previous assignment, so figures do not teleport between frames. */
  readonly previous: ReadonlyMap<number, number>
}

/**
 * Assigns each living figure to a wall so the per-wall totals match `occupancy`
 * exactly.
 *
 * Stability is what `previous` is for. Recomputing freely every time the server
 * spoke would have figures swapping walls for no visible reason, which reads as
 * a bug and destroys the one thing this is for — watching a wall thin out.
 */
export function assignStations(input: AssignInput): Map<number, number> {
  const { ids, myId, myStation, occupancy, previous } = input
  const stations = occupancy.length || 4
  const remaining = Array.from({ length: stations }, (_, i) => occupancy[i] ?? 0)
  const out = new Map<number, number>()

  // 1. The local player first and unconditionally: theirs is the only truthful
  //    placement on this screen, so it is never traded away to satisfy a count.
  if (myId !== null && myStation !== null && ids.includes(myId)) {
    out.set(myId, myStation)
    remaining[myStation] = Math.max(0, remaining[myStation] - 1)
  }

  // 2. Anyone already standing somewhere that still has room stays put.
  for (const id of ids) {
    if (out.has(id)) continue
    const prev = previous.get(id)
    if (prev !== undefined && remaining[prev] > 0) {
      out.set(id, prev)
      remaining[prev]--
    }
  }

  // 3. The rest fill the gaps in order, so the totals come out exact.
  let cursor = 0
  for (const id of ids) {
    if (out.has(id)) continue
    while (cursor < stations && remaining[cursor] <= 0) cursor++
    // Counts can under-cover the roster for a frame — a figure the director has
    // not retired yet, a snapshot in flight. Park the remainder rather than
    // dropping anyone off the board.
    const station = cursor < stations ? cursor : stations - 1
    out.set(id, station)
    if (cursor < stations) remaining[cursor]--
  }

  return out
}
