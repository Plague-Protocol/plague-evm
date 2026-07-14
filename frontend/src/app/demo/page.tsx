'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { SiteNav } from '@/components/ui/site-nav'
import { AmbientLayer } from '@/components/game/AmbientLayer'
import { PhaseTransition } from '@/components/game/PhaseTransition'
import { MomentOverlay, type Moment } from '@/components/game/MomentOverlay'
import { PlayerCard } from '@/components/game/PlayersGrid'
import { GameOverOverlay, type GameOutcome } from '@/components/game/GameOverOverlay'

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

// ── Game constants (mirrors real-game pacing, compressed) ───────────────────

const INFECTION_SECS  = 6
const DISCUSSION_SECS = 45
const VOTING_SECS     = 30
const REVEAL_SECS     = 7
const MAX_ROUNDS      = 5
const STAKE_PER_PLAYER = 1           // USDm
const PLATFORM_FEE     = 0.015       // 1.5%, same as PlagueGame.sol

// ── Players ──────────────────────────────────────────────────────────────────

type Role = 'clean' | 'infected'

interface DemoPlayer {
  id: string
  name: string
  isYou: boolean
  status: Role                      // hidden true status
  isPatientZero: boolean
  eliminated: boolean
  shieldRound: number               // round in which Shield was activated (0 = never)
  revealedStatus: Role | null      // made public on elimination
}

const YOU_ID = 'guest'

function freshPlayers(): DemoPlayer[] {
  const base = (id: string, name: string, isYou = false): DemoPlayer => ({
    id, name, isYou, status: 'clean', isPatientZero: false, eliminated: false, shieldRound: 0, revealedStatus: null,
  })
  return [
    base(YOU_ID, 'You', true),
    base('viper', 'Viper'),
    base('atlas', 'Atlas'),
    base('echo',  'Echo'),
    base('moss',  'Moss'),
    base('rook',  'Rook'),
  ]
}

const TOTAL_PLAYERS = 6
const POT_TOTAL = TOTAL_PLAYERS * STAKE_PER_PLAYER

// ── State machine ─────────────────────────────────────────────────────────────

type DemoPhase =
  | 'welcome'
  | 'starting'
  | 'infection'
  | 'discussion'
  | 'voting'
  | 'reveal'
  | 'gameover'

interface ChatMsg {
  senderId: string
  name: string
  text: string
}

interface DemoState {
  phase: DemoPhase
  round: number
  players: DemoPlayer[]
  votes: Record<string, string>     // voterId → targetId (this round)
  eliminatedIds: string[]           // eliminated this round (for reveal panel)
  noElimination: boolean            // reveal resolved with everyone saved
  outcome: GameOutcome | null
  maxRoundsHit: boolean
  winners: string[]                 // display names
  potPerWinner: number
  shieldSet: boolean
  pzNextTarget: string | null       // Patient Zero's vote = next infection target
  infectionChain: string[]
  feed: string[]
  chat: ChatMsg[]
}

const INITIAL_STATE: DemoState = {
  phase: 'welcome',
  round: 0,
  players: freshPlayers(),
  votes: {},
  eliminatedIds: [],
  noElimination: false,
  outcome: null,
  maxRoundsHit: false,
  winners: [],
  potPerWinner: 0,
  shieldSet: false,
  pzNextTarget: null,
  infectionChain: [],
  feed: [],
  chat: [],
}

// ── Phase display (mirrors the real game page) ───────────────────────────────

const DEMO_PHASE_LABEL: Record<DemoPhase, string> = {
  welcome:    '',
  starting:   'STARTING',
  infection:  'INFECTION',
  discussion: 'DISCUSS',
  voting:     'VOTING',
  reveal:     'ELIMINATION',
  gameover:   '',
}

const DEMO_PHASE_COLOR: Record<DemoPhase, string> = {
  welcome:    '#6b8e23',
  starting:   '#6b8e23',
  infection:  '#e63329',
  discussion: '#6b8e23',
  voting:     '#f5c518',
  reveal:     '#d4c9b2',
  gameover:   '#4a5e44',
}

// ── Random helpers ────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function chance(p: number): boolean {
  return Math.random() < p
}

// ── Bot chatter ───────────────────────────────────────────────────────────────

const STARTING_LINES = [
  'gm survivors 🧟',
  'passwords locked. trust no one.',
  'someone in here is about to get very unlucky',
  'i have a good feeling about this village',
  'remember — no vote means you vote yourself',
]

const ACCUSE_LINES = [
  (t: string) => `${t} has been way too quiet…`,
  (t: string) => `i don't trust ${t}. no shield, no alibi.`,
  (t: string) => `watch ${t}. something is off there.`,
  (t: string) => `${t} is acting exactly like a carrier acts`,
  (t: string) => `my vote is leaning ${t} unless they shield`,
]

const DEFEND_LINES = [
  "i'm clean — i'll shield if you all come for me",
  'wasting a shield early is how clean players lose',
  'check the feed. the shields tell you who to trust.',
  'not me. look at who has NOT shielded.',
  'we vote wrong and the plague wins, just saying',
]

const SHIELDED_LINES = [
  'shield up — provably clean. focus on the rest.',
  'proof is on-chain. i am NOT the carrier.',
]

const REPLY_LINES = [
  'hmm 👀',
  'noted… but that is exactly what a carrier would say',
  'agreed.',
  'prove it — shield up.',
  'the loud ones are always sus',
  'ok but who are we actually voting?',
]

// ── Styling helpers ───────────────────────────────────────────────────────────

function playerCardStyle(p: DemoPlayer, selected: boolean): { border: string; backgroundColor: string; color: string } {
  if (p.eliminated && p.revealedStatus === 'infected') return { border: '2px solid #e63329', backgroundColor: 'rgba(230,51,41,0.12)', color: '#8a4a44' }
  if (p.eliminated) return { border: '2px solid #4a5e44', backgroundColor: 'rgba(74,94,68,0.12)', color: '#4a5e44' }
  if (selected) return { border: '2px solid #f5c518', backgroundColor: 'rgba(245,197,24,0.1)', color: '#f5c518' }
  if (p.isYou) return { border: '2px solid #6b8e23', backgroundColor: 'rgba(107,142,35,0.12)', color: '#6b8e23' }
  return { border: '2px solid rgba(107,142,35,0.3)', backgroundColor: 'rgba(107,142,35,0.05)', color: '#8fa882' }
}

