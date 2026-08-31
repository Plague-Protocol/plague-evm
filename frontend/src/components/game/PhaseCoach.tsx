'use client'

/**
 * PhaseCoach — one-time, non-blocking guidance shown at the moment a phase
 * starts.
 *
 * Players told us they "didn't know what to do" INSIDE the demo, despite a
 * six-bullet explainer sitting directly above the Start button and a full rules
 * page a click away. That is not a discoverability failure — nobody reads
 * instructions before an activity. It is a just-in-time problem, so the guidance
 * moved to the moment of confusion.
 *
 * Hard constraints, all learned from that:
 *   - NEVER blocking. Discussion is 45s and Voting is 30s in the demo; a modal
 *     that steals five of those seconds actively causes the mistake it was
 *     meant to prevent. Fixed position, pointer-events only on the card.
 *   - Once per phase, per browser. A hint that reappears every round is noise,
 *     and noise gets dismissed reflexively — including the first time.
 *   - Auto-retires. It fades on its own so an idle player isn't left with a
 *     card covering the table.
 *
 * Copy lives here rather than at the call site so /demo and /game teach exactly
 * the same thing; a player who learns Shield timing in the demo meets the same
 * sentence in a real room.
 */

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

const STORAGE_KEY = 'plague_coach_seen_v1'
const HOLD_MS = 11_000

interface Hint {
  title: string
  body: string
  color: string
}

/** Keyed by phase. Phases with no entry show nothing. */
const HINTS: Record<string, Hint> = {
  infection: {
    title: 'Your role is private',
    body: 'If you were infected, only you were told. Everyone sees the same table — that is the whole game.',
    color: '#e63329',
  },
  discussion: {
    title: 'Talk now, vote next',
    body: 'Accuse, defend, bluff. If you are clean and being framed, activate your Shield — it proves innocence and only works during Discussion.',
    color: '#f5c518',
  },
  voting: {
    title: 'You must vote',
    body: 'Pick a player and confirm. Not voting counts as a vote against yourself, so there is no sitting this one out.',
    color: '#6b8e23',
  },
  reveal: {
    title: 'Roles go public',
    body: 'The eliminated player is revealed to everyone. Wrong guesses thin out your own side.',
    color: '#8fa882',
  },
}

function readSeen(): Set<string> {
  // Private browsing and blocked site data both throw here; a coach mark is
  // never worth a crash, so failure just means the hint shows again.
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function markSeen(phase: string): void {
  try {
    const seen = readSeen()
    seen.add(phase)
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]))
  } catch {
    /* nothing to do — the hint simply shows again next time */
  }
}

export interface PhaseCoachProps {
  /** Current phase key. Changing it may fire a hint. */
  readonly phase: string
  /** Master switch — pass false to suppress entirely (e.g. returning players). */
  readonly enabled?: boolean
}

export function PhaseCoach({ phase, enabled = true }: PhaseCoachProps) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    const hint = HINTS[phase]
    if (!hint) return
    if (readSeen().has(phase)) return
    markSeen(phase)
    setShown(phase)
  }, [phase, enabled])

  // Retire on a timer so an idle player never keeps a card over the table.
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setShown(null), HOLD_MS)
    return () => clearTimeout(t)
  }, [shown])

  // A phase change always clears the previous card, even mid-hold.
  useEffect(() => { setShown(s => (s === phase ? s : null)) }, [phase])

  const dismiss = useCallback(() => setShown(null), [])
  const hint = shown ? HINTS[shown] : null

  return (
    <AnimatePresence>
      {hint && (
        <motion.div
          key={shown}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={{ duration: reduced ? 0.15 : 0.32, ease: 'easeOut' }}
          // pointer-events-none on the wrapper, auto on the card: the table
          // underneath stays fully clickable while a hint is up.
          className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3 sm:justify-end sm:px-5 sm:pb-5"
        >
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto w-full max-w-sm rounded-lg border p-3 shadow-lg sm:p-4"
            style={{
              backgroundColor: 'rgba(10,16,10,0.97)',
              borderColor: hint.color,
              boxShadow: '3px 3px 0 rgba(0,0,0,0.5)',
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <p
                className="font-heading text-sm font-bold uppercase tracking-wide sm:text-base"
                style={{ color: hint.color }}
              >
                {hint.title}
              </p>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Dismiss hint"
                className="-mr-1 -mt-1 shrink-0 rounded px-2 py-0.5 font-mono text-xs transition-opacity hover:opacity-70"
                style={{ color: '#7d9a72' }}
              >
                ✕
              </button>
            </div>
            <p className="mt-1.5 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
              {hint.body}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
