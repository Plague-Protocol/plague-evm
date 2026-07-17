'use client'

/**
 * ArenaDoors — one-shot "easing the doors open" entrance, played when a player
 * walks into a game room.
 *
 * Horror pacing: the doors never fully stop once they start — a continuous,
 * trembling creep (stop-start reads as mechanical; a slow crawl reads as fear).
 * The room behind is revealed out of pure darkness, a pair of red eyes glints
 * in the crack during the peek, a whispered "stay quiet…" flickers below, and
 * a low heartbeat plays underneath (the sound of your own fear, honoring the
 * global mute toggle).
 *
 * When it plays — once per room per browser session:
 *  - Fires immediately on mount (so it covers the room's loading moment and the
 *    audio starts in sync), guarded by sessionStorage per roomId. Re-entering
 *    the same room later in the session — including lobby round-trips mid-game —
 *    shows nothing; a new room (new game) plays again.
 *  - Spectators walking into a live zone get the full beat too — their entry
 *    click is a fresh gesture, so the audio plays without priming.
 *
 * Pure transform + opacity, so it runs on the GPU compositor thread and never
 * touches layout/paint — cheap even on low-end mobile. No image/video assets
 * and no new dependencies (framer-motion is already bundled).
 *
 * Deliberately unobtrusive:
 *  - Non-blocking theatre: the game view renders BEHIND this the whole time.
 *  - Skipped entirely under prefers-reduced-motion.
 *  - Tap anywhere to dismiss immediately.
 */

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useSound } from '@/providers/sound-provider'

// ── Timeline (seconds unless noted) ───────────────────────────────────────────
const OPEN_DELAY = 0.4   // stillness before the first movement
const SWING_S    = 4.4   // full door-swing duration — slow enough to dread
const HOLD_MS    = 5_600 // total on-screen time before auto-dismiss (ms)

// Continuous creep: crack open a sliver, keep crawling through the "peek"
// (never a dead stop), then commit. Per-segment easing keeps the velocity
// changes smooth so it reads as a hand easing the door, not staged jumps.
const DOOR_KEYFRAMES = [0, 13, 19, 112] // degrees (negated for the left door)
const DOOR_TIMES     = [0, 0.2, 0.52, 1]
const DOOR_EASES     = ['easeOut', 'linear', 'easeInOut'] as const

// Shared industrial-door surface: dark panel + faint scanlines, matching the
// game's existing PhaseTransition texture.
const scanlines =
  'repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.55) 2px 4px)'

// ── Primed audio singletons ───────────────────────────────────────────────────
// Browsers only allow audio after a RECENT user gesture. In live play the lobby
// click is followed by a wallet prompt + an on-chain tx, so by the time the
// game page mounts the gesture has expired and play() is silently blocked
// (the demo works because Start Demo → doors is instant). primeArenaSounds()
// is called from the lobby's create/join click handlers: it plays both tracks
// muted for an instant while the gesture is still valid, permanently unlocking
// these elements for gesture-free playback on the game page.
let primedCreak: HTMLAudioElement | null = null
let primedPulse: HTMLAudioElement | null = null
let soundsInUse = false

function getArenaSounds() {
  if (typeof window === 'undefined') return null
  if (!primedCreak || !primedPulse) {
    primedCreak = new Audio('/sounds/door-creak.mp3')
    primedPulse = new Audio('/sounds/heartbeat.mp3')
    primedPulse.loop = true
  }
  return { creak: primedCreak, pulse: primedPulse }
}

export function primeArenaSounds() {
  const s = getArenaSounds()
  if (!s) return
  for (const a of [s.creak, s.pulse]) {
    a.muted = true
    a.play()
      .then(() => {
        // Don't yank the audio back if the doors started for real meanwhile.
        if (!soundsInUse) { a.pause(); a.currentTime = 0 }
        a.muted = false
      })
      .catch(() => { a.muted = false })
  }
}