function getChatBlockedReason(state: DemoState): string | null {
  const you = state.players.find(p => p.isYou)
  if (state.phase === 'gameover') return 'Chat is closed because this game has ended.'
  if (you?.eliminated) return 'Eliminated players cannot use chat.'
  if (state.phase === 'voting') return 'Chat is disabled during voting.'
  return null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DemoPage() {
  const [demoCount, setDemoCount] = useState(0)
  const [state, setState] = useState<DemoState>(INITIAL_STATE)
  const [countdown, setCountdown] = useState(0)
  const [selectedVote, setSelectedVote] = useState<string | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [gameOverSeen, setGameOverSeen] = useState(false)

  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state })

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDemoCount(getDemoCount())
  }, [])

  // Auto-scroll chat on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.chat])

  // ── Timer plumbing ─────────────────────────────────────────────────────────

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
    setCountdown(0)
  }, [])

  const schedule = useCallback((ms: number, fn: () => void) => {
    timersRef.current.push(setTimeout(fn, ms))
  }, [])

  const startCountdown = useCallback((secs: number, onEnd: () => void) => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    setCountdown(secs)
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
          return 0
        }
        return prev - 1
      })
    }, 1_000)
    schedule(secs * 1_000, onEnd)
  }, [schedule])

  useEffect(() => () => clearTimers(), [clearTimers])

  // ── Feed / chat helpers ────────────────────────────────────────────────────

  const pushFeed = useCallback((...msgs: string[]) => {
    setState(prev => ({ ...prev, feed: [...prev.feed, ...msgs].slice(-60) }))
  }, [])

  const botSay = useCallback((botId: string, text: string) => {
    setState(prev => {
      const bot = prev.players.find(p => p.id === botId)
      if (!bot || bot.eliminated) return prev
      if (prev.phase === 'voting' || prev.phase === 'gameover' || prev.phase === 'welcome') return prev
      return { ...prev, chat: [...prev.chat, { senderId: botId, name: bot.name, text }].slice(-200) }
    })
  }, [])

  /** Schedule scattered bot chatter across a phase window. */
  const scheduleBotChatter = useCallback((kind: 'starting' | 'discussion', windowSecs: number) => {
    const count = kind === 'starting' ? 3 : 4 + Math.floor(Math.random() * 3)
    for (let i = 0; i < count; i++) {
      const at = 1_500 + Math.random() * (windowSecs * 1_000 * 0.8)
      schedule(at, () => {
        const s = stateRef.current
        if (kind === 'starting' && s.phase !== 'starting') return
        const aliveBots = s.players.filter(p => !p.isYou && !p.eliminated)
        if (aliveBots.length === 0) return
        const bot = pick(aliveBots)
        let line: string
        if (kind === 'starting') {
          line = pick(STARTING_LINES)
        } else if (bot.shieldRound === s.round && chance(0.5)) {
          line = pick(SHIELDED_LINES)
        } else if (chance(0.5)) {
          // Accuse a random other alive player. Infected bots never accuse teammates.
          const targets = s.players.filter(p =>
            p.id !== bot.id && !p.eliminated &&
            (bot.status !== 'infected' || p.status === 'clean')
          )
          if (targets.length === 0) return
          line = pick(ACCUSE_LINES)(pick(targets).name)
        } else {
          line = pick(DEFEND_LINES)
        }
        botSay(bot.id, line)
      })
    }
  }, [schedule, botSay])

  // ── Phase engine ───────────────────────────────────────────────────────────
  // Forward declarations via refs so callbacks can chain in any order.
  const startRoundRef = useRef<(n: number) => void>(() => {})
  const goVotingRef = useRef<() => void>(() => {})
  const resolveVotesRef = useRef<() => void>(() => {})
  const checkEndRef = useRef<() => void>(() => {})

  const finishGame = useCallback((outcome: GameOutcome, maxRoundsHit = false) => {
    clearTimers()
    setState(prev => {
      const alive = prev.players.filter(p => !p.eliminated)
      let winners: DemoPlayer[] = []
      if (outcome === 'clean_win') winners = alive.filter(p => p.status === 'clean')
      if (outcome === 'infected_win') winners = alive.filter(p => p.status === 'infected')
      const potNet = POT_TOTAL * (1 - PLATFORM_FEE)
      const per = winners.length > 0 ? potNet / winners.length : 0
      const feed = [...prev.feed]
      if (maxRoundsHit) feed.push(`Round limit reached (${MAX_ROUNDS}) — counts as an infected win.`)
      feed.push(`Game over: ${outcome.replaceAll('_', ' ')}. Pot ${POT_TOTAL} USDm − ${PLATFORM_FEE * 100}% fee → ${per > 0 ? `${per.toFixed(2)} USDm per winner.` : 'no faction payout.'}`)
      // Reveal everyone at game end, like the real post-game state.
      const players = prev.players.map(p => ({ ...p, revealedStatus: p.status }))
      return {
        ...prev,
        phase: 'gameover',
        players,
        outcome,
        maxRoundsHit,
        winners: winners.map(w => w.name),
        potPerWinner: per,
        feed: feed.slice(-60),
      }
    })
  }, [clearTimers])

  const checkEnd = useCallback(() => {
    const s = stateRef.current
    const alive = s.players.filter(p => !p.eliminated)
    const infected = alive.filter(p => p.status === 'infected').length
    const clean = alive.length - infected
    if (infected === 0) { finishGame('clean_win'); return }
    if (infected === 1 && clean === 1) { finishGame('draw'); return }
    if (infected > clean) { finishGame('infected_win'); return }
    if (s.round >= MAX_ROUNDS) { finishGame('infected_win', true); return }
    startRoundRef.current(s.round + 1)
  }, [finishGame])

  const resolveVotes = useCallback(() => {
    const s0 = stateRef.current
    if (s0.phase !== 'voting') return
    clearTimers()
    setState(prev => {
      const alive = prev.players.filter(p => !p.eliminated)
      const votes = { ...prev.votes }
      const feed = [...prev.feed]

      // Absent-vote rule: silence equals a self-vote — same as the contract.
      for (const p of alive) {
        if (!votes[p.id]) {
          votes[p.id] = p.id
          feed.push(`${p.name} did not vote — self-vote recorded.`)
        }
      }

      const tally: Record<string, number> = {}
      for (const target of Object.values(votes)) tally[target] = (tally[target] ?? 0) + 1
      const max = Math.max(...Object.values(tally))
      const tiedIds = Object.keys(tally).filter(id => tally[id] === max)
      const tied = tiedIds.map(id => prev.players.find(p => p.id === id)!).filter(p => !p.eliminated)

      const vulnerable = tied.filter(p => p.shieldRound !== prev.round)
      let eliminatedIds: string[] = []
      if (vulnerable.length === 0) {
        feed.push('Top votes were tied and every top-voted player had an active Shield — nobody was eliminated.')
      } else {
        const infectedVul = vulnerable.filter(p => p.status === 'infected')
        eliminatedIds = (infectedVul.length > 0 ? infectedVul : vulnerable).map(p => p.id)
        const saved = tied.filter(p => p.shieldRound === prev.round)
        for (const p of saved) feed.push(`${p.name} was top-voted but their Shield saved them.`)
      }

      let players = prev.players.map(p =>
        eliminatedIds.includes(p.id)
          ? { ...p, eliminated: true, revealedStatus: p.status }
          : p
      )
      for (const id of eliminatedIds) {
        const p = players.find(pl => pl.id === id)!
        const status = p.status === 'infected' ? 'INFECTED ☣' : 'CLEAN ✚'
        feed.push(p.isYou
          ? `You have been eliminated — you were ${status}.`
          : `${p.name} has been eliminated — they were ${status}.`)
      }

      // Patient Zero succession: promote the next alive infected in the chain.
      const pzDown = players.find(p => p.isPatientZero && p.eliminated)
      if (pzDown) {
        players = players.map(p => (p.id === pzDown.id ? { ...p, isPatientZero: false } : p))
        const nextId = prev.infectionChain.find(id => {
          const p = players.find(pl => pl.id === id)
          return p && !p.eliminated && p.status === 'infected'
        })
        if (nextId) {
          players = players.map(p => (p.id === nextId ? { ...p, isPatientZero: true } : p))
          feed.push('Patient Zero has fallen — but the infection chain promotes a new carrier…')
          if (nextId === YOU_ID) feed.push('☣ You are now Patient Zero. Your vote secretly marks the next infection target.')
        }
      }

      return { ...prev, phase: 'reveal', players, votes, eliminatedIds, noElimination: eliminatedIds.length === 0, feed: feed.slice(-60) }
    })
    startCountdown(REVEAL_SECS, () => checkEndRef.current())
  }, [clearTimers, startCountdown])

  /** Register a vote, announce it, and short-circuit the phase once everyone voted. */
  const addVote = useCallback((voterId: string, targetId: string) => {
    setState(prev => {
      if (prev.phase !== 'voting' || prev.votes[voterId]) return prev
      const voter = prev.players.find(p => p.id === voterId)
      if (!voter || voter.eliminated) return prev
      const feed = [...prev.feed, voter.isYou ? 'You have voted.' : `${voter.name} has voted.`]
      return {
        ...prev,
        votes: { ...prev.votes, [voterId]: targetId },
        // Patient Zero's vote doubles as the next infection target — real mechanic.
        pzNextTarget: voter.isPatientZero ? targetId : prev.pzNextTarget,
        feed: feed.slice(-60),
      }
    })
    schedule(80, () => {
      const s = stateRef.current
      if (s.phase !== 'voting') return
      const alive = s.players.filter(p => !p.eliminated)
      if (alive.every(p => s.votes[p.id])) {
        clearTimers()
        pushFeed('All votes are in — tallying early.')
        schedule(1_500, () => resolveVotesRef.current())
      }
    })
  }, [schedule, clearTimers, pushFeed])

  const goVoting = useCallback(() => {
    const s0 = stateRef.current
    if (s0.phase !== 'discussion') return
    clearTimers()
    setSelectedVote(null)
    setState(prev => ({
      ...prev,
      phase: 'voting',
      feed: [...prev.feed, 'Voting is open. Skipping your vote records a self-vote against you.'].slice(-60),
    }))
    // Bots vote at scattered times.
    const s = stateRef.current
    for (const bot of s.players.filter(p => !p.isYou && !p.eliminated)) {
      schedule(2_000 + Math.random() * VOTING_SECS * 1_000 * 0.7, () => {
        const now = stateRef.current
        if (now.phase !== 'voting') return
        const me = now.players.find(p => p.id === bot.id)
        if (!me || me.eliminated || now.votes[me.id]) return
        const others = now.players.filter(p => p.id !== me.id && !p.eliminated)
        let pool: DemoPlayer[]
        if (me.status === 'infected') {
          // Infected target clean players, preferring unshielded ones.
          const cleanTargets = others.filter(p => p.status === 'clean')
          const unshielded = cleanTargets.filter(p => p.shieldRound !== now.round)
          pool = unshielded.length > 0 ? unshielded : (cleanTargets.length > 0 ? cleanTargets : others)
        } else {
          // Clean bots trust anyone whose Shield proved them clean this round.
          const suspects = others.filter(p => p.shieldRound !== now.round)
          pool = suspects.length > 0 ? suspects : others
        }
        addVote(me.id, pick(pool).id)
      })
    }
    startCountdown(VOTING_SECS, () => resolveVotesRef.current())
  }, [clearTimers, schedule, startCountdown, addVote])

  const startRound = useCallback((n: number) => {
    clearTimers()
    setSelectedVote(null)
    setState(prev => ({
      ...prev,
      phase: 'infection',
      round: n,
      votes: {},
      eliminatedIds: [],
      noElimination: false,
      feed: [...prev.feed, `Round ${n} — infection phase. ${n === 1 ? 'Patient Zero is about to emerge…' : 'The plague is choosing its next host…'}`].slice(-60),
    }))
    startCountdown(INFECTION_SECS, () => {
      // Resolve infection, then open discussion.
      setState(prev => {
        const feed = [...prev.feed]
        let players = prev.players
        let chain = prev.infectionChain

        const aliveClean = players.filter(p => !p.eliminated && p.status === 'clean')
        let targetId: string | null = null
        if (n === 1) {
          // First infection is random — that player IS Patient Zero.
          targetId = pick(aliveClean).id
        } else {
          const wanted = prev.pzNextTarget
          const valid = wanted && aliveClean.some(p => p.id === wanted)
          targetId = valid ? wanted : (aliveClean.length > 0 ? pick(aliveClean).id : null)
        }

        if (targetId) {
          players = players.map(p =>
            p.id === targetId ? { ...p, status: 'infected' as Role, isPatientZero: n === 1 } : p
          )
          chain = [...chain, targetId]
          feed.push(n === 1
            ? 'Patient Zero has emerged. Someone in this room is now infected — and only they know it.'
            : 'The infection has spread to a new host. Only they were notified.')
          if (targetId === YOU_ID) {
            feed.push(n === 1
              ? '☣ You are Patient Zero. Blend in — your vote secretly marks the next infection target.'
              : '⚠ You have been infected. You can no longer activate a Shield — blend in.')
          }
        } else {
          feed.push('The plague found no new host this round.')
        }

        feed.push('Discussion is open. Clean players can activate a Shield to prove innocence.')
        return { ...prev, phase: 'discussion', players, infectionChain: chain, pzNextTarget: null, feed: feed.slice(-60) }
      })

      startCountdown(DISCUSSION_SECS, () => goVotingRef.current())
      scheduleBotChatter('discussion', DISCUSSION_SECS)

      // Some clean bots prove innocence with a Shield mid-discussion.
      const s = stateRef.current
      for (const bot of s.players.filter(p => !p.isYou && !p.eliminated)) {
        if (!chance(0.4)) continue
        schedule(3_000 + Math.random() * DISCUSSION_SECS * 1_000 * 0.55, () => {
          const now = stateRef.current
          if (now.phase !== 'discussion') return
          const me = now.players.find(p => p.id === bot.id)
          // Infected players cannot produce a valid proof — the circuit rejects them.
          if (!me || me.eliminated || me.status === 'infected' || me.shieldRound === now.round) return
          setState(prev => ({
            ...prev,
            players: prev.players.map(p => p.id === me.id ? { ...p, shieldRound: prev.round } : p),
            feed: [...prev.feed, `${me.name} activated a Shield — verified clean this round.`].slice(-60),
          }))
        })
      }
    })
  }, [clearTimers, startCountdown, schedule, scheduleBotChatter])

  // Keep the forward-declaration refs pointing at the latest callbacks.
  useEffect(() => {
    startRoundRef.current = startRound
    goVotingRef.current = goVoting
    resolveVotesRef.current = resolveVotes
    checkEndRef.current = checkEnd
  }, [startRound, goVoting, resolveVotes, checkEnd])

  // ── User actions ───────────────────────────────────────────────────────────

  const startDemo = useCallback(() => {
    if (getDemoCount() >= DEMO_LIMIT) return
    incrementDemoCount()
    setDemoCount(getDemoCount())
    setGameOverSeen(false)
    clearTimers()
    setState({
      ...INITIAL_STATE,
      players: freshPlayers(),
      phase: 'starting',
      feed: [`Room "The Cursed Village" filled — ${TOTAL_PLAYERS} players staked ${STAKE_PER_PLAYER} USDm each. Pot: ${POT_TOTAL} USDm.`],
    })
    scheduleBotChatter('starting', 12)
  }, [clearTimers, scheduleBotChatter])

  const resetDemo = useCallback(() => {
    clearTimers()
    setGameOverSeen(false)
    setSelectedVote(null)
    setChatInput('')
    setState(INITIAL_STATE)
  }, [clearTimers])

  const commitShield = useCallback((password: string) => {
    if (!password.trim()) return
    setState(prev => ({
      ...prev,
      shieldSet: true,
      feed: [...prev.feed, 'Shield Password set (ZK commitment registered). Waiting for the other players…'].slice(-60),
    }))
    schedule(1_800, () => pushFeed('All players locked in. The game is starting.'))
    schedule(3_000, () => startRoundRef.current(1))
  }, [schedule, pushFeed])

  const activateShield = useCallback(() => {
    setState(prev => {
      const you = prev.players.find(p => p.isYou)!
      if (prev.phase !== 'discussion' || you.eliminated || you.status === 'infected' || you.shieldRound === prev.round) return prev
      return {
        ...prev,
        players: prev.players.map(p => p.isYou ? { ...p, shieldRound: prev.round } : p),
        feed: [...prev.feed, 'Your Shield is active — you are provably clean this round. A top vote cannot eliminate you.'].slice(-60),
      }
    })
  }, [])

  const castVote = useCallback(() => {
    if (!selectedVote) return
    addVote(YOU_ID, selectedVote)
    setSelectedVote(null)
  }, [selectedVote, addVote])

  const sendChat = useCallback(() => {
    const text = chatInput.trim()
    if (!text) return
    const s = stateRef.current
    if (getChatBlockedReason(s)) return
    setState(prev => ({ ...prev, chat: [...prev.chat, { senderId: YOU_ID, name: 'You', text }].slice(-200) }))
    setChatInput('')
    // Bots often react to what you say.
    if (chance(0.65)) {
      schedule(1_200 + Math.random() * 2_500, () => {
        const now = stateRef.current
        const bots = now.players.filter(p => !p.isYou && !p.eliminated)
        if (bots.length > 0) botSay(pick(bots).id, pick(REPLY_LINES))
      })
    }
  }, [chatInput, schedule, botSay])

  // ── Derived ────────────────────────────────────────────────────────────────

  const { phase, round, players, votes, eliminatedIds, noElimination, outcome, maxRoundsHit, winners, potPerWinner, shieldSet, feed, chat } = state

  const you = players.find(p => p.isYou)!

  // ── Personal moment overlays (same beats as the live game) ────────────────
  const [moment, setMoment] = useState<{ key: string; data: Moment } | null>(null)
  // Infection reveal — fires on your clean→infected flip, any code path.
  const prevYouStatusRef = useRef(you.status)
  useEffect(() => {
    const prev = prevYouStatusRef.current
    prevYouStatusRef.current = you.status
    if (prev !== 'infected' && you.status === 'infected') {
      setMoment({
        key: `infected:${Date.now()}`,
        data: {
          label: 'You Are Infected',
          color: '#e63329',
          glyph: '☣',
          sublabel: 'Hide it. Spread it. Survive the votes.',
          intense: true,
        },
      })
    }
  }, [you.status])
  // Shield activation — fires when your shieldRound lands on a new round.
  const prevShieldRoundRef = useRef(you.shieldRound)
  useEffect(() => {
    const prev = prevShieldRoundRef.current
    prevShieldRoundRef.current = you.shieldRound
    if (you.shieldRound > 0 && you.shieldRound !== prev) {
      setMoment({
        key: `shield:${you.shieldRound}`,
        data: {
          label: 'Shield Active',
          color: '#6b8e23',
          glyph: '✚',
          sublabel: `Round ${you.shieldRound} — provably clean`,
        },
      })
    }
  }, [you.shieldRound])
  const alivePlayers = players.filter(p => !p.eliminated)
  const infectedAlive = alivePlayers.filter(p => p.status === 'infected').length
  const youVoted = Boolean(votes[YOU_ID])
  const canVote = phase === 'voting' && !you.eliminated && !youVoted
  const youShielded = you.shieldRound === round && round > 0
  const chatBlockedReason = getChatBlockedReason(state)

  const voteTally: Record<string, number> = {}
  for (const target of Object.values(votes)) voteTally[target] = (voteTally[target] ?? 0) + 1

  // Feed + role cards render in the left column on desktop (mirrors the real
  // game page) but stay below the chat in the single-column mobile stack.
  const feedCard = (
    <div className="rounded-lg border p-5" style={{ backgroundColor: '#0a100a', borderColor: 'rgba(107,142,35,0.15)' }}>
      <p className="font-mono text-xs uppercase tracking-[0.2em] mb-3" style={{ color: '#6b8e23' }}>Live Feed</p>
      <ul className="space-y-2 font-mono text-xs overflow-y-auto" style={{ color: '#8fa882', maxHeight: '16rem', scrollbarWidth: 'thin' }}>
        {feed.length === 0 ? (
          <li style={{ color: '#4a5e44' }}>No events yet.</li>
        ) : (
          [...feed].reverse().map((msg, i) => (
            <li key={`${msg}-${i}`} className="flex gap-2">
              <span style={{ color: '#4a5e44' }}>→</span> {msg}
            </li>
          ))
        )}
      </ul>
    </div>
  )
  const roleCard = <YourRoleCard you={you} />

  // ── Welcome / limit screens ────────────────────────────────────────────────

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
              A full simulated match — {TOTAL_PLAYERS} players, live chat, a random Patient Zero, real voting rules. Exactly like the live game, without staking a single USDm.
            </p>
          </div>

          <div className="w-full rounded-lg border p-5 space-y-3" style={{ backgroundColor: '#0a100a', borderColor: 'rgba(107,142,35,0.25)' }}>
            <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>What you&apos;ll experience</p>
            {[
              'A random player becomes Patient Zero — it could be you',
              'Chat with the room: accuse, defend, bluff',
              'The infection spreads round after round',
              'Activate your Shield (ZK proof) to prove innocence',
              'Vote each round — skip it and you vote yourself',
              'Survive until one side takes the pot',
            ].map(step => (
              <div key={step} className="flex items-start gap-2 text-left">
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
      <AmbientLayer />
      <PhaseTransition
        phaseKey={`${round}:${phase}`}
        label={DEMO_PHASE_LABEL[phase]}
        color={DEMO_PHASE_COLOR[phase]}
        sublabel={round > 0 ? `Round ${round}` : undefined}
        glyphKey={phase}
        enabled={phase !== 'gameover' && DEMO_PHASE_LABEL[phase] !== ''}
      />
      <MomentOverlay momentKey={moment?.key ?? null} moment={moment?.data ?? null} />
      {phase === 'gameover' && outcome && !gameOverSeen && (
        <GameOverOverlay
          outcome={outcome}
          potPerWinner={potPerWinner}
          winners={winners}
          onDismiss={() => setGameOverSeen(true)}
        />
      )}
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
                ⚠ Demo mode · simulated players · no real tokens
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
                <p className="font-heading text-2xl leading-none" style={{ color: '#e63329' }}>The Cursed Village</p>
              </div>
              {phase !== 'gameover' && (
                <span
                  className="rounded border px-3 py-1 font-mono text-xs uppercase tracking-[0.2em]"
                  style={{
                    borderColor: `${DEMO_PHASE_COLOR[phase]}44`,
                    backgroundColor: `${DEMO_PHASE_COLOR[phase]}18`,
                    color: DEMO_PHASE_COLOR[phase],
                  }}
                >
                  {DEMO_PHASE_LABEL[phase]}
                </span>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-4">
              <div className="text-center">
                <p className="font-mono text-[10px] uppercase" style={{ color: '#4a5e44' }}>Round</p>
                <p className="font-heading text-3xl leading-none" style={{ color: '#d4c9b2' }}>{round}</p>
              </div>
              <div className="text-center">
                <p className="font-mono text-[10px] uppercase" style={{ color: '#4a5e44' }}>Alive</p>
                <p className="font-heading text-3xl leading-none" style={{ color: '#d4c9b2' }}>{alivePlayers.length}/{TOTAL_PLAYERS}</p>
              </div>
              <div className="text-center">
                <p className="font-mono text-[10px] uppercase" style={{ color: '#4a5e44' }}>Pot</p>
                <p className="font-heading text-3xl leading-none" style={{ color: '#f5c518' }}>{POT_TOTAL} USDm</p>
              </div>
              <div className="text-center">
                <p className="font-mono text-[10px] uppercase" style={{ color: '#4a5e44' }}>Infected</p>
                <p className="font-heading text-3xl leading-none" style={{ color: '#e63329' }}>
                  {phase === 'gameover' ? infectedAlive : '?'}
                </p>
              </div>
              {countdown > 0 && (
                <div className="text-center">
                  <p className="font-mono text-[10px] uppercase" style={{ color: '#4a5e44' }}>Time Left</p>
                  <p className="font-mono text-3xl tabular-nums leading-none" style={{ color: '#6b8e23' }}>{String(Math.floor(countdown / 60)).padStart(2, '0')}:{String(countdown % 60).padStart(2, '0')}</p>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main */}
        <div className="px-6 py-8">
          <div className="mx-auto w-full max-w-6xl">
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">

              {/* Left column */}
              <div className="flex flex-col gap-6">

                {/* Player grid */}
                <article className="rounded-lg border p-5" style={{ backgroundColor: '#0a100a', borderColor: 'rgba(107,142,35,0.2)' }}>
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <h2 className="font-heading text-xl leading-none" style={{ color: '#d4c9b2' }}>Area 51</h2>
                    <span className="font-mono text-xs rounded border px-2 py-0.5" style={{ borderColor: 'rgba(107,142,35,0.3)', color: '#6b8e23' }}>{alivePlayers.length} alive</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {players.map((p, i) => {
                      const selected = phase === 'voting' && selectedVote === p.id
                      const justRevealed = phase === 'reveal' && eliminatedIds.includes(p.id)
                      const clickable = canVote && !p.isYou && !p.eliminated
                      const tallyCount = voteTally[p.id] ?? 0
                      return (
                        <PlayerCard
                          key={p.id}
                          index={i}
                          name={p.name}
                          style={playerCardStyle(p, selected)}
                          isMe={p.isYou}
                          selected={selected}
                          eliminated={p.eliminated}
                          justEliminated={justRevealed}
                          votedByMe={phase === 'voting' && votes[YOU_ID] === p.id}
                          clickable={clickable}
                          onClick={() => clickable && setSelectedVote(prev => prev === p.id ? null : p.id)}
                        >
                          {p.isYou && <span className="block font-mono text-[9px] font-normal lowercase tracking-wider mt-1" style={{ color: 'inherit', opacity: 0.7 }}>(you)</span>}
                          {p.eliminated && (
                            <span className="block font-mono text-[9px] font-normal lowercase tracking-wider mt-1">
                              {p.revealedStatus === 'infected' ? 'was infected ☣' : 'was clean ✚'}
                            </span>
                          )}
                          {!p.eliminated && p.shieldRound === round && round > 0 && (
                            <span className="block font-mono text-[9px] font-normal mt-1" style={{ color: '#84cc16' }}>⊕ shielded</span>
                          )}
                          {phase === 'voting' && tallyCount > 0 && !p.eliminated && (
                            <span className="block font-mono text-[9px] font-normal mt-1" style={{ color: '#ff6b6b' }}>{tallyCount} vote{tallyCount === 1 ? '' : 's'}</span>
                          )}
                          {phase === 'gameover' && !p.eliminated && p.revealedStatus === 'infected' && (
                            <span className="block font-mono text-[9px] font-normal mt-1" style={{ color: '#ff6b6b' }}>infected ☣</span>
                          )}
                        </PlayerCard>
                      )
                    })}
                  </div>
                  {canVote && (
                    <p className="mt-3 font-mono text-xs text-center" style={{ color: '#8fa882' }}>Tap a player to select, then cast your vote below.</p>
                  )}
                </article>

                {/* Phase action panel */}
                {phase === 'starting' && (
                  <StartingPanel shieldSet={shieldSet} onCommit={commitShield} />
                )}

                {phase === 'infection' && (
                  <div className="rounded-lg border p-5" style={{ borderColor: 'rgba(230,51,41,0.4)', backgroundColor: 'rgba(230,51,41,0.08)' }}>
                    <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#e63329' }}>Infection Phase</p>
                    <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#8fa882' }}>
                      {round === 1
                        ? 'The plague is choosing Patient Zero at random. Only the infected player will know…'
                        : 'Patient Zero is silently spreading the plague to a new host…'}
                    </p>
                    {countdown > 0 && (
                      <p className="mt-2 font-mono text-xs" style={{ color: '#4a5e44' }}>Resolving in {countdown}s…</p>
                    )}
                  </div>
                )}

                {phase === 'discussion' && (
                  <DiscussionPanel
                    you={you}
                    round={round}
                    shielded={youShielded}
                    onActivate={activateShield}
                    onSkip={goVoting}
                  />
                )}

                {phase === 'voting' && !you.eliminated && !youVoted && (
                  <div className="rounded-lg border p-5" style={{ borderColor: 'rgba(245,197,24,0.4)', backgroundColor: 'rgba(245,197,24,0.06)' }}>
                    <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#f5c518' }}>Voting Phase</p>
                    <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#8fa882' }}>
                      Vote out the suspected carrier. Players who activated a Shield this round are provably clean — look at everyone else.
                    </p>
                    <p className="mt-2 font-mono text-xs" style={{ color: '#e63329' }}>
                      ⚠ If the timer runs out before you vote, a self-vote is recorded against you.
                    </p>
                    {you.isPatientZero && (
                      <p className="mt-2 font-mono text-xs" style={{ color: '#e63329' }}>
                        ☣ You are Patient Zero — your vote also secretly marks the next infection target.
                      </p>
                    )}
                    <button
                      onClick={castVote}
                      disabled={!selectedVote}
                      className="mt-3 w-full rounded border py-2 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-40"
                      style={{ backgroundColor: '#e63329', borderColor: '#e63329', color: '#d4c9b2' }}
                    >
                      {selectedVote
                        ? `Cast Vote Against ${players.find(p => p.id === selectedVote)?.name}`
                        : 'Select a Player Above'}
                    </button>
                  </div>
                )}

                {phase === 'voting' && !you.eliminated && youVoted && (
                  <div className="rounded-lg border p-5" style={{ borderColor: 'rgba(107,142,35,0.35)', backgroundColor: 'rgba(107,142,35,0.08)' }}>
                    <p className="font-mono text-xs" style={{ color: '#6b8e23' }}>
                      ✓ Vote cast against <strong style={{ color: '#d4c9b2' }}>{players.find(p => p.id === votes[YOU_ID])?.name}</strong>. Waiting for the rest of the room…
                    </p>
                  </div>
                )}

                {phase === 'voting' && you.eliminated && (
                  <div className="rounded-lg border p-5" style={{ borderColor: 'rgba(74,94,68,0.5)', backgroundColor: 'rgba(74,94,68,0.1)' }}>
                    <p className="font-mono text-xs" style={{ color: '#4a5e44' }}>⊘ You have been eliminated — spectating while the room votes.</p>
                  </div>
                )}

                {phase === 'reveal' && (
                  <RevealPanel players={players} eliminatedIds={eliminatedIds} noElimination={noElimination} countdown={countdown} />
                )}

                {phase === 'gameover' && (
                  <GameOverPanel
                    outcome={outcome}
                    maxRoundsHit={maxRoundsHit}
                    winners={winners}
                    potPerWinner={potPerWinner}
                    youWon={outcome !== null && winners.includes('You')}
                    demoRunsLeft={DEMO_LIMIT - demoCount}
                    onReset={resetDemo}
                  />
                )}

                {/* Desktop: feed balances the left column (like the live game) */}
                <div className="hidden lg:block">
                  {feedCard}
                </div>
              </div>

              {/* Right: chat + feed + role */}
              <aside className="flex flex-col gap-6">

                {/* Room chat — same rules as the live game */}
                <div className="rounded-lg border p-4 flex flex-col" style={{ backgroundColor: '#0a100a', borderColor: 'rgba(107,142,35,0.15)' }}>
                  <p className="font-mono text-xs uppercase tracking-[0.2em] flex-shrink-0" style={{ color: '#6b8e23' }}>Room Chat</p>
                  <div className="mt-3 overflow-y-auto space-y-2 pr-1" style={{ maxHeight: '16rem', scrollbarWidth: 'thin' }}>
                    {chat.length === 0 ? (
                      <p className="font-mono text-[11px]" style={{ color: '#4a5e44' }}>No messages yet…</p>
                    ) : (
                      chat.map((m, i) => (
                        <div key={`${m.senderId}-${i}`} className="font-mono text-[11px] leading-snug break-words">
                          <span style={{ color: m.senderId === YOU_ID ? '#6b8e23' : '#f5c518' }}>{m.name}</span>
                          <span style={{ color: '#4a5e44' }}>: </span>
                          <span style={{ color: '#d4c9b2' }}>{m.text}</span>
                        </div>
                      ))
                    )}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="mt-3 flex gap-2 flex-shrink-0">
                    <input
                      type="text"
                      placeholder={chatBlockedReason ?? 'Say something…'}
                      value={chatInput}
                      maxLength={256}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') sendChat() }}
                      disabled={chatBlockedReason !== null}
                      className="flex-1 rounded border bg-transparent px-3 py-1.5 font-mono text-xs focus:outline-none"
                      style={{ borderColor: 'rgba(107,142,35,0.3)', color: '#d4c9b2' }}
                    />
                    <button
                      onClick={sendChat}
                      disabled={!chatInput.trim() || chatBlockedReason !== null}
                      className="rounded border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-40"
                      style={{ borderColor: '#6b8e23', color: '#6b8e23' }}
                    >
                      Send
                    </button>
                  </div>
                  {chatBlockedReason && (
                    <p className="mt-2 font-mono text-[11px]" style={{ color: '#f5c518' }}>{chatBlockedReason}</p>
                  )}
                </div>

                {/* Your role — stays beside the chat on desktop */}
                {roleCard}

                {/* Mobile: feed stacks under the chat */}
                <div className="lg:hidden">
                  {feedCard}
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

function StartingPanel({ shieldSet, onCommit }: { shieldSet: boolean; onCommit: (pw: string) => void }) {
  const [input, setInput] = useState('')

  if (shieldSet) {
    return (
      <div className="rounded-lg border p-5" style={{ borderColor: 'rgba(107,142,35,0.35)', backgroundColor: 'rgba(107,142,35,0.08)' }}>
        <p className="font-mono text-xs" style={{ color: '#6b8e23' }}>✓ Shield Password set. Waiting for all players — the game is starting…</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border p-5" style={{ borderColor: 'rgba(107,142,35,0.35)', backgroundColor: 'rgba(107,142,35,0.08)' }}>
      <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#6b8e23' }}>Set Shield Password</p>
      <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
        Choose a secret password. You&apos;ll use it later to activate your Shield — a ZK proof of innocence the contract verifies without ever seeing your password.
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
  you,
  round,
  shielded,
  onActivate,
  onSkip,
}: {
  you: DemoPlayer
  round: number
  shielded: boolean
  onActivate: () => void
  onSkip: () => void
}) {
  if (you.eliminated) {
    return (
      <div className="rounded-lg border p-5" style={{ borderColor: 'rgba(74,94,68,0.5)', backgroundColor: 'rgba(74,94,68,0.1)' }}>
        <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>⊘ Eliminated</p>
        <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#4a5e44' }}>
          You&apos;re out of the game. Watch the survivors argue it out — the round advances automatically.
        </p>
      </div>
    )
  }

  if (you.status === 'infected') {
    return (
      <div className="rounded-lg border p-5" style={{ borderColor: 'rgba(230,51,41,0.5)', backgroundColor: 'rgba(230,51,41,0.08)' }}>
        <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#e63329' }}>
          {you.isPatientZero ? '☣ You are Patient Zero' : '⚠ You are Infected'}
        </p>
        <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#ff6b6b' }}>
          Infected players cannot activate a Shield — the ZK circuit rejects the proof. Use the chat to deflect suspicion, then vote a clean player out.
        </p>
        <button
          onClick={onSkip}
          className="mt-3 w-full rounded border py-2 font-mono text-sm uppercase tracking-wider transition-all hover:opacity-80"
          style={{ borderColor: 'rgba(245,197,24,0.5)', color: '#f5c518', backgroundColor: 'transparent' }}
        >
          Skip to Voting →
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-lg border p-5" style={{ borderColor: 'rgba(107,142,35,0.35)', backgroundColor: 'rgba(107,142,35,0.08)' }}>
      <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#6b8e23' }}>Discussion Phase — Round {round}</p>
      <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
        Someone new is infected. Talk it out in chat — and if suspicion lands on you, activate your Shield to prove innocence. Infected players <em>cannot</em> activate one.
      </p>
      {shielded ? (
        <div className="mt-3 space-y-3">
          <p className="font-mono text-xs" style={{ color: '#84cc16' }}>✓ Shield active — you are provably clean this round. A top vote cannot eliminate you.</p>
          <button
            onClick={onSkip}
            className="w-full rounded border py-2 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90"
            style={{ borderColor: '#f5c518', color: '#f5c518', backgroundColor: 'rgba(245,197,24,0.08)' }}
          >
            Skip to Voting →
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
            Skip to Voting →
          </button>
        </div>
      )}
    </div>
  )
}

function RevealPanel({
  players,
  eliminatedIds,
  noElimination,
  countdown,
}: {
  players: DemoPlayer[]
  eliminatedIds: string[]
  noElimination: boolean
  countdown: number
}) {
  const eliminated = players.filter(p => eliminatedIds.includes(p.id))
  const anyInfected = eliminated.some(p => p.revealedStatus === 'infected')

  let borderColor = 'rgba(230,51,41,0.4)'
  let accent = '#e63329'
  if (noElimination) { borderColor = 'rgba(143,168,130,0.4)'; accent = '#8fa882' }
  else if (anyInfected) { borderColor = 'rgba(132,204,22,0.4)'; accent = '#84cc16' }

  return (
    <div className="rounded-lg border p-5" style={{ borderColor, backgroundColor: `${accent}10` }}>
      <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: accent }}>
        {noElimination ? 'No Elimination' : anyInfected ? 'Carrier Down' : 'Wrong Elimination'}
      </p>
      {noElimination ? (
        <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#8fa882' }}>
          Every top-voted player had an active Shield. Nobody was eliminated — the game moves on.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {eliminated.map(p => (
            <p key={p.id} className="font-mono text-sm" style={{ color: p.revealedStatus === 'infected' ? '#84cc16' : '#e63329' }}>
              {p.name} eliminated — was {p.revealedStatus === 'infected' ? 'INFECTED ☣' : 'CLEAN ✚'}
              {p.revealedStatus === 'clean' && '. The plague is still among you.'}
            </p>
          ))}
        </div>
      )}
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#4a5e44' }}>
        {countdown > 0 ? `Next round in ${countdown}s…` : 'Resolving…'}
      </p>
    </div>
  )
}

function YourRoleCard({ you }: { you: DemoPlayer }) {
  let label = 'Clean'
  let color = '#6b8e23'
  let desc = 'Survive, find the carriers, and vote them out before the infected reach parity.'
  if (you.eliminated) {
    label = 'Eliminated'
    color = '#4a5e44'
    desc = 'You are out. Spectate the rest of the outbreak.'
  } else if (you.isPatientZero) {
    label = 'Patient Zero ☣'
    color = '#e63329'
    desc = 'You lead the infection. Your vote secretly marks the next infection target. Avoid suspicion.'
  } else if (you.status === 'infected') {
    label = 'Infected ⚠'
    color = '#e63329'
    desc = 'You carry the plague. You cannot Shield — bluff your way to parity.'
  }
  return (
    <div className="rounded-lg border p-5" style={{ backgroundColor: 'rgba(107,142,35,0.04)', borderColor: 'rgba(107,142,35,0.2)' }}>
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] mb-2" style={{ color: '#4a5e44' }}>Your Role</p>
      <p className="font-mono text-sm" style={{ color }}>{label}</p>
      <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>{desc}</p>
    </div>
  )
}

function GameOverPanel({
  outcome,
  maxRoundsHit,
  winners,
  potPerWinner,
  youWon,
  demoRunsLeft,
  onReset,
}: {
  outcome: GameOutcome | null
  maxRoundsHit: boolean
  winners: string[]
  potPerWinner: number
  youWon: boolean
  demoRunsLeft: number
  onReset: () => void
}) {
  const won = outcome === 'clean_win'
  let title = 'DRAW'
  let color = '#f5c518'
  if (outcome === 'clean_win') { title = 'CLEAN WIN'; color = '#84cc16' }
  if (outcome === 'infected_win') { title = 'INFECTED WIN'; color = '#e63329' }

  return (
    <div className="space-y-6">
      <div
        className="rounded-lg border p-6"
        style={{ borderColor: `${color}66`, backgroundColor: `${color}0f` }}
      >
        <p className="font-display text-4xl leading-none" style={{ color }}>{title}</p>
        {maxRoundsHit && (
          <p className="mt-2 font-mono text-xs" style={{ color: '#8fa882' }}>Round limit reached — counts as an infected win.</p>
        )}
        <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#8fa882' }}>
          {outcome === 'draw'
            ? 'One infected, one clean — a standoff. In a real game, no faction payout is declared.'
            : won
              ? 'The village purged every carrier. The pot goes to the surviving clean players.'
              : 'The infected reached parity with the living. The pot goes to the surviving infected.'}
        </p>
        {winners.length > 0 && (
          <p className="mt-3 font-mono text-sm" style={{ color: '#f5c518' }}>
            {youWon ? '★ You survived and won' : 'Winners'}: {winners.join(', ')} — {potPerWinner.toFixed(2)} USDm each
            <span style={{ color: '#4a5e44' }}> (pot {POT_TOTAL} USDm − 1.5% platform fee)</span>
          </p>
        )}
        <p className="mt-3 font-mono text-xs" style={{ color: '#4a5e44' }}>
          In real games all of this runs on Celo: stakes locked in the contract, Shields verified as ZK proofs on-chain, payouts automatic.
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
        {demoRunsLeft > 0 && (
          <button
            onClick={onReset}
            className="flex-1 rounded-lg border py-4 text-center font-mono text-sm uppercase tracking-wider transition-all hover:opacity-80"
            style={{ borderColor: 'rgba(245,197,24,0.5)', color: '#f5c518' }}
          >
            Run Demo Again ({demoRunsLeft} left)
          </button>
        )}
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
