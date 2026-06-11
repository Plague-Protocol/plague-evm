'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { SiteNav } from '@/components/ui/site-nav'

// ── Demo limits ──────────────────────────────────────────────────────────────

const DEMO_STORAGE_KEY = 'plague_demo_count'
const DEMO_LIMIT = 2

function getDemoCount(): number {
  if (typeof window === 'undefined') return 0
  return parseInt(localStorage.getItem(DEMO_STORAGE_KEY) ?? '0', 10)
}

function incrementDemoCount() {
  if (typeof window === 'undefined') return
  localStorage.setItem(DEMO_STORAGE_KEY, String(getDemoCount() + 1))
}

// ── Players ──────────────────────────────────────────────────────────────────

interface DemoPlayer {
  id: string
  name: string
  isYou: boolean
  trueStatus: 'clean' | 'infected'    // hidden from user
  visibleStatus: 'clean' | 'infected' // only revealed post-vote
  eliminated: boolean
  hasShield: boolean
}

const INITIAL_PLAYERS: DemoPlayer[] = [
  { id: 'guest', name: 'You',    isYou: true,  trueStatus: 'clean',    visibleStatus: 'clean', eliminated: false, hasShield: false },
  { id: 'viper', name: 'Viper',  isYou: false, trueStatus: 'infected', visibleStatus: 'clean', eliminated: false, hasShield: false },
  { id: 'atlas', name: 'Atlas',  isYou: false, trueStatus: 'clean',    visibleStatus: 'clean', eliminated: false, hasShield: false },
  { id: 'echo',  name: 'Echo',   isYou: false, trueStatus: 'clean',    visibleStatus: 'clean', eliminated: false, hasShield: false },
]

// ── State machine ─────────────────────────────────────────────────────────────

type DemoPhase =
  | 'welcome'
  | 'starting'
  | 'infection'
  | 'discussion'
  | 'voting'
  | 'reveal'
  | 'gameover'

interface DemoState {
  phase: DemoPhase
  round: number
  players: DemoPlayer[]
  infectedThisRound: string | null  // player id newly infected
  votedFor: string | null           // player id user voted for
  eliminatedId: string | null       // player eliminated this round
  outcome: 'clean_win' | 'infected_win' | null
  shieldSet: boolean
  shieldActive: boolean
  shieldPassword: string
  feed: string[]
}

const INITIAL_STATE: DemoState = {
  phase: 'welcome',
  round: 0,
  players: INITIAL_PLAYERS,
  infectedThisRound: null,
  votedFor: null,
  eliminatedId: null,
  outcome: null,
  shieldSet: false,
  shieldActive: false,
  shieldPassword: '',
  feed: [],
}

// ── Phase durations (ms) ─────────────────────────────────────────────────────

const INFECTION_DURATION = 6_000
const REVEAL_DURATION    = 5_000

// ── Styling helpers ───────────────────────────────────────────────────────────

