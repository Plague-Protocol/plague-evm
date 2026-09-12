/**
 * survivorSprites — a pre-rendered sprite atlas for the people in the compound.
 *
 * The quarantine cam used to draw every survivor as stroked line segments: a
 * 2 px spine, two legs, two arms, a filled circle for a head. At the size these
 * figures actually occupy — roughly 26 to 39 CSS px tall, since perspectiveScale
 * runs 0.72 to 1.22 over a 240 px mobile scene — a stick figure reads as a
 * diagram rather than a person. The eye recognises MASS before it recognises
 * limbs, so a filled silhouette with a tapered torso and real shoulders reads
 * as human at sizes where an articulated stick figure does not.
 *
 * Rather than stroke those shapes per figure per frame, each build is rendered
 * ONCE into an offscreen atlas and blitted with drawImage. Four walk frames per
 * build, so the legs actually cycle.
 *
 * ── Why procedural art instead of a PNG ───────────────────────────────────────
 *
 * 🚨 THE ATLAS IS KEYED ON THE FIGURE ID AND NOTHING ELSE.
 * Figure ids are per-viewer fiction assigned by OutbreakDirector — your cam and
 * mine disagree about which body is whom. Every visual difference between two
 * survivors MUST derive from that id, or the cam starts leaking: placement is
 * truthful in aggregate and players announce their walls in chat, so any
 * appearance that tracked a seat, an address or a role would cut the suspect
 * pool without anyone having said anything true.
 *
 * Shipping a hand-drawn PNG would split that rule across two places — the art
 * file and the lookup that picks a cell. Generating the cells here, from the
 * same seed the rest of the scene already uses, keeps the whole guarantee
 * visible in one function. It also costs zero bytes of payload and no network
 * request, which matters on the MiniPay audience's connections.
 *
 * ── Why the atlas is drawn in white ───────────────────────────────────────────
 *
 * The scene tints figures at draw time: infected, dead, YOU, and the white/amber
 * flash of an electrocution all recolour the same body. So cells are rendered as
 * white-on-transparent with only LUMINANCE varying — lit side, body, shadow
 * side, outline — and the caller multiplies a colour through them. One atlas
 * serves every state instead of one atlas per colour.
 */

/** Frames in a walk cycle. Four is enough for a plod and keeps the atlas small. */
export const WALK_FRAMES = 4

/**
 * Distinct builds in the atlas.
 *
 * 12 = 3 headgear options x 2 heights x 2 shoulder widths. Big enough that a
 * six-player room rarely shows a duplicate, small enough that the whole atlas
 * is one texture upload.
 */
export const BUILD_COUNT = 12

/**
 * Cell size in sprite pixels, BEFORE the scene scales it down.
 *
 * Rendered at 3x the largest on-screen size (~39 px tall at perspectiveScale
 * 1.22) so the blit is always a downscale. Upscaling a sprite is what makes
 * pixel art look muddy; downscaling with the browser's default smoothing reads
 * as anti-aliasing, which is what we want here — this is a dark, foggy scene,
 * not a retro tribute.
 */
const CELL_W = 84
const CELL_H = 120
/** Where the figure's feet sit inside its cell, as a fraction of CELL_H. */
const FOOT_Y = 0.94
/** Nominal figure height in cell pixels — the body is drawn to fill this. */
const FIG_H = CELL_H * 0.82

/**
 * Body proportions, as fractions of figure height.
 *
 * Exported because the scene draws carried items and bracing arms live, over
 * the sprite, and has to land them on the same shoulders and hips the atlas
 * baked in. Keep these and drawSurvivorCell in step.
 */
export const PROP = {
  hipY: -0.44,
  shoulderY: -0.80,
  shoulderHalf: 0.132,
} as const

/** Luminance ramp. The atlas is white; the caller multiplies a hue through it. */
const LIT = 'rgba(255,255,255,1)'
const BODY = 'rgba(255,255,255,0.82)'
const SHADE = 'rgba(255,255,255,0.58)'
const DARK = 'rgba(255,255,255,0.34)'

