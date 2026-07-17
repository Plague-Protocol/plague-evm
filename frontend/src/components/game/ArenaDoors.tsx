'use client'

/**
 * ArenaDoors — one-shot "easing the doors open" entrance, played when a player
 * first enters a game room.
 *
 * Horror pacing: the doors never fully stop once they start — a continuous,
 * trembling creep (stop-start reads as mechanical; a slow crawl reads as fear).
 * The room behind is revealed out of pure darkness, a pair of red eyes glints
 * in the crack during the peek, and a whispered "stay quiet…" flickers below.
 *
 * Pure transform + opacity, so it runs on the GPU compositor thread and never
 * touches layout/paint — cheap even on low-end mobile. No image/video assets
 * and no new dependencies (framer-motion is already bundled).
 *
 * Deliberately unobtrusive:
 *  - Non-blocking theatre: the game view renders BEHIND this the whole time, so
 *    the doors are an overlay on an already-live screen, never a gate in front
 *    of it. Data keeps loading underneath.
 *  - Plays at most once per room per browser session (sessionStorage guard), so
 *    a refresh or a leave-and-return doesn't replay it.
 *  - Skipped entirely under prefers-reduced-motion.
 *  - Tap anywhere to dismiss immediately.
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

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

export function ArenaDoors({ roomId }: { roomId: string | null }) {
  const reduced = useReducedMotion()
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!roomId || reduced) return
    if (typeof window === 'undefined') return
    const key = `arena-doors:${roomId}`
    if (sessionStorage.getItem(key)) return // already played this session
    sessionStorage.setItem(key, '1')
    setShow(true)
    const t = setTimeout(() => setShow(false), HOLD_MS)
    return () => clearTimeout(t)
  }, [roomId, reduced])

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
