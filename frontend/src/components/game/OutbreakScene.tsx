'use client'

/**
 * OutbreakScene — the "quarantine cam": an anonymized live diorama of the room.
 *
 * Little canvas-drawn figures wander a dark chamber, the clean ones breaking
 * away whenever a zombie drifts too close. When the plague picks its
 * first host a figure is struck by a bolt and turns; later infections play as
 * a zombie chasing down and biting a victim; eliminations drop a figure where
 * it stands. Which body is which player is per-client fiction supplied by
 * OutbreakDirector — only "your" figure is truthful (and labeled YOU), so the
 * scene can never deanonymize another player. Shield saves (public events)
 * flash a protective ring on an anonymous figure.
 *
 * During Discussion the chamber becomes the BARRICADE: figures post up at three
 * stations along the far wall, the threatened one lights up before a push, and
 * the room watches whether it holds. Only the local player's position is
 * truthful — everyone else is placed to match server-published HEADCOUNTS, so
 * the wall you can see thinning really is thinning while the scene still says
 * nothing about who anyone is. See barricadeStations.ts.
 *
 * Purely decorative: no polling, no RPC — driven entirely by props the game
 * page already derives plus the existing socket stream. Honors
 * prefers-reduced-motion (static tableau, cues applied instantly) and pauses
 * the sim while the tab is hidden.
 */

import { useEffect, useRef } from 'react'
import type { Socket } from 'socket.io-client'
import { OutbreakDirector, type Figure, type FigureKind, type FinaleOutcome, type OutbreakCue } from './outbreakDirector'
import {
  assignStations, stationAnchor, interiorPoint, compoundShape, wallSegment,
  wallOutward, clampInside, clampOutside, isInside, depthAt, wallBand, type Corners,
} from './barricadeStations'

// ── Layout / timing constants ─────────────────────────────────────────────────

const PAD_X = 26
const PAD_TOP = 40
const PAD_BOTTOM = 18
const HUMAN_SPEED = 16
const ZOMBIE_SPEED = 11
const CHASE_SPEED = 58
/** Distance at which a clean figure notices a zombie and breaks away. */
const FLEE_RADIUS = 46
/** Panic speed, scaled up the closer the nearest zombie gets. */
const FLEE_SPEED_MIN = 22
const FLEE_SPEED_MAX = 40
/** Band along each wall that pushes a fleeing figure sideways instead of into a corner. */
const WALL_MARGIN = 30
/** While fleeing, the trigger radius widens by this much — hysteresis, so they run properly clear. */
const FLEE_HOLD_FACTOR = 1.8
const FLEE_HOLD_SECS = 0.9
const ELECTRO_FLICKER_SECS = 1.1
const ELECTRO_TOTAL_SECS = 1.7
const BITE_CHASE_MAX_SECS = 3.5
const BITE_LUNGE_SECS = 1.0
const DEATH_SECS = 1.25
const FINALE_SECS = 2.6
const CUE_GAP_SECS = 0.35
/** How long the room stays scattered after a station breaks. */
const BREACH_SECS = 2.4
/**
 * Answering a wall is a RUN, not a stroll.
 *
 * At the idle walk of 16 px/s, crossing the compound to a threatened wall took
 * well over ten seconds — longer than the eight-second warning, so tapping a
 * wall produced no visible response before the push landed and the control felt
 * broken. A sprint makes the choice legible the instant it is made.
 */
const SPRINT_SPEED = 92
const SPRINT_SECS = 2.6
/**
 * How long a figure braces at a wall after being sent there, before drifting
 * back into the yard.
 *
 * 🚨 A POST IS SOMETHING YOU DO, NOT SOMEWHERE YOU LIVE.
 * Figures used to be pinned to their station for the whole of Discussion, which
 * produced the single worst bug in play-testing: the room stood frozen in four
 * clumps against the boards for three minutes, and — combined with the wall
 * buttons being disabled outside a push warning — a player's own figure looked
 * welded in place and unresponsive to every tap.
 *
 * So the yard is the default. Everyone mills about inside; answering a wall is
 * a sprint out to it, a brace, and a walk back. The one thing that overrides it
 * is an incoming push, when the people assigned to the threatened wall go and
 * stand on it — which is the only moment the placement is carrying information
 * anyway, and now the only moment anyone is standing anywhere.
 *
 * The clock starts on ARRIVAL, not on the tap, so this is eight seconds of
 * actually standing there. It reads much shorter than the number suggests,
 * which is why it has been raised twice: a figure that jogs out, touches the
 * wall and turns straight round does not look like it went to help.
 */
const POST_SECS = 8

const COLOR_HUMAN = '#93a883'
const COLOR_HUMAN_ME = '#d6e6a3'
const COLOR_ZOMBIE = '#8fbf3f'
const COLOR_DEAD = '#3f4f3a'

// ── Runtime types ─────────────────────────────────────────────────────────────

interface Body {
  id: number
  isMe: boolean
  kind: FigureKind
  alive: boolean
  x: number
  y: number
  tx: number
  ty: number
  walk: number
  gait: number
  facing: 1 | -1
  pauseUntil: number
  /** 0 = upright … 1 = corpse on the floor */
  fallT: number
  frozen: boolean
  chasing: boolean
  dying: boolean
  /** Seconds of committed flight left — keeps a scared figure running past the trigger radius. */
  fleeT: number
  staggerT: number
  /** Seconds of sprint left — set when this figure is sent to a new wall. */
  sprintT: number
  /** Seconds of bracing left at a wall before drifting back into the yard. */
  postT: number
  /**
   * Outward normal of the wall this figure is holding, or (0,0) for nobody.
   *
   * A survivor silhouette is symmetrical, so `facing` — which only drives the
   * zombie pose and the death topple — said nothing about which way a defender
   * was turned. You could send your figure to the north wall and watch it stand
   * there apparently facing the yard. This is what turns it around.
   */
  braceX: number
  braceY: number
  transformT: number
  shieldT: number
}

type ActiveCue =
  | { type: 'electrocute'; body: Body; t: number; turned: boolean }
  | { type: 'bite'; z: Body; v: Body; stage: 'chase' | 'lunge'; t: number; turned: boolean }
  | { type: 'death'; body: Body; t: number }
  | { type: 'finale'; outcome: FinaleOutcome; t: number }

const rand = (min: number, max: number) => min + Math.random() * (max - min)

function makeBody(fig: Figure, w: number, h: number): Body {
  return {
    id: fig.id,
    isMe: fig.isMe,
    kind: fig.kind,
    alive: fig.alive,
    x: rand(PAD_X, Math.max(PAD_X + 1, w - PAD_X)),
    y: rand(PAD_TOP, Math.max(PAD_TOP + 1, h - PAD_BOTTOM)),
    tx: rand(PAD_X, Math.max(PAD_X + 1, w - PAD_X)),
    ty: rand(PAD_TOP, Math.max(PAD_TOP + 1, h - PAD_BOTTOM)),
    walk: rand(0, Math.PI * 2),
    gait: 0,
    facing: Math.random() < 0.5 ? 1 : -1,
    pauseUntil: 0,
    fallT: fig.alive ? 0 : 1,
    frozen: false,
    chasing: false,
    dying: false,
    fleeT: 0,
    staggerT: 0,
    sprintT: 0,
    postT: 0,
    braceX: 0,
    braceY: 0,
    transformT: 0,
    shieldT: 0,
  }
}

// ── Drawing ───────────────────────────────────────────────────────────────────

function perspectiveScale(y: number, h: number): number {
  const t = (y - PAD_TOP) / Math.max(1, h - PAD_TOP - PAD_BOTTOM)
  return 0.72 + 0.5 * Math.min(1, Math.max(0, t))
}

/**
 * 🚨 Inside the compound, everyone looks the same.
 *
 * `uniform` is set while the barricade is live. It forces every figure except
 * the local player's own to render as a survivor regardless of what the
 * director privately thinks it is.
 *
 * This is not cosmetic. Station occupancy is TRUTHFUL in aggregate and players
 * announce their walls in chat; a visible infected tell would combine with
 * those two facts to cut the suspect pool without anyone saying anything true.
 * See the header of barricadeStations.ts for the full argument.
 *
 * It costs nothing to enforce, because no infection or elimination cue can fire
 * during Discussion — infections are assigned in the Infection phase and
 * eliminations resolve in Reveal. During Discussion the cam has nothing to
 * narrate except the barricade.
 */
function bodyColor(b: Body, uniform: boolean): string {
  if (!b.alive && b.fallT >= 1) return COLOR_DEAD
  if (uniform && !b.isMe) return COLOR_HUMAN
  if (b.kind === 'zombie') return COLOR_ZOMBIE
  return b.isMe ? COLOR_HUMAN_ME : COLOR_HUMAN
}

/**
 * What this figure is holding.
 *
 * Derived from the figure id, which is per-viewer fiction assigned by
 * OutbreakDirector — so it is stable across frames, costs no traffic, and
 * cannot identify anybody. Everyone carries something: an unarmed crowd behind
 * a barricade reads as a queue, and a scavenged weapon is the cheapest way to
 * say these people are surviving rather than waiting.
 */
function itemOf(id: number): 0 | 1 | 2 {
  return (Math.imul(id + 1, 2654435761) >>> 0) % 3 as 0 | 1 | 2
}