export interface SpriteBuild {
  /** 0 none · 1 cap · 2 hood */
  hat: 0 | 1 | 2
  /** Multiplier on overall height. */
  height: number
  /** Multiplier on shoulder width. */
  shoulder: number
}

/**
 * The build for a given atlas row.
 *
 * Kept deliberately narrow, for the reason the old stick-figure version was:
 * a big spread reads as different species rather than different people, and a
 * very short figure behind a wall stops reading as a person at all.
 */
export function buildForIndex(i: number): SpriteBuild {
  return {
    hat: (i % 3) as 0 | 1 | 2,
    height: Math.floor(i / 3) % 2 === 0 ? 0.96 : 1.05,
    shoulder: Math.floor(i / 6) % 2 === 0 ? 0.94 : 1.08,
  }
}

/** Which atlas row a figure uses. Seeded from the figure id — see the header. */
export function buildIndexOf(id: number): number {
  return (Math.imul(id + 1, 2654435761) >>> 0) % BUILD_COUNT
}

export interface SurvivorAtlas {
  canvas: HTMLCanvasElement
  cellW: number
  cellH: number
  /** Device-pixel scale the atlas was rendered at. */
  dpr: number
  /** Feet offset inside a cell, in CSS px of cell space. */
  footY: number
}

/**
 * Draw one survivor into the current transform, feet at the origin.
 *
 * Everything is a filled path. The figure is built from four masses — legs,
 * torso, arms, head — each tapered, each with a darker trailing edge so the
 * silhouette has a light direction. That shading is what separates this from
 * the stroked version: a flat white cutout at 30 px reads as a paper doll.
 */
/**
 * Where one arm's shoulder and hand sit, in cell-space units.
 *
 * 🚨 SINGLE SOURCE OF TRUTH FOR THE HAND. The atlas bakes arms into the sprite,
 * but whatever a survivor is CARRYING is still drawn live by the scene, because
 * an item has to swing with the wall a defender braces against. That means two
 * places need the same hand position, and the first cut had the scene guessing
 * at it — it used the old stroked figure's arm swing, a different phase and a
 * different amplitude from the one baked in here, so weapons drifted off the
 * hand and hung in front of the body.
 *
 * Anything that needs to know where a hand is calls this.
 */
export function armGeometry(
  H: number, shoulderHalf: number, hipY: number,
  cyc: number, dir: number, phase: number,
): { topX: number; x: number; y: number } {
  const sw = Math.sin(cyc + phase) * H * 0.055
  const topX = dir * shoulderHalf * 0.88
  return { topX, x: topX + sw * 0.5 + dir * H * 0.012, y: hipY + H * 0.05 }
}

