/**
 * barricadeStations.ts — the compound: four walls, an inside, and an outside.
 *
 * WHY THE CAM AND THE BARRICADE ARE ONE THING
 * They shipped as two panels describing the same room and disagreeing about it.
 * The cam was a diorama of an open chamber where figures wandered freely; the
 * barricade said you were posted at a fixed station. No tuning reconciles that,
 * because it is different geometry — so the cam became the barricade.
 *
 * THE COMPOUND IS A TRAPEZOID, NOT A RECTANGLE.
 * An axis-aligned box reads as a diagram: a plan view with people standing on
 * it, which is exactly how the first version looked. Foreshortening the far
 * wall — narrower and higher, with the near wall wide and low — puts the camera
 * above and behind the survivors and makes the enclosure a place they are
 * standing IN. Everything else (figure scale, wall thickness, plank spacing)
 * keys off the same depth, so the parts agree.
 *
 * 🚨 EVERYONE INSIDE LOOKS THE SAME. THIS IS LOAD-BEARING.
 * The cam places figures TRUTHFULLY in aggregate — station occupancy is real —
 * and players announce their walls in chat constantly. Add any visible mark on
 * infected figures and those three facts combine: a wall shows three bodies,
 * three players claimed that wall, one body is marked, and the suspect pool
 * just went from five to three with nobody having said anything true. Two
 * rounds of that and the game is solved by watching instead of reasoning.
 *
 * So inside the compound there are no marks, no colours, no tells. The only
 * truthful figure on any screen is the local player's own, which reveals
 * nothing to anyone else.
 *
 * The zombies stay outside, where being visibly zombies costs nothing.
 */

/**
 * Compound proportions.
 *
 * The first pass gave the near wall 80% of the canvas width against ~100px of
 * depth — an 8:1 corridor, not a courtyard, which is a large part of why it
 * read as a diagram. Pulling the walls in does two things at once: the
 * enclosure gets plausible proportions, and the margin outside becomes wide
 * enough for the treeline and the horde to be somewhere rather than a border.
 */
/** Horizontal inset of the NEAR (south) wall — the widest edge. */
const NEAR_INSET_X = 0.20
/** Horizontal inset of the FAR (north) wall. The gap between the two IS the
 *  perspective, so it stays generous. */
const FAR_INSET_X = 0.36
/** Where the far and near walls sit in the usable vertical band. */
const FAR_Y = 0.22
/**
 * The near wall stops well short of the bottom edge.
 *
 * At 0.93 there were about twenty pixels of ground between the south boarding
 * and the end of the canvas — not enough for a treeline, so the south side read
 * as bare, and not enough for the horde to work that wall without standing on
 * it. The forest needs somewhere to be on all four sides, not three.
 *
 * The figure is now set by arithmetic rather than taste: the south strip has to
 * fit the boarding's half-thickness (~21px), a walker's clearance (~12px) and a
 * whole walker's HEIGHT (~26px) below that, or the horde ends up drawn across
 * the boards it is supposed to be outside of. ~60px, which 0.78 buys on a
 * 400px cam with room to spare and on a 240px one with none.
 */
const NEAR_Y = 0.74

export interface Corners {
  /** Far-left, far-right, near-right, near-left — clockwise from the back. */
  fl: { x: number; y: number }
  fr: { x: number; y: number }
  nr: { x: number; y: number }
  nl: { x: number; y: number }
}

export function compoundShape(w: number, h: number, padTop: number, padBottom: number): Corners {
  const band = Math.max(1, h - padTop - padBottom)
  const farY = padTop + band * FAR_Y
  const nearY = padTop + band * NEAR_Y
  return {
    fl: { x: w * FAR_INSET_X, y: farY },
    fr: { x: w * (1 - FAR_INSET_X), y: farY },
    nr: { x: w * (1 - NEAR_INSET_X), y: nearY },
    nl: { x: w * NEAR_INSET_X, y: nearY },
  }
}

/** 0 at the far wall, 1 at the near wall — the depth every other size keys off. */
export function depthAt(y: number, c: Corners): number {
  return Math.min(1, Math.max(0, (y - c.fl.y) / Math.max(1, c.nl.y - c.fl.y)))
}