function drawFigure(ctx: CanvasRenderingContext2D, b: Body, t: number, h: number, flash: boolean, shieldAura: boolean, uniform: boolean) {
  const s = perspectiveScale(b.y, h)
  const zombie = b.kind === 'zombie' && !(uniform && !b.isMe)

  // ground shadow
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(b.x, b.y + 1.5 * s, 7 * s, 2.4 * s, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0,0,0,0.4)'
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.translate(b.x + Math.sin(t * 40) * 3 * b.staggerT, b.y)
  if (b.fallT > 0) ctx.rotate(-b.facing * b.fallT * (Math.PI / 2) * 0.96)

  let color = bodyColor(b, uniform)
  if (flash) color = Math.floor(t / 0.06) % 2 === 0 ? '#ffffff' : '#f5c518'
  if (b.isMe && b.alive) {
    ctx.shadowColor = zombie ? 'rgba(230,51,41,0.8)' : 'rgba(107,142,35,0.9)'
    ctx.shadowBlur = 10
  }
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2 * s
  ctx.lineCap = 'round'

  let handA: { x: number; y: number } | null = null
  let handB: { x: number; y: number } | null = null
  const legSwing = Math.sin(b.walk) * 4 * s * b.gait
  const armSwing = Math.sin(b.walk + Math.PI) * 3 * s * b.gait
  const hipY = -11 * s
  const shoulderX = zombie ? b.facing * 4.5 * s : 0
  const shoulderY = zombie ? -19 * s : -21 * s
  const headX = zombie ? shoulderX + b.facing * 3 * s : 0
  const headY = zombie ? -22.5 * s : -26 * s
  const headR = 3.6 * s

  ctx.beginPath()
  // legs
  ctx.moveTo(0, hipY); ctx.lineTo(2 * s + legSwing, 0)
  ctx.moveTo(0, hipY); ctx.lineTo(-2 * s - legSwing, 0)
  // spine
  ctx.moveTo(0, hipY); ctx.lineTo(shoulderX, shoulderY)
  // arms
  if (zombie) {
    const bob = Math.sin(t * 2.2 + b.id) * 1.3 * s
    ctx.moveTo(shoulderX, shoulderY); ctx.lineTo(shoulderX + b.facing * 9 * s, shoulderY + 3 * s + bob)
    ctx.moveTo(shoulderX, shoulderY); ctx.lineTo(shoulderX + b.facing * 8 * s, shoulderY + 6 * s - bob)
  } else {
    // Bracing: both hands go out toward the wall this figure is holding, so a
    // defender is visibly turned to face it. Only once they have stopped —
    // arms out at a run would read as a charge.
    const braced = (b.braceX !== 0 || b.braceY !== 0) && b.gait < 0.4 && b.alive
    if (braced) {
      const rx = b.braceX
      const ry = b.braceY * 0.5
      const reach = 7.5 * s
      // Perpendicular, so the two hands are apart rather than stacked.
      const px = -ry
      const py = rx
      handA = { x: shoulderX + rx * reach + px * 2.4 * s, y: shoulderY + ry * reach + py * 2.4 * s + 3 * s }
      handB = { x: shoulderX + rx * reach - px * 2.4 * s, y: shoulderY + ry * reach - py * 2.4 * s + 3 * s }
    } else {
      handA = { x: shoulderX + 3 * s + armSwing, y: -12 * s }
      handB = { x: shoulderX - 3 * s - armSwing, y: -12 * s }
    }
    ctx.moveTo(shoulderX, shoulderY); ctx.lineTo(handA.x, handA.y)
    ctx.moveTo(shoulderX, shoulderY); ctx.lineTo(handB.x, handB.y)
  }
  ctx.stroke()

  // ── What they are carrying ─────────────────────────────────────────────
  if (!zombie && b.alive && b.fallT === 0 && handA && handB) {
    const item = itemOf(b.id)
    const braced = (b.braceX !== 0 || b.braceY !== 0) && b.gait < 0.4
    ctx.save()
    ctx.lineCap = 'round'
    if (braced) {
      // Held across both hands, shoved against the boards.
      ctx.strokeStyle = item === 1 ? '#8d9298' : '#7d5c34'
      ctx.lineWidth = (item === 0 ? 3.2 : 2) * s
      ctx.beginPath()
      const ex = handA.x - handB.x
      const ey = handA.y - handB.y
      const el = Math.hypot(ex, ey) || 1
      const grow = item === 0 ? 3.5 * s : 5 * s
      ctx.moveTo(handA.x + (ex / el) * grow, handA.y + (ey / el) * grow)
      ctx.lineTo(handB.x - (ex / el) * grow, handB.y - (ey / el) * grow)
      ctx.stroke()
    } else {
      // Carried down at the side.
      ctx.strokeStyle = item === 1 ? '#8d9298' : '#7d5c34'
      ctx.lineWidth = (item === 0 ? 3 : 1.9) * s
      ctx.beginPath()
      ctx.moveTo(handA.x, handA.y - 1 * s)
      ctx.lineTo(handA.x + 1.5 * s, handA.y + (item === 0 ? 7 : 9) * s)
      ctx.stroke()
    }
    if (item === 2) {
      // A torch — the one thing in the compound that answers the braziers.
      const tip = braced
        ? { x: handA.x + (handA.x - handB.x) * 0.9, y: handA.y + (handA.y - handB.y) * 0.9 }
        : { x: handA.x + 1.5 * s, y: handA.y + 9 * s }
      ctx.beginPath()
      ctx.arc(tip.x, tip.y, (1.7 + Math.sin(t * 9 + b.id) * 0.3) * s, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(240,150,60,0.9)'
      ctx.fill()
    }
    ctx.restore()
  }

  // head
  ctx.beginPath()
  ctx.arc(headX, headY, headR, 0, Math.PI * 2)
  ctx.fill()

  // zombie eyes — two red pinpricks on the leading side of the skull
  if (zombie && (b.alive || b.fallT < 1)) {
    ctx.shadowColor = 'rgba(255,47,47,0.9)'
    ctx.shadowBlur = 4
    ctx.fillStyle = '#ff3b30'
    ctx.beginPath()
    ctx.arc(headX + b.facing * 1.2 * s, headY - 0.6 * s, 0.75 * s, 0, Math.PI * 2)
    ctx.arc(headX + b.facing * 2.9 * s, headY - 0.6 * s, 0.75 * s, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  // transformation pulse (just turned)
  if (b.transformT > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(b.x, b.y - 10 * s, (1 - b.transformT) * 20 * s + 6, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(230,51,41,${(b.transformT * 0.85).toFixed(3)})`
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.restore()
  }

  // shield ring (innocence proof save)
  if (b.shieldT > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(b.x, b.y - 10 * s, (1 - b.shieldT) * 16 * s + 8, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(107,142,35,${(b.shieldT * 0.9).toFixed(3)})`
    ctx.lineWidth = 2.5
    ctx.stroke()
    ctx.restore()
  }

  // steady aura while YOUR shield is active this round (own info only)
  if (b.isMe && shieldAura && b.alive && b.fallT === 0) {
    ctx.save()
    const r = 12 * s + Math.sin(t * 2.4) * 1.4
    ctx.beginPath()
    ctx.arc(b.x, b.y - 10 * s, r, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(132,204,22,0.55)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(b.x, b.y - 10 * s, r + 3, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(132,204,22,0.2)'
    ctx.stroke()
    ctx.restore()
  }

  if (b.isMe) {
    ctx.save()
    ctx.font = '700 9px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.fillStyle = '#c9e08f'
    ctx.fillText('YOU', b.x, b.y + 12)
    ctx.restore()
  }
}

function drawBolt(ctx: CanvasRenderingContext2D, b: Body, h: number) {
  if (Math.random() < 0.25) return // flicker gaps
  const s = perspectiveScale(b.y, h)
  const topX = b.x + rand(-6, 6)
  const headY = b.y - 26 * s
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.shadowColor = 'rgba(245,197,24,0.9)'
  ctx.shadowBlur = 8
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(topX, 0)
  const steps = 5
  for (let i = 1; i <= steps; i++) {
    const yy = (headY / steps) * i
    ctx.lineTo(b.x + rand(-9, 9) * (1 - i / steps) + (topX - b.x) * (1 - i / steps), yy)
  }
  ctx.lineTo(b.x, headY)
  ctx.stroke()
  // impact glow
  ctx.beginPath()
  ctx.arc(b.x, headY, 7 * s, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(245,197,24,0.25)'
  ctx.fill()
  ctx.restore()
}

/** Stable pseudo-random in [0,1) from an integer — the treeline and the horde
 *  must not reshuffle every frame, and persistent particles are more
 *  bookkeeping than a backdrop deserves. */
function noise(i: number, salt = 1): number {
  return ((Math.sin(i * 12.9898 * salt + salt * 78.233) * 43758.5453) % 1 + 1) % 1
}

/**
 * The world outside the walls: night forest, ground fog, and the horde.
 *
 * The first version drew this almost black on black and it was invisible, which
 * defeated the point — the walls only read as protection when you can see what
 * they are keeping out. Trunks are now lit from the compound's own lamplight,
 * so the treeline is legible without competing with the figures.
 */
/**
 * Sky and treeline, rendered ONCE per resize into an offscreen canvas and
 * blitted each frame.
 *
 * These are static: 38 tree polygons and a sky gradient that never change until
 * the canvas does. Rebuilding them every frame meant allocating gradients at
 * 60 Hz, which is the classic canvas performance smell and the thing that would
 * have made a taller cam expensive. Caching it is what pays for the extra
 * height — the per-frame cost is now one drawImage.
 *
 * The sway is gone with it, deliberately. Trees that shift are a per-frame cost
 * for something nobody looks at, and the braziers and the horde already supply
 * all the motion the scene needs — from things, rather than from weather.
 */
function renderBackdrop(w: number, h: number, c: Corners, dpr: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const off = document.createElement('canvas')
  off.width = Math.max(1, Math.floor(w * dpr))
  off.height = Math.max(1, Math.floor(h * dpr))
  const ctx = off.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const horizon = c.fl.y + 20
  const sky = ctx.createLinearGradient(0, 0, 0, horizon)
  sky.addColorStop(0, '#050a06')
  sky.addColorStop(1, '#0b1410')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, horizon)

  // Forest on ALL FOUR SIDES. The first pass drew a treeline along the top only,
  // so the compound sat in a lit void with woods painted behind it — the walls
  // to the east, south and west were holding back nothing. Trees are scattered
  // across the whole canvas and then anything that lands INSIDE the compound is
  // dropped, which fills the margin evenly without hand-placing four bands.
  //
  // 🚨 THEY HAVE TRUNKS AND THEY ARE NOT BLACK.
  // The first version was a flat near-black triangle with a 2 px stub for a
  // trunk, at 85–95% opacity over an almost-black sky: the treeline was
  // technically present and visually absent, so the compound still read as
  // sitting in a void. Trunks are now proportional and lit, and the canopy is
  // three stacked tiers in real greens with a rim on the lamplit side. Night
  // does not mean invisible — it means low-key with a light source.
  const tree = (x: number, baseY: number, th: number, halfW: number, far: boolean) => {
    const trunkH = th * 0.3
    const trunkW = Math.max(1.6, halfW * 0.3)

    ctx.fillStyle = far ? 'rgba(46,36,26,0.95)' : 'rgba(64,48,32,1)'
    ctx.fillRect(x - trunkW / 2, baseY - trunkH, trunkW, trunkH)

    const body = far ? '#20402b' : '#2c5535'
    const rim = far ? '#2b5638' : '#3d7046'
    const canopyH = th - trunkH
    for (let k = 2; k >= 0; k--) {
      // Bottom tier widest, top tier smallest — a fir, not a cone.
      const frac = 1 - k * 0.26
      const tierBase = baseY - trunkH - canopyH * (k * 0.28)
      const tierTop = tierBase - canopyH * 0.56
      const hw = halfW * frac
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.moveTo(x - hw, tierBase)
      ctx.lineTo(x, tierTop)
      ctx.lineTo(x + hw, tierBase)
      ctx.closePath()
      ctx.fill()
      // Lamplight catches the compound-facing edge.
      ctx.strokeStyle = rim
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, tierTop)
      ctx.lineTo(x + hw, tierBase)
      ctx.stroke()
    }
  }

  /** Undergrowth: rocks, fallen logs, stumps. Cheap, and they are what stop the
   *  ground outside reading as an empty mat with trees standing on it. */
  const prop = (x: number, y: number, kind: number, d: number) => {
    const s = 0.6 + d * 0.9
    ctx.save()
    ctx.translate(x, y)
    if (kind === 0) {
      // Boulder
      ctx.fillStyle = 'rgba(72,76,68,0.95)'
      ctx.beginPath()
      ctx.ellipse(0, 0, 7 * s, 4.4 * s, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(104,110,96,0.75)'
      ctx.beginPath()
      ctx.ellipse(-1.6 * s, -1.4 * s, 3.4 * s, 1.8 * s, -0.4, 0, Math.PI * 2)
      ctx.fill()
    } else if (kind === 1) {
      // Fallen log
      ctx.rotate(-0.22)
      ctx.fillStyle = 'rgba(58,44,30,0.95)'
      ctx.fillRect(-11 * s, -2.6 * s, 22 * s, 5.2 * s)
      ctx.fillStyle = 'rgba(86,66,44,0.85)'
      ctx.beginPath()
      ctx.ellipse(11 * s, 0, 1.7 * s, 2.6 * s, 0, 0, Math.PI * 2)
      ctx.fill()
    } else {
      // Stump
      ctx.fillStyle = 'rgba(54,42,28,0.95)'
      ctx.fillRect(-4 * s, -6 * s, 8 * s, 6 * s)
      ctx.fillStyle = 'rgba(88,68,44,0.9)'
      ctx.beginPath()
      ctx.ellipse(0, -6 * s, 4 * s, 1.8 * s, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  // Back ranks, above the compound — kept dense so the horizon reads as woods.
  for (const rank of [0, 1] as const) {
    const baseY = c.fl.y * (rank === 0 ? 0.72 : 0.94)
    const count = rank === 0 ? 22 : 16
    for (let i = 0; i < count; i++) {
      const x = noise(i + rank * 50) * (w + 60) - 30
      const th = c.fl.y * (rank === 0 ? 0.34 : 0.5) * (0.6 + noise(i, 3) * 0.7)
      tree(x, baseY, th, (rank === 0 ? 5 : 8) * (0.7 + noise(i, 7) * 0.6), rank === 0)
    }
  }

  // Flanks and foreground. Sized by depth so trees nearer the camera are bigger,
  // which is what stops the sides reading as wallpaper.
  const clear = (x: number, y: number, skirt: number) => {
    if (isInside(x, y, c)) return false
    return !(isInside(x - skirt, y, c) || isInside(x + skirt, y, c)
      || isInside(x, y - skirt * 0.8, c) || isInside(x, y + skirt * 0.8, c))
  }
  for (let i = 0; i < 54; i++) {
    const x = noise(i, 31) * (w + 80) - 40
    const y = c.fl.y + noise(i, 37) * (h - c.fl.y + 30)
    // A generous skirt around the walls: trees must not appear to grow out of
    // the barricade itself.
    if (!clear(x, y, 22)) continue
    const d = 0.45 + ((y - c.fl.y) / Math.max(1, h - c.fl.y)) * 0.9
    let th = (26 + noise(i, 41) * 34) * d
    // 🚨 A TREE IS TALLER THAN ITS BASE POINT.
    // The clearance test only looked at where the trunk meets the ground, so a
    // tree rooted just south of the near wall passed the check and then threw
    // sixty pixels of canopy straight over the compound — which is why the
    // south side looked like the woods were growing inside the barricade.
    // South of the wall the canopy is capped at the real gap; anything with no
    // room left is dropped rather than drawn intruding.
    if (y > c.nl.y) {
      const room = y - c.nl.y - 14
      if (room < 12) continue
      th = Math.min(th, room)
    }
    tree(x, y, th, (5 + noise(i, 43) * 4) * d, false)
  }

  // Ground clutter, drawn after the trees so it sits at their feet.
  for (let i = 0; i < 26; i++) {
    const x = noise(i, 83) * (w + 60) - 30
    const y = c.fl.y * 0.86 + noise(i, 89) * (h - c.fl.y * 0.86)
    if (!clear(x, y, 16)) continue
    const d = Math.min(1, Math.max(0, (y - c.fl.y) / Math.max(1, h - c.fl.y)))
    prop(x, y, Math.floor(noise(i, 97) * 3), d)
  }

  // Lamplight on the compound floor. Static too, so it is baked in here rather
  // than allocating a radial gradient every frame — and it is drawn before the
  // horde and the walls, which is the order the live pass needs anyway.
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(c.fl.x, c.fl.y)
  ctx.lineTo(c.fr.x, c.fr.y)
  ctx.lineTo(c.nr.x, c.nr.y)
  ctx.lineTo(c.nl.x, c.nl.y)
  ctx.closePath()
  const gx = (c.fl.x + c.nr.x) / 2
  const gy = (c.fl.y + c.nl.y) / 2
  const glow = ctx.createRadialGradient(gx, gy, 4, gx, gy, Math.max(c.nr.x - c.nl.x, c.nl.y - c.fl.y) * 0.7)
  // Dimmed now that the braziers light the compound. This is the residual
  // ambience the corner lamps sit on top of; before they existed it had to
  // carry the whole floor on its own, and the floor was lit by nothing.
  glow.addColorStop(0, 'rgba(120,150,60,0.07)')
  glow.addColorStop(1, 'rgba(16,26,15,0.58)')
  ctx.fillStyle = glow
  ctx.fill()
  ctx.restore()

  return off
}

/**
 * The world outside, blitted from the cache.
 *
 * There used to be drifting ground fog here. It is gone: it washed grey over
 * the treeline — the one part of the scene that most needed to be legible —
 * and a lit compound in a clear night is a sharper picture than a murky one.
 * The motion it was providing now comes from the braziers and the horde, both
 * of which are things rather than atmosphere.
 */
function drawOutside(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  backdrop: HTMLCanvasElement | null,
) {
  if (backdrop) ctx.drawImage(backdrop, 0, 0, w, h)
}

/**
 * A zombie outside the walls.
 *
 * 🚨 (x, y) IS THE GROUND UNDER ITS FEET, AND THE FEET STAY ON IT.
 * The previous version translated the WHOLE body — feet included — by a
 * vertical lurch, so every walker bobbed a couple of pixels off the floor
 * sixty times a second while its shadow sat still. That is exactly the recipe
 * for reading as floating, which is what play-testing reported twice. The
 * lurch now moves the hips; the feet are planted at y and the shadow is drawn
 * at y, so contact is unambiguous.
 *
 * 🚨 SAME SIZE AS THE SURVIVORS INSIDE.
 * It is built to the same proportions as drawFigure's zombie pose and takes
 * the same perspectiveScale, so a walker and a person at the same depth are
 * the same height. They were previously about half scale, which made the
 * compound look like it was being besieged by insects and made the horde read
 * as texture rather than as a threat.
 */
function drawWalker(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number, phase: number,
  /** Unit vector toward the compound — the thing it wants. */
  rx: number, ry: number,
) {
  // Contact shadow, on the ground line and staying there.
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(x, y, 6 * s, 2.1 * s, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fill()
  ctx.restore()

  const stride = Math.sin(phase) * 3.4 * s
  const bob = Math.abs(Math.sin(phase)) * 1.1 * s      // hips rise on the step
  const hipY = -11 * s + bob
  const shoulderY = hipY - 8 * s
  const headY = shoulderY - 3.4 * s
  // The reach, projected. `ry` is squashed because the camera looks down the
  // scene — a walker on the far side leans toward us a little rather than
  // vanishing into a vertical line.
  const ax = rx
  const ay = ry * 0.45
  const lean = ax * 1.8 * s

  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = 'rgba(150,196,74,0.78)'
  ctx.fillStyle = 'rgba(150,196,74,0.78)'
  ctx.lineWidth = 1.9 * s
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, hipY); ctx.lineTo(stride, 0)           // legs land ON the ground
  ctx.moveTo(0, hipY); ctx.lineTo(-stride, 0)
  ctx.moveTo(0, hipY); ctx.lineTo(lean, shoulderY)     // hunched, leaning in
  // Arms reaching TOWARD the compound — never away from it. They used to reach
  // in a fixed +x direction, so half the horde stood with its back to the
  // boards it was supposed to be trying to get through.
  const reach = 8.2 * s
  ctx.moveTo(lean, shoulderY)
  ctx.lineTo(lean + ax * reach, shoulderY + ay * reach + 2 * s + Math.sin(phase * 1.3) * 1.4 * s)
  ctx.moveTo(lean, shoulderY)
  ctx.lineTo(lean + ax * reach * 0.92, shoulderY + ay * reach * 0.92 + 4.6 * s - Math.sin(phase * 1.1) * 1.4 * s)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(lean + ax * 3.4 * s, headY + ay * 2.4 * s, 3.2 * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * The glow pool cast by a brazier, rendered once and tinted per frame.
 *
 * A radial gradient per lamp per frame would be four allocations at 60 Hz —
 * precisely the cost that was just removed from the backdrop and the fog. As a
 * sprite, flicker is a change of alpha and scale on a drawImage.
 */
function renderGlowSprite(r: number, dpr: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const off = document.createElement('canvas')
  off.width = off.height = Math.max(1, Math.floor(r * 2 * dpr))
  const ctx = off.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const g = ctx.createRadialGradient(r, r, 0, r, r, r)
  g.addColorStop(0, 'rgba(255,168,72,0.5)')
  g.addColorStop(0.45, 'rgba(226,122,40,0.16)')
  g.addColorStop(1, 'rgba(226,122,40,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, r * 2, r * 2)
  return off
}

/** Per-lamp flicker. Two detuned sines beat against each other, so the rhythm
 *  never repeats visibly and no randomness has to be stored. */
function flicker(t: number, i: number): number {
  return 0.78 + 0.14 * Math.sin(t * 8.3 + i * 2.1) + 0.08 * Math.sin(t * 13.7 + i)
}

/** The four corners, near-first so callers can depth-sort trivially. */
function lampPositions(c: Corners): { x: number; y: number }[] {
  return [c.fl, c.fr, c.nr, c.nl]
}

/**
 * Light pools on the compound floor. Drawn before the walls so the light lies
 * on the ground rather than over the boards.
 */
function drawLampPools(
  ctx: CanvasRenderingContext2D, c: Corners, t: number, glow: HTMLCanvasElement | null, dim: number,
) {
  if (!glow) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  lampPositions(c).forEach((p, i) => {
    const d = depthAt(p.y, c)
    const r = (46 + d * 40) * flicker(t, i)
    ctx.globalAlpha = 0.85 * dim * flicker(t, i + 3)
    ctx.drawImage(glow, p.x - r, p.y - r * 0.6, r * 2, r * 1.2)
  })
  ctx.restore()
}

/**
 * Brazier posts at the four corners.
 *
 * They are the SOURCE of the light the compound already had — the floor was
 * lit by nothing before, which is a small incoherence the eye notices without
 * naming. They also plant the corners, which is what makes the trapezoid read
 * as an enclosure rather than a shape.
 *
 * Deliberately deep orange rather than amber: amber is the wall-under-pressure
 * signal, and four permanent amber lights would dilute the one colour that has
 * to mean something. The flame is also small and static in place, where the
 * pressure glow is a pulse spread along a whole wall — different colour,
 * different shape, no confusion.
 */
function drawLampPosts(ctx: CanvasRenderingContext2D, c: Corners, t: number, dim: number) {
  lampPositions(c).forEach((p, i) => {
    const d = depthAt(p.y, c)
    const s = 0.8 + d * 0.55
    const f = flicker(t, i) * dim
    const postH = 20 * s

    ctx.save()
    ctx.translate(p.x, p.y)

    // Post
    ctx.strokeStyle = 'rgba(58,50,34,0.95)'
    ctx.lineWidth = 2.4 * s
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(0, -postH)
    ctx.stroke()

    // Bowl
    ctx.strokeStyle = 'rgba(84,72,50,0.95)'
    ctx.lineWidth = 1.8 * s
    ctx.beginPath()
    ctx.moveTo(-3.4 * s, -postH)
    ctx.lineTo(3.4 * s, -postH)
    ctx.stroke()

    // Flame — a teardrop that leans and breathes.
    if (dim > 0.05) {
      const lean = Math.sin(t * 3.1 + i) * 1.3 * s
      const hgt = (7 + f * 4) * s
      ctx.beginPath()
      ctx.moveTo(-2.2 * s, -postH)
      ctx.quadraticCurveTo(-2.6 * s + lean, -postH - hgt * 0.6, lean, -postH - hgt)
      ctx.quadraticCurveTo(2.6 * s + lean, -postH - hgt * 0.6, 2.2 * s, -postH)
      ctx.closePath()
      ctx.fillStyle = `rgba(232,126,40,${(0.85 * f).toFixed(3)})`
      ctx.fill()
      // Hot core
      ctx.beginPath()
      ctx.ellipse(lean * 0.5, -postH - hgt * 0.32, 1.3 * s, 2.4 * s, 0, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255,214,138,${(0.8 * f).toFixed(3)})`
      ctx.fill()
    }
    ctx.restore()
  })
}

/** A member of the horde. Stateful on purpose — see stepHorde. */
interface Walker {
  x: number
  y: number
  tx: number
  ty: number
  phase: number
  /** Seconds until it picks somewhere new to shamble toward. */
  retargetIn: number
}

const HORDE_SPEED = 13
/**
 * How many walkers.
 *
 * Was forty. At forty, drawn at survivor scale, the treeline was a solid mat of
 * bodies and the wall-pressure signal never dropped — every wall had someone
 * leaning on it at all times, so every wall shuddered all game and none of it
 * meant anything. Sixteen legible figures beat forty specks, and it leaves the
 * ground between them visible, which is what makes a group arriving at one wall
 * read as an event.
 */
const HORDE_SIZE = 16

/**
 * Extra room the horde keeps below the SOUTH wall — about one walker's height.
 *
 * Everything above the south boarding is the courtyard, so a walker standing
 * just outside it is drawn straight up across the planks and reads as being
 * inside the compound. Nothing else fixes that: occluding it with the boards
 * only hides its legs and leaves a torso in the yard. It has to stand a whole
 * body clear — a walker is about 31px tall at the near scale, so 26 was still
 * leaving its head inside the planks. NEAR_Y and FAR_Y in barricadeStations.ts
 * are sized to leave room for this.
 */
const SOUTH_CLEAR = 34

/** Somewhere outside the walls for a walker to head for. */
function hordeTarget(c: Corners, threatened: number | null, r1: number, r2: number, collapsed = false) {
  if (collapsed) {
    // The walls are down. They go in.
    const q = interiorPoint(c, r1, r2)
    return { x: q.x, y: q.y }
  }
  // Most of them drift toward whatever is being pushed; the rest keep working
  // the perimeter, so the picture never empties out on one side.
  if (threatened !== null && r1 < 0.66) {
    const seg = wallSegment(threatened, c)
    const out = wallOutward(threatened, c)
    const depth = 10 + r2 * 26
    return {
      x: seg.x1 + (seg.x2 - seg.x1) * r2 + out.dx * depth,
      y: seg.y1 + (seg.y2 - seg.y1) * r2 + out.dy * depth,
    }
  }
  const cx = (c.fl.x + c.fr.x + c.nr.x + c.nl.x) / 4
  const cy = (c.fl.y + c.fr.y + c.nr.y + c.nl.y) / 4
  const spanX = (c.nr.x - c.nl.x) / 2
  const spanY = (c.nl.y - c.fl.y) / 2
  const a = r1 * Math.PI * 2
  // Tight enough to stay in frame on a narrow canvas — see the clamp in
  // stepHorde for why wandering off the edge was the real "they disappear".
  const rad = 1.14 + r2 * 0.24
  return {
    x: cx + Math.cos(a) * spanX * rad,
    y: cy + Math.sin(a) * spanY * rad * 0.8 + spanY * 0.14,
  }
}

/**
 * Walks the horde.
 *
 * 🚨 THEY MOVE. They do not appear.
 *
 * The first version computed every position from time and index, so the two
 * thirds that converge on a threatened wall TELEPORTED there the instant the
 * warning fired, and teleported back afterwards. Play-testing read that as
 * things blinking in and out, which it was.
 *
 * They are stateful now and steer toward a target at a shamble. The
 * consequence is the point: pressure on a wall is no longer a flag the wall
 * reads, it is however many of them have physically arrived. The shaking is
 * caused by the crowd rather than drawn alongside it, so it builds as they
 * gather and eases as they wander off.
 */
function stepHorde(
  walkers: Walker[], c: Corners, dt: number, threatened: number | null,
  w: number, h: number, collapsed: boolean,
) {
  for (const wk of walkers) {
    wk.retargetIn -= dt
    if (wk.retargetIn <= 0) {
      const t = hordeTarget(c, threatened, Math.random(), Math.random(), collapsed)
      wk.tx = t.x
      wk.ty = t.y
      // Short while a wall is being worked, long while merely circling — they
      // commit to a breach and lose interest slowly.
      wk.retargetIn = threatened !== null ? 1.2 + Math.random() * 1.6 : 3 + Math.random() * 4
    }
    const dx = wk.tx - wk.x
    const dy = wk.ty - wk.y
    const d = Math.hypot(dx, dy)
    if (d > 1) {
      const step = Math.min(d, HORDE_SPEED * dt)
      wk.x += (dx / d) * step
      wk.y += (dy / d) * step
    }
    // 🚨 The inside is a SAFE ZONE. Targets were already outside, but a walker
    // crossing from the north side to the south simply walked through the
    // courtyard to get there. Clamping the position — not just the destination
    // — is what actually keeps them out, and it turns a straight line through
    // the compound into a shamble along the outside of the boards.
    //
    // The margin clears the BOARDING, not the centreline. Now that a wall is
    // real timber up to ~21px thick, a flat 14 would have parked half the horde
    // inside the planks. On the SOUTH side it also clears a whole body height —
    // see clampOutside.
    //
    // 🚨 UNLESS THE WALLS ARE DOWN. At parity the compound is breached and the
    // horde is meant to be inside it; keeping them politely outside a wall that
    // no longer exists was the endgame's whole drama being drawn as a colour
    // change. This is the ONE state where the safe zone stops being safe.
    const p = collapsed
      ? { x: wk.x, y: wk.y }
      : clampOutside(wk.x, wk.y, c, wallBand(depthAt(wk.y, c)) + 12, SOUTH_CLEAR)
    // 🚨 AND THEY STAY ON SCREEN.
    // The perimeter orbit reached about 1.65 span-widths from the centre, which
    // is off the side of a narrow canvas. Walkers strolled out of frame and
    // back, and with a fixed population that reads exactly as zombies popping
    // in and out of existence — the thing this was supposed to have fixed. The
    // count never changed; the visible count did.
    wk.x = Math.min(w - 6, Math.max(6, p.x))
    wk.y = Math.min(h - 6, Math.max(c.fl.y * 0.55, p.y))
    wk.phase += dt * 3.4
  }
}

/** How many walkers are pressed against each wall — this is what shakes it. */
function wallPressure(walkers: readonly Walker[], c: Corners): number[] {
  const counts = [0, 0, 0, 0]
  for (let i = 0; i < 4; i++) {
    const seg = wallSegment(i, c)
    const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) || 1
    for (const wk of walkers) {
      // Distance from the wall's line segment, clamped to its span so a walker
      // beyond the corner is not counted against it.
      const t = Math.max(0, Math.min(1,
        ((wk.x - seg.x1) * (seg.x2 - seg.x1) + (wk.y - seg.y1) * (seg.y2 - seg.y1)) / (len * len)))
      const px = seg.x1 + (seg.x2 - seg.x1) * t
      const py = seg.y1 + (seg.y2 - seg.y1) * t
      if (Math.hypot(wk.x - px, wk.y - py) < 34) counts[i]++
    }
  }
  return counts
}

function drawHorde(
  ctx: CanvasRenderingContext2D, walkers: readonly Walker[], c: Corners, h: number,
) {
  const cx = (c.fl.x + c.fr.x + c.nr.x + c.nl.x) / 4
  const cy = (c.fl.y + c.fr.y + c.nr.y + c.nl.y) / 4
  // Depth-sorted: drawn in array order, a walker behind another could paint
  // over one standing in front of it.
  const order = [...walkers].sort((a, b) => a.y - b.y)
  for (const wk of order) {
    const dx = cx - wk.x
    const dy = cy - wk.y
    const len = Math.hypot(dx, dy) || 1
    // The SAME scale function the survivors use, so a walker and a person at
    // the same depth are the same height. They ran on their own curve before
    // and came out around half size.
    drawWalker(ctx, wk.x, wk.y, perspectiveScale(wk.y, h), wk.phase, dx / len, dy / len)
  }
}

/**
 * The four walls, as boarded-up plywood.
 *
 * 🚨 THEY ARE FILLED TIMBER, NOT STROKED LINES.
 * The previous version stacked three to five thin strokes along the outward
 * normal, which totalled about eight pixels of "wall" on the far side. Two
 * things went wrong with that. It read as a diagram — a boxed region on a
 * floor plan rather than something built — and everything standing at a corner
 * (the brazier posts especially) looked like a box balanced on a line, because
 * there was no structure underneath for it to be mounted on.
 *
 * So a wall is now a filled band: four to six boards of real width, in wood
 * colours, with seams between them, cross battens holding them together and a
 * squared post at each end. The band is wide enough that the corner posts have
 * something to stand on, and wide enough that a figure inside it is
 * unambiguously behind it.
 *
 * THE COLOUR LADDER SURVIVES, IT JUST MOVED.
 * Timber is the material, so state can no longer be carried by the boards'
 * own colour without turning them plastic. It rides on the inner rim light and
 * the strain glow instead:
 *
 *   olive rim   intact
 *   amber rim   under pressure — they are on it right now
 *   ash boards  splintered: a push got through, damaged but still standing
 *   red         collapsed at parity, the game is over
 */

/**
 * How far inside the wall CENTRELINE a body has to stay.
 *
 * One number, used both to place targets and to catch escapes, and it accounts
 * for the boarding's real thickness. Two different constants (18 for targets, 8
 * for the guard) were what let a body settle in a spot the guard then disagreed
 * with, and the disagreement is what produced the sideways drift.
 */
function bodyClearance(y: number, c: Corners): number {
  return wallBand(depthAt(y, c)) + 7
}

function drawWalls(
  ctx: CanvasRenderingContext2D, c: Corners, t: number, bar: BarricadeView,
  pressure: readonly number[],
) {
  for (let i = 0; i < 4; i++) {
    const seg = wallSegment(i, c)
    const out = wallOutward(i, c)
    const straining = bar.threatened === i
    const broken = bar.brokenWalls.includes(i)
    const gone = bar.collapsed

    const midY = (seg.y1 + seg.y2) / 2
    const d = depthAt(midY, c)
    const band = wallBand(d)
    const boards = 4 + Math.round(d * 2)          // 4 far … 6 near
    const bh = (band * 2) / boards                // one board's thickness

    // Shake is CAUSED by the crowd, not drawn alongside it: it builds as they
    // arrive and eases as they wander off, so the picture explains itself.
    //
    // 🚨 ONLY THE WALL UNDER A PUSH. A wandering horde always has somebody
    // leaning on something, so keying the shudder purely off proximity had all
    // four walls vibrating for the entire game — which is how a signal becomes
    // wallpaper. A wall shakes when the horde is ON it, in the sense the rules
    // mean: a push is coming here. The crowd count still decides HOW hard, so
    // the shudder builds as they gather rather than snapping on.
    const crowd = straining ? Math.min(1, (pressure[i] ?? 0) / 5) : 0

    ctx.save()
    // The boards strain, not the camera — a shaking viewport reads as a bug.
    if (crowd > 0 && !gone) {
      const amp = crowd * 3
      ctx.translate(out.dx * Math.sin(t * 30) * amp, out.dy * Math.sin(t * 30) * amp)
    }

    // Strain bleeding out from behind the boards, scaled by how many are
    // leaning on it. Amber, not red — red is reserved for the walls being DOWN.
    if (crowd > 0.15 && !gone) {
      const pulse = (0.18 + 0.24 * Math.sin(t * 7)) * crowd
      ctx.save()
      ctx.strokeStyle = `rgba(245,197,24,${pulse.toFixed(3)})`
      ctx.lineWidth = band * 2 + 14
      ctx.globalAlpha = 0.45
      ctx.beginPath()
      ctx.moveTo(seg.x1, seg.y1)
      ctx.lineTo(seg.x2, seg.y2)
      ctx.stroke()
      ctx.restore()
    }

    // A point on the wall: `f` along it (0..1), `o` across it (outward +).
    const at = (f: number, o: number) => ({
      x: seg.x1 + (seg.x2 - seg.x1) * f + out.dx * o,
      y: seg.y1 + (seg.y2 - seg.y1) * f + out.dy * o,
    })
    const slab = (f1: number, f2: number, o1: number, o2: number, fill: string) => {
      const a = at(f1, o1)
      const b = at(f2, o1)
      const cc = at(f2, o2)
      const dd = at(f1, o2)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.lineTo(cc.x, cc.y)
      ctx.lineTo(dd.x, dd.y)
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
    }

    // 🚨 A HOLE IS A PROMISE, AND MID-GAME WE CANNOT KEEP IT.
    //
    // A splintered wall used to be drawn with its middle punched out. That is a
    // clearer read than a colour change, and it was the wrong thing to draw:
    // a wall with a gap in it, a horde pressed against the far side, and
    // nothing coming through. Every player who saw it reasoned — correctly —
    // that zombies should now be getting in, and the scene had no answer.
    //
    // The rules cannot give it one. A breach must stay survivable or there is
    // no round-to-round tension, and nothing in the barricade is allowed to
    // eliminate anybody: the vote is the only thing that costs money. So a
    // mid-game breach is damage that HELD — battered, gouged, boards torn off
    // the outer face — with the line unbroken.
    //
    // The hole is reserved for `gone`, the parity collapse, which is the one
    // moment the promise is kept: the boarding opens and the horde walks in
    // (see stepHorde).
    const spans: [number, number][] = gone
      ? [[0, 0.15], [0.33, 0.45], [0.71, 0.86]]
      : [[0, 1]]

    // Timber. Ash when splintered, scorched when the walls are down.
    const tone = gone
      ? ['#4a241d', '#5d2f24', '#6b382a']
      : broken
        ? ['#413d36', '#524d43', '#5f594d']
        : ['#4a3520', '#5b4227', '#6d4f2e']

    for (const [f1, f2] of spans) {
      // Ground shadow just outside the boards, so the wall sits ON the earth
      // rather than floating over it.
      slab(f1, f2, band, band + 3 + d * 3, 'rgba(0,0,0,0.4)')

      for (let k = 0; k < boards; k++) {
        const o1 = -band + k * bh
        // A hairline of gap between boards is what makes it read as boarding
        // rather than as a solid slab.
        slab(f1, f2, o1, o1 + bh - 0.9, tone[k % tone.length])
      }

      // Cross battens — the thing that turns loose boards into a barricade.
      const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) || 1
      const bw = Math.max(0.018, (5 + d * 4) / len)
      for (const f of [0.5]) {
        const m = f1 + (f2 - f1) * f
        slab(m - bw, m + bw, -band, band, gone ? '#3a1d18' : broken ? '#35322c' : '#3c2a17')
      }

      // Battle damage on a wall that took a push and held: chunks torn out of
      // the OUTER face, leaving the inner boarding continuous. Nothing can get
      // through it, and it plainly shows that something tried.
      if (broken && !gone) {
        // Depth is a fraction of the full band, capped below 0.5 so a gouge can
        // never reach the centreline: the inner face stays continuous timber,
        // which is the whole reason this is damage and not a hole.
        for (const [g, depth] of [[0.24, 0.44], [0.47, 0.3], [0.71, 0.48]] as const) {
          const gw = 0.035
          const m = f1 + (f2 - f1) * g
          slab(m - gw, m + gw, band - band * 2 * depth, band + 1, 'rgba(16,11,6,0.9)')
          // A splinter left standing in the gouge.
          slab(m + gw * 0.35, m + gw * 0.6, band - band * 2 * depth * 0.7, band, '#6a6459')
        }
      }

      // Lit top edge. The braziers are inside, so the inner face catches them.
      slab(f1, f2, -band, -band + 1.6, gone
        ? 'rgba(150,60,44,0.55)'
        : 'rgba(160,124,74,0.55)')

      // ── The state rim ────────────────────────────────────────────────────
      ctx.strokeStyle = gone
        ? 'rgba(230,51,41,0.85)'
        : straining
          ? 'rgba(245,197,24,0.95)'
          : broken
            ? 'rgba(122,116,92,0.75)'
            : 'rgba(120,152,60,0.6)'
      ctx.lineWidth = 1.6
      const r1 = at(f1, -band)
      const r2 = at(f2, -band)
      ctx.beginPath()
      ctx.moveTo(r1.x, r1.y)
      ctx.lineTo(r2.x, r2.y)
      ctx.stroke()
    }

    // End posts — squared timber standing proud of the boarding at each corner.
    // These are what the braziers are mounted on, and why a light at a corner no
    // longer reads as a box balanced on a line.
    if (!gone) {
      const pw = Math.max(0.02, (band * 0.62) / (Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) || 1))
      for (const f of [0, 1]) {
        const f1 = Math.max(0, f - pw)
        const f2 = Math.min(1, f + pw)
        slab(f1, f2, -band - 2.5, band + 2.5, broken ? '#3b3831' : '#40301c')
        slab(f1, f2, -band - 2.5, -band + 1.4, broken ? '#5e594e' : '#6d5230')
      }
    }
    ctx.restore()
  }
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bodies: Body[],
  t: number,
  active: ActiveCue | null,
  myShield: boolean,
  bar: BarricadeView | null,
  backdrop: HTMLCanvasElement | null,
  glow: HTMLCanvasElement | null,
  walkers: readonly Walker[],
) {
  ctx.clearRect(0, 0, w, h)

  // faint chamber floor lines
  ctx.save()
  ctx.strokeStyle = 'rgba(107,142,35,0.08)'
  ctx.lineWidth = 1
  for (const frac of [0.42, 0.62, 0.82]) {
    ctx.beginPath()
    ctx.moveTo(0, h * frac)
    ctx.lineTo(w, h * frac)
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(107,142,35,0.16)'
  ctx.beginPath()
  ctx.moveTo(0, PAD_TOP - 14)
  ctx.lineTo(w, PAD_TOP - 14)
  ctx.stroke()
  ctx.restore()

  // ── The compound ────────────────────────────────────────────────────────────
  // Drawn before the figures so depth-sorting puts defenders in front of the
  // boards they are holding. Everything outside the walls is the world the
  // walls exist to keep out — without it, a barricade is a fence.
  if (bar) {
    const c = compoundShape(w, h, PAD_TOP, PAD_BOTTOM)
    drawOutside(ctx, w, h, backdrop)
    // The lamps gutter out when the walls come down — the compound stops being
    // a place anyone is keeping lit.
    const lamp = bar.collapsed ? 0.12 : 1
    // Pools first: light lies ON the ground, under the boards and the bodies.
    drawLampPools(ctx, c, t, glow, lamp)
    // 🚨 THE BOARDING ALWAYS OCCLUDES THE HORDE, INCLUDING ON THE SOUTH SIDE.
    // Splitting the horde by depth and painting the south group OVER the near
    // wall is technically the correct camera order, and it looked like zombies
    // standing on top of the barricade — because a wall drawn as a band on the
    // ground has no visible height for them to be behind. Drawing them under it
    // instead hides their legs behind the boards, which is exactly the read we
    // want: something clawing at a wall from the far side of it.
    drawHorde(ctx, walkers, c, h)
    drawWalls(ctx, c, t, bar, wallPressure(walkers, c))
    // Posts last, so a brazier reads as mounted on its corner.
    drawLampPosts(ctx, c, t, lamp)
  }

  const flashBody = active?.type === 'electrocute' && active.t < ELECTRO_FLICKER_SECS ? active.body : null
  for (const b of [...bodies].sort((a, c) => a.y - c.y)) {
    // 🚨 NOBODY INSIDE THE COMPOUND IS DRAWN AS A ZOMBIE. EVER.
    //
    // This used to be gated on the barricade MECHANIC running, i.e. Discussion
    // only, so in Infection, Voting and Reveal the cam quietly reverted to
    // drawing infected players as hunched red-eyed zombies standing among the
    // survivors. Two things wrong with that. It leaked — the placement is
    // truthful in aggregate and players announce their walls in chat, which is
    // the exact combination the uniform rule exists to prevent. And it made
    // the picture incoherent, because the whole premise of a compound is that
    // the zombies are the ones OUTSIDE it.
    //
    // The rule is now the simplest one available: if there is a compound,
    // everyone in it is a survivor. Zombies exist, they are the horde at the
    // boards. The cues still narrate an infection — the bolt still strikes,
    // the flash still lands — they just stop naming a shape for it.
    drawFigure(ctx, b, t, h, b === flashBody, myShield, bar !== null)
  }
  if (flashBody) drawBolt(ctx, flashBody, h)

  // finale wash
  if (active?.type === 'finale') {
    const alpha = 0.16 * Math.sin((active.t / FINALE_SECS) * Math.PI)
    let tint: string | null = null
    if (active.outcome === 'infected_win') tint = `rgba(204,20,20,${alpha.toFixed(3)})`
    if (active.outcome === 'clean_win') tint = `rgba(107,142,35,${alpha.toFixed(3)})`
    if (tint) {
      ctx.save()
      ctx.fillStyle = tint
      ctx.fillRect(0, 0, w, h)
      ctx.restore()
    }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

/** What the cam needs to draw the barricade. Counts and geometry only. */
export interface BarricadeView {
  /**
   * Whether the barricade MECHANIC is running (Discussion only).
   *
   * Separate from whether the compound is drawn, which is always. The place
   * exists for the whole game — a room that becomes a fortified courtyard for
   * three minutes and an empty chamber the rest of the time reads as two
   * different games. What changes by phase is what is happening in it.
   *
   * It also gates uniform rendering: outside Discussion the infection and
   * elimination cues need to distinguish figures, and they are safe to show
   * then because placement is not truthful when nobody is posted at a wall.
   */
  readonly active: boolean
  /** Empty outside Discussion — figures mill about inside instead of posting. */
  readonly occupancy: readonly number[]
  /** Station under attack, or null between pushes. */
  readonly threatened: number | null
  /** The local player's own station — the one truthful placement. */
  readonly myStation: number | null
  /** Bumps on each resolution so the scene can play the outcome once. */
  readonly resultKey: number
  /** Whether the most recent push held. */
  readonly held: boolean | null
  /** Walls a push has already got through this round — they stay splintered. */
  readonly brokenWalls: readonly number[]
  /** Public infected count; sizes the horde. Already on the HUD, so no leak. */
  readonly infectedCount: number
  /**
   * The endgame, not a scare: infected outnumber clean, the walls come down and
   * the horde is inside. Distinct from a broken wall on purpose — a push that
   * gets through has to stay survivable or there is no round-to-round tension,
   * and this lands harder for having survived three of those.
   */
  readonly collapsed: boolean
}

export interface OutbreakSceneProps {
  readonly totalPlayers: number
  readonly aliveCount: number
  readonly zombieCount: number
  readonly myStatus: 'clean' | 'infected' | 'eliminated' | null
  readonly outcome: FinaleOutcome | null
  readonly socket?: Socket | null
  readonly localAddress?: string | null
  readonly className?: string
  /** Local player's shield is active this round — steady aura on YOUR figure only (your own info). */
  readonly myShieldActive?: boolean
  /** Count of OTHER players with an active shield this round (public); increments flash anonymous figures. */
  readonly othersShieldCount?: number
  /** Barricade state during Discussion; null the rest of the time (free wander). */
  readonly barricade?: BarricadeView | null
}

export function OutbreakScene({
  totalPlayers, aliveCount, zombieCount, myStatus, outcome, socket, localAddress,
  className = '', myShieldActive = false, othersShieldCount = 0, barricade = null,
}: OutbreakSceneProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const directorRef = useRef<OutbreakDirector | null>(null)
  // Barricade is read through refs so it can steer the sim without tearing down
  // and rebuilding the animation loop every time the server speaks.
  const barricadeRef = useRef<BarricadeView | null>(null)
  const stationOfBodyRef = useRef<Map<number, number>>(new Map())
  /** Seconds left on the breach reaction — figures scatter, then recover. */
  const breachTRef = useRef(0)
  /** Set when placement changes; the sim loop clears pauses and re-forms. */
  const reformRef = useRef(false)
  /** Figures whose wall changed — they sprint to it on the next frame. */
  const sprintersRef = useRef<Set<number>>(new Set())
  /** Last wall a warning named, so a new threat scrambles the room exactly once. */
  const lastThreatRef = useRef<number | null>(null)
  /** Cached sky + treeline. Rebuilt on resize only — see renderBackdrop. */
  const backdropRef = useRef<HTMLCanvasElement | null>(null)
  /** The horde. Stateful so they walk rather than blink between positions. */
  const hordeRef = useRef<Walker[]>([])
  /** Brazier light pool, tinted per frame rather than re-created. */
  const glowRef = useRef<HTMLCanvasElement | null>(null)
  const lastResultKeyRef = useRef(-1)
  const epochRef = useRef(0)
  const bodiesRef = useRef<Body[]>([])
  const queueRef = useRef<OutbreakCue[]>([])
  const activeRef = useRef<ActiveCue | null>(null)
  const gapRef = useRef(0)
  const tRef = useRef(0)
  const sizeRef = useRef({ w: 0, h: 0 })
  const reducedRef = useRef(false)
  const renderRef = useRef<(() => void) | null>(null)
  const myShieldRef = useRef(false)
  const prevOthersShieldRef = useRef(0)
  const endedRef = useRef(false)
  const settleRef = useRef<number | null>(null)
  const resumeRef = useRef<(() => void) | null>(null)

  directorRef.current ??= new OutbreakDirector()

  // ── Canvas setup + simulation loop ─────────────────────────────────────────
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    reducedRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      sizeRef.current = { w, h }
      canvas.width = Math.max(1, Math.floor(w * dpr))
      canvas.height = Math.max(1, Math.floor(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      backdropRef.current = renderBackdrop(w, h, compoundShape(w, h, PAD_TOP, PAD_BOTTOM), dpr)
      glowRef.current ??= renderGlowSprite(96, dpr)
      // Seed the horde where it will already be walking, so a resize does not
      // make them appear from nowhere.
      if (hordeRef.current.length === 0) {
        const c = compoundShape(w, h, PAD_TOP, PAD_BOTTOM)
        hordeRef.current = Array.from({ length: HORDE_SIZE }, (_, i) => {
          const t0 = hordeTarget(c, null, noise(i, 61), noise(i, 67))
          const p0 = clampOutside(t0.x, t0.y, c, wallBand(depthAt(t0.y, c)) + 12, SOUTH_CLEAR)
          return { x: p0.x, y: p0.y, tx: p0.x, ty: p0.y, phase: i, retargetIn: noise(i, 71) * 4 }
        })
      }
      for (const b of bodiesRef.current) {
        b.x = Math.min(Math.max(b.x, PAD_X), Math.max(PAD_X, w - PAD_X))
        b.y = Math.min(Math.max(b.y, PAD_TOP), Math.max(PAD_TOP, h - PAD_BOTTOM))
        b.tx = Math.min(Math.max(b.tx, PAD_X), Math.max(PAD_X, w - PAD_X))
        b.ty = Math.min(Math.max(b.ty, PAD_TOP), Math.max(PAD_TOP, h - PAD_BOTTOM))
      }
      renderRef.current?.()
    }

    const render = () => {
      const { w, h } = sizeRef.current
      drawScene(ctx, w, h, bodiesRef.current, tRef.current, activeRef.current, myShieldRef.current, barricadeRef.current, backdropRef.current, glowRef.current, hordeRef.current)
    }
    renderRef.current = render

    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()

    if (reducedRef.current) {
      return () => { ro.disconnect(); renderRef.current = null }
    }

    /** Decays once per frame, not once per body — see the call site below. */
    const tickBreach = (dt: number) => {
      if (breachTRef.current > 0) breachTRef.current = Math.max(0, breachTRef.current - dt)
    }

    const retarget = (b: Body) => {
      const { w, h } = sizeRef.current

      // Holding the line. Figures cluster on their station instead of drifting,
      // with enough jitter that a wall reads as a crowd of people rather than a
      // row of pegs. A breach overrides it — nobody holds a broken window.
      const bar = barricadeRef.current
      if (bar && b.alive) {
        const c = compoundShape(w, h, PAD_TOP, PAD_BOTTOM)
        const station = stationOfBodyRef.current.get(b.id)
        // A figure goes to a wall for exactly two reasons: the horde is coming
        // for that wall, or its player just sent it there. Otherwise it is in
        // the yard with everyone else. See POST_SECS. A breach clears the
        // boards outright — nobody holds a broken window — and scatters the
        // room into the yard, which is inside the walls rather than the old
        // canvas-wide scatter that pressed everyone into the boards.
        const posted = breachTRef.current <= 0 && station !== undefined
          && (bar.threatened === station || b.postT > 0)

        if (!posted) {
          b.braceX = 0
          b.braceY = 0
          const q = interiorPoint(c, Math.random(), Math.random())
          const pi = clampInside(q.x, q.y, c, bodyClearance(q.y, c))
          b.tx = pi.x
          b.ty = pi.y
          return
        }
        {
          // Turned to face the boards they are holding.
          const facing = wallOutward(station as number, c)
          b.braceX = facing.dx
          b.braceY = facing.dy
          const anchor = stationAnchor(station as number, c)
          // Jitter, then clamp INSIDE the walls. Bodies used to be bounded by
          // the canvas, so they walked straight through a barricade and stood
          // in the forest — which made nonsense of the whole picture.
          // Spread along the wall, barely across it: a line of defenders, not a
          // cloud that drifts into the boards.
          const seg = wallSegment(station as number, c)
          const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) || 1
          const ax = (seg.x2 - seg.x1) / len
          const ay = (seg.y2 - seg.y1) / len
          const along = rand(-1, 1) * len * 0.24
          const qy = anchor.y + ay * along + rand(-5, 5)
          const p = clampInside(
            anchor.x + ax * along + rand(-5, 5),
            qy,
            c, bodyClearance(qy, c),
          )
          b.tx = p.x
          b.ty = p.y
          return
        }
      }

      b.braceX = 0
      b.braceY = 0

      if (b.kind === 'zombie' && Math.random() < 0.65) {
        // zombies drift toward the nearest living human — pure ambiance
        let prey: Body | null = null
        let best = Infinity
        for (const o of bodiesRef.current) {
          if (!o.alive || o.kind !== 'human') continue
          const d = (o.x - b.x) ** 2 + (o.y - b.y) ** 2
          if (d < best) { best = d; prey = o }
        }
        if (prey) {
          b.tx = Math.min(Math.max(prey.x + rand(-22, 22), PAD_X), Math.max(PAD_X, w - PAD_X))
          b.ty = Math.min(Math.max(prey.y + rand(-14, 14), PAD_TOP), Math.max(PAD_TOP, h - PAD_BOTTOM))
          return
        }
      }
      b.tx = rand(PAD_X, Math.max(PAD_X + 1, w - PAD_X))
      b.ty = rand(PAD_TOP, Math.max(PAD_TOP + 1, h - PAD_BOTTOM))
    }

    const moveToward = (b: Body, speed: number, dt: number): number => {
      const dx = b.tx - b.x
      const dy = b.ty - b.y
      const dist = Math.hypot(dx, dy)
      if (dist < 3) return dist
      const step = Math.min(dist, speed * dt)
      b.x += (dx / dist) * step
      b.y += (dy / dist) * step
      if (Math.abs(dx) > 0.5) b.facing = dx > 0 ? 1 : -1
      b.walk += dt * speed * 0.35
      return dist
    }

    /**
     * Clean figures keep their distance. Sums a repulsion vector from every
     * zombie inside FLEE_RADIUS (plus a shove off nearby walls so panic never
     * ends in a corner) and walks it. Returns false when nothing is close
     * enough to spook them, so the caller falls back to idle wandering.
     *
     * A chase cue overrides this — CHASE_SPEED beats FLEE_SPEED_MAX, so a
     * scripted bite still lands. That's the point: the only time a zombie
     * catches anyone is when the public counts say an infection happened.
     */
    const fleeStep = (b: Body, dt: number): boolean => {
      const { w, h } = sizeRef.current
      // Hysteresis: already running → keep running until well clear, so the
      // scene reads as a scramble instead of a twitch on the radius boundary.
      const radius = b.fleeT > 0 ? FLEE_RADIUS * FLEE_HOLD_FACTOR : FLEE_RADIUS
      let ax = 0
      let ay = 0
      let nearest = Infinity
      for (const z of bodiesRef.current) {
        if (!z.alive || z.kind !== 'zombie') continue
        const dx = b.x - z.x
        const dy = b.y - z.y
        const d = Math.hypot(dx, dy) || 0.001
        if (d > radius) continue
        if (d < nearest) nearest = d
        const weight = (radius - d) / radius
        ax += (dx / d) * weight
        ay += (dy / d) * weight
      }
      if (nearest === Infinity) return false
      b.fleeT = FLEE_HOLD_SECS

      const minX = PAD_X
      const maxX = Math.max(PAD_X, w - PAD_X)
      const minY = PAD_TOP
      const maxY = Math.max(PAD_TOP, h - PAD_BOTTOM)
      if (b.x - minX < WALL_MARGIN) ax += (WALL_MARGIN - (b.x - minX)) / WALL_MARGIN
      if (maxX - b.x < WALL_MARGIN) ax -= (WALL_MARGIN - (maxX - b.x)) / WALL_MARGIN
      if (b.y - minY < WALL_MARGIN) ay += (WALL_MARGIN - (b.y - minY)) / WALL_MARGIN
      if (maxY - b.y < WALL_MARGIN) ay -= (WALL_MARGIN - (maxY - b.y)) / WALL_MARGIN

      // Zombie repulsion and wall shove cancelled out (pinned, or flanked from
      // both sides) — break along the chamber instead of freezing in place.
      if (Math.hypot(ax, ay) < 0.001) {
        ax = b.x < (minX + maxX) / 2 ? 1 : -1
        ay = 0
      }
      const len = Math.hypot(ax, ay)
      const urgency = Math.min(1, Math.max(0, 1 - nearest / FLEE_RADIUS))
      const speed = FLEE_SPEED_MIN + (FLEE_SPEED_MAX - FLEE_SPEED_MIN) * urgency
      const step = speed * dt
      b.x = Math.min(Math.max(b.x + (ax / len) * step, minX), maxX)
      b.y = Math.min(Math.max(b.y + (ay / len) * step, minY), maxY)
      if (Math.abs(ax) > 0.05) b.facing = ax > 0 ? 1 : -1
      b.walk += dt * speed * 0.42
      // Wander target follows the retreat so they don't turn straight back
      // around the moment the zombie falls out of range.
      b.tx = b.x
      b.ty = b.y
      b.pauseUntil = 0
      return true
    }

    const stepCue = (dt: number) => {
      const active = activeRef.current
      if (!active) {
        gapRef.current -= dt
        if (gapRef.current <= 0 && queueRef.current.length > 0) {
          const cue = queueRef.current.shift() as OutbreakCue
          activeRef.current = startCue(cue)
        }
        return
      }
      active.t += dt
      switch (active.type) {
        case 'electrocute': {
          active.body.frozen = true
          if (!active.turned && active.t >= ELECTRO_FLICKER_SECS) {
            active.turned = true
            active.body.kind = 'zombie'
            active.body.transformT = 1
          }
          if (active.t >= ELECTRO_TOTAL_SECS) {
            active.body.frozen = false
            finishCue()
          }
          break
        }
        case 'bite': {
          const { z, v } = active
          if (active.stage === 'chase') {
            z.chasing = true
            z.tx = v.x
            z.ty = v.y
            const dist = moveToward(z, CHASE_SPEED, dt)
            z.gait = 1
            if (dist < 14 * perspectiveScale(v.y, sizeRef.current.h) || active.t >= BITE_CHASE_MAX_SECS) {
              active.stage = 'lunge'
              active.t = 0
              v.staggerT = 1
            }
          } else {
            if (!active.turned && active.t >= 0.45) {
              active.turned = true
              v.kind = 'zombie'
              v.transformT = 1
            }
            if (active.t >= BITE_LUNGE_SECS) {
              z.chasing = false
              z.pauseUntil = tRef.current + rand(0.8, 1.6)
              finishCue()
            }
          }
          break
        }
        case 'death': {
          active.body.dying = true
          active.body.fallT = Math.min(1, active.t / DEATH_SECS)
          if (active.t >= DEATH_SECS + 0.15) {
            active.body.dying = false
            active.body.alive = false
            finishCue()
          }
          break
        }
        case 'finale': {
          if (active.outcome === 'infected_win') {
            // frenzy — the horde quickens for a beat
            for (const b of bodiesRef.current) {
              if (b.alive && b.kind === 'zombie') b.walk += dt * 6
            }
          }
          if (active.t >= FINALE_SECS) finishCue()
          break
        }
      }
    }

    const startCue = (cue: OutbreakCue): ActiveCue | null => {
      const byId = (id: number) => bodiesRef.current.find(b => b.id === id)
      switch (cue.type) {
        case 'electrocute': {
          const body = byId(cue.figureId)
          return body ? { type: 'electrocute', body, t: 0, turned: false } : null
        }
        case 'bite': {
          const z = byId(cue.zombieId)
          const v = byId(cue.victimId)
          if (!z || !v) return null
          return { type: 'bite', z, v, stage: 'chase', t: 0, turned: false }
        }
        case 'death': {
          const body = byId(cue.figureId)
          return body ? { type: 'death', body, t: 0 } : null
        }
        case 'finale':
          return { type: 'finale', outcome: cue.outcome, t: 0 }
      }
    }

    const finishCue = () => {
      activeRef.current = null
      gapRef.current = CUE_GAP_SECS
    }

    const step = (dt: number) => {
      tRef.current += dt
      tickBreach(dt)
      stepCue(dt)

      // The horde walks every frame, whatever phase it is — they are outside
      // the whole game, not only while the barricade mechanic is running.
      {
        const { w, h } = sizeRef.current
        const bar = barricadeRef.current
        if (bar) {
          stepHorde(hordeRef.current, compoundShape(w, h, PAD_TOP, PAD_BOTTOM), dt, bar.threatened, w, h, bar.collapsed)
        }
      }

      if (reformRef.current) {
        reformRef.current = false
        const sprinters = sprintersRef.current
        for (const b of bodiesRef.current) {
          b.pauseUntil = 0
          if (sprinters.has(b.id)) {
            // Sent somewhere: run there, then brace for a while before the yard
            // pulls them back. This is the movement that answers a tap, so it
            // has to start on the very next frame.
            b.sprintT = SPRINT_SECS
            b.postT = POST_SECS
          }
          // Re-aim NOW rather than when the current stroll happens to finish.
          // Without this a figure kept walking to wherever it was already
          // headed — up to a few seconds of looking like it ignored you.
          retarget(b)
        }
        sprintersRef.current = new Set()
      }

      // Belt and braces: whatever moved a body this frame — walking, a cue, a
      // resize — it ends up inside the walls. The picture only works if the
      // survivors are unambiguously behind the barricade.
      //
      // 🚨 IT CORRECTS AN ESCAPE. IT DOES NOT DRAG ANYONE.
      // This ran unconditionally with a tighter margin than the one used to
      // place targets, so a figure could settle at a wall in a spot the guard
      // disagreed with by a pixel or two. The guard then nudged it sideways
      // every single frame — while `moveToward` had already returned early
      // (it was "there") and so never advanced the walk cycle. A body sliding
      // across the ground with its legs still: exactly the sideways float that
      // showed up after someone answered a wall.
      //
      // Now both use bodyClearance, so they cannot disagree; and a correction
      // large enough to matter re-aims the figure so it WALKS somewhere legal
      // instead of being shoved there.
      const barNow = barricadeRef.current
      if (barNow && !barNow.collapsed) {
        const { w, h } = sizeRef.current
        const c = compoundShape(w, h, PAD_TOP, PAD_BOTTOM)
        for (const b of bodiesRef.current) {
          if (!b.alive) continue
          const p = clampInside(b.x, b.y, c, bodyClearance(b.y, c))
          const shove = Math.hypot(p.x - b.x, p.y - b.y)
          if (shove < 0.05) continue
          b.x = p.x
          b.y = p.y
          // Legs keep up with the correction, so even a shove looks like steps.
          b.walk += shove * 0.35
          b.gait = Math.min(1, b.gait + shove * 0.2)
          if (shove > 0.5) {
            b.pauseUntil = 0
            retarget(b)
          }
        }
      }
      for (const b of bodiesRef.current) {
        b.staggerT = Math.max(0, b.staggerT - dt * 2.2)
        b.sprintT = Math.max(0, b.sprintT - dt)
        // The hold clock does not start until they have ARRIVED. Running it
        // during the sprint spent half the post on the journey, so a five
        // second brace became about two.
        if (b.sprintT <= 0) b.postT = Math.max(0, b.postT - dt)
        b.transformT = Math.max(0, b.transformT - dt / 0.7)
        b.shieldT = Math.max(0, b.shieldT - dt / 0.9)
        b.fleeT = Math.max(0, b.fleeT - dt)
        if (!b.alive || b.frozen || b.chasing || b.dying) { b.gait = Math.max(0, b.gait - dt * 4); continue }
        // game over — walkers halt where they stand while the scene settles
        if (settleRef.current !== null) { b.gait = Math.max(0, b.gait - dt * 4); continue }
        // Clean figures break away before a zombie can reach them — checked
        // ahead of the idle pause so panic always beats standing still.
        // No fleeing WHILE THE COMPOUND STANDS — in any phase, not just while
        // the barricade mechanic is running. Everyone inside is rendered as a
        // survivor but their internal kind is unchanged, so this had people
        // bolting from figures that LOOK human: unexplained panic, a scattered
        // yard, and (before the walls bounded them) survivors shoved out into
        // the forest. Fleeing belongs to the open-chamber scene that plays
        // before a game starts, where there is no compound and no uniform.
        if (!barricadeRef.current && b.kind === 'human' && fleeStep(b, dt)) {
          b.gait = Math.min(1, b.gait + dt * 6)
          continue
        }
        if (tRef.current < b.pauseUntil) {
          b.gait = Math.max(0, b.gait - dt * 4)
          b.walk += dt * 0.6 // idle sway
          continue
        }
        b.gait = Math.min(1, b.gait + dt * 4)
        const speed = b.sprintT > 0
          ? SPRINT_SPEED
          : b.kind === 'zombie' ? ZOMBIE_SPEED : HUMAN_SPEED
        const dist = moveToward(b, speed, dt)
        if (dist < 3) {
          // 🚨 A DEFENDER STANDS STILL. THAT IS THE WHOLE POINT OF THE POSE.
          // Everyone inside the compound shared one short pause, so a figure
          // that had just braced against a wall re-picked a jittered spot a
          // few pixels away within a second and started walking again. The
          // brace only draws while the gait is near zero, so it barely showed:
          // the effect was somebody shuffling along the boards rather than
          // holding them. Posted figures now hold for a proper beat.
          const posted = b.braceX !== 0 || b.braceY !== 0
          b.pauseUntil = tRef.current + (posted
            ? rand(2.4, 4.2)
            : barricadeRef.current
              ? rand(0.6, 1.8)
              : b.kind === 'zombie' ? rand(0.3, 1.2) : rand(0.7, 2.8))
          retarget(b)
        }
      }
    }

    let raf = 0
    let running = false
    let last = 0
    const tick = (now: number) => {
      if (!running) return
      raf = requestAnimationFrame(tick)
      if (document.hidden) { last = now; return }
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      // Game over with nothing left to play: let the walkers halt mid-stride,
      // then stop the loop entirely — a still tableau costs nothing while the
      // tab stays open. resumeRef restarts it (demo replay / late cues).
      const idle = endedRef.current && !activeRef.current && queueRef.current.length === 0
      if (idle) settleRef.current ??= tRef.current
      else settleRef.current = null
      step(dt)
      render()
      if (idle && settleRef.current !== null && tRef.current - settleRef.current > 1.5) {
        running = false
        cancelAnimationFrame(raf)
      }
    }
    const start = () => {
      if (running) return
      running = true
      last = performance.now()
      raf = requestAnimationFrame(tick)
    }
    resumeRef.current = start
    start()

    return () => {
      running = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderRef.current = null
      resumeRef.current = null
    }
  }, [])

  // ── Barricade: keep placement current, and react once per resolution ───────
  useEffect(() => {
    barricadeRef.current = barricade
    if (!barricade) {
      // Discussion is over — release the figures back to free wander rather
      // than leaving them frozen at walls that no longer mean anything.
      stationOfBodyRef.current = new Map()
      breachTRef.current = 0
      lastThreatRef.current = null
      return
    }
    const alive = bodiesRef.current.filter(b => b.alive)
    const me = alive.find(b => b.isMe) ?? null
    const before = stationOfBodyRef.current
    const next = assignStations({
      ids: alive.map(b => b.id),
      myId: me?.id ?? null,
      myStation: barricade.myStation,
      occupancy: barricade.occupancy,
      previous: before,
    })
    // Only figures whose wall actually changed break into a run. Sprinting
    // everyone on every server frame would read as panic rather than as a
    // decision, and would hide the one movement that carries information.
    //
    // 🚨 AND ONLY WHILE THERE IS SOMEWHERE TO RUN TO. When the barricade stops
    // running, `next` is empty and every figure "changed" — from a wall to
    // nowhere. Counting those as movers sprinted the entire room at every phase
    // boundary, which is the rush that showed up in play-testing. Leaving a
    // post is a stroll; there is nothing urgent about it.
    const moved = new Set<number>()
    if (next.size > 0) {
      for (const [id, st] of next) if (before.get(id) !== st) moved.add(id)
      // A warning going up is the other reason to run: everyone assigned to the
      // threatened wall breaks for it, and eight seconds is not enough to get
      // there at a stroll. Keyed on the threat CHANGING so this fires once per
      // push rather than on every frame the warning is live.
      if (barricade.threatened !== null && barricade.threatened !== lastThreatRef.current) {
        for (const [id, st] of next) if (st === barricade.threatened) moved.add(id)
      }
    }
    lastThreatRef.current = barricade.threatened
    const wasPosted = before.size > 0
    stationOfBodyRef.current = next
    sprintersRef.current = moved

    // Ask the sim loop to break every pause, so the room re-forms on the NEXT
    // frame rather than up to three seconds later. Without this, opening the
    // barricade — or the server publishing new occupancy — left figures
    // standing at walls they had already been reassigned away from.
    //
    // Only when the placement actually changed, though. The view object arrives
    // on every server frame, and re-aiming a room that has nothing new to do
    // just resets everyone's stroll mid-step.
    //
    // Raised as a flag rather than mutating bodies here: the simulation owns
    // body state, and reaching into it from an effect is exactly the kind of
    // cross-ownership write that gets hard to reason about later.
    if (moved.size > 0 || (wasPosted && next.size === 0)) reformRef.current = true

    // A breach scatters the room. Fired from a key rather than from `held`
    // changing, so two consecutive breaches both land.
    if (barricade.resultKey !== lastResultKeyRef.current) {
      lastResultKeyRef.current = barricade.resultKey
      if (barricade.held === false) breachTRef.current = BREACH_SECS
    }
  }, [barricade])

  // ── Feed public-state changes to the director ──────────────────────────────
  useEffect(() => {
    const director = directorRef.current
    if (!director) return
    const cues = director.update({ totalPlayers, aliveCount, zombieCount, myStatus, outcome })
    endedRef.current = outcome !== null

    if (director.epoch !== epochRef.current) {
      // roster changed — rebuild bodies wholesale (keep positions for known ids)
      epochRef.current = director.epoch
      const { w, h } = sizeRef.current
      const old = new Map(bodiesRef.current.map(b => [b.id, b]))
      bodiesRef.current = director.getFigures().map(fig => {
        const body = makeBody(fig, w || 320, h || 190)
        const prev = old.get(fig.id)
        if (prev) { body.x = prev.x; body.y = prev.y; body.tx = prev.tx; body.ty = prev.ty }
        return body
      })
      queueRef.current = []
      activeRef.current = null
      renderRef.current?.()
      resumeRef.current?.() // fresh troupe (e.g. demo replay) — restart a stopped loop
      return
    }

    if (reducedRef.current) {
      // no animation — snap bodies to the director's end state
      for (const cue of cues) {
        if (cue.type === 'electrocute') { const b = bodiesRef.current.find(x => x.id === cue.figureId); if (b) b.kind = 'zombie' }
        if (cue.type === 'bite') { const b = bodiesRef.current.find(x => x.id === cue.victimId); if (b) b.kind = 'zombie' }
        if (cue.type === 'death') { const b = bodiesRef.current.find(x => x.id === cue.figureId); if (b) { b.alive = false; b.fallT = 1 } }
      }
      renderRef.current?.()
      return
    }
    queueRef.current.push(...cues)
    resumeRef.current?.()
  }, [totalPlayers, aliveCount, zombieCount, myStatus, outcome])

  // ── Own shield aura — reflect immediately, even on the static tableau ──────
  useEffect(() => {
    myShieldRef.current = myShieldActive
    renderRef.current?.()
  }, [myShieldActive])

  // ── Anonymous flashes when OTHER players raise shields (public count) ──────
  // The count is public but figures are anonymous, so each new activation
  // rings a random human figure — never the activator's true one.
  useEffect(() => {
    const fresh = othersShieldCount - prevOthersShieldRef.current
    prevOthersShieldRef.current = othersShieldCount
    if (fresh <= 0 || reducedRef.current) return
    const pool = bodiesRef.current.filter(b => b.alive && !b.isMe && b.kind === 'human' && b.shieldT <= 0)
    for (let k = 0; k < fresh && pool.length > 0; k++) {
      const idx = Math.floor(Math.random() * pool.length)
      pool.splice(idx, 1)[0].shieldT = 1
    }
    resumeRef.current?.()
  }, [othersShieldCount])

  // ── Shield flashes from the public proof-save event ────────────────────────
  useEffect(() => {
    if (!socket) return
    const onEvent = (ev: { type?: string; payload?: Record<string, unknown> }) => {
      if (ev?.type !== 'player_saved_by_proof') return
      const saved = String(ev.payload?.player ?? '').toLowerCase()
      const mine = saved !== '' && saved === (localAddress ?? '').toLowerCase()
      const pool = bodiesRef.current.filter(b => b.alive && (mine ? b.isMe : !b.isMe && b.kind === 'human'))
      const target = pool[Math.floor(Math.random() * pool.length)]
      if (target) {
        target.shieldT = 1
        if (reducedRef.current) renderRef.current?.()
      }
    }
    socket.on('game_event', onEvent)
    return () => { socket.off('game_event', onEvent) }
  }, [socket, localAddress])

  return (
    <div
      className={`relative overflow-hidden rounded-lg border ${className}`}
      style={{ borderColor: 'rgba(107,142,35,0.15)', background: 'linear-gradient(180deg, #050a05 0%, #0a120a 100%)' }}
    >
      {/* Height is what the scene needs, not width.
          At 190/230px against a ~1060px column this was a 4.6:1 letterbox: the
          compound got ~100px of depth across ~850px of width, so the
          perspective had no room to read and the whole thing looked like a plan
          view. Taller fixes that; wider would have made it worse.

          Mobile stays comparatively short on purpose — vertical space is scarce
          there, chat and the wall controls are directly below, and MiniPay
          users should not have to scroll past a cutscene to reach the game.
          The canvas is DPR-capped at 2 and the backdrop is cached, so the extra
          pixels cost one drawImage per frame. */}
      <div ref={wrapRef} className="relative h-[240px] w-full sm:h-[400px]">
        <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full" />
        {/* CCTV scanlines */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.14) 0px, rgba(0,0,0,0.14) 1px, transparent 1px, transparent 3px)' }}
        />
        <span className="absolute left-3 top-2 font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: '#8fa882' }}>
          <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full align-middle" style={{ backgroundColor: '#e63329' }} />
          Quarantine cam
        </span>
        {totalPlayers === 0 && (
          <span className="absolute inset-0 flex items-center justify-center font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#7d9a72' }}>
            Awaiting subjects…
          </span>
        )}
      </div>
      <p className="border-t px-3 py-1.5 font-mono text-[10px]" style={{ borderColor: 'rgba(107,142,35,0.12)', color: '#7d9a72' }}>
        Identities scrambled per viewer — only your own figure is marked.
      </p>
    </div>
  )
}
