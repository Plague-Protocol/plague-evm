/**
 * walkerSprites — a pre-rendered sprite atlas for the horde outside the walls.
 *
 * The survivors inside the compound became sprites first (see
 * survivorSprites.ts, which carries the full argument for why filled
 * silhouettes beat stroked lines at 20-odd pixels). The horde was left stroked,
 * which turned out to be the bigger problem of the two: a typical room holds
 * four to ten players against a horde of twenty-four, so roughly FOUR OUT OF
 * FIVE figures on screen were still drawn in the old style, and the two styles
 * stood in the same frame — 24 px of filled body next to 20 px of hairline.
 *
 * ── The angle problem, and why an atlas still works ──────────────────────────
 *
 * A survivor only ever walks or stands, which is what made an atlas easy. A
 * walker CLAWS AT A SPECIFIC BOARD: its lean, its reach and the squash on that
 * reach all follow the inward normal of whichever wall it is working. That
 * sounds continuous, and it nearly is — but the four wall normals account for
 * all of it except a deliberate per-walker jitter of about ±12°, small enough
 * to apply as a rotation at blit time rather than as extra cells.
 *
 * So the atlas bakes the stoop, the reach and the shamble against ONE canonical
 * direction (reaching along +x), and the scene rotates the whole cell to point
 * at the wall. The vertical squash the old code applied by hand — walkers on
 * the near and far walls lean toward the camera rather than collapsing into a
 * vertical line — becomes a scale on the rotated context.
 *
 * ── What is deliberately NOT varied ──────────────────────────────────────────
 *
 * 🚨 EVERY WALKER IS BUILT THE SAME.
 * Survivors get twelve builds because telling them apart is the point — it
 * gives players something to lie about. The horde is the opposite: it should
 * read as a mass. Giving the infected recognisable silhouettes would make a
 * turned figure trackable across frames, which is exactly the leak the uniform
 * rule inside the compound exists to prevent. Variety here is limited to the
 * walk phase, which no one can track.
 */

/** Frames in the shamble cycle. */
export const WALKER_FRAMES = 6

/**
 * Which way a walker is turned relative to the camera.
 *
 * 🚨 THESE ARE THREE DIFFERENT POSES, NOT ONE POSE MIRRORED.
 * Every walker faces the boards it is clawing at, and the camera looks down the
 * scene — so a walker on the FAR (north) wall is reaching away from us and we
 * see its back, one on the NEAR (south) wall is reaching toward us and we see
 * its front, and the east and west walls show a profile. A mirror turns east
 * into west, but nothing turns a back into a front.
 *
 * The first cut tried to cover all four walls with one profile cell plus a
 * horizontal mirror and a small shear. On the east and west walls that worked.
 * On the north and south the toward-wall vector has NO horizontal component, so
 * the mirror did nothing and every walker on both of those walls reached east
 * regardless — two whole ranks standing side-on to the boards they were
 * supposedly attacking, which is exactly the failure the facing rule exists to
 * prevent.
 */
export const POSE_PROFILE = 0
export const POSE_BACK = 1
export const POSE_FRONT = 2
export const POSE_COUNT = 3

/** Cell size in sprite pixels, before the scene scales it down. */
const CELL_W = 96
const CELL_H = 96
/** Where the walker's feet sit inside its cell, as a fraction of CELL_H. */
const FOOT_Y = 0.92
/** Nominal walker height in cell pixels. */
const FIG_H = CELL_H * 0.62

/**
 * Luminance ramp. Same trick as the survivor atlas: cells are white, and the
 * caller multiplies the horde's sickly green through them, so one texture
 * serves every tint the scene might want.
 */
const LIT = 'rgba(255,255,255,1)'
const BODY = 'rgba(255,255,255,0.84)'
const SHADE = 'rgba(255,255,255,0.58)'
const DARK = 'rgba(255,255,255,0.36)'

export interface WalkerAtlas {
  canvas: HTMLCanvasElement
  cellW: number
  cellH: number
  dpr: number
  footY: number
}

/**
 * One walker, feet at the origin, reaching along +x.
 *
 * The canonical direction matters: the scene rotates this whole cell to aim it
 * at a wall, so everything here is drawn as though the boards were directly to
 * the right.
 */
