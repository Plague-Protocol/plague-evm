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
import type { RoundPhase } from '@/types/game'
import { toast } from 'sonner'

export const dynamic = 'force-dynamic'

// ── Phase display helpers ─────────────────────────────────────────────────────

const PHASE_LABEL: Record<RoundPhase, string> = {
  infection:  'INFECTION',
  discussion: 'DISCUSS',
  voting:     'VOTING',
  reveal:     'REVEAL',
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

// ── Contract error → user message ─────────────────────────────────────────────

const CONTRACT_ERROR_MAP: Record<string, string> = {
  NotAlive:              'You are no longer alive in this game and cannot take this action.',
  WrongPhase:            'This action is not available in the current phase.',
  AlreadyVoted:          'You have already voted this round.',
  AlreadyProvedThisRound:'You have already submitted an innocence proof this round.',
  NullifierUsed:         'This proof nullifier has already been used. Try a different secret.',
  InvalidProof:          'ZK proof verification failed. Check your secret phrase and try again.',
  NotParticipant:        'You are not a participant in this room.',
  AlreadyCommitted:      'You have already committed your role.',
  NotActive:             'The game is not currently active.',
  NotEnoughPlayers:      'Not enough players to perform this action.',
  InvalidInfectionTarget:'Invalid infection target.',
}

function parseContractError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  for (const [name, friendly] of Object.entries(CONTRACT_ERROR_MAP)) {
    if (msg.includes(name)) return friendly
  }
  return msg.split('\n')[0]
}

// ── Inner component (uses hooks that need Suspense) ───────────────────────────

