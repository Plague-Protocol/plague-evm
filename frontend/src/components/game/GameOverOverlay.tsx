'use client'

/**
 * GameOverOverlay — the endgame reveal moment.
 *
 * A staged full-screen sequence shown once when the result lands:
 *   veil → "OUTBREAK RESOLVED" eyebrow → outcome stamp slams in →
 *   pot counter counts up → winners line → dismiss affordance.
 *
 * Dismissible by click/tap anywhere. The persistent in-flow result card
 * remains the durable record; this overlay is only the moment.
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

export type GameOutcome = 'clean_win' | 'infected_win' | 'draw' | 'aborted'

const OUTCOME_META: Record<GameOutcome, { label: string; color: string; glyph: string; line: string }> = {
  clean_win:    { label: 'CLEAN WIN',    color: '#84cc16', glyph: '✚', line: 'The carrier has been purged. The village survives.' },
  infected_win: { label: 'INFECTED WIN', color: '#e63329', glyph: '☣', line: 'The plague overran the living. The village falls.' },
  draw:         { label: 'DRAW',         color: '#f5c518', glyph: '⚖', line: 'Stalemate. The outbreak ends unresolved.' },
  // Room ended before the game ever started (expired waiting for players, or
  // the host never started it). Distinct from a win so nobody thinks they won
  // or lost — the key message is that every stake came back.
  aborted:      { label: 'OUTBREAK CALLED OFF', color: '#8fa882', glyph: '⌛', line: 'The zone closed before the plague could spread — no game was played. All stakes refunded in full.' },
}

function useCountUp(target: number, start: boolean, durationMs = 1_000): number {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!start) return
    if (target <= 0) { setValue(0); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / durationMs)
      const eased = 1 - Math.pow(1 - k, 3)
      setValue(target * eased)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, start, durationMs])
  return value
}

export interface GameOverOverlayProps {
  readonly outcome: GameOutcome
  /** Pot share per winner (already in whole USDm units). */
  readonly potPerWinner?: number
  /** Display names of winners. */
  readonly winners?: readonly string[]
  readonly onDismiss: () => void
}

export function GameOverOverlay({ outcome, potPerWinner = 0, winners = [], onDismiss }: GameOverOverlayProps) {
  const reduced = useReducedMotion()
  const meta = OUTCOME_META[outcome]
  const [stampDone, setStampDone] = useState(false)
  const pot = useCountUp(potPerWinner, stampDone || !!reduced)

  // Small prizes must not collapse to "0.0000": use 2 decimals for >= 1, and 6
  // for sub-1 amounts (matches formatToken). Decimals are fixed to the target's
  // magnitude so the count-up width stays stable. Dust below 6dp shows a floor.
  const potDecimals = potPerWinner >= 1 ? 2 : 6
  const potText = potPerWinner > 0 && Number(potPerWinner.toFixed(potDecimals)) === 0
    ? '<0.000001'
    : pot.toFixed(potDecimals)

  // Arm the counter even if the stamp animation callback is skipped (reduced motion).
  useEffect(() => {
    if (reduced) setStampDone(true)
  }, [reduced])

  return (
    <AnimatePresence>
      <motion.div
        key="gameover"
        role="dialog"
        aria-label={`Game over: ${meta.label}`}
        className="fixed inset-0 z-[80] flex cursor-pointer items-center justify-center px-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        style={{ backgroundColor: 'rgba(6,11,6,0.93)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' }}
        onClick={onDismiss}
      >
        <div className="flex max-w-lg flex-col items-center gap-5 text-center">
          <motion.p
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.4 }}
            className="font-mono text-xs uppercase tracking-[0.34em]"
            style={{ color: '#8fa882' }}
          >
            Outbreak Resolved
          </motion.p>

          <motion.span
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 2.2 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.3 }}
            className="text-6xl leading-none"
            style={{ color: meta.color, textShadow: `0 0 40px ${meta.color}` }}
          >
            {meta.glyph}
          </motion.span>

          <motion.h2
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.7, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.45 }}
            onAnimationComplete={() => setStampDone(true)}
            className="font-horror text-5xl leading-none sm:text-7xl"
            style={{ color: meta.color, textShadow: `0 0 32px ${meta.color}55, 5px 5px 0 #060b06` }}
          >
            {meta.label}
          </motion.h2>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9, duration: 0.4 }}
            className="font-mono text-sm leading-relaxed"
            style={{ color: '#8fa882' }}
          >
            {meta.line}
          </motion.p>

          {potPerWinner > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.05, duration: 0.4 }}
              className="rounded-lg border px-8 py-4"
              style={{ borderColor: `${meta.color}55`, backgroundColor: `${meta.color}11` }}
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: '#4a5e44' }}>Pot per winner</p>
              <p className="mt-1 font-heading text-4xl font-bold tabular-nums leading-none" style={{ color: '#f5c518', textShadow: '0 0 18px rgba(245,197,24,0.4)' }}>
                {potText} <span className="text-xl">USDm</span>
              </p>
            </motion.div>
          )}

          {winners.length > 0 && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.25, duration: 0.4 }}
              className="font-mono text-xs"
              style={{ color: '#8fa882' }}
            >
              Survivors: <span style={{ color: '#d4c9b2' }}>{winners.join(', ')}</span>
            </motion.p>
          )}

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.7, duration: 0.5 }}
            className="mt-2 font-mono text-[10px] uppercase tracking-[0.26em]"
            style={{ color: '#4a5e44' }}
          >
            Tap anywhere to continue
          </motion.p>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