/**
 * Half-thickness of the boarding at a given depth. Near walls are heavier.
 *
 * Geometry, not decoration, which is why it lives here rather than with the
 * drawing code: where a defender can stand, where the horde has to stay, and
 * how wide the planks are drawn all have to agree, and they only agree if they
 * are reading the same number.
 */
export function wallBand(d: number): number {
  return 9 + d * 12
}

export interface Segment { x1: number; y1: number; x2: number; y2: number }

/** Wall segments, in station order: North, East, South, West. */
export function wallSegment(station: number, c: Corners): Segment {
  switch (station) {
    case 0: return { x1: c.fl.x, y1: c.fl.y, x2: c.fr.x, y2: c.fr.y }
    case 1: return { x1: c.fr.x, y1: c.fr.y, x2: c.nr.x, y2: c.nr.y }
    case 2: return { x1: c.nl.x, y1: c.nl.y, x2: c.nr.x, y2: c.nr.y }
    default: return { x1: c.fl.x, y1: c.fl.y, x2: c.nl.x, y2: c.nl.y }
  }
}

/** Outward normal of a wall, for massing the horde on the correct side. */
export function wallOutward(station: number, c: Corners): { dx: number; dy: number } {
  const s = wallSegment(station, c)
  const dx = s.x2 - s.x1
  const dy = s.y2 - s.y1
  const len = Math.hypot(dx, dy) || 1
  // Right-hand normal, then flipped to point away from the centre.
  let nx = dy / len
  let ny = -dx / len
  const cx = (c.fl.x + c.fr.x + c.nr.x + c.nl.x) / 4
  const cy = (c.fl.y + c.fr.y + c.nr.y + c.nl.y) / 4
  const mx = (s.x1 + s.x2) / 2
  const my = (s.y1 + s.y2) / 2
  if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny }
  return { dx: nx, dy: ny }
}

export interface StationAnchor { x: number; y: number }

/**
 * Where defenders stand: just inside their wall, pulled toward the centre.
 * A figure pressed into the boards reads as scenery; one standing off them
 * reads as somebody bracing.
 */
export function stationAnchor(station: number, c: Corners): StationAnchor {
  const s = wallSegment(station, c)
  const out = wallOutward(station, c)
  const mx = (s.x1 + s.x2) / 2
  const my = (s.y1 + s.y2) / 2
  // 🚨 MEASURED FROM THE BOARDING, NOT FROM THE COMPOUND'S SIZE.
  //
  // This was a fraction of the compound's depth clamped to 38–60px, which is a
  // number picked when the walls were stroked lines and had no thickness worth
  // measuring. It has no relationship to where the planks actually end, so it
  // was far too generous on the north and south walls in particular: defenders
  // stood most of a body-length out in the yard from a wall they were meant to
  // be holding, which reads as loitering near it rather than bracing against
  // it.
  //
  // The timber's own half-thickness plus enough room for a body to stand and
  // brace. That puts them right up against the boards on every side, and it
  // stays correct if the boarding is ever redrawn thicker.
  const inset = wallBand(depthAt(my, c)) + 15
  return { x: mx - out.dx * inset, y: my - out.dy * inset }
}

/**
 * The idle area: the middle of the compound, well clear of every wall.
 *
 * Figures with nothing to defend belong here rather than drifting into the
 * boards. Between pushes — and in every phase where the barricade is not
 * running — the room mills around in the open, and closing on a wall becomes a
 * visible act rather than the default state.
 */
export function interiorPoint(c: Corners, rx: number, ry: number): StationAnchor {
  const t = 0.34 + ry * 0.32
  const left = c.fl.x + (c.nl.x - c.fl.x) * t
  const right = c.fr.x + (c.nr.x - c.fr.x) * t
  const y = c.fl.y + (c.nl.y - c.fl.y) * t
  const pad = (right - left) * 0.26
  return { x: left + pad + rx * (right - left - pad * 2), y }
}

/**
 * Clamps a point inside the compound.
 *
 * Figures used to be bounded by the canvas rather than by the walls, so they
 * strolled straight through a barricade and stood in the forest — which made
 * nonsense of the entire picture. Interpolating the left and right edges at the
 * point's own depth keeps them inside the trapezoid rather than inside its
 * bounding box.
 */
