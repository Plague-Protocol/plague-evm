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
  assignStations, stationAnchor, compoundShape, wallSegment, wallOutward,
  clampInside, depthAt, type Corners,
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
    ctx.moveTo(shoulderX, shoulderY); ctx.lineTo(shoulderX + 3 * s + armSwing, -12 * s)
    ctx.moveTo(shoulderX, shoulderY); ctx.lineTo(shoulderX - 3 * s - armSwing, -12 * s)
  }
  ctx.stroke()

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
function drawOutside(
  ctx: CanvasRenderingContext2D, w: number, h: number, c: Corners, t: number,
) {
  // Night sky behind the trees, warming very slightly toward the compound.
  const sky = ctx.createLinearGradient(0, 0, 0, c.fl.y + 20)
  sky.addColorStop(0, '#050a06')
  sky.addColorStop(1, '#0b1410')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, c.fl.y + 20)

  // Treeline: two ranks, the far one dimmer and thinner, for depth.
  for (const rank of [0, 1] as const) {
    const baseY = c.fl.y * (rank === 0 ? 0.72 : 0.94)
    const count = rank === 0 ? 22 : 16
    for (let i = 0; i < count; i++) {
      const x = noise(i + rank * 50) * (w + 60) - 30
      const th = c.fl.y * (rank === 0 ? 0.34 : 0.5) * (0.6 + noise(i, 3) * 0.7)
      const halfW = (rank === 0 ? 5 : 8) * (0.7 + noise(i, 7) * 0.6)
      const sway = Math.sin(t * 0.4 + i) * (rank === 0 ? 0.8 : 1.6)
      ctx.fillStyle = rank === 0 ? 'rgba(22,38,26,0.85)' : 'rgba(14,26,17,0.95)'
      ctx.beginPath()
      ctx.moveTo(x - halfW + sway, baseY)
      ctx.lineTo(x + sway, baseY - th)
      ctx.lineTo(x + halfW + sway, baseY)
      ctx.closePath()
      ctx.fill()
      // Trunk
      ctx.fillStyle = 'rgba(10,16,10,0.9)'
      ctx.fillRect(x - 1.2 + sway, baseY - 2, 2.4, 6)
    }
  }

  // Ground fog drifting across the treeline base — cheap, and it does more for
  // "outside at night" than any amount of extra geometry.
  ctx.save()
  for (let i = 0; i < 5; i++) {
    const y = c.fl.y * (0.78 + i * 0.05)
    const drift = ((t * (6 + i * 3) + i * 200) % (w + 300)) - 150
    const g = ctx.createRadialGradient(drift, y, 0, drift, y, 130)
    g.addColorStop(0, 'rgba(120,150,120,0.05)')
    g.addColorStop(1, 'rgba(120,150,120,0)')
    ctx.fillStyle = g
    ctx.fillRect(drift - 130, y - 40, 260, 80)
  }
  ctx.restore()
}

/**
 * A zombie outside the walls.
 *
 * Drawn as a body rather than a dot. The first version used 2.6px circles and
 * play-testing read them, correctly, as debris — a horde has to be made of
 * things with arms if the walls are going to mean anything. Deliberately
 * cruder than the survivors inside: hunched, arms out, no face.
 */
