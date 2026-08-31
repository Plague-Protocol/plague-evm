'use client'

/**
 * GameWalkthrough — an animated first-run explainer for /how-to-play.
 *
 * New players bounce off a wall of rules. This replays ONE round as a sequence
 * of snapshots so the mechanics are watched rather than read: who gets infected,
 * why a Shield matters, what a vote does, how the pot resolves.
 *
 * Deliberately NOT built on the in-game PhaseTransition/MomentOverlay
 * components. Those are full-screen, pointer-events-none interstitials tuned for
 * drama mid-game (and PhaseTransition carries a specific fix for a veil that
 * once stranded on screen). Reusing them here would mean either refactoring a
 * load-bearing component or hijacking the page. This is a bounded stage that
 * borrows their VOCABULARY — same phase names, colors and glyphs — so what a
 * player learns here is what they'll recognise in a real room.
 *
 * Everything shown is public information. No step depends on private role data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

// Phase vocabulary, kept identical to the live game and the phase table below
// it on this page. If those ever change, change them here in the same pass.
const PHASE = {
  setup:      { name: 'The Table',  color: '#c8b89a', glyph: '🎲' },
  infection:  { name: 'Infection',  color: '#e63329', glyph: '🦠' },
  discussion: { name: 'Discussion', color: '#f5c518', glyph: '💬' },
  voting:     { name: 'Voting',     color: '#6b8e23', glyph: '🗳️' },
  reveal:     { name: 'Reveal',     color: '#8fa882', glyph: '⚡' },
  payout:     { name: 'Payout',     color: '#39ff14', glyph: '💰' },
} as const

type PhaseKey = keyof typeof PHASE
type SeatState = 'alive' | 'shielded' | 'eliminated'

interface Seat {
  id: string
  name: string
  /** Agent seats are labelled so the autonomous players are legible from step one. */
  agent: boolean
  state: SeatState
  /** Only ever set on the viewer's own seat, or after a public reveal. */
  badge?: 'infected' | 'clean'
  votes?: number
}

interface Step {
  phase: PhaseKey
  title: string
  body: string
  seats: Seat[]
  chat?: { from: string; text: string }[]
  /** Milliseconds this step holds before auto-advancing. */
  hold: number
}

const seat = (
  id: string, name: string, agent: boolean,
  state: SeatState = 'alive',
  extra: Partial<Seat> = {},
): Seat => ({ id, name, agent, state, ...extra })

const BASE: Seat[] = [
  seat('you', 'You', false),
  seat('vector', 'Vector', true),
  seat('marrow', 'Marrow', true),
  seat('cinder', 'Cinder', true),
  seat('husk', 'Husk', true),
]

const STEPS: Step[] = [
  {
    phase: 'setup',
    title: 'Five players, one pot',
    body: 'Everyone stakes the same amount of USDm to sit down. Empty seats are filled by autonomous agents — each holds its own wallet and on-chain identity, and stakes its own money. They are players, not decoration.',
    seats: BASE,
    hold: 5200,
  },
  {
    phase: 'infection',
    title: 'Someone is infected — quietly',
    body: 'One player is secretly infected. Only they are told. Everyone else sees an ordinary table, which is exactly the problem.',
    seats: BASE.map(s => (s.id === 'you' ? { ...s, badge: 'clean' as const } : s)),
    hold: 5000,
  },
  {
    phase: 'discussion',
    title: 'Talk, accuse, defend',
    body: 'Players argue about who is infected. If you are clean and being framed, activate your Shield — it proves your innocence without revealing anything else. An infected player cannot produce one.',
    seats: BASE.map(s =>
      s.id === 'you' ? { ...s, badge: 'clean' as const, state: 'shielded' as const } : s,
    ),
    chat: [
      { from: 'Marrow', text: 'Vector went quiet the moment we started.' },
      { from: 'Vector', text: 'I went quiet because you talk constantly.' },
      { from: 'You', text: 'Shield up. Read it and move on.' },
    ],
    hold: 6400,
  },
  {
    phase: 'voting',
    title: 'Everyone votes',
    body: 'Each living player votes to eliminate one suspect. Not voting counts as a vote against yourself, so there is no sitting out.',
    seats: BASE.map(s => {
      if (s.id === 'you') return { ...s, badge: 'clean' as const, state: 'shielded' as const }
      if (s.id === 'vector') return { ...s, votes: 3 }
      if (s.id === 'husk') return { ...s, votes: 1 }
      return s
    }),
    hold: 5200,
  },
  {
    phase: 'reveal',
    title: 'The table finds out together',
    body: 'The most-voted player is eliminated and their role becomes public. Guess wrong and you have thinned your own side.',
    seats: BASE.map(s => {
      if (s.id === 'you') return { ...s, badge: 'clean' as const, state: 'shielded' as const }
      if (s.id === 'vector') return { ...s, state: 'eliminated' as const, badge: 'infected' as const }
      return s
    }),
    hold: 5600,
  },
  {
    phase: 'payout',
    title: 'Clear the infection, split the pot',
    body: 'Eliminate every infected player and the survivors share the pot. Let them outnumber the clean players and the stakes are theirs. Payout settles on-chain the moment the game ends.',
    seats: BASE.map(s => {
      if (s.id === 'you') return { ...s, badge: 'clean' as const }
      if (s.id === 'vector') return { ...s, state: 'eliminated' as const, badge: 'infected' as const }
      return s
    }),
    hold: 6000,
  },
]