function drawWalkerCell(ctx: CanvasRenderingContext2D, frame: number, pose: number) {
  const H = FIG_H
  const cyc = (frame / WALKER_FRAMES) * Math.PI * 2
  const swing = Math.sin(cyc)
  // Facing the camera or away from it, the reach is FORESHORTENED: arms that
  // would extend toward or past the viewer cannot be drawn extending sideways,
  // so they shorten and drop instead, and both are visible rather than one
  // hiding the other behind the torso.
  const axial = pose !== POSE_PROFILE
  // Hips rise on the step. A shamble bobs more than a walk and less evenly.
  const bob = Math.abs(Math.sin(cyc)) * H * 0.022

  const hipY = -H * 0.46 + bob
  // Pitched forward over its own feet. This is the hunch, and it is most of
  // what separates a walker from a survivor at this size.
  //
  // 🚨 KEPT SMALL, BECAUSE THE SHEAR ADDS TO IT.
  // 0.16 put the torso 28° off vertical in the cell. On the north and south
  // walls the scene then shears by another 18° to aim the reach at the boards,
  // and 46° of total lean plus arms reaching a full leg-length sideways stopped
  // reading as a stoop: the figure became a horizontal mass with a head on one
  // end. The cell leans a little; the scene supplies the rest.
  const lean = axial ? 0 : H * 0.085
  const shoulderY = hipY - H * 0.31
  const headR = H * 0.105
  const headX = lean + (axial ? 0 : H * 0.10)
  const headY = shoulderY - headR * 0.55

  // ── Legs ────────────────────────────────────────────────────────────────
  // Same construction as the survivors: two hips, a stride that opens and
  // closes, tapered masses rather than strokes. A walker drags one foot, so the
  // two legs are deliberately asymmetric.
  const leg = (dir: number, phase: number, drag: boolean, back: boolean) => {
    const hipX = dir * H * 0.055
    const stride = Math.sin(cyc + phase) * H * (drag ? 0.05 : 0.10)
    const footX = hipX + stride + lean * 0.35
    const kneeX = hipX + stride * 0.4 + lean * 0.2
    const thighHalf = H * 0.062
    const shinHalf = H * 0.042
    const kneeY = hipY * 0.46
    ctx.fillStyle = back ? SHADE : BODY
    ctx.beginPath()
    ctx.moveTo(hipX - thighHalf, hipY)
    ctx.lineTo(hipX + thighHalf, hipY)
    ctx.lineTo(kneeX + shinHalf, kneeY)
    ctx.lineTo(footX + shinHalf * 0.92, 0)
    ctx.lineTo(footX - shinHalf * 0.92, 0)
    ctx.lineTo(kneeX - shinHalf, kneeY)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = DARK
    ctx.beginPath()
    ctx.ellipse(footX, -H * 0.014, shinHalf * 1.5, H * 0.022, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  leg(-1, Math.PI, true, swing < 0)

  // ── Torso ───────────────────────────────────────────────────────────────
  // Leaning forward, and narrower at the shoulders than a survivor's: the
  // horde reads as wasted, not as people who have been eating.
  const shoulderHalf = H * 0.115
  ctx.fillStyle = BODY
  ctx.beginPath()
  ctx.moveTo(lean - shoulderHalf, shoulderY)
  ctx.lineTo(lean + shoulderHalf, shoulderY)
  ctx.lineTo(H * 0.070, hipY + H * 0.02)
  ctx.lineTo(-H * 0.070, hipY + H * 0.02)
  ctx.closePath()
  ctx.fill()
  // 🚨 THE BOWED BACK IS A PROFILE FEATURE ONLY.
  // A curved dark mass down one side of the torso reads as a spine seen from
  // the side, which is the point — a straight hip-to-shoulder line looks like
  // someone bending over, a curve looks like someone who cannot stand up. But
  // it was drawn in EVERY pose, including the front view, where there is no
  // back to show: the dark side then read as the rear of the head and
  // shoulders, so a walker on the near wall looked like it had its eyes on the
  // back of its skull. Seen head-on a body has a centre line, not a spine.
  ctx.fillStyle = SHADE
  ctx.beginPath()
  if (axial) {
    // Centred shading: darker at the flanks, light down the middle, so the
    // chest reads as a rounded mass facing us rather than a slab.
    ctx.moveTo(-shoulderHalf, shoulderY)
    ctx.lineTo(-shoulderHalf * 0.42, shoulderY)
    ctx.lineTo(-H * 0.028, hipY + H * 0.02)
    ctx.lineTo(-H * 0.070, hipY + H * 0.02)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(shoulderHalf, shoulderY)
    ctx.lineTo(shoulderHalf * 0.42, shoulderY)
    ctx.lineTo(H * 0.028, hipY + H * 0.02)
    ctx.lineTo(H * 0.070, hipY + H * 0.02)
    ctx.closePath()
    ctx.fill()
  } else {
    ctx.moveTo(-H * 0.070, hipY + H * 0.02)
    ctx.quadraticCurveTo(-H * 0.11, hipY - H * 0.18, lean - shoulderHalf, shoulderY)
    ctx.lineTo(lean - shoulderHalf * 0.3, shoulderY)
    ctx.quadraticCurveTo(-H * 0.03, hipY - H * 0.16, H * 0.010, hipY + H * 0.02)
    ctx.closePath()
    ctx.fill()
  }
  // Ribs — two short dark breaks across the chest. At this size they read as
  // "this body is wrong" rather than as anatomy, which is the intent.
  ctx.fillStyle = DARK
  for (let r = 0; r < 2; r++) {
    const ry = shoulderY + H * (0.085 + r * 0.075)
    ctx.fillRect(lean - shoulderHalf * 0.55, ry, shoulderHalf * 1.15, H * 0.016)
  }

  // ── Arms ────────────────────────────────────────────────────────────────
  // Both reaching toward the boards, at different heights and out of phase, so
  // a rank of them does not pulse in unison.
  const arm = (drop: number, phase: number, back: boolean, side = 1) => {
    const sw = Math.sin(cyc + phase) * H * 0.05
    const topX = lean + (axial ? side * H * 0.075 : 0)
    const topY = shoulderY + H * 0.02
    // 🚨 SHORTER THAN IT WANTS TO BE. At 0.52 — and even at 0.40 — the hands
    // reached as far sideways as the legs reached down, so the figure's widest
    // axis was horizontal and it read as lying down rather than reaching. A
    // walker's arms are out in front of it, not wings.
    //
    // Foreshortened in the axial poses: an arm reaching toward or away from the
    // camera projects to almost nothing horizontally, so it drops instead. The
    // hands end up low and close to the body, which is what a reach looks like
    // seen end-on.
    const reachX = axial ? topX + side * H * 0.055 : topX + H * 0.30
    const reachY = axial ? topY + H * (drop + 0.22) + sw : topY + H * drop + sw
    const upHalf = H * 0.040
    const loHalf = H * 0.026
    ctx.fillStyle = back ? SHADE : BODY
    ctx.beginPath()
    ctx.moveTo(topX, topY - upHalf)
    ctx.lineTo(topX, topY + upHalf)
    ctx.lineTo(reachX, reachY + loHalf)
    ctx.lineTo(reachX, reachY - loHalf)
    ctx.closePath()
    ctx.fill()
    // The hand: splayed, and the furthest-forward thing on the figure. This is
    // the silhouette cue that says "reaching" rather than "standing".
    ctx.fillStyle = back ? SHADE : LIT
    ctx.beginPath()
    ctx.ellipse(reachX + H * 0.018, reachY, H * 0.038, H * 0.026, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  arm(0.14, Math.PI * 0.6, true, -1)

  // ── Head ────────────────────────────────────────────────────────────────
  // Hung forward off the neck, tilted. A level head reads as alert.
  ctx.fillStyle = SHADE
  ctx.fillRect(lean - H * 0.020, shoulderY - H * 0.030, H * 0.052, H * 0.042)
  ctx.fillStyle = LIT
  ctx.beginPath()
  ctx.ellipse(headX, headY, headR * 1.06, headR * 0.94, 0.18, 0, Math.PI * 2)
  ctx.fill()
  // Jaw, hanging open. Two pixels of gap at render size, and it does more for
  // "this is not a person any more" than anything else on the figure.
  //
  // A walker on the FAR wall has its back to us, so there is no jaw to see —
  // just the shadowed curve of a skull. Drawing a face on the back of a head is
  // the kind of detail nobody consciously notices and everybody feels.
  if (pose !== POSE_BACK) {
    ctx.fillStyle = DARK
    ctx.beginPath()
    ctx.ellipse(
      headX + (axial ? 0 : headR * 0.42),
      headY + headR * (axial ? 0.50 : 0.62),
      headR * (axial ? 0.34 : 0.46), headR * 0.34,
      axial ? 0 : 0.3, 0, Math.PI * 2,
    )
    ctx.fill()
  }
  // Skull shading.
  //
  // 🚨 A HALF-DISC OF SHADOW SAYS WHICH WAY THE HEAD IS TURNED, so it must not
  // be drawn on a head that is facing us. In profile it belongs on the rear of
  // the skull, opposite the jaw, and that is what makes the face read as facing
  // the boards. On a BACK view it wraps the whole crown, since there is no lit
  // face to leave uncovered. On a FRONT view it must be neither: a dark half on
  // one side of a forward-facing skull reads as the back of the head, which is
  // exactly why the near wall's walkers looked like their eyes were behind
  // them. Head-on, the shadow sits UNDER the brow instead.
  ctx.fillStyle = SHADE
  ctx.beginPath()
  if (pose === POSE_BACK) {
    ctx.arc(headX, headY - headR * 0.12, headR * 0.86, 0, Math.PI * 2)
  } else if (pose === POSE_FRONT) {
    // A brow line: shadow across the top of the skull, face lit below it.
    ctx.ellipse(headX, headY - headR * 0.52, headR * 0.92, headR * 0.42, 0, 0, Math.PI * 2)
  } else {
    ctx.arc(headX - headR * 0.36, headY, headR * 0.82, Math.PI * 0.5, Math.PI * 1.5)
  }
  ctx.fill()

  // ── Near leg and near arm, over the torso ───────────────────────────────
  leg(1, 0, false, swing >= 0)
  arm(0.26, 0, false, 1)
}

/**
 * Build the atlas: one row, WALKER_FRAMES columns.
 *
 * 🚨 EYES ARE NOT IN HERE. They are drawn by the scene as one batched shadowed
 * fill for the whole horde — canvas shadowBlur is the most expensive thing in
 * that loop, and baking a glow into each cell would either lose the glow or
 * multiply it by the headcount. See drawHorde.
 */
export function renderWalkerAtlas(dpr: number): WalkerAtlas | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(CELL_W * WALKER_FRAMES * dpr))
  canvas.height = Math.max(1, Math.floor(CELL_H * POSE_COUNT * dpr))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  for (let pose = 0; pose < POSE_COUNT; pose++) {
    for (let f = 0; f < WALKER_FRAMES; f++) {
      ctx.save()
      ctx.translate(f * CELL_W + CELL_W * 0.34, pose * CELL_H + CELL_H * FOOT_Y)
      drawWalkerCell(ctx, f, pose)
      ctx.restore()
    }
  }

  return { canvas, cellW: CELL_W, cellH: CELL_H, dpr, footY: CELL_H * FOOT_Y }
}

/** A tinted copy. Same source-in trick as the survivor atlas. */
export function tintWalkerAtlas(atlas: WalkerAtlas, color: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const out = document.createElement('canvas')
  out.width = atlas.canvas.width
  out.height = atlas.canvas.height
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(atlas.canvas, 0, 0)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, out.width, out.height)
  return out
}

/**
 * Where the walker's reaching hand lands, in cell-space units relative to the
 * feet, along the canonical +x direction.
 *
 * Exported for the eye positions: the scene needs to know where the head is
 * after rotation, and deriving it here keeps the two in step.
 */
export function walkerHeadOffset(frame: number, pose: number): { x: number; y: number; r: number } {
  // ⚠ THESE CONSTANTS MIRROR drawWalkerCell AND MUST TRACK IT.
  // They silently did not: the cell's proportions were corrected once (the
  // figures were reading as lying down) and this copy kept the old hip, lean
  // and shoulder values, so the eye glow was placed on a skull that had since
  // moved. It verified fine against itself and was wrong on screen. If you
  // change a proportion above, change it here in the same edit.
  const H = FIG_H
  const cyc = (frame / WALKER_FRAMES) * Math.PI * 2
  const bob = Math.abs(Math.sin(cyc)) * H * 0.022
  const hipY = -H * 0.46 + bob
  const axial = pose !== POSE_PROFILE
  const lean = axial ? 0 : H * 0.085
  const shoulderY = hipY - H * 0.31
  const headR = H * 0.105
  return { x: lean + (axial ? 0 : H * 0.10), y: shoulderY - headR * 0.55, r: headR }
}