// Ramp an audio element to silence then stop it — the creak is longer than the
// door beat, and a hard cut mid-sound is more jarring than no sound at all.
function fadeOutAndStop(a: HTMLAudioElement, ms = 400) {
  const v0 = a.volume
  const t0 = performance.now()
  const step = () => {
    const k = (performance.now() - t0) / ms
    if (k >= 1) { a.pause(); return }
    a.volume = v0 * (1 - k)
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

export interface ArenaDoorsProps {
  readonly roomId: string | null
}

export function ArenaDoors({ roomId }: ArenaDoorsProps) {
  const reduced = useReducedMotion()
  const { muted } = useSound()
  const [show, setShow] = useState(false)
  // Which roomId this mount has already decided for — prevents status flaps
  // (waiting → active) from re-running the play/suppress decision mid-beat.
  const decidedForRef = useRef<string | null>(null)
  // Auto-dismiss timer lives in a ref so a dependency change can't cancel it
  // and strand the overlay on screen.
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pulseRef = useRef<HTMLAudioElement | null>(null)
  const creakRef = useRef<HTMLAudioElement | null>(null)

  // Fire immediately on mount — the doors cover the room's loading moment and
  // the audio starts in sync with them. Once per roomId per browser session.
  useEffect(() => {
    if (!roomId || reduced) return
    if (decidedForRef.current === roomId) return  // already decided this visit
    decidedForRef.current = roomId
    const key = `arena-doors:${roomId}`
    if (sessionStorage.getItem(key)) return       // this room already played this session
    sessionStorage.setItem(key, '1')
    setShow(true)
    hideTimerRef.current = setTimeout(() => setShow(false), HOLD_MS)
  }, [roomId, reduced])

  useEffect(() => () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
  }, [])

  // Heartbeat under the door beat — your own pulse in your ears — plus the
  // hinge creak, cued to the doors' first movement. Same pattern as
  // useSoundscape's stings; autoplay rejection is swallowed silently.
  useEffect(() => {
    if (!show) return
    const s = getArenaSounds()
    if (!s) return
    soundsInUse = true
    const { pulse, creak } = s

    pulse.currentTime = 0
    pulse.volume = 0.45
    pulseRef.current = pulse
    pulse.play().catch(() => {})

    // Creak starts with the overlay itself — the hinge strains from the very
    // first touch, before the door visibly gives.
    creak.currentTime = 0
    creak.volume = 0.6
    creakRef.current = creak
    creak.play().catch(() => {})

    return () => {
      soundsInUse = false
      fadeOutAndStop(pulse)
      fadeOutAndStop(creak) // longer than the beat — fade, don't chop
      pulseRef.current = null
      creakRef.current = null
    }
  }, [show])

  // Honor the global mute toggle live, without restarting playback.
  useEffect(() => {
    if (pulseRef.current) pulseRef.current.volume = muted ? 0 : 0.45
    if (creakRef.current) creakRef.current.volume = muted ? 0 : 0.6
  }, [muted, show])

  const swing = {
    duration: SWING_S,
    delay: OPEN_DELAY,
    times: DOOR_TIMES,
    ease: [...DOOR_EASES],
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="arena-doors"
          aria-hidden="true"
          className="fixed inset-0 z-[80] overflow-hidden"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.4, ease: 'easeIn' } }}
          onClick={() => setShow(false)}
        >
          {/* Darkness behind the doors — the room emerges from pitch black only
              after the doors have committed, so the crack reveals nothing. */}
          <motion.div
            className="absolute inset-0"
            style={{ backgroundColor: '#020402' }}
            initial={{ opacity: 0.96 }}
            animate={{ opacity: 0 }}
            transition={{ delay: 2.9, duration: 2.0, ease: 'easeInOut' }}
          />

          {/* Eyes in the dark — a red pair glints in the crack mid-peek, blinks
              once, and is gone before the doors open wide. Did you see it? */}
          <motion.div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0, 1, 1, 0, 1, 0] }}
            transition={{ delay: 1.1, duration: 1.7, times: [0, 0.15, 0.3, 0.55, 0.62, 0.75, 1], ease: 'linear' }}
          >
            <div className="flex items-center gap-3" style={{ transform: 'translateY(-6px)' }}>
              <span className="h-[7px] w-[9px] rounded-full" style={{ backgroundColor: '#e63329', boxShadow: '0 0 10px #e63329, 0 0 22px rgba(230,51,41,0.6)' }} />
              <span className="h-[6px] w-[8px] rounded-full" style={{ backgroundColor: '#e63329', boxShadow: '0 0 8px #e63329, 0 0 18px rgba(230,51,41,0.5)', transform: 'translateY(1px)' }} />
            </div>
          </motion.div>

          {/* Trembling wrapper — a scared hand's micro-shake on both doors. */}
          <motion.div
            className="absolute inset-0 flex"
            style={{ perspective: 1100 }}
            animate={{ x: [0, -1.2, 0.8, -0.6, 1, -0.8, 0.4, 0] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
          >
            {/* Left door — hinged on the left edge, eases away into the room. */}
            <motion.div
              className="relative h-full w-1/2 origin-left"
              style={{
                backgroundColor: '#0a120a',
                backgroundImage: scanlines,
                boxShadow: 'inset -48px 0 90px rgba(0,0,0,0.75)',
                borderRight: '2px solid rgba(107,142,35,0.35)',
              }}
              initial={{ rotateY: 0 }}
              animate={{ rotateY: DOOR_KEYFRAMES.map(d => -d) }}
              transition={swing}
            >
              {/* seam-side hazard stripe */}
              <div
                className="absolute inset-y-0 right-0 w-6 opacity-40"
                style={{ backgroundImage: 'repeating-linear-gradient(45deg, #f5c518 0 8px, #0a120a 8px 16px)' }}
              />
            </motion.div>

            {/* Right door — mirror. */}
            <motion.div
              className="relative h-full w-1/2 origin-right"
              style={{
                backgroundColor: '#0a120a',
                backgroundImage: scanlines,
                boxShadow: 'inset 48px 0 90px rgba(0,0,0,0.75)',
                borderLeft: '2px solid rgba(107,142,35,0.35)',
              }}
              initial={{ rotateY: 0 }}
              animate={{ rotateY: DOOR_KEYFRAMES }}
              transition={swing}
            >
              <div
                className="absolute inset-y-0 left-0 w-6 opacity-40"
                style={{ backgroundImage: 'repeating-linear-gradient(-45deg, #f5c518 0 8px, #0a120a 8px 16px)' }}
              />
            </motion.div>
          </motion.div>

          {/* Vignette — closes the edges in for the whole beat. */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(ellipse at center, transparent 42%, rgba(2,4,2,0.9) 100%)' }}
          />

          {/* Whispered warning — flickers like a dying light, gone by mid-open. */}
          <motion.p
            className="pointer-events-none absolute inset-x-0 bottom-[18%] text-center font-mono text-xs lowercase tracking-[0.5em]"
            style={{ color: '#8fa882', textShadow: '0 0 12px rgba(107,142,35,0.5)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.9, 0.25, 0.8, 0.1, 0.7, 0] }}
            transition={{ delay: 0.9, duration: 2.6, times: [0, 0.18, 0.3, 0.5, 0.62, 0.8, 1], ease: 'linear' }}
          >
            stay quiet…
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
