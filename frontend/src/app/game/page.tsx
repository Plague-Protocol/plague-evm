'use client'

import { SiteNav } from '@/components/ui/site-nav'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { useGameState } from '@/hooks/useGameState'
import { useWallet } from '@/hooks/useWallet'
import { useSoundscape, GAME_OVER_TRACKS, playSting } from '@/hooks/useSoundscape'
import { useSound } from '@/providers/sound-provider'
import { createContractClient } from '@/lib/contract'
import { GameTabNav, type GameTab } from '@/components/game/GameTabNav'
import type { RoundPhase } from '@/types/game'
import { toast } from 'sonner'

export const dynamic = 'force-dynamic'

// ── Phase display helpers ─────────────────────────────────────────────────────

const PHASE_LABEL: Record<RoundPhase, string> = {
  infection:  'INFECTION',
  discussion: 'DISCUSS',
  voting:     'VOTING',
  reveal:     'ELIMINATION',
  ended:      'ENDED',
}

const PHASE_COLOR: Record<RoundPhase, string> = {
  infection:  '#e63329',
  discussion: '#39ff14',
  voting:     '#f5c518',
  reveal:     '#d4c9b2',
  ended:      '#4a5e44',
}

function playerStyle(status: string): { border: string; backgroundColor: string; color: string } {
  if (status === 'infected')   return { border: '2px solid #e63329', backgroundColor: 'rgba(230,51,41,0.15)', color: '#ff6b6b' }
  if (status === 'eliminated') return { border: '2px solid #4a5e44', backgroundColor: 'rgba(74,94,68,0.12)', color: '#4a5e44' }
  return { border: '2px solid #39ff14', backgroundColor: 'rgba(57,255,20,0.08)', color: '#39ff14' }
}

/** Only reveal 'infected' styling to the player themselves — hide it from others. */
function visibleStatus(p: { walletAddress: string; status: string }, localAddress: string | null | undefined): string {
  if (p.status === 'infected' && p.walletAddress.toLowerCase() !== (localAddress ?? '').toLowerCase()) {
    return 'clean'
  }
  return p.status
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const CUSD_ADDRESSES: Record<number, `0x${string}`> = {
  11142220: '0xae10a9e08d979e7d154d3b0212fb7cbf70fa6bb1', // Celo Sepolia (MockCUSD)
  42220: '0x765DE816845861e75A25fCA122bb6022DB77Eaca',   // Mainnet
}
const ROLE_COMMIT_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_ROLE_COMMIT_TIMEOUT_MS ?? 180_000)

function getHeaderTitle(isLoading: boolean, round: number, roomStatus?: string): string {
  if (isLoading) return 'LOADING…'
  if (round > 0) return `ROUND ${round}`
  if (roomStatus === 'waiting') return 'WAITING'
  if (roomStatus === 'ended') return 'ENDED'
  return 'STARTING'
}

function getPhaseCardBackground(phase: RoundPhase): string {
  if (phase === 'infection') return 'rgba(230,51,41,0.1)'
  if (phase === 'discussion') return 'rgba(57,255,20,0.1)'
  if (phase === 'voting') return 'rgba(245,197,24,0.1)'
  return 'rgba(143,168,130,0.1)'
}

function getPhaseDescription(
  phase: RoundPhase,
  hasVoted: boolean,
  result: { outcome: string } | null,
  roomStatus?: string,
  isInfected?: boolean,
): string {
  if (phase === 'infection') return isInfected
    ? 'You are a carrier. Patient Zero is spreading infection to a new target this round.'
    : 'Patient Zero is spreading the plague. A new carrier is being assigned — stay vigilant.'
  if (phase === 'discussion') return 'Infection has spread. Activate your Shield now before voting opens.'
  if (phase === 'voting') return hasVoted ? 'Your vote has been cast. Awaiting other votes…' : 'Vote to eliminate the suspected carrier before more are infected.'
  if (phase === 'reveal') return 'Votes tallied — elimination is being resolved on-chain.'
  if (result) return `Game over: ${result.outcome.replaceAll('_', ' ')}`
  if (roomStatus === 'waiting') return 'Waiting for players to join.'
  if (roomStatus === 'starting') return 'Waiting for all players to commit their role.'
  return 'Game ended.'
}

function getResultLabel(outcome: string): string {
  if (outcome === 'clean_win') return 'Clean Win'
  if (outcome === 'infected_win') return 'Infected Win'
  return 'Draw'
}

function getVotePanelLabel(phase: RoundPhase, hasVoted: boolean): string {
  if (phase !== 'voting') return 'Voting not open'
  return hasVoted ? 'Vote submitted' : 'Select suspected carrier'
}

function getChatBlockedReason(
  socketOnline: boolean,
  localPlayer: { isEliminated: boolean } | null,
  roomStatus: string | undefined,
  phase: RoundPhase,
): string | null {
  if (!socketOnline) return 'Chat unavailable while backend is offline.'
  if (localPlayer === null) return 'Only joined room players can chat.'
  if (roomStatus === 'ended') return 'Chat is closed because this game has ended.'
  if (localPlayer.isEliminated) return 'Eliminated players cannot use chat.'
  if (roomStatus === 'active' && phase === 'voting') return 'Chat is disabled during voting.'
  return null
}

function ensureHexPrefixed(value: string): `0x${string}` {
  if (value.startsWith('0x')) return value as `0x${string}`
  return `0x${value}`
}

// ── Contract error → user message ─────────────────────────────────────────────

const CONTRACT_ERROR_MAP: Record<string, string> = {
  NotAlive:              'You are no longer alive in this game and cannot take this action.',
  WrongPhase:            'This action is not available in the current phase.',
  AlreadyVoted:          'You have already voted this round.',
  AlreadyProvedThisRound:'Your Shield is already active this round.',
  NullifierUsed:         'This proof nullifier has already been used. Try a different secret.',
  InvalidProof:          'ZK proof verification failed. Check your secret phrase and try again.',
  NotParticipant:        'You are not a participant in this room.',
  AlreadyCommitted:      'You have already committed your role.',
  DuplicateRoleCommitment:'That Shield Password is already taken in this room. Pick a different one.',
  NotActive:             'The game is not currently active.',
  NotEnoughPlayers:      'Not enough players to perform this action.',
  InvalidInfectionTarget:'Invalid infection target.',
}

function parseContractError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/cannot satisfy constraint|cannot satisfy constraints|unsatisfied constraint/i.test(msg)) {
    return 'Proof generation failed. Your secret phrase is incorrect for this room/round. Please use the exact phrase you committed with.'
  }
  for (const [name, friendly] of Object.entries(CONTRACT_ERROR_MAP)) {
    if (msg.includes(name)) return friendly
  }
  return msg.split('\n')[0]
}

// ── Inner component (uses hooks that need Suspense) ───────────────────────────