function playerCardStyle(p: DemoPlayer, selected: boolean, revealed: boolean): React.CSSProperties {
  if (p.eliminated) return { border: '2px solid #4a5e44', backgroundColor: 'rgba(74,94,68,0.12)', color: '#4a5e44' }
  if (revealed && p.trueStatus === 'infected') return { border: '2px solid #e63329', backgroundColor: 'rgba(230,51,41,0.15)', color: '#ff6b6b' }
  if (selected) return { border: '2px solid #f5c518', backgroundColor: 'rgba(245,197,24,0.1)', color: '#f5c518' }
  if (p.isYou) return { border: '2px solid #6b8e23', backgroundColor: 'rgba(107,142,35,0.12)', color: '#6b8e23' }
  return { border: '2px solid rgba(107,142,35,0.3)', backgroundColor: 'rgba(107,142,35,0.05)', color: '#8fa882' }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DemoPage() {
  const [demoCount, setDemoCount] = useState(0)
  const [state, setState] = useState<DemoState>(INITIAL_STATE)
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setDemoCount(getDemoCount())
  }, [])

  const clearTimers = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
  }, [])

  // Run a countdown display then call cb
  const startCountdown = useCallback((secs: number, cb: () => void) => {
    clearTimers()
    setCountdown(secs)
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearTimers()
          return 0
        }
        return prev - 1
      })
    }, 1_000)
    timerRef.current = setTimeout(() => {
      clearTimers()
      cb()
    }, secs * 1_000)
  }, [clearTimers])

  // ── Phase transitions ──────────────────────────────────────────────────────

  const startDemo = useCallback(() => {
    if (getDemoCount() >= DEMO_LIMIT) return
    incrementDemoCount()
    setDemoCount(getDemoCount())
    setState({ ...INITIAL_STATE, phase: 'starting', round: 1 })
  }, [])

  const commitShield = useCallback((password: string) => {
    if (!password.trim()) return
    setState(prev => ({
      ...prev,
      shieldSet: true,
      shieldPassword: password,
      feed: [...prev.feed, 'Shield Password set. Stay vigilant.'],
    }))
    // Auto-advance to infection after 2s
    timerRef.current = setTimeout(() => {
      setState(prev => ({
        ...prev,
        phase: 'infection',
        infectedThisRound: 'atlas',
        feed: [...prev.feed, 'Patient Zero is spreading the plague…'],
      }))
      startCountdown(Math.floor(INFECTION_DURATION / 1_000), () => {
        setState(prev => ({
          ...prev,
          phase: 'discussion',
          feed: [
            ...prev.feed,
            'Viper has spread the plague to Atlas.',
            'Discussion phase open. Activate your Shield to prove innocence.',
          ],
        }))
      })
    }, 2_000)
  }, [startCountdown])

  const activateShield = useCallback(() => {
    setState(prev => ({
      ...prev,
      shieldActive: true,
      feed: [...prev.feed, 'Your Shield has been activated. You are proven innocent.'],
    }))
  }, [])

  const skipToVoting = useCallback(() => {
    clearTimers()
    setState(prev => ({
      ...prev,
      phase: 'voting',
      feed: [...prev.feed, 'Voting phase open. Select the suspected carrier.'],
    }))
  }, [clearTimers])

  const castVote = useCallback((targetId: string) => {
    const targetName = INITIAL_PLAYERS.find(p => p.id === targetId)?.name ?? targetId
    setState(prev => ({
      ...prev,
      votedFor: targetId,
      feed: [...prev.feed, `You voted against ${targetName}.`],
    }))
    // Bot votes: atlas votes viper, echo votes viper → viper gets 3 votes if user votes viper
    // If user votes atlas or echo → that player gets 1 vote, viper gets 2 → viper still eliminated
    // Simple rule: whoever gets the most votes gets eliminated
    // User vote + 2 bot votes for viper → viper always eliminated unless user votes viper making it 3
    // For compelling UX: always eliminate the player with most votes
    // Bot votes always go to viper → if user also votes viper: viper eliminated (3 votes)
    //                                 if user votes atlas: atlas 1, viper 2 → viper eliminated
    //                                 if user votes echo:  echo 1, viper 2 → viper eliminated
    // Actually to make the WRONG vote feel meaningful, let's say bots split:
    // atlas votes viper, echo votes atlas → viper:1, atlas:1, then user vote tips it
    // if user votes viper: viper:2 → viper eliminated → clean win
    // if user votes atlas: atlas:2 → atlas eliminated (clean) → infected win
    // if user votes echo:  echo:1, viper:1, atlas:1 → tie → viper eliminated (first by id)
    const botVotes: Record<string, string> = { atlas: 'viper', echo: 'atlas' }
    const tally: Record<string, number> = { viper: 0, atlas: 0, echo: 0 }
    tally[targetId] = (tally[targetId] ?? 0) + 1
    for (const vote of Object.values(botVotes)) {
      tally[vote] = (tally[vote] ?? 0) + 1
    }
    // Find max votes
    const sorted = Object.entries(tally).sort(([, a], [, b]) => b - a)
    const eliminatedId = sorted[0][0]
    const eliminatedPlayer = INITIAL_PLAYERS.find(p => p.id === eliminatedId)!
    const outcome: 'clean_win' | 'infected_win' =
      eliminatedPlayer.trueStatus === 'infected' ? 'clean_win' : 'infected_win'

    timerRef.current = setTimeout(() => {
      setState(prev => ({
        ...prev,
        phase: 'reveal',
        eliminatedId,
        outcome,
        players: prev.players.map(p =>
          p.id === eliminatedId ? { ...p, eliminated: true, visibleStatus: p.trueStatus } : p
        ),
        feed: [
          ...prev.feed,
          `${eliminatedPlayer.name} has been eliminated.`,
          eliminatedPlayer.trueStatus === 'infected'
            ? `${eliminatedPlayer.name} was INFECTED — you found the carrier!`
            : `${eliminatedPlayer.name} was CLEAN — wrong call.`,
        ],
      }))
      startCountdown(REVEAL_DURATION / 1_000, () => {
        setState(prev => ({ ...prev, phase: 'gameover' }))
      })
    }, 400)
  }, [startCountdown])

  useEffect(() => () => clearTimers(), [clearTimers])

  // ── Render ─────────────────────────────────────────────────────────────────

  const { phase, round, players, votedFor, eliminatedId, outcome, shieldSet, shieldActive, shieldPassword, feed } = state

  const alivePlayers = players.filter(p => !p.eliminated)
  const isRevealing  = phase === 'reveal'
  const canVote      = phase === 'voting' && !votedFor

  // ── Welcome / limit screen ─────────────────────────────────────────────────

  if (demoCount >= DEMO_LIMIT && phase === 'welcome') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 gap-8" style={{ backgroundColor: '#060b06', color: '#d4c9b2', backgroundImage: 'url(/images/bg-lobby.webp)', backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }}>
        <div className="fixed inset-0" style={{ backgroundColor: 'rgba(6,11,6,0.9)' }} />
        <div className="relative flex flex-col items-center gap-6 text-center max-w-md">
          <span className="font-mono text-xs uppercase tracking-[0.3em]" style={{ color: '#e63329' }}>Demo Limit Reached</span>
          <h1 className="font-display text-4xl sm:text-6xl leading-none" style={{ color: '#d4c9b2' }}>ENOUGH PRACTICE</h1>
          <p className="font-mono text-sm leading-relaxed" style={{ color: '#8fa882' }}>
            You&apos;ve used your {DEMO_LIMIT} free demos. Sign in to play for real — stake USDm, use ZK proofs, and compete against other players.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <Link
              href="/lobby"
              className="flex-1 rounded-lg py-3 text-center font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90"
              style={{ backgroundColor: '#cc1414', color: '#d4c9b2', boxShadow: '4px 4px 0 #6b8e23' }}
            >
              Sign In & Play →
            </Link>
            <Link
              href="/"
              className="flex-1 rounded-lg border py-3 text-center font-mono text-sm uppercase tracking-wider transition-all hover:opacity-80"
              style={{ borderColor: 'rgba(107,142,35,0.4)', color: '#6b8e23' }}
            >
              Back to Home
            </Link>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>
            Demo limit is per device · stored in browser
          </p>
        </div>
      </main>
    )
  }

  if (phase === 'welcome') {
    const remaining = DEMO_LIMIT - demoCount
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 gap-8" style={{ backgroundColor: '#060b06', color: '#d4c9b2', backgroundImage: 'url(/images/bg-lobby.webp)', backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }}>
        <div className="fixed inset-0" style={{ backgroundColor: 'rgba(6,11,6,0.88)' }} />
        <div className="relative z-10 flex flex-col items-center gap-8 text-center max-w-lg">
          <div className="flex flex-col items-center gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.3em]" style={{ color: '#6b8e23' }}>Free Demo</span>
            <h1
              className="font-display text-5xl sm:text-7xl leading-none font-bold"
              style={{ background: 'linear-gradient(135deg, #cc1414, #c8b89a)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
            >
              TRY THE PLAGUE
            </h1>
            <p className="font-mono text-sm leading-relaxed max-w-sm" style={{ color: '#8fa882' }}>
              4 players. 1 Patient Zero. ZK-powered innocence proofs. This demo shows you everything before you stake a single USDm.
            </p>
          </div>

          <div className="w-full rounded-lg border p-5 space-y-3" style={{ backgroundColor: '#0a100a', borderColor: 'rgba(107,142,35,0.25)' }}>
            <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>What you&apos;ll experience</p>
            {[
              'Set your Shield Password (ZK commitment)',
              'Watch infection spread in real time',
              'Activate your Shield to prove innocence',
              'Vote to eliminate the suspected carrier',
            ].map(step => (
              <div key={step} className="flex items-start gap-2">
                <span style={{ color: '#6b8e23' }}>→</span>
                <span className="font-mono text-xs" style={{ color: '#8fa882' }}>{step}</span>
              </div>
            ))}
          </div>

          <button
            onClick={startDemo}
            className="w-full rounded-lg py-4 font-mono text-sm font-bold uppercase tracking-widest transition-all hover:opacity-90 active:scale-95"
            style={{ backgroundColor: '#cc1414', color: '#d4c9b2', boxShadow: '4px 4px 0 #6b8e23' }}
          >
            Start Demo →
          </button>

          <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>
            {remaining} free demo{remaining === 1 ? '' : 's'} remaining · no sign-in needed
          </p>

          <Link href="/lobby" className="font-mono text-xs underline transition-opacity hover:opacity-70" style={{ color: '#6b8e23' }}>
            Skip demo — sign in and play →
          </Link>
        </div>
      </main>
    )
  }

  // ── Active game UI ─────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen" style={{ backgroundColor: '#060b06', color: '#d4c9b2', backgroundImage: 'url(/images/bg-game.webp)', backgroundSize: 'cover', backgroundPosition: 'center top', backgroundAttachment: 'fixed' }}>
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundColor: 'rgba(6,11,6,0.88)', zIndex: 0 }} />
      <div className="relative" style={{ zIndex: 1 }}>

        {/* Nav */}
        <div className="sticky top-0 z-50 px-4 pt-4 sm:px-8 sm:pt-6">
          <div className="mx-auto w-full max-w-6xl">
            <SiteNav currentPath="/demo" />
          </div>
        </div>

        {/* Demo banner */}
        <div className="px-6 pt-4">
          <div className="mx-auto w-full max-w-6xl">
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2"
              style={{ backgroundColor: 'rgba(245,197,24,0.06)', borderColor: 'rgba(245,197,24,0.3)' }}
            >
              <span className="font-mono text-xs" style={{ color: '#f5c518' }}>
                ⚠ Demo mode · no real tokens
              </span>
              <Link
                href="/lobby"
                className="flex-shrink-0 whitespace-nowrap font-mono text-[10px] uppercase tracking-wider rounded border px-2 py-1 transition-all hover:opacity-80"
                style={{ borderColor: 'rgba(107,142,35,0.4)', color: '#6b8e23' }}
              >
                Play for Real →
              </Link>
            </div>
          </div>
        </div>

        {/* Header */}
        <header className="px-6 py-8" style={{ borderBottom: '1px solid rgba(107,142,35,0.2)' }}>
          <div className="mx-auto w-full max-w-6xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: '#4a5e44' }}>Demo Room</p>
                <p className="font-display text-2xl leading-none" style={{ color: '#e63329' }}>The Cursed Village</p>
              </div>
              {phase !== 'gameover' && (
                <span
                  className="rounded border px-3 py-1 font-mono text-xs uppercase tracking-[0.2em]"
                  style={{
                    borderColor: 'rgba(107,142,35,0.4)',
                    backgroundColor: 'rgba(107,142,35,0.08)',
                    color: '#6b8e23',
                  }}
                >
                  {phase === 'starting'   ? 'STARTING'
                  : phase === 'infection' ? 'INFECTION'
                  : phase === 'discussion'? 'DISCUSS'
                  : phase === 'voting'    ? 'VOTING'
                  : phase === 'reveal'    ? 'ELIMINATION'
                  : ''}
                </span>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-4">
              <div className="text-center">
                <p className="font-mono text-[10px] uppercase" style={{ color: '#4a5e44' }}>Round</p>
                <p className="font-display text-3xl leading-none" style={{ color: '#d4c9b2' }}>{round}</p>
              </div>
              <div className="text-center">
                <p className="font-mono text-[10px] uppercase" style={{ color: '#4a5e44' }}>Players</p>
                <p className="font-display text-3xl leading-none" style={{ color: '#d4c9b2' }}>{alivePlayers.length}/4</p>
              </div>
              <div className="text-center">
                <p className="font-mono text-[10px] uppercase" style={{ color: '#4a5e44' }}>Pot</p>
                <p className="font-display text-3xl leading-none" style={{ color: '#f5c518' }}>4 USDm</p>
              </div>
              {countdown > 0 && (
                <div className="text-center">
                  <p className="font-mono text-[10px] uppercase" style={{ color: '#4a5e44' }}>Auto-advance</p>
                  <p className="font-mono text-3xl tabular-nums leading-none" style={{ color: '#6b8e23' }}>{String(Math.floor(countdown / 60)).padStart(2, '0')}:{String(countdown % 60).padStart(2, '0')}</p>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main */}
        <div className="px-6 py-8">
          <div className="mx-auto w-full max-w-6xl">
            <div className="grid gap-6 lg:grid-cols-[1fr_300px]">

              {/* Left column */}
              <div className="flex flex-col gap-6">

                {/* Player grid */}
                <article className="rounded-lg border p-5" style={{ backgroundColor: '#0a100a', borderColor: 'rgba(107,142,35,0.2)' }}>
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <h2 className="font-display text-xl leading-none" style={{ color: '#d4c9b2' }}>Area 51</h2>
                    <span className="font-mono text-xs rounded border px-2 py-0.5" style={{ borderColor: 'rgba(107,142,35,0.3)', color: '#6b8e23' }}>{alivePlayers.length} alive</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {players.map(p => {
                      const selected = phase === 'voting' && votedFor === p.id
                      const revealed = isRevealing && p.id === eliminatedId
                      return (
                        <button
                          key={p.id}
                          onClick={() => canVote && !p.isYou && !p.eliminated && castVote(p.id)}
                          disabled={!canVote || p.isYou || p.eliminated}
                          className="relative rounded-lg px-2 py-4 font-mono text-sm font-bold uppercase tracking-widest transition-all hover:opacity-80 disabled:cursor-default"
                          style={playerCardStyle(p, selected, revealed)}
                        >
                          {p.name}
                          {p.isYou && <span className="block font-mono text-[9px] font-normal lowercase tracking-wider mt-1" style={{ color: 'inherit', opacity: 0.7 }}>(you)</span>}
                          {p.eliminated && <span className="block font-mono text-[9px] font-normal lowercase tracking-wider mt-1">eliminated</span>}
                          {p.hasShield && !p.eliminated && <span className="block font-mono text-[9px] font-normal mt-1" style={{ color: '#84cc16' }}>⊕ shielded</span>}
                          {revealed && p.trueStatus === 'infected' && <span className="block font-mono text-[9px] font-normal mt-1" style={{ color: '#ff6b6b' }}>was infected!</span>}
                          {revealed && p.trueStatus === 'clean' && <span className="block font-mono text-[9px] font-normal mt-1" style={{ color: '#8fa882' }}>was clean</span>}
                        </button>
                      )
                    })}
                  </div>
                  {canVote && (
                    <p className="mt-3 font-mono text-xs text-center" style={{ color: '#8fa882' }}>Click a player to vote against them</p>
                  )}
                </article>

                {/* Phase action panel */}
                {phase === 'starting' && (
                  <StartingPanel
                    shieldSet={shieldSet}
                    shieldPassword={shieldPassword}
                    onCommit={commitShield}
                  />
                )}

                {phase === 'infection' && (
                  <div className="rounded-lg border p-5" style={{ borderColor: 'rgba(230,51,41,0.4)', backgroundColor: 'rgba(230,51,41,0.08)' }}>
                    <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#e63329' }}>Infection Phase</p>
                    <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#8fa882' }}>
                      Patient Zero is silently spreading the plague. A new carrier is being selected…
                    </p>
                    {countdown > 0 && (
                      <p className="mt-2 font-mono text-xs" style={{ color: '#4a5e44' }}>Auto-advancing in {countdown}s…</p>
                    )}
                  </div>
                )}

                {phase === 'discussion' && (
                  <DiscussionPanel shieldActive={shieldActive} onActivate={activateShield} onSkip={skipToVoting} />
                )}

                {phase === 'voting' && !votedFor && (
                  <div className="rounded-lg border p-5" style={{ borderColor: 'rgba(245,197,24,0.4)', backgroundColor: 'rgba(245,197,24,0.06)' }}>
                    <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#f5c518' }}>Voting Phase</p>
                    <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#8fa882' }}>
                      Tap a player in the grid above to vote against them. The player with the most votes will be eliminated.
                    </p>
                    <p className="mt-2 font-mono text-xs" style={{ color: '#4a5e44' }}>
                      Hint: Atlas activated a Shield. Echo hasn&apos;t spoken. Who&apos;s suspicious?
                    </p>
                  </div>
                )}

                {phase === 'voting' && votedFor && (
                  <div className="rounded-lg border p-5" style={{ borderColor: 'rgba(107,142,35,0.35)', backgroundColor: 'rgba(107,142,35,0.08)' }}>
                    <p className="font-mono text-xs" style={{ color: '#6b8e23' }}>
                      ✓ Vote cast against <strong style={{ color: '#d4c9b2' }}>{players.find(p => p.id === votedFor)?.name}</strong>. Tallying votes…
                    </p>
                  </div>
                )}

                {phase === 'reveal' && (
                  <RevealPanel
                    eliminatedId={eliminatedId}
                    players={players}
                    outcome={outcome}
                  />
                )}

                {phase === 'gameover' && (
                  <GameOverPanel outcome={outcome} />
                )}
              </div>

              {/* Right: feed */}
              <aside className="flex flex-col gap-6">
                <div className="rounded-lg border p-5" style={{ backgroundColor: '#0a100a', borderColor: 'rgba(107,142,35,0.15)' }}>
                  <p className="font-mono text-xs uppercase tracking-[0.2em] mb-3" style={{ color: '#6b8e23' }}>Live Feed</p>
                  <ul className="space-y-2 font-mono text-xs overflow-y-auto" style={{ color: '#8fa882', maxHeight: '20rem', scrollbarWidth: 'thin' }}>
                    {feed.length === 0 ? (
                      <li style={{ color: '#4a5e44' }}>No events yet.</li>
                    ) : (
                      feed.map((msg, i) => (
                        <li key={i} className="flex gap-2">
                          <span style={{ color: '#4a5e44' }}>→</span> {msg}
                        </li>
                      ))
                    )}
                  </ul>
                </div>

                <div
                  className="rounded-lg border p-5"
                  style={{ backgroundColor: 'rgba(107,142,35,0.04)', borderColor: 'rgba(107,142,35,0.2)' }}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] mb-2" style={{ color: '#4a5e44' }}>Your Role</p>
                  <p className="font-mono text-sm" style={{ color: '#6b8e23' }}>Clean</p>
                  <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
                    Survive, identify Patient Zero, vote them out before infected reach parity.
                  </p>
                </div>

                <Link
                  href="/how-to-play"
                  className="rounded-lg border py-3 text-center font-mono text-xs uppercase tracking-widest transition-all hover:opacity-80"
                  style={{ borderColor: 'rgba(107,142,35,0.3)', color: '#6b8e23', display: 'block' }}
                >
                  How to Play →
                </Link>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

// ── Sub-panels ────────────────────────────────────────────────────────────────

function StartingPanel({
  shieldSet,
  shieldPassword,
  onCommit,
}: {
  shieldSet: boolean
  shieldPassword: string
  onCommit: (pw: string) => void
}) {
  const [input, setInput] = useState(shieldPassword)

  if (shieldSet) {
    return (
      <div className="rounded-lg border p-5" style={{ borderColor: 'rgba(107,142,35,0.35)', backgroundColor: 'rgba(107,142,35,0.08)' }}>
        <p className="font-mono text-xs" style={{ color: '#6b8e23' }}>✓ Shield Password set. The game is starting…</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border p-5" style={{ borderColor: 'rgba(107,142,35,0.35)', backgroundColor: 'rgba(107,142,35,0.08)' }}>
      <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#6b8e23' }}>Set Shield Password</p>
      <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
        Choose a secret password. You&apos;ll use it later to generate a ZK proof of innocence — the contract verifies it without ever seeing your password.
      </p>
      <input
        type="password"
        placeholder="My Shield Password…"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && input.trim() && onCommit(input)}
        className="mt-3 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm focus:outline-none"
        style={{ borderColor: 'rgba(107,142,35,0.4)', color: '#d4c9b2' }}
        autoFocus
      />
      <button
        onClick={() => input.trim() && onCommit(input)}
        disabled={!input.trim()}
        className="mt-3 w-full rounded border py-2 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-40"
        style={{ backgroundColor: '#6b8e23', borderColor: '#6b8e23', color: '#060b06' }}
      >
        Set Shield Password
      </button>
    </div>
  )
}

function DiscussionPanel({
  shieldActive,
  onActivate,
  onSkip,
}: {
  shieldActive: boolean
  onActivate: () => void
  onSkip: () => void
}) {
  return (
    <div className="rounded-lg border p-5" style={{ borderColor: 'rgba(107,142,35,0.35)', backgroundColor: 'rgba(107,142,35,0.08)' }}>
      <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#6b8e23' }}>Discussion Phase</p>
      <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
        Infection has spread. Activate your Shield now to prove innocence before voting opens. Infected players <em>cannot</em> activate a Shield.
      </p>
      {shieldActive ? (
        <div className="mt-3 space-y-3">
          <p className="font-mono text-xs" style={{ color: '#84cc16' }}>✓ Shield activated — you are proven innocent on-chain.</p>
          <button
            onClick={onSkip}
            className="w-full rounded border py-2 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90"
            style={{ borderColor: '#f5c518', color: '#f5c518', backgroundColor: 'rgba(245,197,24,0.08)' }}
          >
            Proceed to Voting →
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col sm:flex-row gap-3">
          <button
            onClick={onActivate}
            className="flex-1 rounded border py-2 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90"
            style={{ backgroundColor: '#6b8e23', borderColor: '#6b8e23', color: '#060b06' }}
          >
            Activate Shield
          </button>
          <button
            onClick={onSkip}
            className="flex-1 rounded border py-2 font-mono text-sm uppercase tracking-wider transition-all hover:opacity-80"
            style={{ borderColor: 'rgba(245,197,24,0.5)', color: '#f5c518', backgroundColor: 'transparent' }}
          >
            Skip → Voting
          </button>
        </div>
      )}
    </div>
  )
}

function RevealPanel({
  eliminatedId,
  players,
  outcome,
}: {
  eliminatedId: string | null
  players: DemoPlayer[]
  outcome: 'clean_win' | 'infected_win' | null
}) {
  const eliminated = players.find(p => p.id === eliminatedId)
  if (!eliminated) return null
  const correct = eliminated.trueStatus === 'infected'

  return (
    <div
      className="rounded-lg border p-5"
      style={{
        borderColor: correct ? 'rgba(132,204,22,0.4)' : 'rgba(230,51,41,0.4)',
        backgroundColor: correct ? 'rgba(132,204,22,0.06)' : 'rgba(230,51,41,0.08)',
      }}
    >
      <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: correct ? '#84cc16' : '#e63329' }}>
        {correct ? 'Correct Elimination' : 'Wrong Elimination'}
      </p>
      <p className="mt-3 font-display text-2xl leading-none" style={{ color: '#d4c9b2' }}>
        {eliminated.name} eliminated
      </p>
      <p className="mt-2 font-mono text-sm" style={{ color: correct ? '#84cc16' : '#e63329' }}>
        {correct
          ? `${eliminated.name} was Patient Zero — the carrier has been found!`
          : `${eliminated.name} was CLEAN. The infected are still among you.`}
      </p>
      {outcome === 'infected_win' && (
        <p className="mt-2 font-mono text-xs" style={{ color: '#8fa882' }}>
          The infected now outnumber the living. The village falls.
        </p>
      )}
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#4a5e44' }}>
        Proceeding to results…
      </p>
    </div>
  )
}

