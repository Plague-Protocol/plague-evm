'use client'

/**
 * MomentOverlay — one-shot dramatic interstitial for PERSONAL game beats.
 *
 * Sibling of PhaseTransition (same visual language) but fired imperatively by
 * a key change rather than a phase change, and — unlike PhaseTransition — it
 * MAY display private information (e.g. "YOU ARE INFECTED"): it renders only
 * in the local player's browser, driven by state that is already private to
 * this client. Never pass another player's secret data here.
 *
 * Fire it by setting `momentKey` to a new non-null value together with the
 * `moment` payload. It shows for ~2s, then removes itself. pointer-events-none
 * throughout; honors prefers-reduced-motion.
 */

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

export interface Moment {
  /** Big display-font title, e.g. "YOU ARE INFECTED". */
  readonly label: string
  /** Accent color (hex). */
  readonly color: string
  /** Optional glyph rendered above the title, e.g. "☣". */
  readonly glyph?: string
  /** Small mono line under the title. */
  readonly sublabel?: string
  /** Adds a screen-edge flash + title shudder for gut-punch moments. */
  readonly intense?: boolean
}

const HOLD_MS = 2_000

export function MomentOverlay({ momentKey, moment }: {
  readonly momentKey: string | null
  readonly moment: Moment | null
}) {
  const reduced = useReducedMotion()
  const [visible, setVisible] = useState(false)
  const [snap, setSnap] = useState<Moment | null>(null)
  const prevKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (momentKey === null || momentKey === prevKeyRef.current) return
    prevKeyRef.current = momentKey
    if (!moment) return
    setSnap(moment) // snapshot so later prop drift can't mutate mid-animation
    setVisible(true)
    const t = setTimeout(() => setVisible(false), HOLD_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [momentKey])

  return (
    <AnimatePresence>
      {visible && snap && (
        <motion.div
          key={momentKey}
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[75] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.4, ease: 'easeIn' } }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          style={{ backgroundColor: 'rgba(6,11,6,0.9)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' }}
        >
          {/* scanline texture */}
          <div
            className="absolute inset-0 opacity-20"
            style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.6) 2px 4px)' }}
          />
          {/* screen-edge flash for intense moments */}
          {snap.intense && !reduced && (
            <motion.div
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.85, 0.2, 0.55, 0.25] }}
              transition={{ duration: 1.1, ease: 'easeOut' }}
              style={{ background: `radial-gradient(ellipse at center, transparent 40%, ${snap.color}55 100%)` }}
            />
          )}
          <div className="relative flex flex-col items-center gap-3 px-6 text-center">
            {snap.glyph && (
              <motion.span
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 3, rotate: 14 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 280, damping: 15, delay: 0.05 }}
                className="text-6xl leading-none"
                style={{ color: snap.color, textShadow: `0 0 40px ${snap.color}` }}
              >
                {snap.glyph}
              </motion.span>
            )}
            <motion.p
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.35 }}
              animate={reduced
                ? { opacity: 1 }
                : snap.intense
                  ? { opacity: [0, 1, 0.5, 1], scale: 1, x: [0, -5, 5, -3, 3, 0] }
                  : { opacity: [0, 1, 0.7, 1], scale: 1 }}
              transition={{ duration: 0.55, delay: 0.12, ease: 'easeOut' }}
              className="font-horror text-4xl uppercase leading-none sm:text-6xl"
              style={{ color: snap.color, textShadow: `0 0 28px ${snap.color}66, 4px 4px 0 #060b06` }}
            >
              {snap.label}
            </motion.p>
            {snap.sublabel && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.45, duration: 0.35 }}
                className="max-w-xs font-mono text-xs uppercase tracking-[0.3em]"
                style={{ color: '#8fa882' }}
              >
                {snap.sublabel}
              </motion.p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