function GamePageInner() {
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

  // ── Vote state ───────────────────────────────────────────────────────────
  const [selectedVote, setSelectedVote]           = useState<string | null>(null)
  const [voting, setVoting]                       = useState(false)
  const [voteError, setVoteError]                 = useState<string | null>(null)
  const [optimisticVotedFor, setOptimisticVotedFor] = useState<string | null>(null)

  // ── Proof submission state ───────────────────────────────────────────────
  const [proving, setProving]       = useState(false)
  const [proofError, setProofError] = useState<string | null>(null)

  // ── Role commitment state (during Starting phase) ────────────────────────
  const [committing, setCommitting]         = useState(false)
  const [commitError, setCommitError]       = useState<string | null>(null)
  const [secretPhrase, setSecretPhrase]     = useState('')

  // ── Start game state (host only, Waiting phase) ──────────────────────────
  const [starting, setStarting]         = useState(false)
  const [startError, setStartError]     = useState<string | null>(null)

  // ── Chat state ───────────────────────────────────────────────────────────
  type ChatMsg = { sender: string; displayName: string; message: string; timestamp: number }
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput]       = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  // ── Derived ──────────────────────────────────────────────────────────────
  const phase       = currentRound?.phase ?? 'ended'
  const round       = currentRound?.number ?? 0
  const activePlayers = room?.players?.filter(p => !p.isEliminated) ?? []
  const totalPlayers  = room?.players?.length ?? 0
  const infectedCount = room?.players?.filter(p => p.status === 'infected' && !p.isEliminated).length ?? 0
  const potCUSD       = room ? (Number(room.stakeAmount) * totalPlayers / 1e18).toFixed(2) : '—'
  const hasVoted      = Boolean(optimisticVotedFor || localPlayer?.hasVotedThisRound)
  const myVotedTarget = optimisticVotedFor ?? localPlayer?.voteTarget
  const hasProofThisRound = Boolean(localPlayer?.hasProofThisRound)
  const commitDone = Boolean(localPlayer?.roleCommitted)
  const canVote       = phase === 'voting' && isConnected && !!localPlayer && !localPlayer.isEliminated && !hasVoted && !voting
  const canProve      = phase === 'discussion' && isConnected && !!localPlayer && !localPlayer.isEliminated && localPlayer.status !== 'infected' && !hasProofThisRound
  const canCommit     = room?.status === 'starting' && isConnected && !!localPlayer && !committing && !commitDone
  const isHost        = !!address && room?.hostAddress?.toLowerCase() === address.toLowerCase()
  // Spectator: wallet connected but address not in players list (late viewer)
  const isSpectator   = !!address && !!room && room.status === 'active' && !room.players.some(p => p.walletAddress.toLowerCase() === address.toLowerCase())

  // ── Soundscape ───────────────────────────────────────────────────────────
  const { muted } = useSound()
  const soundScene = room?.status === 'ended' ? 'ended' : (phase as RoundPhase)
  useSoundscape(soundScene, muted)

  // Reset optimistic vote when round changes
  const roundNumber = currentRound?.number ?? 0
  useEffect(() => { setOptimisticVotedFor(null) }, [roundNumber])

  // If the room ended but live socket events were missed (result is still null),
  // do a chain read so the game-over overlay is populated correctly.
  useEffect(() => {
    if (room?.status === 'ended' && !result) refresh()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.status])

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
    }
    const historyHandler = (history: { sender: string; displayName: string; message: string; timestamp: number }[]) => {
      setChatMessages(history.slice(-200))
    }
    socket.on('chat_message', msgHandler)
    socket.on('chat_history', historyHandler)
    return () => {
      socket.off('chat_message', msgHandler)
      socket.off('chat_history', historyHandler)
    }
  }, [socket])

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const handleSendChat = useCallback(() => {
    if (!chatInput.trim() || !socket || !address || !roomId) return
    const displayName = room?.players?.find(p => p.walletAddress.toLowerCase() === address.toLowerCase())?.displayName
      ?? `${address.slice(0, 6)}…${address.slice(-4)}`
    socket.emit('chat_message', { roomId, message: chatInput.trim(), playerAddress: address, displayName })
    setChatInput('')
  }, [chatInput, socket, address, roomId, room])

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

      const nullifierHex = `0x${nullifier.toString(16).padStart(64, '0')}` as `0x${string}`
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
      toast.success('Innocence proof submitted!')
      refresh()
    } catch (err) {
      const msg = parseContractError(err)
      setProofError(msg)
      toast.error(msg)
    } finally {
      setProving(false)
    }
  }, [address, roomId, secretPhrase, round, localPlayer, room, chainId, socket, refresh])

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
      const proofResult = await proveRoleCommitment({ role, secret: secretBigInt, commitment })
      const commitmentHex = commitment.startsWith('0x') ? commitment as `0x${string}` : `0x${commitment}` as `0x${string}`
      const proofBytes    = ('0x' + proofResult.proof.map((b: number) => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
      const client = getContractClient()!
      await client.submitRoleCommitment(address, BigInt(roomId), commitmentHex, proofBytes)
      setSecretPhrase('')
      socket?.emit('request_room_refresh', { roomId })
      toast.success('Role committed!')
      refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Role commitment failed.'
      // AlreadyCommitted means a previous submission went through — treat as success
      if (msg.includes('AlreadyCommitted')) {
        setSecretPhrase('')
        socket?.emit('request_room_refresh', { roomId })
        refresh()
      } else {
        setCommitError(msg.split('\n')[0])
      }
    } finally {
      setCommitting(false)
    }
  }, [address, roomId, secretPhrase, refresh, socket])

  const handleStartGame = useCallback(async () => {
    if (!address || !roomId) return
    const client = getContractClient()
    if (!client) return
    setStarting(true)
    setStartError(null)
    try {
      await client.startGame(address, BigInt(roomId))
      refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start game.'
      // Extract the human-readable revert reason if present (e.g. NotEnoughPlayers)
      const revert = (/Error:\s*(\w+\(\))/).exec(msg)?.[1] ?? msg.split('\n')[0]
      toast.error(`Start failed: ${revert}`)
      setStartError(revert)
    } finally {
      setStarting(false)
    }
  }, [address, roomId, refresh])

  // ── Phase advance ticker ─────────────────────────────────────────────────
  useEffect(() => {
    if (!socket || !roomId || room?.status !== 'active') return
    const id = setInterval(() => {
      socket.emit('request_phase_advance', { roomId })
    }, 10_000)
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
      <div className="relative" style={{ zIndex: 1 }}>
      {/* Nav */}
      <div className="px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="mx-auto w-full max-w-6xl">
          <SiteNav currentPath="/game" />
        </div>
      </div>

      {/* Game Header */}
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
            <span
              className="rounded border px-3 py-1 font-mono text-xs uppercase tracking-[0.25em]"
              style={{ borderColor: 'rgba(230,51,41,0.5)', backgroundColor: 'rgba(230,51,41,0.12)', color: '#e63329' }}
            >
              Room #{roomId}
            </span>
            <span
              className="rounded border px-3 py-1 font-mono text-xs uppercase tracking-[0.2em]"
              style={{ borderColor: `${PHASE_COLOR[phase]}44`, backgroundColor: `${PHASE_COLOR[phase]}18`, color: PHASE_COLOR[phase] }}
            >
              {PHASE_LABEL[phase]} phase
            </span>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-6">
            <h1 className="font-display text-7xl font-bold leading-none sm:text-8xl" style={{ color: '#d4c9b2' }}>
              {isLoading ? 'LOADING…' : round > 0 ? `ROUND ${round}` : room?.status === 'waiting' ? 'WAITING' : room?.status === 'ended' ? 'ENDED' : 'STARTING'}
            </h1>
            {phaseEndsAt > 0 && (
              <div
                className="flex flex-col items-center rounded-xl border px-10 py-4"
                style={{ borderColor: 'rgba(57,255,20,0.45)', backgroundColor: 'rgba(57,255,20,0.06)' }}
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: '#4a5e44' }}>Time Left</p>
                <p className="mt-1 font-display text-6xl font-bold leading-none tabular-nums" style={{ color: '#39ff14', textShadow: '0 0 20px rgba(57,255,20,0.5)' }}>
                  {formatCountdown(msLeft)}
                </p>
              </div>
            )}
          </div>

          {/* Connection status */}
          <div className="mt-3 flex items-center gap-3">
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
          </div>
        </div>
      </header>

      {/* Telemetry Strip */}
      <div className="px-6 pt-8">
        <div className="mx-auto w-full max-w-6xl">
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'POT',          value: `${potCUSD} cUSD`, accent: '#f5c518' },
              { label: 'INFECTED',     value: `${infectedCount} / ${activePlayers.length}`, accent: '#e63329' },
              { label: 'PROOF WINDOW', value: phase === 'discussion' ? 'OPEN' : 'CLOSED', accent: '#39ff14' },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rise-in rounded-lg border p-4 text-center"
                style={{ backgroundColor: '#0a100a', borderColor: `${stat.accent}33` }}
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>{stat.label}</p>
                <p className="mt-2 font-display text-3xl leading-none" style={{ color: stat.accent }}>{stat.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Board + Right Sidebar */}
      <div className="px-6 py-8">
        <div className="mx-auto w-full max-w-6xl">
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">

            {/* Containment Board */}
            <div className="flex flex-col gap-6">
              <article
                className="rise-in rounded-lg border p-6"
                style={{ backgroundColor: '#0a100a', borderColor: 'rgba(57,255,20,0.2)' }}
              >
                <div className="flex items-center justify-between gap-4">
                  <h2 className="font-display text-2xl leading-none" style={{ color: '#d4c9b2' }}>Containment Board</h2>
                  <span
                    className="rounded border px-3 py-1 font-mono text-xs uppercase tracking-[0.18em]"
                    style={{ borderColor: 'rgba(57,255,20,0.35)', color: '#39ff14', backgroundColor: 'rgba(57,255,20,0.1)' }}
                  >
                    {activePlayers.length} alive
                  </span>
                </div>

                {/* Player Grid */}
                <div
                  className="mt-6 rounded-lg border p-5"
                  style={{ backgroundColor: '#0c1309', borderColor: 'rgba(57,255,20,0.15)' }}
                >
                  {isLoading ? (
                    <p className="text-center font-mono text-xs" style={{ color: '#4a5e44' }}>Loading players…</p>
                  ) : room?.players?.length ? (
                    <div className="grid grid-cols-4 gap-3">
                      {room.players.map((p) => (
                        <button
                          key={p.walletAddress}
                          onClick={() => canVote && setSelectedVote(p.walletAddress === selectedVote ? null : p.walletAddress)}
                          className="rounded-lg py-3 font-mono text-sm font-bold uppercase tracking-widest transition-all hover:opacity-80"
                          style={{
                            ...playerStyle(visibleStatus(p, address)),
                            boxShadow: selectedVote === p.walletAddress ? `0 0 0 2px #f5c518` : undefined,
                            cursor: canVote && !p.isEliminated ? 'pointer' : 'default',
                          }}
                        >
                          {p.displayName}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center font-mono text-xs" style={{ color: '#4a5e44' }}>Waiting for players…</p>
                  )}
                </div>

                {/* Role awareness banners — private, only shown to the local player */}
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
                        ? 'The plague started with you. Lead the infected faction to parity.'
                        : 'Spread the plague. Avoid suspicion. Infected players cannot submit innocence proofs.'}
                    </p>
                  </div>
                )}

                {/* Spectator mode banner — shown to anyone who didn't join before the game started */}
                {isSpectator && (
                  <div className="mt-5 rounded-lg border p-5" style={{ borderColor: 'rgba(245,197,24,0.45)', backgroundColor: 'rgba(245,197,24,0.07)' }}>
                    <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#f5c518' }}>👁 SPECTATOR MODE</p>
                    <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
                      This game was already in progress when you arrived. You can watch but cannot vote, prove innocence, or affect the outcome.
                    </p>
                  </div>
                )}

                {/* Phase + Proof panel */}
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div
                    className="rounded-lg border p-5"
                    style={{ backgroundColor: '#0e180d', borderColor: 'rgba(57,255,20,0.18)' }}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>Live Feed</p>
                    <ul className="mt-3 space-y-2 font-mono text-xs max-h-32 overflow-y-auto" style={{ color: '#8fa882' }}>
                      {feed.length > 0 ? feed.map((msg, i) => (
                        <li key={i} className="flex gap-2">
                          <span style={{ color: '#4a5e44' }}>→</span> {msg}
                        </li>
                      )) : (
                        <li className="text-gray-500">Waiting for game events…</li>
                      )}
                    </ul>
                  </div>
                  <div
                    className="rounded-lg border p-5"
                    style={{ backgroundColor: `rgba(${PHASE_COLOR[phase] === '#e63329' ? '230,51,41' : phase === 'discussion' ? '57,255,20' : phase === 'voting' ? '245,197,24' : '143,168,130'},0.1)`, borderColor: `${PHASE_COLOR[phase]}4d` }}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>Phase</p>
                    <p className="mt-2 font-display text-3xl leading-none" style={{ color: PHASE_COLOR[phase] }}>
                      {PHASE_LABEL[phase]}
                    </p>
                    <p className="mt-3 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
                      {phase === 'infection'  && 'Infection spreading — new carrier assigned.'}
                      {phase === 'discussion' && 'Submit innocence proofs now before voting opens.'}
                      {phase === 'voting'     && (hasVoted ? 'Your vote has been cast. Awaiting other votes…' : 'Cast your vote to eliminate the suspected carrier.')}
                      {phase === 'reveal'     && 'Vote resolution in progress.'}
                      {phase === 'ended' && (
                        result
                          ? `Game over: ${result.outcome.replaceAll('_', ' ')}`
                          : (
                              room?.status === 'waiting'  ? 'Waiting for players to join.' :
                              room?.status === 'starting' ? 'Waiting for all players to commit their role.' :
                              'Game ended.'
                            )
                      )}
                    </p>
                  </div>
                </div>

                {/* Start Game panel (host only, Waiting phase) */}
                {room?.status === 'waiting' && isHost && (
                  <div
                    className="mt-5 rounded-lg border p-5"
                    style={{ borderColor: 'rgba(245,197,24,0.4)', backgroundColor: 'rgba(245,197,24,0.08)' }}
                  >
                    <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#f5c518' }}>
                      Host Controls
                    </p>
                    <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
                      {`${totalPlayers} player${totalPlayers !== 1 ? 's' : ''} in room. Start when ready.`}
                    </p>
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

                {/* Role Commitment panel (Starting phase) */}
                {room?.status === 'starting' && (
                  <div
                    className="mt-5 rounded-lg border p-5"
                    style={{ borderColor: 'rgba(57,255,20,0.35)', backgroundColor: 'rgba(57,255,20,0.08)' }}
                  >
                    <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#39ff14' }}>
                      Submit Role Commitment
                    </p>
                    {commitDone ? (
                      <p className="mt-3 font-mono text-xs" style={{ color: '#39ff14' }}>
                        ✓ Commitment submitted. Waiting for all players…
                      </p>
                    ) : (
                      <>
                        <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
                          Enter a private secret phrase. This generates your ZK commitment — keep the phrase safe.
                        </p>
                        <input
                          type="password"
                          placeholder="My secret phrase…"
                          value={secretPhrase}
                          onChange={e => setSecretPhrase(e.target.value)}
                          className="mt-3 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm focus:outline-none"
                          style={{ borderColor: 'rgba(57,255,20,0.4)', color: '#d4c9b2' }}
                        />
                        {commitError && <p className="mt-2 font-mono text-xs" style={{ color: '#e63329' }}>{commitError}</p>}
                        <button
                          onClick={handleCommitRole}
                          disabled={!canCommit || !secretPhrase}
                          className="mt-3 w-full rounded border py-2 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-40"
                          style={{ backgroundColor: '#39ff14', borderColor: '#39ff14', color: '#060b06' }}
                        >
                          {committing ? 'Generating ZK Proof…' : 'Commit Role'}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Proof Submission panel (Discussion phase) — only for active participants */}
                {phase === 'discussion' && !!localPlayer && localPlayer.status !== 'infected' && !hasProofThisRound && (
                  <div
                    className="mt-5 rounded-lg border p-5"
                    style={{ borderColor: 'rgba(57,255,20,0.35)', backgroundColor: 'rgba(57,255,20,0.08)' }}
                  >
                    <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#39ff14' }}>
                      Submit Innocence Proof
                    </p>
                    <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
                      Prove you are clean before voting opens. Your first proof is free.
                      {localPlayer?.freeProofUsed && ' (Free proof used — fee will be charged.)'}
                    </p>
                    <input
                      type="password"
                      placeholder="Your secret phrase…"
                      value={secretPhrase}
                      onChange={e => setSecretPhrase(e.target.value)}
                      className="mt-3 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm focus:outline-none"
                      style={{ borderColor: 'rgba(57,255,20,0.4)', color: '#d4c9b2' }}
                    />
                    {proofError && <p className="mt-2 font-mono text-xs" style={{ color: '#e63329' }}>{proofError}</p>}
                    <button
                      onClick={handleSubmitProof}
                      disabled={!canProve || !secretPhrase}
                      className="mt-3 w-full rounded border py-2 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-40"
                      style={{ backgroundColor: '#39ff14', borderColor: '#39ff14', color: '#060b06' }}
                    >
                      {proving ? 'Generating ZK Proof…' : 'Submit Innocence Proof'}
                    </button>
                  </div>
                )}

                {phase === 'discussion' && hasProofThisRound && (
                  <p className="mt-4 font-mono text-xs" style={{ color: '#84cc16' }}>
                    ✓ Innocence proof submitted on-chain.
                  </p>
                )}
              </article>

              {/* Game Result */}
              {result && (
                <article
                  className="rise-in rounded-lg border p-6"
                  style={{ backgroundColor: '#0a100a', borderColor: 'rgba(132,204,22,0.3)' }}
                >
                  <h3 className="font-display text-2xl" style={{ color: '#84cc16' }}>GAME OVER</h3>
                  <p className="mt-2 font-display text-4xl" style={{ color: '#f5c518' }}>
                    {result.outcome === 'clean_win' ? 'Clean Win' : result.outcome === 'infected_win' ? 'Infected Win' : 'Draw'}
                  </p>
                  <p className="mt-3 font-mono text-sm" style={{ color: '#8fa882' }}>
                    Pot per winner: {result.potPerWinner > 0n
                      ? (Number(result.potPerWinner) / 1e18).toFixed(4)
                      : result.winners.length > 0
                        ? (Number(result.totalPot) / 1e18 / result.winners.length).toFixed(4)
                        : '0.0000'
                    } cUSD
                  </p>
                  <p className="mt-1 font-mono text-xs" style={{ color: '#4a5e44' }}>
                    Winners: {result.winners.map(w => {
                      const p = room?.players?.find(pl => pl.walletAddress.toLowerCase() === w.toLowerCase())
                      return p?.displayName ?? `${w.slice(0, 6)}…`
                    }).join(', ') || '—'}
                  </p>
                </article>
              )}
            </div>

            {/* Right Sidebar */}
            <aside className="flex flex-col gap-6">

              {/* Vote Panel */}
              <div
                className="rise-in rounded-lg border p-6"
                style={{ backgroundColor: '#0a100a', borderColor: 'rgba(230,51,41,0.25)', animationDelay: '80ms' }}
              >
                <h3 className="font-display text-xl leading-none" style={{ color: '#d4c9b2' }}>Vote Panel</h3>
                <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em]" style={{ color: '#4a5e44' }}>
                  {phase === 'voting' ? (hasVoted ? 'Vote submitted' : 'Select suspected carrier') : 'Voting not open'}
                </p>

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
                  <p className="mt-4 font-mono text-xs" style={{ color: '#8fa882' }}>
                    Voting is available only to alive room participants.
                  </p>
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
                            <span style={{ color: '#ff6b6b' }}>{cnt} vote{cnt !== 1 ? 's' : ''}</span>
                          </div>
                        )
                      })}
                  </div>
                ) : null}
              </div>

              {/* Player Roster */}
              <div
                className="rise-in rounded-lg border p-6"
                style={{ backgroundColor: '#0a100a', borderColor: 'rgba(132,204,22,0.2)', animationDelay: '160ms' }}
              >
                <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#84cc16' }}>Roster</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {room?.players?.map((p) => {
                    const num = /^Player (\d+)$/.exec(p.displayName)?.[1]
                    return (
                      <div
                        key={p.walletAddress}
                        className="flex h-10 w-10 items-center justify-center rounded-full font-mono text-[10px] font-bold uppercase"
                        style={playerStyle(visibleStatus(p, address))}
                      >
                        {num ? `P${num}` : p.displayName.slice(0, 4)}
                      </div>
                    )
                  }) ?? null}
                </div>
                {localPlayer && (
                  <p className="mt-3 font-mono text-xs" style={{ color: '#4a5e44' }}>
                    You: {localPlayer.displayName}
                    {localPlayer.role !== 'unknown' && ` · ${localPlayer.role}`}
                  </p>
                )}
              </div>

              {/* Chat Panel */}
              <div
                className="rise-in rounded-lg border p-4"
                style={{ backgroundColor: '#0a100a', borderColor: 'rgba(57,255,20,0.15)', animationDelay: '220ms' }}
              >
                <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#39ff14' }}>Room Chat</p>
                <div
                  className="mt-3 h-44 overflow-y-auto space-y-2 pr-1"
                  style={{ scrollbarWidth: 'thin' }}
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
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    placeholder="Say something…"
                    value={chatInput}
                    maxLength={256}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSendChat() }}
                    className="flex-1 rounded border bg-transparent px-3 py-1.5 font-mono text-xs focus:outline-none"
                    style={{ borderColor: 'rgba(57,255,20,0.3)', color: '#d4c9b2' }}
                  />
                  <button
                    onClick={handleSendChat}
                    disabled={!chatInput.trim() || !socketOn}
                    className="rounded border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-40"
                    style={{ borderColor: '#39ff14', color: '#39ff14' }}
                  >
                    Send
                  </button>
                </div>
              </div>

              {/* Back to Lobby */}
              <Link
                href="/lobby"
                className="rise-in rounded-lg border py-4 text-center font-mono text-sm uppercase tracking-[0.18em] transition-all hover:opacity-90"
                style={{ borderColor: 'rgba(57,255,20,0.35)', backgroundColor: 'rgba(57,255,20,0.08)', color: '#39ff14', display: 'block', animationDelay: '300ms' }}
              >
                ← Back to Lobby
              </Link>
            </aside>
          </div>
        </div>
      </div>
      </div>
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

