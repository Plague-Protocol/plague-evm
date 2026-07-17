'use client'

/**
 * ArenaDoors — one-shot "the doors swing open" entrance, played when a player
 * first enters a game room.
 *
 * Pure CSS 3D transform + opacity, so it runs on the GPU compositor thread and
 * never touches layout/paint — cheap even on low-end mobile. No image/video
 * assets and no new dependencies (framer-motion is already bundled).
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

// Doors sit closed for a beat, swing open, hold briefly on the reveal, then go.
const SWING_MS = 0.9   // door swing duration (seconds)
const HOLD_MS  = 1_350 // total on-screen time before auto-dismiss (ms)

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

  const swing = { duration: SWING_MS, ease: [0.7, 0, 0.3, 1] as const, delay: 0.18 }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="arena-doors"
          aria-hidden="true"
          className="fixed inset-0 z-[80] flex overflow-hidden"
          style={{ perspective: 1200 }}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.3, ease: 'easeIn' } }}
          onClick={() => setShow(false)}
        >
          {/* Left door — hinged on the left edge, swings away into the room. */}
          <motion.div
            className="relative h-full w-1/2 origin-left"
            style={{
              backgroundColor: '#0a120a',
              backgroundImage: scanlines,
              boxShadow: 'inset -48px 0 90px rgba(0,0,0,0.75)',
              borderRight: '2px solid rgba(107,142,35,0.35)',
            }}
            initial={{ rotateY: 0 }}
            animate={{ rotateY: -112 }}
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
            animate={{ rotateY: 112 }}
            transition={swing}
          >
            <div
              className="absolute inset-y-0 left-0 w-6 opacity-40"
              style={{ backgroundImage: 'repeating-linear-gradient(-45deg, #f5c518 0 8px, #0a120a 8px 16px)' }}
            />
          </motion.div>

          {/* Center emblem that fades as the doors part. */}
          <motion.span
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-6xl"
            style={{ color: '#6b8e23', textShadow: '0 0 32px #6b8e23' }}
            initial={{ opacity: 0.9, scale: 1 }}
            animate={{ opacity: 0, scale: 1.3 }}
            transition={{ duration: 0.45, ease: 'easeIn', delay: 0.18 }}
          >
            ☣
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