function GameOverPanel({ outcome }: { outcome: 'clean_win' | 'infected_win' | null }) {
  const won = outcome === 'clean_win'
  return (
    <div className="space-y-6">
      <div
        className="rounded-lg border p-6"
        style={{
          borderColor: won ? 'rgba(132,204,22,0.4)' : 'rgba(230,51,41,0.4)',
          backgroundColor: won ? 'rgba(132,204,22,0.06)' : 'rgba(230,51,41,0.06)',
        }}
      >
        <p className="font-display text-4xl leading-none" style={{ color: won ? '#84cc16' : '#e63329' }}>
          {won ? 'CLEAN WIN' : 'INFECTED WIN'}
        </p>
        <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#8fa882' }}>
          {won
            ? 'The village survived. You identified the carrier using ZK proofs and community votes. In a real game you would have shared 4 USDm between the clean survivors.'
            : 'The plague spreads unchecked. A wrong vote costs lives — and USDm. In a real game you would have lost your stake.'}
        </p>
        <p className="mt-3 font-mono text-xs" style={{ color: '#4a5e44' }}>
          In real games: ZK proofs are verified on-chain. Stakes are locked in the contract. Winners claim the pot.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          href="/lobby"
          className="flex-1 rounded-lg py-4 text-center font-mono text-sm font-bold uppercase tracking-widest transition-all hover:opacity-90 active:scale-95"
          style={{ backgroundColor: '#cc1414', color: '#d4c9b2', boxShadow: '4px 4px 0 #6b8e23' }}
        >
          Play for Real →
        </Link>
        <Link
          href="/how-to-play"
          className="flex-1 rounded-lg border py-4 text-center font-mono text-sm uppercase tracking-wider transition-all hover:opacity-80"
          style={{ borderColor: 'rgba(107,142,35,0.4)', color: '#6b8e23' }}
        >
          How It Works →
        </Link>
      </div>
    </div>
  )
}