function drawWalker(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, phase: number) {
  const lurch = Math.sin(phase) * 1.4
  ctx.save()
  ctx.translate(x, y + lurch)
  ctx.strokeStyle = 'rgba(143,191,63,0.62)'
  ctx.fillStyle = 'rgba(143,191,63,0.62)'
  ctx.lineWidth = 1.6 * s
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, 0); ctx.lineTo(-2.2 * s, 4.5 * s)   // legs
  ctx.moveTo(0, 0); ctx.lineTo(2.2 * s, 4.5 * s)
  ctx.moveTo(0, 0); ctx.lineTo(0, -5.5 * s)          // spine
  // Arms reaching forward — the whole silhouette of the thing.
  ctx.moveTo(0, -4 * s); ctx.lineTo(4.6 * s, -3 * s + Math.sin(phase * 1.3) * 1.2)
  ctx.moveTo(0, -4 * s); ctx.lineTo(4.2 * s, -1.2 * s - Math.sin(phase * 1.1) * 1.2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, -7 * s, 1.9 * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * The horde: bodies circling the compound, probing it, massing where the next
 * push is coming.
 *
 * Motion is derived from time and index rather than simulated, so a hundred of
 * them cost nothing and nothing has to be stored. Sizes scale with depth so the
 * ones behind the far wall sit correctly against the trees.
 */
function drawHorde(ctx: CanvasRenderingContext2D, c: Corners, t: number, bar: BarricadeView) {
  const count = Math.min(40, 12 + bar.infectedCount * 5)
  const cx = (c.fl.x + c.fr.x + c.nr.x + c.nl.x) / 4
  const cy = (c.fl.y + c.fr.y + c.nr.y + c.nl.y) / 4
  const spanX = (c.nr.x - c.nl.x) / 2
  const spanY = (c.nl.y - c.fl.y) / 2

  for (let i = 0; i < count; i++) {
    // Two thirds converge on the threatened wall; the rest keep circling, so
    // the pressure is legible without the rest of the picture emptying out.
    const massing = bar.threatened !== null && i % 3 !== 0
    let x: number
    let y: number
    if (massing && bar.threatened !== null) {
      const seg = wallSegment(bar.threatened, c)
      const out = wallOutward(bar.threatened, c)
      const k = noise(i, 11)
      const depth = 8 + noise(i, 13) * 30 + Math.sin(t * 1.6 + i) * 3
      x = seg.x1 + (seg.x2 - seg.x1) * k + out.dx * depth
      y = seg.y1 + (seg.y2 - seg.y1) * k + out.dy * depth
    } else {
      // A slow patrol around the perimeter, each at its own rate — they are
      // looking for a way in, not orbiting a point.
      const a = noise(i, 17) * Math.PI * 2 + t * (0.05 + noise(i, 19) * 0.06)
      const r = 1.32 + noise(i, 23) * 0.5
      x = cx + Math.cos(a) * spanX * r
      y = cy + Math.sin(a) * spanY * r
    }
    const d = depthAt(y, c)
    drawWalker(ctx, x, y, 0.85 + d * 0.7, t * 3.4 + i)
  }
}

/**
 * The four walls, as actual barricades.
 *
 * Stacked planks with posts at the ends — a single stroked line read as a
 * diagram box, which is exactly what play-testing said. Plank count and
 * thickness scale with depth so the near wall is heavier than the far one.
 *
 * Three states, all readable at a glance on a phone: intact, straining (under
 * attack — shuddering, red bleeding between the boards) and splintered (a push
 * got through this round). `collapsed` is the endgame, not a state of a wall.
 */
function drawWalls(ctx: CanvasRenderingContext2D, c: Corners, t: number, bar: BarricadeView) {
  for (let i = 0; i < 4; i++) {
    const seg = wallSegment(i, c)
    const out = wallOutward(i, c)
    const straining = bar.threatened === i
    const broken = bar.brokenWalls.includes(i)
    const gone = bar.collapsed

    const midY = (seg.y1 + seg.y2) / 2
    const d = depthAt(midY, c)
    const planks = 3 + Math.round(d * 2)          // 3 far … 5 near
    const gap = 2.6 + d * 2.2
    const lw = 2.2 + d * 2.4

    ctx.save()
    // The boards strain, not the camera — a shaking viewport reads as a bug.
    if (straining && !gone) {
      ctx.translate(out.dx * Math.sin(t * 30) * 2, out.dy * Math.sin(t * 30) * 2)
    }

    // Pressure bleeding between the boards from outside.
    if (straining && !gone) {
      const pulse = 0.3 + 0.28 * Math.sin(t * 7)
      ctx.save()
      ctx.strokeStyle = `rgba(230,51,41,${pulse.toFixed(3)})`
      ctx.lineWidth = planks * gap + 10
      ctx.globalAlpha = 0.45
      ctx.beginPath()
      ctx.moveTo(seg.x1, seg.y1)
      ctx.lineTo(seg.x2, seg.y2)
      ctx.stroke()
      ctx.restore()
    }

    ctx.strokeStyle = gone
      ? 'rgba(230,51,41,0.42)'
      : broken
        ? 'rgba(230,51,41,0.85)'
        : straining
          ? 'rgba(245,197,24,0.95)'
          : 'rgba(120,152,60,0.72)'
    ctx.lineWidth = lw
    ctx.lineCap = 'butt'

    for (let k = 0; k < planks; k++) {
      // Planks stack along the wall's own outward normal, so each wall boards
      // up in its own direction instead of all of them stacking downward.
      const off = (k - (planks - 1) / 2) * gap
      const ox = out.dx * off
      const oy = out.dy * off
      // A splintered wall keeps its outer boards and loses the middle: a gap
      // punched through reads at a glance where a colour change does not.
      const spans: [number, number][] = gone
        ? [[0, 0.16], [0.34, 0.46], [0.72, 0.86]]
        : broken && k > 0
          ? [[0, 0.3], [0.7, 1]]
          : [[0, 1]]
      for (const [a, b] of spans) {
        ctx.beginPath()
        ctx.moveTo(seg.x1 + (seg.x2 - seg.x1) * a + ox, seg.y1 + (seg.y2 - seg.y1) * a + oy)
        ctx.lineTo(seg.x1 + (seg.x2 - seg.x1) * b + ox, seg.y1 + (seg.y2 - seg.y1) * b + oy)
        ctx.stroke()
      }
    }

    // End posts — they turn a stack of lines into a built thing.
    if (!gone) {
      ctx.lineWidth = lw + 1.4
      ctx.strokeStyle = broken ? 'rgba(230,51,41,0.7)' : 'rgba(90,116,48,0.9)'
      const half = (planks * gap) / 2 + 2
      for (const [px, py] of [[seg.x1, seg.y1], [seg.x2, seg.y2]] as const) {
        ctx.beginPath()
        ctx.moveTo(px - out.dx * half, py - out.dy * half)
        ctx.lineTo(px + out.dx * half, py + out.dy * half)
        ctx.stroke()
      }
    }
    ctx.restore()
  }
}

/** Lamplight inside the compound — the reason the survivors are visible and the
 *  forest is not, and the thing that makes the enclosure feel occupied. */
function drawCompoundGround(ctx: CanvasRenderingContext2D, c: Corners) {
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(c.fl.x, c.fl.y)
  ctx.lineTo(c.fr.x, c.fr.y)
  ctx.lineTo(c.nr.x, c.nr.y)
  ctx.lineTo(c.nl.x, c.nl.y)
  ctx.closePath()
  const cx = (c.fl.x + c.nr.x) / 2
  const cy = (c.fl.y + c.nl.y) / 2
  const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, Math.max(c.nr.x - c.nl.x, c.nl.y - c.fl.y) * 0.7)
  g.addColorStop(0, 'rgba(120,150,60,0.14)')
  g.addColorStop(1, 'rgba(20,32,18,0.5)')
  ctx.fillStyle = g
  ctx.fill()
  ctx.restore()
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
    drawOutside(ctx, w, h, c, t)
    drawCompoundGround(ctx, c)
    // Horde before the walls: they are outside, so the boards occlude them.
    drawHorde(ctx, c, t, bar)
    drawWalls(ctx, c, t, bar)
  }

  const flashBody = active?.type === 'electrocute' && active.t < ELECTRO_FLICKER_SECS ? active.body : null
  for (const b of [...bodies].sort((a, c) => a.y - c.y)) {
    // `uniform` while the compound stands: identical survivors inside, and the
    // only truthful figure is your own.
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
      drawScene(ctx, w, h, bodiesRef.current, tRef.current, activeRef.current, myShieldRef.current, barricadeRef.current)
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
      if (bar && b.alive && breachTRef.current <= 0) {
        const station = stationOfBodyRef.current.get(b.id)
        if (station !== undefined) {
          const c = compoundShape(w, h, PAD_TOP, PAD_BOTTOM)
          const anchor = stationAnchor(station, c)
          // Jitter, then clamp INSIDE the walls. Bodies used to be bounded by
          // the canvas, so they walked straight through a barricade and stood
          // in the forest — which made nonsense of the whole picture.
          const p = clampInside(anchor.x + rand(-30, 30), anchor.y + rand(-18, 18), c, 12)
          b.tx = p.x
          b.ty = p.y
          return
        }
      }

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

      if (reformRef.current) {
        reformRef.current = false
        for (const b of bodiesRef.current) b.pauseUntil = 0
      }

      // Belt and braces: whatever moved a body this frame — walking, a cue, a
      // resize — it ends up inside the walls. The picture only works if the
      // survivors are unambiguously behind the barricade.
      const barNow = barricadeRef.current
      if (barNow && !barNow.collapsed) {
        const { w, h } = sizeRef.current
        const c = compoundShape(w, h, PAD_TOP, PAD_BOTTOM)
        for (const b of bodiesRef.current) {
          if (!b.alive) continue
          const p = clampInside(b.x, b.y, c, 8)
          b.x = p.x
          b.y = p.y
        }
      }
      for (const b of bodiesRef.current) {
        b.staggerT = Math.max(0, b.staggerT - dt * 2.2)
        b.transformT = Math.max(0, b.transformT - dt / 0.7)
        b.shieldT = Math.max(0, b.shieldT - dt / 0.9)
        b.fleeT = Math.max(0, b.fleeT - dt)
        if (!b.alive || b.frozen || b.chasing || b.dying) { b.gait = Math.max(0, b.gait - dt * 4); continue }
        // game over — walkers halt where they stand while the scene settles
        if (settleRef.current !== null) { b.gait = Math.max(0, b.gait - dt * 4); continue }
        // Clean figures break away before a zombie can reach them — checked
        // ahead of the idle pause so panic always beats standing still.
        // No fleeing while the compound stands. Figures are rendered uniformly
        // during the barricade but their internal kind is unchanged, so this
        // had survivors bolting from figures that LOOK human — scattering the
        // formation and, with the old canvas-wide bounds, pushing them out
        // through the walls. They are holding a line, not running from it.
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
        const speed = b.kind === 'zombie' ? ZOMBIE_SPEED : HUMAN_SPEED
        const dist = moveToward(b, speed, dt)
        if (dist < 3) {
          // Short pauses while holding the line: a long idle looks like nobody
          // reacted to the wall that is about to be hit.
          b.pauseUntil = tRef.current + (barricadeRef.current
            ? rand(0.2, 0.9)
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
      return
    }
    const alive = bodiesRef.current.filter(b => b.alive)
    const me = alive.find(b => b.isMe) ?? null
    stationOfBodyRef.current = assignStations({
      ids: alive.map(b => b.id),
      myId: me?.id ?? null,
      myStation: barricade.myStation,
      occupancy: barricade.occupancy,
      previous: stationOfBodyRef.current,
    })

    // Ask the sim loop to break every pause, so the room re-forms on the NEXT
    // frame rather than up to three seconds later. Without this, opening the
    // barricade — or the server publishing new occupancy — left figures
    // standing at walls they had already been reassigned away from.
    //
    // Raised as a flag rather than mutating bodies here: the simulation owns
    // body state, and reaching into it from an effect is exactly the kind of
    // cross-ownership write that gets hard to reason about later.
    reformRef.current = true

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
      <div ref={wrapRef} className="relative h-[190px] w-full sm:h-[230px]">
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