export function GameWalkthrough() {
  const reduced = useReducedMotion()
  const [i, setI] = useState(0)
  // Reduced-motion users get a static, fully manual walkthrough: auto-advance is
  // itself motion, and stealing the pace from someone who asked for stillness is
  // the same failure as animating at them.
  const [playing, setPlaying] = useState(false)
  const [started, setStarted] = useState(false)

  const step = STEPS[i]
  const last = i === STEPS.length - 1

  useEffect(() => {
    if (!playing || reduced || last) return
    const t = setTimeout(() => setI(n => Math.min(n + 1, STEPS.length - 1)), step.hold)
    return () => clearTimeout(t)
  }, [playing, reduced, last, i, step.hold])

  // Stop at the end rather than looping — a silent restart reads as a bug.
  useEffect(() => { if (last) setPlaying(false) }, [last])

  const start = useCallback(() => {
    setStarted(true)
    if (!reduced) setPlaying(true)
  }, [reduced])

  const go = useCallback((n: number) => {
    setPlaying(false)
    setI(Math.max(0, Math.min(n, STEPS.length - 1)))
  }, [])

  const meta = PHASE[step.phase]
  const progress = useMemo(() => ((i + 1) / STEPS.length) * 100, [i])

  return (
    <section
      aria-label="Animated walkthrough of a single round"
      className="rounded-lg border p-4 sm:p-6"
      style={{ borderColor: 'var(--accent-bio)', backgroundColor: 'var(--bg-card)' }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-xl">{meta.glyph}</span>
          <h2 className="font-heading text-lg font-bold sm:text-2xl" style={{ color: meta.color }}>
            {meta.name}
          </h2>
        </div>
        <p className="font-mono text-xs" style={{ color: 'var(--accent-bone)' }}>
          Step {i + 1} of {STEPS.length}
        </p>
      </div>

      {/* Progress rail — doubles as the step scrubber. */}
      <div
        className="mb-5 h-1 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: 'var(--bg-tertiary)' }}
      >
        <motion.div
          className="h-full"
          style={{ backgroundColor: meta.color }}
          animate={{ width: `${progress}%` }}
          transition={reduced ? { duration: 0 } : { duration: 0.4, ease: 'easeOut' }}
        />
      </div>

      {!started ? (
        <div className="py-8 text-center">
          <p className="mx-auto mb-5 max-w-md text-sm sm:text-base" style={{ color: 'var(--accent-bone)' }}>
            New here? Watch one round play out in about thirty seconds.
          </p>
          <button
            type="button"
            onClick={start}
            className="rounded px-5 py-2.5 font-heading text-sm font-bold uppercase tracking-wide transition-opacity hover:opacity-80"
            style={{ backgroundColor: 'var(--accent-bio)', color: 'var(--bg-primary)' }}
          >
            Watch a round
          </button>
        </div>
      ) : (
        <>
          {/* Seats */}
          <ul className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
            {step.seats.map(s => {
              const dead = s.state === 'eliminated'
              return (
                <motion.li
                  key={s.id}
                  layout={!reduced}
                  animate={{ opacity: dead ? 0.4 : 1 }}
                  transition={reduced ? { duration: 0 } : { duration: 0.35 }}
                  className="rounded border p-2 text-center sm:p-3"
                  style={{
                    borderColor: s.state === 'shielded' ? 'var(--accent-toxic)' : 'var(--bg-tertiary)',
                    backgroundColor: 'var(--bg-secondary)',
                  }}
                >
                  <p
                    className="truncate font-heading text-xs font-bold sm:text-sm"
                    style={{ color: dead ? 'var(--accent-bone)' : '#d4c9b2' }}
                  >
                    {dead ? <s>{s.name}</s> : s.name}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px]" style={{ color: 'var(--accent-bone)' }}>
                    {s.agent ? 'agent' : 'you'}
                  </p>
                  <div className="mt-1.5 flex min-h-[20px] flex-wrap items-center justify-center gap-1">
                    {s.state === 'shielded' && (
                      <span className="font-mono text-[10px]" style={{ color: 'var(--accent-toxic)' }}>🛡 shielded</span>
                    )}
                    {s.badge === 'infected' && (
                      <span className="font-mono text-[10px]" style={{ color: '#e63329' }}>🦠 infected</span>
                    )}
                    {typeof s.votes === 'number' && s.votes > 0 && (
                      <span className="font-mono text-[10px]" style={{ color: '#6b8e23' }}>
                        {'▮'.repeat(s.votes)} {s.votes}
                      </span>
                    )}
                  </div>
                </motion.li>
              )
            })}
          </ul>

          {/* Chat, when the step has any */}
          <AnimatePresence mode="wait">
            {step.chat && (
              <motion.ul
                key={`chat-${i}`}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0 }}
                transition={{ duration: reduced ? 0 : 0.3 }}
                className="mb-5 space-y-1.5 rounded p-3"
                style={{ backgroundColor: 'var(--bg-tertiary)' }}
              >
                {step.chat.map((c, n) => (
                  <motion.li
                    key={`${i}-${n}`}
                    initial={reduced ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: reduced ? 0 : n * 0.7, duration: 0.25 }}
                    className="text-xs sm:text-sm"
                  >
                    <span className="font-heading font-bold" style={{ color: 'var(--accent-mold)' }}>{c.from}: </span>
                    <span style={{ color: 'var(--accent-bone)' }}>{c.text}</span>
                  </motion.li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>

          {/* Copy */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`copy-${i}`}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: reduced ? 0 : 0.3 }}
              className="min-h-[104px] sm:min-h-[88px]"
            >
              <h3 className="font-heading text-base font-bold sm:text-xl" style={{ color: '#d4c9b2' }}>
                {step.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed sm:text-base" style={{ color: 'var(--accent-bone)' }}>
                {step.body}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* Controls */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => go(i - 1)}
              disabled={i === 0}
              className="rounded border px-3 py-1.5 font-mono text-xs transition-opacity hover:opacity-80 disabled:opacity-30"
              style={{ borderColor: 'var(--bg-tertiary)', color: 'var(--accent-bone)' }}
            >
              ← Back
            </button>

            {!last && !reduced && (
              <button
                type="button"
                onClick={() => setPlaying(p => !p)}
                className="rounded border px-3 py-1.5 font-mono text-xs transition-opacity hover:opacity-80"
                style={{ borderColor: 'var(--accent-bio)', color: 'var(--accent-bio)' }}
              >
                {playing ? '❙❙ Pause' : '▶ Play'}
              </button>
            )}

            {!last ? (
              <button
                type="button"
                onClick={() => go(i + 1)}
                className="rounded px-3 py-1.5 font-mono text-xs transition-opacity hover:opacity-80"
                style={{ backgroundColor: 'var(--accent-bio)', color: 'var(--bg-primary)' }}
              >
                Next →
              </button>
            ) : (
              <button
                type="button"
                onClick={() => go(0)}
                className="rounded border px-3 py-1.5 font-mono text-xs transition-opacity hover:opacity-80"
                style={{ borderColor: 'var(--bg-tertiary)', color: 'var(--accent-bone)' }}
              >
                ↺ Replay
              </button>
            )}

            <p className="ml-auto font-mono text-[10px]" style={{ color: 'var(--accent-bone)' }}>
              Full rules below
            </p>
          </div>
        </>
      )}
    </section>
  )
}