export function clampInside(x: number, y: number, c: Corners, margin = 10): { x: number; y: number } {
  const top = c.fl.y + margin
  const bottom = c.nl.y - margin
  const cy = Math.min(bottom, Math.max(top, y))
  const t = (cy - c.fl.y) / Math.max(1, c.nl.y - c.fl.y)
  const left = c.fl.x + (c.nl.x - c.fl.x) * t + margin
  const right = c.fr.x + (c.nr.x - c.fr.x) * t - margin
  return { x: Math.min(right, Math.max(left, x)), y: cy }
}

/** True when a point lies within the compound walls. */
export function isInside(x: number, y: number, c: Corners): boolean {
  if (y < c.fl.y || y > c.nl.y) return false
  const t = (y - c.fl.y) / Math.max(1, c.nl.y - c.fl.y)
  return x > c.fl.x + (c.nl.x - c.fl.x) * t && x < c.fr.x + (c.nr.x - c.fr.x) * t
}

/**
 * Pushes a point OUT of the compound — the mirror of clampInside, and the
 * reason the inside is a safe zone.
 *
 * The horde walked in a straight line toward its target, and a walker on the
 * north side heading for a point on the south side simply strolled through the
 * courtyard. Play-testing read that, correctly, as zombies inside the
 * barricade, which makes nonsense of the barricade.
 *
 * Applied every frame rather than only at target-selection, because it is the
 * PATH that trespasses, not the destination. The visible consequence is that a
 * walker crossing to the far side slides along the outside of the boards
 * instead of through them — which is what something looking for a way in
 * actually looks like.
 */
export function clampOutside(
  x: number, y: number, c: Corners, margin = 14,
  /**
   * Extra clearance when the way out is DOWNWARD, i.e. past the south wall.
   *
   * The other three sides need only the boarding's own thickness, because a
   * figure standing beyond them is drawn above or beside the planks and reads
   * as outside without any help. The south wall is the exception: a body drawn
   * just below it extends UP across the boards, and everything above the south
   * wall is the courtyard — so a walker there looks like it is standing inside
   * the compound, which is exactly what play-testing kept reporting. Pushing it
   * a full body-height clear is what makes "outside" unambiguous on that side.
   */
  downMargin = 0,
): { x: number; y: number } {
  if (!isInside(x, y, c)) return { x, y }
  let best = { x, y }
  let bestD = Infinity
  for (let i = 0; i < 4; i++) {
    const s = wallSegment(i, c)
    const dx = s.x2 - s.x1
    const dy = s.y2 - s.y1
    const len2 = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / len2))
    const px = s.x1 + dx * t
    const py = s.y1 + dy * t
    const d = Math.hypot(x - px, y - py)
    if (d < bestD) {
      bestD = d
      const out = wallOutward(i, c)
      const m = margin + Math.max(0, out.dy) * downMargin
      best = { x: px + out.dx * m, y: py + out.dy * m }
    }
  }
  return best
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
 * Assigns each living figure to a wall so per-wall totals match `occupancy`.
 *
 * Stability is what `previous` is for: recomputing freely every time the server
 * spoke would have figures swapping walls for no visible reason, which reads as
 * a bug and destroys the one thing this is for — watching a wall thin out.
 */
export function assignStations(input: AssignInput): Map<number, number> {
  const { ids, myId, myStation, occupancy, previous } = input

  // 🚨 NO OCCUPANCY MEANS NOBODY IS POSTED — NOT "EVERYONE ON THE LAST WALL".
  // With an empty or all-zero occupancy the fill loop below ran its cursor off
  // the end and parked every single figure on station 3. That is what produced
  // the stampede at every phase change: Discussion ends, occupancy empties, and
  // the entire room breaks for the west wall at a sprint for no reason anyone
  // watching could name.
  const posted = occupancy.reduce((a, b) => a + (b > 0 ? b : 0), 0)
  if (posted <= 0) return new Map()

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
    const station = cursor < stations ? cursor : stations - 1
    out.set(id, station)
    if (cursor < stations) remaining[cursor]--
  }

  return out
}