function drawSurvivorCell(ctx: CanvasRenderingContext2D, build: SpriteBuild, frame: number) {
  const H = FIG_H * build.height
  // Walk cycle. Frame 0 and 2 are the passing positions (legs together), 1 and
  // 3 the contact positions (legs apart) — a plod, not a sprint.
  const cyc = (frame / WALK_FRAMES) * Math.PI * 2
  const swing = Math.sin(cyc)
  const bob = Math.abs(Math.cos(cyc)) * H * 0.012

  const hipY = -H * 0.44 - bob
  const shoulderY = -H * 0.80 - bob
  const neckY = -H * 0.835 - bob
  const headR = H * 0.094
  const headY = neckY - headR * 0.92
  const shoulderHalf = H * PROP.shoulderHalf * build.shoulder

  // ── Legs ────────────────────────────────────────────────────────────────
  // Tapered from thigh to ankle. Drawn as quads rather than strokes so the
  // thigh can be visibly thicker than the shin, which is most of what makes a
  // small figure read as a body rather than a wireframe.
  const leg = (dir: number, phase: number, back: boolean) => {
    // 🚨 LEGS HANG FROM TWO HIPS, THEY DO NOT SPLAY FROM ONE POINT.
    // The first cut started both legs at x=0 and ran them out to a foot at
    // ±0.10·H, so every figure stood in a permanent inverted V — and because
    // the stride was a constant rather than a function of the walk cycle, even
    // a STOPPED survivor (which holds frame 0, swing = 0) kept its feet planted
    // wide apart. A leg drops from its own hip socket, near-vertical, and the
    // stride opens and closes with the step.
    const hipX = dir * H * 0.040
    const stride = Math.sin(cyc + phase) * H * 0.085
    const footX = hipX + stride
    // The knee leads the foot on the forward leg and trails it on the back one.
    const kneeX = hipX + stride * 0.45

    // 🚨 THESE ARE WIDER THAN THEY LOOK ON PAPER, AND THEY HAVE TO BE.
    // An earlier cut used 0.040 / 0.026, which at the size these figures
    // actually render — 21 to 36 px tall — put a thigh at 1.5 px and a shin
    // under 1 px. That is THINNER than the 2 px stroke the old stick figures
    // used, so the "filled" legs read as wireframe and the whole exercise
    // looked like no change at all. A real human thigh is about a seventh of
    // body height; anything under ~2.5 px on screen stops reading as mass.
    const thighHalf = H * 0.062
    const shinHalf = H * 0.042
    const kneeY = hipY * 0.44
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
    // Boot. A darker block at the ankle — the cheapest possible shoe, and it
    // stops the leg from tapering into nothing against the ground.
    ctx.fillStyle = DARK
    ctx.beginPath()
    ctx.ellipse(footX + dir * H * 0.008, -H * 0.012, shinHalf * 1.55, H * 0.020, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  // Back leg first, so the near leg overlaps it. `dir` is now which HIP the leg
  // hangs from, and the stride is applied inside — so the two legs step in
  // opposition rather than both swinging the same way.
  leg(-1, Math.PI, swing < 0)

  // ── Torso ───────────────────────────────────────────────────────────────
  // Trapezoid: wide at the shoulders, narrow at the waist. This is the single
  // biggest readability win over the stroked spine.
  ctx.fillStyle = BODY
  ctx.beginPath()
  ctx.moveTo(-shoulderHalf, shoulderY)
  ctx.lineTo(shoulderHalf, shoulderY)
  ctx.lineTo(H * 0.078, hipY + H * 0.02)
  ctx.lineTo(-H * 0.078, hipY + H * 0.02)
  ctx.closePath()
  ctx.fill()
  // Trailing edge, so the torso has a lit side and a shadow side.
  ctx.fillStyle = SHADE
  ctx.beginPath()
  ctx.moveTo(shoulderHalf * 0.34, shoulderY)
  ctx.lineTo(shoulderHalf, shoulderY)
  ctx.lineTo(H * 0.078, hipY + H * 0.02)
  ctx.lineTo(H * 0.026, hipY + H * 0.02)
  ctx.closePath()
  ctx.fill()
  // Belt — a horizontal break at the waist. One dark line does more for scale
  // reading than any amount of detail higher up.
  ctx.fillStyle = DARK
  ctx.fillRect(-H * 0.082, hipY - H * 0.004, H * 0.164, H * 0.022)

  // ── Arms ────────────────────────────────────────────────────────────────
  const arm = (dir: number, phase: number, back: boolean) => {
    const hand = armGeometry(H, shoulderHalf, hipY, cyc, dir, phase)
    const topX = hand.topX
    const handX = hand.x
    const handY = hand.y
    // Same correction as the legs — see the note there.
    const upHalf = H * 0.042
    const loHalf = H * 0.030
    ctx.fillStyle = back ? SHADE : BODY
    ctx.beginPath()
    ctx.moveTo(topX - upHalf, shoulderY + H * 0.006)
    ctx.lineTo(topX + upHalf, shoulderY + H * 0.006)
    ctx.lineTo(handX + loHalf, handY)
    ctx.lineTo(handX - loHalf, handY)
    ctx.closePath()
    ctx.fill()
  }
  arm(swing >= 0 ? 1 : -1, Math.PI, true)

  // ── Head ────────────────────────────────────────────────────────────────
  // Neck first, so the head does not float.
  ctx.fillStyle = SHADE
  ctx.fillRect(-H * 0.016, neckY - H * 0.012, H * 0.032, H * 0.030)
  ctx.fillStyle = LIT
  ctx.beginPath()
  ctx.arc(0, headY, headR, 0, Math.PI * 2)
  ctx.fill()
  // Shadow on the trailing side of the skull.
  ctx.fillStyle = SHADE
  ctx.beginPath()
  ctx.arc(headR * 0.34, headY, headR * 0.88, -Math.PI * 0.5, Math.PI * 0.5)
  ctx.fill()

  // ── Headgear ────────────────────────────────────────────────────────────
  //
  // 🚨 SITS ON THE SKULL, DOES NOT REPLACE IT.
  // An earlier pass drew a cap as an arc of 1.05x head radius and a hood as a
  // 1.35x dome. At this size both simply engulfed the head circle and every
  // survivor turned into a featureless blob. A figure this small has room for
  // one silhouette cue, so the cue sits ABOVE the head's outline.
  if (build.hat === 1) {
    // Cap: a crown over the top of the skull, plus a forward peak.
    ctx.fillStyle = DARK
    ctx.beginPath()
    ctx.arc(0, headY - headR * 0.12, headR * 0.98, Math.PI, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(-headR * 0.2, headY - headR * 0.30)
    ctx.lineTo(-headR * 1.75, headY - headR * 0.30)
    ctx.lineTo(-headR * 1.75, headY - headR * 0.02)
    ctx.lineTo(-headR * 0.2, headY - headR * 0.02)
    ctx.closePath()
    ctx.fill()
  } else if (build.hat === 2) {
    // Hood: a peak rising off the back of the skull, and a cowl on the shoulders.
    ctx.fillStyle = DARK
    ctx.beginPath()
    ctx.moveTo(-headR * 1.0, headY + headR * 0.30)
    ctx.quadraticCurveTo(headR * 0.55, headY - headR * 2.15, headR * 0.95, headY + headR * 0.20)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(-shoulderHalf * 0.8, shoulderY + H * 0.014)
    ctx.lineTo(shoulderHalf * 0.8, shoulderY + H * 0.014)
    ctx.lineTo(headR * 0.8, neckY)
    ctx.lineTo(-headR * 0.8, neckY)
    ctx.closePath()
    ctx.fill()
  }

  // ── Near leg and near arm, over the torso ───────────────────────────────
  leg(1, 0, swing >= 0)
  arm(swing >= 0 ? -1 : 1, 0, false)
}

/**
 * Build the atlas: BUILD_COUNT rows x WALK_FRAMES columns.
 *
 * Called once on mount and once per DPR change. At 84x120 per cell, 12 builds
 * and 4 frames, the texture is 1008x480 CSS px — about 2 MB of VRAM at DPR 2,
 * which is well inside what a mid-range Android browser holds for a canvas.
 */
export function renderSurvivorAtlas(dpr: number): SurvivorAtlas | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(CELL_W * WALK_FRAMES * dpr))
  canvas.height = Math.max(1, Math.floor(CELL_H * BUILD_COUNT * dpr))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  for (let b = 0; b < BUILD_COUNT; b++) {
    const build = buildForIndex(b)
    for (let f = 0; f < WALK_FRAMES; f++) {
      ctx.save()
      ctx.translate(f * CELL_W + CELL_W / 2, b * CELL_H + CELL_H * FOOT_Y)
      drawSurvivorCell(ctx, build, f)
      ctx.restore()
    }
  }

  return { canvas, cellW: CELL_W, cellH: CELL_H, dpr, footY: CELL_H * FOOT_Y }
}

/**
 * A tinted copy of the atlas.
 *
 * The atlas is white-with-luminance; multiplying a flat colour through it with
 * `source-in` keeps the shading ramp and replaces the hue. Tinted copies are
 * cached by the caller, because there are only ever four or five live colours
 * (survivor, YOU, infected, dead, flash) and re-tinting a 1008x480 texture per
 * frame would cost more than the stroked figures ever did.
 */
export function tintAtlas(atlas: SurvivorAtlas, color: string): HTMLCanvasElement | null {
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
