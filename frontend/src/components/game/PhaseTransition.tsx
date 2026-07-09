'use client'

/**
 * PhaseTransition — full-screen dramatic interstitial fired on phase changes.
 *
 * Renders nothing until `phaseKey` CHANGES (the initial mount is skipped so a
 * page refresh doesn't replay it). On change it flashes a dark veil with the
 * phase title in the phase color for ~1.4s, then removes itself. The overlay
 * is pointer-events-none throughout — it never blocks input.
 *
 * Only public information should ever be passed as label/sublabel: phase
 * names, round numbers, elimination results. Never role or infection data.
 */

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

const GLYPH: Record<string, string> = {
  infection:  '☣',
  discussion: '✚',
  voting:     '⚖',
  reveal:     '☠',
}

export interface PhaseTransitionProps {
  /** Unique key per transition, e.g. `${round}:${phase}`. Changing it fires the overlay. */
  readonly phaseKey: string
  /** Big display-font title, e.g. "VOTING". */
  readonly label: string
  /** Phase accent color (hex). */
  readonly color: string
  /** Small mono line under the title, e.g. "Round 3". */
  readonly sublabel?: string
  /** Glyph lookup key; falls back to no glyph. */
  readonly glyphKey?: string
  /** Master switch — pass false while the room isn't active. */
  readonly enabled?: boolean
}

const HOLD_MS = 1_450

export function PhaseTransition({ phaseKey, label, color, sublabel, glyphKey, enabled = true }: PhaseTransitionProps) {
  const reduced = useReducedMotion()
  const [visible, setVisible] = useState(false)
  const [snap, setSnap] = useState({ label, color, sublabel, glyphKey })
  const prevKeyRef = useRef<string | null>(null)

  useEffect(() => {
    // Skip the first observed key (initial mount / page refresh).
    if (prevKeyRef.current === null) {
      prevKeyRef.current = phaseKey
      return
    }
    if (prevKeyRef.current === phaseKey) return
    prevKeyRef.current = phaseKey
    if (!enabled) return

    // Snapshot the display props so a mid-animation phase drift can't mutate the card.
    setSnap({ label, color, sublabel, glyphKey })
    setVisible(true)
    const t = setTimeout(() => setVisible(false), HOLD_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseKey, enabled])

  const glyph = snap.glyphKey ? GLYPH[snap.glyphKey] : undefined

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={phaseKey}
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35, ease: 'easeIn' } }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          style={{ backgroundColor: 'rgba(6,11,6,0.86)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)' }}
        >
          {/* scanline texture */}
          <div
            className="absolute inset-0 opacity-20"
            style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.6) 2px 4px)' }}
          />
          <div className="relative flex flex-col items-center gap-3 px-6 text-center">
            {glyph && (
              <motion.span
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 2.4, rotate: -12 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 18, delay: 0.05 }}
                className="text-5xl leading-none"
                style={{ color: snap.color, textShadow: `0 0 32px ${snap.color}` }}
              >
                {glyph}
              </motion.span>
            )}
            <motion.p
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 26, letterSpacing: '0.4em' }}
              animate={reduced
                ? { opacity: 1 }
                : { opacity: [0, 1, 0.65, 1], y: 0, letterSpacing: '0.12em' }}
              transition={{ duration: 0.5, delay: 0.12, ease: 'easeOut' }}
              className="font-horror text-4xl uppercase leading-none sm:text-6xl"
              style={{ color: snap.color, textShadow: `0 0 28px ${snap.color}66, 4px 4px 0 #060b06` }}
            >
              {snap.label}
            </motion.p>
            {snap.sublabel && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.34, duration: 0.3 }}
                className="font-mono text-xs uppercase tracking-[0.3em]"
                style={{ color: '#8fa882' }}
              >
                {snap.sublabel}
              </motion.p>
            )}
            {/* horizontal rule sweep */}
            {!reduced && (
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: 0.2, duration: 0.45, ease: 'easeOut' }}
                className="h-[2px] w-48 sm:w-72"
                style={{ backgroundColor: snap.color, boxShadow: `0 0 12px ${snap.color}` }}
              />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