function GamePageInner() { // NOSONAR
  const router = useRouter()
  const params = useSearchParams()
  const roomId = params.get('room')

  const { isConnected, address, chainId } = useWallet()
  const { room, localPlayer, currentRound, result, isConnected: socketOn, isLoading, error, feed, socket, refresh } = useGameState(roomId, address)

  // ── Phase timer ──────────────────────────────────────────────────────────
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  const phaseEndsAt = currentRound?.phaseEndsAt ?? 0
  const msLeft = phaseEndsAt > now ? phaseEndsAt - now : 0
  const startCommitEndsAt = room?.status === 'starting' && room?.startedAt
    ? room.startedAt + ROLE_COMMIT_TIMEOUT_MS
    : 0
  const headerCountdownMs = startCommitEndsAt > now ? startCommitEndsAt - now : msLeft

  // ── Vote state ───────────────────────────────────────────────────────────
  const [selectedVote, setSelectedVote]           = useState<string | null>(null)
  const [voting, setVoting]                       = useState(false)
  const [voteError, setVoteError]                 = useState<string | null>(null)
  const [optimisticVotedFor, setOptimisticVotedFor] = useState<string | null>(null)

  // ── Proof submission state ───────────────────────────────────────────────
  const [proving, setProving]       = useState(false)
  const [proofError, setProofError] = useState<string | null>(null)
  const [optimisticProofDone, setOptimisticProofDone] = useState(false)

  // ── Role commitment state (during Starting phase) ────────────────────────
  const [committing, setCommitting]               = useState(false)
  const [commitError, setCommitError]             = useState<string | null>(null)
  const [secretPhrase, setSecretPhrase]           = useState('')
  const [optimisticCommitDone, setOptimisticCommitDone] = useState(false)

  // ── Start game state (host only, Waiting phase) ──────────────────────────
  const [starting, setStarting]         = useState(false)
  const [startError, setStartError]     = useState<string | null>(null)

  // ── Room name editor (host only, when name is null) ─────────────────────
  const [roomNameEditing, setRoomNameEditing] = useState(false)
  const [pendingRoomName, setPendingRoomName] = useState('')

  // ── Chat state ───────────────────────────────────────────────────────────
  type ChatMsg = { sender: string; displayName: string; message: string; timestamp: number }
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput]       = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const phaseAdvanceNudgeKeyRef = useRef<string>('')

  // ── Mobile tab navigation ───────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<GameTab>('game')
  const [unreadChat, setUnreadChat] = useState(0)
  const [isMobile, setIsMobile] = useState(false)
  // Refs to expose current values inside socket-handler closures without re-registering
  const activeTabRef = useRef<GameTab>('game')
  const isMobileRef  = useRef(false)
  useEffect(() => { activeTabRef.current = activeTab }, [activeTab])
  useEffect(() => { isMobileRef.current  = isMobile  }, [isMobile])
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Clear unread when switching to chat tab
  const handleTabChange = useCallback((tab: GameTab) => {
    setActiveTab(tab)
    if (tab === 'chat') setUnreadChat(0)
  }, [])

  // Auto-switch tab on mobile when the game phase changes so players always land
  // on the relevant panel without having to hunt for it manually.
  //   starting           → Game tab  (Set Shield Password action is there)
  //   discussion         → Game tab  (Activate Shield action is there)
  //   infection / voting / reveal → Vote tab (Area 51 grid + vote panel)
  useEffect(() => {
    if (!isMobile) return
    const status   = room?.status
    const phaseNow = currentRound?.phase ?? 'ended'
    if (status === 'starting') {
      setActiveTab('game')
    } else if (status === 'active') {
      setActiveTab(phaseNow === 'discussion' ? 'game' : 'board')
    }
  }, [room?.status, currentRound?.phase, isMobile])

  const schedulePostTxRefresh = useCallback(() => {
    socket?.emit('request_room_refresh', { roomId })
    // Retry refreshes at 1.5 s, 3.5 s, and 6 s to handle RPC propagation lag.
    setTimeout(() => { refresh(); socket?.emit('request_room_refresh', { roomId }) }, 1_500)
    setTimeout(() => { refresh(); socket?.emit('request_room_refresh', { roomId }) }, 3_500)
    setTimeout(() => { refresh() }, 6_000)
  }, [refresh, roomId, socket])

  // ── Derived ──────────────────────────────────────────────────────────────
  const phase       = currentRound?.phase ?? 'ended'
  const round       = currentRound?.number ?? 0
  const activePlayers = room?.players?.filter(p => !p.isEliminated) ?? []
  const totalPlayers  = room?.players?.length ?? 0
  const infectedCount = room?.players?.filter(p => p.status === 'infected' && !p.isEliminated).length ?? 0
  const potCUSD       = room ? (Number(room.stakeAmount) * totalPlayers / 1e18).toFixed(2) : '—'
  const hasVoted      = Boolean(optimisticVotedFor || localPlayer?.hasVotedThisRound)
  const myVotedTarget = optimisticVotedFor ?? localPlayer?.voteTarget
  const hasProofThisRound = optimisticProofDone || Boolean(localPlayer?.hasProofThisRound)
  const commitDone = optimisticCommitDone || Boolean(localPlayer?.roleCommitted)
  const canVote       = phase === 'voting' && isConnected && !!localPlayer && !localPlayer.isEliminated && !hasVoted && !voting
  const canProve      = phase === 'discussion' && isConnected && !!localPlayer && !localPlayer.isEliminated && localPlayer.status !== 'infected' && !hasProofThisRound
  const canCommit     = room?.status === 'starting' && isConnected && !!localPlayer && !committing && !commitDone
  const chatBlockedReason = getChatBlockedReason(socketOn, localPlayer, room?.status, phase)
  const canChat = chatBlockedReason === null
  const isHost        = !!address && room?.hostAddress?.toLowerCase() === address.toLowerCase()
  // Spectator: wallet connected but address not in players list (late viewer)
  const isSpectator   = !!address && !!room && room.status === 'active' && !room.players.some(p => p.walletAddress.toLowerCase() === address.toLowerCase())
  const isPhaseSyncing = room?.status === 'active'
    && (phase === 'discussion' || phase === 'voting' || phase === 'reveal')
    && headerCountdownMs <= 0
  const headerTitle = getHeaderTitle(isLoading, round, room?.status)
  const phaseCardDescription = getPhaseDescription(phase, hasVoted, result, room?.status, localPlayer?.status === 'infected')
  const phaseCardBackground = getPhaseCardBackground(phase)
  const synchronizedFeed = [
    `System sync: Round ${round > 0 ? round : '-'} · ${PHASE_LABEL[phase]} · Infected ${infectedCount}/${Math.max(activePlayers.length, 1)}`,
    ...feed,
  ].slice(0, 50)
  const hostPlayerCountLabel = `${totalPlayers} player${totalPlayers === 1 ? '' : 's'} in room. Start when ready.`
  const votePanelLabel = getVotePanelLabel(phase, hasVoted)
  let potPerWinnerValue = 0
  if (result?.potPerWinner && result.potPerWinner > 0n) {
    potPerWinnerValue = Number(result.potPerWinner) / 1e18
  } else if (result && result.winners.length > 0) {
    potPerWinnerValue = Number(result.totalPot) / 1e18 / result.winners.length
  }
  const potPerWinnerDisplay = potPerWinnerValue.toFixed(4)
  let playersPanelBody: React.ReactNode
  if (isLoading) {
    playersPanelBody = <p className="text-center font-mono text-xs" style={{ color: '#4a5e44' }}>Loading players…</p>
  } else if (room?.players?.length) {
    playersPanelBody = (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {room.players.map((p) => {
          const isMe = p.walletAddress.toLowerCase() === address?.toLowerCase()
          return (
            <button
              key={p.walletAddress}
              onClick={() => canVote && setSelectedVote(p.walletAddress === selectedVote ? null : p.walletAddress)}
              title={isMe ? `${p.displayName} (You)` : p.displayName}
              className="relative truncate rounded-lg px-2 py-3 font-mono text-sm font-bold uppercase tracking-widest transition-all hover:opacity-80"
              style={{
                ...playerStyle(visibleStatus(p, address)),
                boxShadow: isMe
                  ? '0 0 0 2px #39ff14, 0 0 12px rgba(57,255,20,0.35)'
                  : selectedVote === p.walletAddress ? `0 0 0 2px #f5c518` : undefined,
                cursor: canVote && !p.isEliminated ? 'pointer' : 'default',
              }}
            >
              {p.displayName}
            </button>
          )
        })}
      </div>
    )
  } else {
    playersPanelBody = <p className="text-center font-mono text-xs" style={{ color: '#4a5e44' }}>Waiting for players…</p>
  }

  // Mobile tab visibility helper — on desktop everything shows
  const showOnTab = (tab: GameTab) => !isMobile || activeTab === tab

  // ── Soundscape ───────────────────────────────────────────────────────────
  const { muted } = useSound()
  const soundScene = room?.status === 'ended' ? 'ended' : phase
  useSoundscape(soundScene, muted)

  // Reset optimistic vote when round changes
  const roundNumber = currentRound?.number ?? 0
  useEffect(() => {
    setOptimisticVotedFor(null)
    setOptimisticProofDone(false)
  }, [roundNumber])

  // Avoid carrying optimistic commitment state into another room.
  useEffect(() => {
    setOptimisticCommitDone(false)
    setOptimisticProofDone(false)
  }, [roomId])

  // If the room ended but live socket events were missed (result is still null),
  // do a chain read so the game-over overlay is populated correctly.
  useEffect(() => {
    if (room?.status === 'ended' && !result) refresh()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.status])

  // While the timer has elapsed but the next phase hasn't landed yet, poll the
  // chain every 4s so a slow tx / RPC lag eventually unsticks the UI without
  // requiring the user to refresh manually.
  const [syncWaitMs, setSyncWaitMs] = useState(0)
  useEffect(() => {
    if (!isPhaseSyncing) {
      setSyncWaitMs(0)
      return
    }
    const start = Date.now()
    setSyncWaitMs(0)
    const tick = () => {
      setSyncWaitMs(Date.now() - start)
      refresh()
      socket?.emit('request_room_refresh', { roomId })
    }
    tick()
    const id = setInterval(tick, 4_000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPhaseSyncing, roomId])

  // Play game-over sting once when result arrives
  useEffect(() => {
    if (!result) return
    const src = result.outcome === 'infected_win'
      ? GAME_OVER_TRACKS.infected
      : GAME_OVER_TRACKS.clean
    playSting(src, muted, 0.55)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.outcome])

  // ── Chat socket listeners ─────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return
    const msgHandler = (msg: { sender: string; displayName: string; message: string; timestamp: number }) => {
      setChatMessages(prev => [...prev.slice(-199), msg])
      // Increment unread if not viewing chat tab on mobile
      if (isMobileRef.current && activeTabRef.current !== 'chat') {
        setUnreadChat(prev => prev + 1)
      }
    }
    const historyHandler = (history: { sender: string; displayName: string; message: string; timestamp: number }[]) => {
      setChatMessages(history.slice(-200))
    }
    const errorHandler = (data: { message?: string }) => {
      if (data?.message) toast.error(data.message)
    }
    socket.on('chat_message', msgHandler)
    socket.on('chat_history', historyHandler)
    socket.on('chat_error', errorHandler)
    return () => {
      socket.off('chat_message', msgHandler)
      socket.off('chat_history', historyHandler)
      socket.off('chat_error', errorHandler)
    }
  }, [socket])

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const handleSendChat = useCallback(() => {
    if (!chatInput.trim() || !socket || !address || !roomId || !canChat) return
    const displayName = room?.players?.find(p => p.walletAddress.toLowerCase() === address.toLowerCase())?.displayName
      ?? `${address.slice(0, 6)}…${address.slice(-4)}`
    socket.emit('chat_message', { roomId, message: chatInput.trim(), playerAddress: address, displayName })
    setChatInput('')
  }, [chatInput, socket, address, roomId, room, canChat])

  // ── Vote tally ────────────────────────────────────────────────────────────
  const voteTally: Record<string, number> = {}
  currentRound?.votes.forEach(v => {
    voteTally[v.targetAddress] = (voteTally[v.targetAddress] ?? 0) + 1
  })

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleCastVote = useCallback(async () => {
    if (!selectedVote || !address || !roomId) return
    const client = getContractClient()
    if (!client) return
    setVoting(true)
    setVoteError(null)
    try {
      await client.castVote(address, BigInt(roomId), selectedVote as `0x${string}`)
      // Optimistic update — flip the UI immediately without waiting for the socket broadcast.
      setOptimisticVotedFor(selectedVote)
      setSelectedVote(null)
      socket?.emit('request_room_refresh', { roomId })
      toast.success('Vote submitted!')
      refresh()
    } catch (err) {
      const msg = parseContractError(err)
      setVoteError(msg)
      toast.error(msg)
    } finally {
      setVoting(false)
    }
  }, [selectedVote, address, roomId, refresh, socket])

  const handleSubmitProof = useCallback(async () => {
    if (!address || !roomId || !secretPhrase) {
      setProofError('Enter your secret phrase to generate a proof.')
      return
    }
    setProving(true)
    setProofError(null)
    try {
      const client = getContractClient()
      if (!client) throw new Error('Contract not configured.')

      // Use on-chain roleCommitment stored when player submitted their role.
      const commitment = (localPlayer?.roleCommitment ?? '') as `0x${string}`
      if (!commitment) throw new Error('Role commitment not found. Submit your role first.')

      const { proveInnocence, computeInnocenceNullifier, deriveSecret } = await import('@/lib/zk')
      const secretBigInt = await deriveSecret(secretPhrase)
      const nullifier = await computeInnocenceNullifier(secretBigInt, BigInt(roomId), BigInt(round))
      const proof = await proveInnocence({
        role:        'clean',
        secret:      secretBigInt,
        roomId:      BigInt(roomId),
        roundNumber: BigInt(round),
        commitment,
      })

      const nullifierHex: `0x${string}` = `0x${nullifier.toString(16).padStart(64, '0')}`
      const proofBytes   = ('0x' + proof.proof.map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`

      // Notify backend before writing on-chain — backend validates and may send proof_error
      if (socket) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 3000) // fall through if no ack within 3s
          socket.once('proof_error', (data: { message?: string }) => {
            clearTimeout(timer)
            reject(new Error(data.message ?? 'Backend rejected proof.'))
          })
          socket.once('proof_ack', () => {
            clearTimeout(timer)
            resolve()
          })
          socket.emit('submit_proof', {
            roomId,
            playerAddress: address,
            commitment,
            nullifier: nullifierHex,
            zkProof: proofBytes,
            isFreeProof: !localPlayer?.freeProofUsed,
          })
        })
      }

      // Approve exact proof fee (not stakeAmount) for paid proofs
      if (localPlayer?.freeProofUsed && chainId && CUSD_ADDRESSES[chainId]) {
        const feeAmt = room?.proofFee ?? 0n
        if (feeAmt > 0n) {
          await client.approveCUSD(address, CUSD_ADDRESSES[chainId], feeAmt)
        }
      }

      await client.submitInnocenceProof(address, BigInt(roomId), commitment, nullifierHex, proofBytes)
      setOptimisticProofDone(true)
      socket?.emit('request_room_refresh', { roomId })
      toast.success('Shield activated!')
      schedulePostTxRefresh()
    } catch (err) {
      const msg = parseContractError(err)
      if (msg.includes('AlreadyProvedThisRound')) {
        setOptimisticProofDone(true)
        socket?.emit('request_room_refresh', { roomId })
        schedulePostTxRefresh()
      } else {
        setProofError(msg)
        toast.error(msg)
      }
    } finally {
      setProving(false)
    }
  }, [address, roomId, secretPhrase, round, localPlayer, room, chainId, socket, schedulePostTxRefresh])

  const handleCommitRole = useCallback(async () => {
    if (!address || !roomId || !secretPhrase) {
      setCommitError('Enter a secret phrase to commit your role.')
      return
    }
    setCommitting(true)
    setCommitError(null)
    try {
      const { generateRoleCommitment, proveRoleCommitment, deriveSecret } = await import('@/lib/zk')
      const role = 'clean' as const // backend assigns infection via assignInfection
      const secretBigInt = await deriveSecret(secretPhrase)
      const { commitment } = await generateRoleCommitment(role, secretBigInt)
      const commitmentHex = ensureHexPrefixed(commitment)

      // Pre-submit duplicate guard. Two players using the same passphrase produce
      // the same commitment (poseidon2(0, secret)) and would collide nullifiers
      // at Shield activation, so only one of them could ever submit.
      //
      // Path 1 (preferred): backend reservation endpoint. Zero gas on reject.
      // Path 2 (fallback):  client-side check + confirm, used when backend is
      //                     unreachable. The contract still enforces uniqueness
      //                     as the final guard if both layers miss.
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
      let reservedByBackend = false
      try {
        const reserveRes = await fetch(`${backendUrl}/api/rooms/${roomId}/reserve-commitment`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ commitment: commitmentHex, address }),
        })
        if (reserveRes.status === 409) {
          const body = await reserveRes.json().catch(() => ({})) as { message?: string }
          const msg = body.message ?? 'That Shield Password is already taken in this room. Pick a different one.'
          setCommitError(msg)
          setCommitting(false)
          return
        }
        if (reserveRes.ok) reservedByBackend = true
      } catch {
        // backend unreachable — fall through to client-side fallback
      }

      if (!reservedByBackend) {
        const myAddrLower = address.toLowerCase()
        const collidesWith = room?.players?.find(p =>
          p.walletAddress.toLowerCase() !== myAddrLower &&
          p.roleCommitment &&
          p.roleCommitment.toLowerCase() === commitmentHex.toLowerCase()
        )
        if (collidesWith) {
          const proceed = window.confirm(
            `Heads up: another player has already set the same Shield Password (${collidesWith.displayName}).\n\n` +
            `The contract will reject your submission. Pick a different password — or press OK to try anyway (the tx will revert and you'll pay gas).`
          )
          if (!proceed) {
            setCommitError('Choose a different Shield Password.')
            setCommitting(false)
            return
          }
        }
      }

      const proofResult = await proveRoleCommitment({ role, secret: secretBigInt, commitment })
      const proofBytes    = ('0x' + proofResult.proof.map((b: number) => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
      const client = getContractClient()!
      await client.submitRoleCommitment(address, BigInt(roomId), commitmentHex, proofBytes)
      setOptimisticCommitDone(true)
      setSecretPhrase('')
      socket?.emit('request_room_refresh', { roomId })
      toast.success('Shield Password set!')
      schedulePostTxRefresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Role commitment failed.'
      // AlreadyCommitted means a previous submission went through — treat as success
      if (msg.includes('AlreadyCommitted')) {
        setOptimisticCommitDone(true)
        setSecretPhrase('')
        socket?.emit('request_room_refresh', { roomId })
        schedulePostTxRefresh()
      } else {
        setCommitError(msg.split('\n')[0])
      }
    } finally {
      setCommitting(false)
    }
  }, [address, roomId, secretPhrase, schedulePostTxRefresh, socket, room])

  const handleStartGame = useCallback(async () => {
    if (!address || !roomId) return
    const client = getContractClient()
    if (!client) return
    setStarting(true)
    setStartError(null)
    try {
      await client.startGame(address, BigInt(roomId))
      socket?.emit('request_room_refresh', { roomId })
      schedulePostTxRefresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start game.'
      // Extract the human-readable revert reason if present (e.g. NotEnoughPlayers)
      const revert = (/Error:\s*(\w+\(\))/).exec(msg)?.[1] ?? msg.split('\n')[0]
      toast.error(`Start failed: ${revert}`)
      setStartError(revert)
    } finally {
      setStarting(false)
    }
  }, [address, roomId, schedulePostTxRefresh, socket])

  // ── Phase advance ticker — accelerates when timer is nearly expired ─────
  const nearPhaseEnd = room?.status === 'active' && headerCountdownMs <= 8_000 && headerCountdownMs > 0
  useEffect(() => {
    if (!socket || !roomId || room?.status !== 'active') return
    // Tick faster (1 s) in the last 8 seconds so transition feels instant.
    const interval = nearPhaseEnd ? 1_000 : 2_000
    const id = setInterval(() => {
      socket.emit('request_phase_advance', { roomId })
    }, interval)
    return () => clearInterval(id)
  }, [socket, roomId, room?.status, nearPhaseEnd])

  // When the local timer reaches zero, proactively request phase advancement
  // once per round+phase to avoid UI stalling until the next monitor tick.
  useEffect(() => {
    if (!socket || !roomId || room?.status !== 'active') return
    const key = `${round}:${phase}`
    if (headerCountdownMs > 0) {
      if (phaseAdvanceNudgeKeyRef.current === key) {
        phaseAdvanceNudgeKeyRef.current = ''
      }
      return
    }
    if (phaseAdvanceNudgeKeyRef.current === key) return
    if (phase !== 'discussion' && phase !== 'voting' && phase !== 'reveal') return

    phaseAdvanceNudgeKeyRef.current = key
    socket.emit('request_phase_advance', { roomId })
    socket.emit('request_room_refresh', { roomId })
    // Burst refresh: emit again after short delays to ensure propagation.
    const t1 = setTimeout(() => { socket.emit('request_phase_advance', { roomId }); socket.emit('request_room_refresh', { roomId }) }, 1_500)
    const t2 = setTimeout(() => { socket.emit('request_phase_advance', { roomId }); socket.emit('request_room_refresh', { roomId }) }, 3_500)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [socket, roomId, room?.status, headerCountdownMs, phase, round])

  // ── Periodic sync for waiting/starting rooms (pick up game-start quickly) ─
  useEffect(() => {
    if (!socket || !roomId) return
    const status = room?.status
    if (status !== 'waiting' && status !== 'starting') return
    const id = setInterval(() => {
      socket.emit('request_room_refresh', { roomId })
    }, 2_500)
    return () => clearInterval(id)
  }, [socket, roomId, room?.status])

  // ── Periodic full refresh — only when socket is offline ─────────────────
  useEffect(() => {
    if (!roomId || socketOn) return
    const id = setInterval(() => { refresh() }, 5_000)
    return () => clearInterval(id)
  }, [roomId, socketOn, refresh])

  // ── No roomId guard ─────────────────────────────────────────────────────
  if (!roomId) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6" style={{ backgroundColor: '#060b06', color: '#d4c9b2', backgroundImage: 'url(/images/bg-game.jpg)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <p className="font-mono text-lg" style={{ color: '#e63329' }}>No room specified.</p>
        <button onClick={() => router.push('/lobby')} className="rounded border px-6 py-3 font-mono text-sm uppercase tracking-wider" style={{ borderColor: '#39ff14', color: '#39ff14' }}>
          ← Back to Lobby
        </button>
      </main>
    )
  }

  // ── Room not found / initializing guard ─────────────────────────────────
  if (!isLoading && !room && error === 'Room not found.') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6" style={{ backgroundColor: '#060b06', color: '#d4c9b2', backgroundImage: 'url(/images/bg-game.jpg)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div className="fixed inset-0 pointer-events-none" style={{ backgroundColor: 'rgba(6,11,6,0.88)' }} />
        <div className="relative flex flex-col items-center gap-4 text-center px-8">
          <p className="font-display text-4xl" style={{ color: '#e63329' }}>Room Not Found</p>
          <p className="font-mono text-sm max-w-sm" style={{ color: '#8fa882' }}>
            The room may still be initializing on-chain, or the link may be incorrect. You can return to the lobby and join from there.
          </p>
          <div className="flex gap-3 mt-2">
            <button
              onClick={() => refresh()}
              className="rounded border px-5 py-2 font-mono text-sm uppercase tracking-wider transition-all hover:opacity-80"
              style={{ borderColor: '#39ff14', color: '#39ff14' }}
            >
              Retry
            </button>
            <button onClick={() => router.push('/lobby')} className="rounded border px-5 py-2 font-mono text-sm uppercase tracking-wider transition-all hover:opacity-80" style={{ borderColor: 'rgba(212,201,178,0.4)', color: '#d4c9b2' }}>
              ← Back to Lobby
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen" style={{ backgroundColor: '#060b06', color: '#d4c9b2', backgroundImage: 'url(/images/bg-game.jpg)', backgroundSize: 'cover', backgroundPosition: 'center top', backgroundAttachment: 'fixed' }}>
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundColor: 'rgba(6,11,6,0.88)', zIndex: 0 }} />
      <div className="relative game-tab-content" style={{ zIndex: 1 }}>
      {/* Nav */}
      <div className="px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="mx-auto w-full max-w-6xl">
          <SiteNav currentPath="/game" />
        </div>
      </div>

      {/* Game Header + Telemetry — visible on Game tab (mobile) or always (desktop) */}
      {showOnTab('game') && (
      <>
      <header
        className="relative overflow-hidden px-6 py-12"
        style={{ borderBottom: '1px solid rgba(57,255,20,0.2)' }}
      >
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute left-1/4 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full opacity-10 blur-3xl" style={{ backgroundColor: '#39ff14' }} />
          <div className="absolute right-1/3 top-1/2 h-48 w-48 -translate-y-1/2 rounded-full opacity-10 blur-3xl" style={{ backgroundColor: '#cc1414' }} />
        </div>

        <div className="relative mx-auto w-full max-w-6xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Room name — prominent display */}
            <div className="flex flex-col gap-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: '#4a5e44' }}>Room</p>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="font-display text-lg sm:text-2xl leading-none"
                  style={{ color: '#e63329', textShadow: '0 0 12px rgba(230,51,41,0.4)' }}
                >
                  {room?.name ? room.name : `Room #${roomId}`}
                </span>
                {isHost && !room?.name && room?.status !== 'ended' && (
                  <button
                    onClick={() => setRoomNameEditing(true)}
                    className="rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest transition-all hover:brightness-125 active:scale-95"
                    style={{ borderColor: 'rgba(57,255,20,0.5)', color: '#39ff14', backgroundColor: 'rgba(57,255,20,0.08)' }}
                  >
                    + Set name
                  </button>
                )}
              </div>
              {room?.name && (
                <span className="font-mono text-[10px]" style={{ color: '#4a5e44' }}>#{roomId}</span>
              )}
              {roomNameEditing && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault()
                    const trimmed = pendingRoomName.trim()
                    if (!trimmed) { setRoomNameEditing(false); return }
                    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
                    try {
                      const res = await fetch(`${backendUrl}/api/rooms/${roomId}/name`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: trimmed }),
                      })
                      if (res.status === 409) {
                        toast.error(`"${trimmed}" is already taken by another active room.`)
                        return
                      }
                      if (!res.ok) {
                        toast.error(`Could not save room name. (${res.status})`)
                        return
                      }
                      setRoomNameEditing(false)
                      setPendingRoomName('')
                      refresh()
                    } catch (err) {
                      toast.error(`Failed to save name: ${err instanceof Error ? err.message : String(err)}`)
                    }
                  }}
                  className="mt-1 flex items-center gap-2"
                >
                  <input
                    autoFocus
                    type="text"
                    maxLength={40}
                    placeholder="Room name"
                    value={pendingRoomName}
                    onChange={(e) => setPendingRoomName(e.target.value)}
                    className="rounded-lg border bg-transparent px-3 py-1.5 font-mono text-xs focus:outline-none"
                    style={{ borderColor: 'rgba(57,255,20,0.4)', color: '#d4c9b2' }}
                  />
                  <button
                    type="submit"
                    className="rounded border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest transition-all hover:brightness-125 active:scale-95"
                    style={{ borderColor: '#39ff14', color: '#39ff14', backgroundColor: 'rgba(57,255,20,0.12)' }}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRoomNameEditing(false); setPendingRoomName('') }}
                    className="rounded border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest transition-all hover:brightness-125 active:scale-95"
                    style={{ borderColor: '#4a5e44', color: '#4a5e44' }}
                  >
                    Cancel
                  </button>
                </form>
              )}
            </div>
            <span
              className="rounded border px-3 py-1 font-mono text-xs uppercase tracking-[0.2em]"
              style={{ borderColor: `${PHASE_COLOR[phase]}44`, backgroundColor: `${PHASE_COLOR[phase]}18`, color: PHASE_COLOR[phase] }}
            >
              {PHASE_LABEL[phase]} phase
            </span>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-6">
            <h1 className="font-display text-4xl font-bold leading-none sm:text-7xl md:text-8xl" style={{ color: '#d4c9b2' }}>
              {headerTitle}
            </h1>
            {headerCountdownMs > 0 && (
              <div
                className="flex flex-col items-center rounded-xl border px-5 py-3 sm:px-10 sm:py-4"
                style={{ borderColor: 'rgba(57,255,20,0.45)', backgroundColor: 'rgba(57,255,20,0.06)' }}
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: '#4a5e44' }}>Time Left</p>
                <p className="mt-1 font-display text-3xl sm:text-6xl font-bold leading-none tabular-nums" style={{ color: '#39ff14', textShadow: '0 0 20px rgba(57,255,20,0.5)' }}>
                  {formatCountdown(headerCountdownMs)}
                </p>
              </div>
            )}
          </div>

          {isPhaseSyncing && (
            <div
              className="mt-4 inline-flex flex-wrap items-center gap-3 rounded border px-3 py-2 font-mono text-xs uppercase tracking-[0.16em]"
              style={{ borderColor: 'rgba(245,197,24,0.4)', backgroundColor: 'rgba(245,197,24,0.08)', color: '#f5c518' }}
            >
              <span>Syncing next phase on-chain{'.'.repeat(1 + Math.floor((syncWaitMs / 500) % 3))}</span>
              {syncWaitMs >= 12_000 && (
                <button
                  onClick={() => refresh()}
                  className="rounded border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest transition-all hover:brightness-125 active:scale-95"
                  style={{ borderColor: '#f5c518', color: '#f5c518', backgroundColor: 'rgba(245,197,24,0.14)' }}
                >
                  ↺ Retry
                </button>
              )}
            </div>
          )}

          {/* Connection status + player identity */}
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`inline-block h-2 w-2 rounded-full ${socketOn ? 'bg-green-400' : 'bg-yellow-400'}`} />
              <span className="font-mono text-xs" style={{ color: '#4a5e44' }}>
                {socketOn ? 'Live · backend connected' : 'On-chain read-only'}
              </span>
              <button
                onClick={() => refresh()}
                disabled={isLoading}
                title="Fetch latest state from chain"
                className="ml-1 rounded border px-3 py-1 font-mono text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-40 hover:brightness-125 active:scale-95"
                style={{ borderColor: '#39ff14', color: '#39ff14', backgroundColor: 'rgba(57,255,20,0.08)', boxShadow: '0 0 6px rgba(57,255,20,0.35)' }}
              >
                {isLoading ? '…' : '↺ Sync'}
              </button>
              {error && <span className="font-mono text-xs" style={{ color: '#e63329' }}>{error}</span>}
              {/* Prominent player identity badge */}
              {localPlayer && (
                <span
                  className="ml-auto rounded-lg border px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-[0.18em]"
                  style={{
                    borderColor: 'rgba(57,255,20,0.6)',
                    backgroundColor: 'rgba(57,255,20,0.12)',
                    color: '#39ff14',
                    boxShadow: '0 0 10px rgba(57,255,20,0.2)',
                  }}
                >
                  You: <span style={{ color: '#d4c9b2' }}>{localPlayer.displayName}</span>
                </span>
              )}
            </div>
            <p className="font-mono text-xs font-medium tracking-wide" style={{ color: '#8fa882' }}>
              Tap ↺ Sync periodically to get the latest game state.
            </p>
          </div>
        </div>
      </header>

      {/* Telemetry Strip */}
      <div className="px-6 pt-8">
        <div className="mx-auto w-full max-w-6xl">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            {[
              { label: 'POT',          value: `${potCUSD} cUSD`, accent: '#f5c518' },
              { label: 'INFECTED',     value: `${infectedCount} / ${activePlayers.length}`, accent: '#e63329' },
              { label: 'SHIELD WINDOW', value: phase === 'discussion' ? 'OPEN' : 'CLOSED', accent: '#39ff14' },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rise-in rounded-lg border p-4 text-center"
                style={{ backgroundColor: '#0a100a', borderColor: `${stat.accent}33` }}
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>{stat.label}</p>
                <p className="mt-2 font-display text-xl sm:text-3xl leading-none" style={{ color: stat.accent }}>{stat.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      </>
      )}

      {/* Main Board */}
      <div className="px-6 py-8">
        <div className="mx-auto w-full max-w-6xl">
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">

            {/* ── LEFT COLUMN ── */}
            <div className="flex flex-col gap-6">

              {/* Phase card — Game tab (mobile) / always (desktop) */}
              {showOnTab('game') && (
                <div
                  className="rise-in rounded-lg border p-5"
                  style={{ backgroundColor: phaseCardBackground, borderColor: `${PHASE_COLOR[phase]}4d` }}
                >
                  {/* Round phase sequence indicator */}
                  {room?.status === 'active' && (
                    <div className="mb-4 flex items-center gap-1 flex-wrap">
                      {((['infection', 'discussion', 'voting', 'reveal'] as RoundPhase[])).map((p, i) => {
                        const phases: RoundPhase[] = ['infection', 'discussion', 'voting', 'reveal']
                        const currentIdx = phases.indexOf(phase)
                        const thisIdx = i
                        const isCurrent = p === phase
                        const isPast = thisIdx < currentIdx
                        const shortLabel: Record<string, string> = { infection: 'INFECT', discussion: 'DISCUSS', voting: 'VOTE', reveal: 'ELIMINATE' }
                        return (
                          <span key={p} className="flex items-center gap-1">
                            <span
                              className="font-mono text-[9px] uppercase tracking-[0.12em]"
                              style={{
                                color: isCurrent ? PHASE_COLOR[phase] : isPast ? '#2a3a24' : '#2a3a24',
                                fontWeight: isCurrent ? 700 : 400,
                                textDecoration: isPast ? 'line-through' : 'none',
                              }}
                            >
                              {shortLabel[p]}
                            </span>
                            {i < 3 && <span className="font-mono text-[9px]" style={{ color: '#2a3a24' }}>→</span>}
                          </span>
                        )
                      })}
                    </div>
                  )}
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>Current Phase</p>
                  <p className="mt-2 font-display text-3xl leading-none" style={{ color: PHASE_COLOR[phase] }}>{PHASE_LABEL[phase]}</p>
                  <p className="mt-3 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>{phaseCardDescription}</p>
                  {localPlayer?.isEliminated && (
                    <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: '#4a5e44' }}>⊘ You have been eliminated — spectator only.</p>
                  )}
                  {!localPlayer?.isEliminated && localPlayer?.status === 'infected' && (
                    <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: '#e63329' }}>
                      {localPlayer.role === 'patient_zero' ? '☣ You are Patient Zero' : '⚠ You are Infected'}
                    </p>
                  )}
                  {isSpectator && (
                    <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: '#f5c518' }}>👁 Spectator mode — observe only.</p>
                  )}
                </div>
              )}

              {/* Containment Board — Board tab (mobile) / always (desktop) */}
              {showOnTab('board') && (
                <article className="rise-in rounded-lg border p-6" style={{ backgroundColor: '#0a100a', borderColor: 'rgba(57,255,20,0.2)' }}>
                  <div className="flex items-center justify-between gap-4">
                    <h2 className="font-display text-2xl leading-none" style={{ color: '#d4c9b2' }}>Area 51</h2>
                    <span className="rounded border px-3 py-1 font-mono text-xs uppercase tracking-[0.18em]" style={{ borderColor: 'rgba(57,255,20,0.35)', color: '#39ff14', backgroundColor: 'rgba(57,255,20,0.1)' }}>
                      {activePlayers.length} alive
                    </span>
                  </div>
                  <div className="mt-6 rounded-lg border p-5" style={{ backgroundColor: '#0c1309', borderColor: 'rgba(57,255,20,0.15)' }}>
                    {playersPanelBody}
                  </div>
                  {localPlayer?.isEliminated && (
                    <div className="mt-5 rounded-lg border p-5" style={{ borderColor: 'rgba(74,94,68,0.5)', backgroundColor: 'rgba(74,94,68,0.1)' }}>
                      <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>⊘ YOU HAVE BEEN ELIMINATED</p>
                      <p className="mt-2 font-mono text-xs" style={{ color: '#4a5e44' }}>You can observe but can no longer vote or submit proofs.</p>
                    </div>
                  )}
                  {!localPlayer?.isEliminated && localPlayer?.status === 'infected' && (
                    <div className="mt-5 rounded-lg border p-5" style={{ borderColor: 'rgba(230,51,41,0.6)', backgroundColor: 'rgba(230,51,41,0.12)' }}>
                      <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#e63329' }}>
                        {localPlayer.role === 'patient_zero' ? '☣ YOU ARE PATIENT ZERO' : '⚠ YOU HAVE BEEN INFECTED'}
                      </p>
                      <p className="mt-2 font-mono text-xs" style={{ color: '#ff6b6b' }}>
                        {localPlayer.role === 'patient_zero'
                          ? 'The infected depends on you. Lead the infected faction to parity.'
                          : 'Spread the plague. Avoid suspicion. Infected players cannot submit innocence proofs.'}
                      </p>
                    </div>
                  )}
                  {isSpectator && (
                    <div className="mt-5 rounded-lg border p-5" style={{ borderColor: 'rgba(245,197,24,0.45)', backgroundColor: 'rgba(245,197,24,0.07)' }}>
                      <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#f5c518' }}>👁 SPECTATOR MODE</p>
                      <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
                        This game was already in progress when you arrived. You can watch but cannot vote, prove innocence, or affect the outcome.
                      </p>
                    </div>
                  )}
                  {localPlayer && (
                    <p className="mt-4 font-mono text-xs" style={{ color: '#4a5e44' }}>
                      You: {localPlayer.displayName}{localPlayer.role !== 'unknown' ? ` · ${localPlayer.role}` : ''}
                    </p>
                  )}
                </article>
              )}

              {/* Action panels — Game tab (mobile) / always (desktop) */}
              {showOnTab('game') && (
                <>
                  {room?.status === 'waiting' && isHost && (
                    <div className="rise-in rounded-lg border p-5" style={{ borderColor: 'rgba(245,197,24,0.4)', backgroundColor: 'rgba(245,197,24,0.08)' }}>
                      <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#f5c518' }}>Host Controls</p>
                      <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>{hostPlayerCountLabel}</p>
                      {startError && <p className="mt-2 font-mono text-xs" style={{ color: '#e63329' }}>{startError}</p>}
                      <button
                        onClick={handleStartGame}
                        disabled={starting || totalPlayers < (room?.minPlayers ?? 3)}
                        className="mt-3 w-full rounded border py-2 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-40"
                        style={{ backgroundColor: '#f5c518', borderColor: '#f5c518', color: '#060b06' }}
                      >
                        {starting ? 'Starting…' : 'Start Game'}
                      </button>
                      {totalPlayers < (room?.minPlayers ?? 3) && (
                        <p className="mt-2 font-mono text-xs" style={{ color: '#4a5e44' }}>Need at least {room?.minPlayers ?? 3} players to start.</p>
                      )}
                    </div>
                  )}

                  {room?.status === 'starting' && (
                    <div className="rise-in rounded-lg border p-5" style={{ borderColor: 'rgba(57,255,20,0.35)', backgroundColor: 'rgba(57,255,20,0.08)' }}>
                      <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#39ff14' }}>Set Shield Password</p>
                      {commitDone ? (
                        <p className="mt-3 font-mono text-xs" style={{ color: '#39ff14' }}>✓ Shield Password set. Waiting for all players…</p>
                      ) : (
                        <>
                          <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
                            Enter your Shield Password. Keep it secret — you&apos;ll need it to activate your Shield later.
                          </p>
                          <p className="mt-1 font-mono text-[11px]" style={{ color: '#84cc16' }}>
                            Password deadline: {formatCountdown(Math.max(0, startCommitEndsAt - now))}
                          </p>
                          <input
                            type="password"
                            placeholder="My Shield Password…"
                            value={secretPhrase}
                            onChange={e => setSecretPhrase(e.target.value)}
                            className="mt-3 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm focus:outline-none"
                            style={{ borderColor: 'rgba(57,255,20,0.4)', color: '#d4c9b2' }}
                          />
                          {commitError && <p className="mt-2 font-mono text-xs" style={{ color: '#e63329' }}>{commitError}</p>}
                          <button
                            onClick={handleCommitRole}
                            disabled={!canCommit || !secretPhrase || committing}
                            className="mt-3 w-full rounded border py-2 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-40"
                            style={{ backgroundColor: '#39ff14', borderColor: '#39ff14', color: '#060b06' }}
                          >
                            {committing ? 'Activating Shield…' : 'Set Shield Password'}
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {phase === 'discussion' && !!localPlayer && !localPlayer.isEliminated && localPlayer.status !== 'infected' && !hasProofThisRound && (
                    <div className="rise-in rounded-lg border p-5" style={{ borderColor: 'rgba(57,255,20,0.35)', backgroundColor: 'rgba(57,255,20,0.08)' }}>
                      <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#39ff14' }}>Activate Shield</p>
                      <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
                        Activate your Shield to prove innocence before voting opens. Your first Shield activation is free.
                        {localPlayer?.freeProofUsed && ' (Free activation used — fee will be charged.)'}
                      </p>
                      <input
                        type="password"
                        placeholder="Your Shield Password…"
                        value={secretPhrase}
                        onChange={e => setSecretPhrase(e.target.value)}
                        className="mt-3 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm focus:outline-none"
                        style={{ borderColor: 'rgba(57,255,20,0.4)', color: '#d4c9b2' }}
                      />
                      {proofError && <p className="mt-2 font-mono text-xs" style={{ color: '#e63329' }}>{proofError}</p>}
                      <button
                        onClick={handleSubmitProof}
                        disabled={!canProve || !secretPhrase || proving}
                        className="mt-3 w-full rounded border py-2 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-40"
                        style={{ backgroundColor: '#39ff14', borderColor: '#39ff14', color: '#060b06' }}
                      >
                        {proving ? 'Activating Shield…' : 'Activate Shield'}
                      </button>
                    </div>
                  )}

                  {phase === 'discussion' && hasProofThisRound && (
                    <p className="font-mono text-xs" style={{ color: '#84cc16' }}>✓ Shield activated on-chain.</p>
                  )}

                  {result && (
                    <article className="rise-in rounded-lg border p-6" style={{ backgroundColor: '#0a100a', borderColor: 'rgba(132,204,22,0.3)' }}>
                      <h3 className="font-display text-2xl" style={{ color: '#84cc16' }}>GAME OVER</h3>
                      <p className="mt-2 font-display text-4xl" style={{ color: '#f5c518' }}>{getResultLabel(result.outcome)}</p>
                      <p className="mt-3 font-mono text-sm" style={{ color: '#8fa882' }}>Pot per winner: {potPerWinnerDisplay} cUSD</p>
                      <p className="mt-1 font-mono text-xs" style={{ color: '#4a5e44' }}>
                        Winners: {result.winners.map(w => {
                          const p = room?.players?.find(pl => pl.walletAddress.toLowerCase() === w.toLowerCase())
                          return p?.displayName ?? `${w.slice(0, 6)}…`
                        }).join(', ') || '—'}
                      </p>
                    </article>
                  )}
                </>
              )}

              {/* Live Feed — Feed tab (mobile) / always (desktop) */}
              {showOnTab('feed') && (
                <div className="rise-in rounded-lg border p-5" style={{ backgroundColor: '#0a100a', borderColor: 'rgba(57,255,20,0.15)' }}>
                  <p className="font-mono text-xs uppercase tracking-[0.2em] mb-3" style={{ color: '#39ff14' }}>Live Feed</p>
                  <ul
                    className="space-y-2 font-mono text-xs overflow-y-auto"
                    style={{ color: '#8fa882', maxHeight: isMobile ? 'calc(100vh - 260px)' : '24rem', scrollbarWidth: 'thin' }}
                  >
                    {synchronizedFeed.length > 0 ? synchronizedFeed.map((msg, i) => (
                      <li key={`${msg}-${i}`} className="flex gap-2">
                        <span style={{ color: '#4a5e44' }}>→</span> {msg}
                      </li>
                    )) : (
                      <li style={{ color: '#4a5e44' }}>No recent events yet.</li>
                    )}
                  </ul>
                </div>
              )}

            </div>

            {/* ── RIGHT SIDEBAR ── */}
            <aside className="flex flex-col gap-6">

              {/* Vote Panel — Board tab (mobile) / always (desktop) */}
              {showOnTab('board') && (
                <div className="rise-in rounded-lg border p-6" style={{ backgroundColor: '#0a100a', borderColor: 'rgba(230,51,41,0.25)', animationDelay: '80ms' }}>
                  <h3 className="font-display text-xl leading-none" style={{ color: '#d4c9b2' }}>Vote Panel</h3>
                  <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em]" style={{ color: '#4a5e44' }}>{votePanelLabel}</p>

                  {phase === 'voting' && hasVoted && (
                    <div className="mt-4 rounded-lg border p-3" style={{ borderColor: 'rgba(57,255,20,0.3)', backgroundColor: 'rgba(57,255,20,0.06)' }}>
                      <p className="font-mono text-xs" style={{ color: '#39ff14' }}>✓ Your vote has been recorded.</p>
                      {myVotedTarget && (
                        <p className="mt-1 font-mono text-xs" style={{ color: '#8fa882' }}>
                          You voted for{' '}
                          <span style={{ color: '#f5c518' }}>
                            {room?.players?.find(p => p.walletAddress.toLowerCase() === myVotedTarget.toLowerCase())?.displayName ?? `${myVotedTarget.slice(0, 6)}…`}
                          </span>
                        </p>
                      )}
                    </div>
                  )}

                  {phase === 'voting' && canVote && (
                    <div className="mt-4 space-y-2">
                      {activePlayers
                        .filter(p => p.walletAddress !== address)
                        .map((p) => (
                          <button
                            key={p.walletAddress}
                            onClick={() => setSelectedVote(p.walletAddress === selectedVote ? null : p.walletAddress)}
                            className="flex w-full items-center justify-between rounded-lg border px-4 py-3 font-mono text-sm uppercase tracking-[0.12em] transition-all hover:opacity-90"
                            style={{
                              borderColor: selectedVote === p.walletAddress ? '#f5c518' : 'rgba(230,51,41,0.35)',
                              backgroundColor: selectedVote === p.walletAddress ? 'rgba(245,197,24,0.1)' : 'rgba(230,51,41,0.1)',
                              color: '#d4c9b2',
                            }}
                          >
                            <span>{p.displayName}</span>
                            {voteTally[p.walletAddress] ? (
                              <span className="rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: 'rgba(230,51,41,0.25)', color: '#ff6b6b' }}>
                                {voteTally[p.walletAddress]}
                              </span>
                            ) : null}
                          </button>
                        ))}
                      {voteError && <p className="font-mono text-xs" style={{ color: '#e63329' }}>{voteError}</p>}
                      <button
                        onClick={handleCastVote}
                        disabled={!selectedVote || voting || !canVote}
                        className="mt-2 w-full rounded border py-2 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-40"
                        style={{ backgroundColor: '#e63329', borderColor: '#e63329', color: '#d4c9b2' }}
                      >
                        {voting ? 'Submitting…' : 'Cast Vote'}
                      </button>
                    </div>
                  )}

                  {phase === 'voting' && !canVote && !hasVoted && (
                    <p className="mt-4 font-mono text-xs" style={{ color: '#8fa882' }}>Voting is available only to alive room participants.</p>
                  )}

                  {phase !== 'voting' && currentRound?.votes.length ? (
                    <div className="mt-4 space-y-1">
                      {Object.entries(voteTally)
                        .sort(([, a], [, b]) => b - a)
                        .map(([addr, cnt]) => {
                          const name = room?.players?.find(p => p.walletAddress.toLowerCase() === addr.toLowerCase())?.displayName ?? `${addr.slice(0, 8)}…`
                          return (
                            <div key={addr} className="flex justify-between font-mono text-xs" style={{ color: '#8fa882' }}>
                              <span>{name}</span>
                              <span style={{ color: '#ff6b6b' }}>{cnt} vote{cnt === 1 ? '' : 's'}</span>
                            </div>
                          )
                        })}
                    </div>
                  ) : null}
                </div>
              )}

              {/* Chat — Chat tab (mobile) / always (desktop) */}
              {showOnTab('chat') && (
                <div
                  className="rise-in rounded-lg border p-4 flex flex-col"
                  style={{
                    backgroundColor: '#0a100a',
                    borderColor: 'rgba(57,255,20,0.15)',
                    animationDelay: '160ms',
                    ...(isMobile ? { height: 'calc(100svh - 180px)', maxHeight: 'calc(100svh - 180px)' } : {}),
                  }}
                >
                  <p className="font-mono text-xs uppercase tracking-[0.2em] flex-shrink-0" style={{ color: '#39ff14' }}>Room Chat</p>
                  <div
                    className="mt-3 overflow-y-auto space-y-2 pr-1 flex-1 min-h-0"
                    style={{ height: isMobile ? undefined : '16rem', scrollbarWidth: 'thin' }}
                  >
                    {chatMessages.length === 0 ? (
                      <p className="font-mono text-[11px]" style={{ color: '#4a5e44' }}>No messages yet…</p>
                    ) : (
                      chatMessages.map((m, i) => (
                        <div key={`${m.timestamp}-${m.sender}-${i}`} className="font-mono text-[11px] leading-snug break-words">
                          <span style={{ color: m.sender.toLowerCase() === address?.toLowerCase() ? '#39ff14' : '#f5c518' }}>
                            {m.displayName}
                          </span>
                          <span style={{ color: '#4a5e44' }}>: </span>
                          <span style={{ color: '#d4c9b2' }}>{m.message}</span>
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
                      onKeyDown={e => { if (e.key === 'Enter') handleSendChat() }}
                      disabled={!canChat}
                      className="flex-1 rounded border bg-transparent px-3 py-1.5 font-mono text-xs focus:outline-none"
                      style={{ borderColor: 'rgba(57,255,20,0.3)', color: '#d4c9b2' }}
                    />
                    <button
                      onClick={handleSendChat}
                      disabled={!chatInput.trim() || !canChat}
                      className="rounded border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-40"
                      style={{ borderColor: '#39ff14', color: '#39ff14' }}
                    >
                      Send
                    </button>
                  </div>
                  {chatBlockedReason && (
                    <p className="mt-2 font-mono text-[11px]" style={{ color: '#f5c518' }}>{chatBlockedReason}</p>
                  )}
                </div>
              )}

              {/* Back to Lobby — Feed tab (mobile) / always (desktop) */}
              {showOnTab('feed') && (
                <Link
                  href="/lobby"
                  className="rise-in rounded-lg border py-4 text-center font-mono text-sm uppercase tracking-[0.18em] transition-all hover:opacity-90"
                  style={{ borderColor: 'rgba(57,255,20,0.35)', backgroundColor: 'rgba(57,255,20,0.08)', color: '#39ff14', display: 'block', animationDelay: '300ms' }}
                >
                  ← Back to Lobby
                </Link>
              )}

            </aside>
          </div>
        </div>
      </div>
      </div>

      {/* Mobile floating countdown chip — visible across all tabs */}
      {isMobile && headerCountdownMs > 0 && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-xs font-bold tabular-nums shadow-lg"
          style={{
            bottom: 'calc(60px + env(safe-area-inset-bottom, 0px) + 8px)',
            borderColor: 'rgba(57,255,20,0.55)',
            backgroundColor: 'rgba(6,11,6,0.92)',
            color: '#39ff14',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            textShadow: '0 0 8px rgba(57,255,20,0.5)',
          }}
        >
          <span className="text-[9px] font-normal uppercase tracking-[0.18em]" style={{ color: '#4a5e44' }}>
            {PHASE_LABEL[phase]}
          </span>
          <span>{formatCountdown(headerCountdownMs)}</span>
        </div>
      )}

      {/* Mobile Tab Bar */}
      {isMobile && (
        <GameTabNav activeTab={activeTab} onTabChange={handleTabChange} unreadChat={unreadChat} />
      )}
    </main>
  )
}

function getContractClient() {
  const network = (process.env.NEXT_PUBLIC_NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
  const addr    = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}` | undefined
  if (!addr) return null
  return createContractClient({ contractAddress: addr, network })
}

export default function GamePage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#060b06' }}>
        <p className="font-mono text-sm" style={{ color: '#4a5e44' }}>Loading game…</p>
      </main>
    }>
      <GamePageInner />
    </Suspense>
  )
}

