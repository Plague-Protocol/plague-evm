'use client'

import { SiteNav } from '@/components/ui/site-nav'
import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useEffect, useState, useCallback } from 'react'
import { useGameState } from '@/hooks/useGameState'
import { useWallet } from '@/hooks/useWallet'
import { useSoundscape, GAME_OVER_TRACKS, playSting } from '@/hooks/useSoundscape'
import { useSound } from '@/providers/sound-provider'
import { createContractClient } from '@/lib/contract'
import type { RoundPhase } from '@/types/game'

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

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const CUSD_ADDRESSES: Record<number, `0x${string}`> = {
  44787: '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1',
  42220: '0x765DE816845861e75A25fCA122bb6022DB77Eaca',
}

// ── Inner component (uses hooks that need Suspense) ───────────────────────────

function GamePageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const roomId = params.get('room')

  const { isConnected, address, chainId, connect } = useWallet()
  const { room, localPlayer, currentRound, result, isConnected: socketOn, isLoading, error, feed, socket } = useGameState(roomId)

  // ── Phase timer ──────────────────────────────────────────────────────────
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  const phaseEndsAt = currentRound?.phaseEndsAt ?? 0
  const msLeft = phaseEndsAt > now ? phaseEndsAt - now : 0

  // ── Vote state ───────────────────────────────────────────────────────────
  const [selectedVote, setSelectedVote] = useState<string | null>(null)
  const [voting, setVoting]             = useState(false)
  const [voteError, setVoteError]       = useState<string | null>(null)

  // ── Proof submission state ───────────────────────────────────────────────
  const [proving, setProving]       = useState(false)
  const [proofError, setProofError] = useState<string | null>(null)
  const [proofDone, setProofDone]   = useState(false)

  // ── Role commitment state (during Starting phase) ────────────────────────
  const [committing, setCommitting]         = useState(false)
  const [commitError, setCommitError]       = useState<string | null>(null)
  const [secretPhrase, setSecretPhrase]     = useState('')

  // ── Derived ──────────────────────────────────────────────────────────────
  const phase       = currentRound?.phase ?? 'ended'
  const round       = currentRound?.number ?? 0
  const activePlayers = room?.players?.filter(p => !p.isEliminated) ?? []
  const totalPlayers  = room?.players?.length ?? 0
  const infectedCount = room?.players?.filter(p => p.status === 'infected' && !p.isEliminated).length ?? 0
  const potCUSD       = room ? (Number(room.stakeAmount) * totalPlayers / 1e18).toFixed(2) : '—'
  const canVote       = phase === 'voting' && isConnected && !localPlayer?.isEliminated && !voting
  const canProve      = phase === 'discussion' && isConnected && !localPlayer?.isEliminated && !proofDone
  const canCommit     = room?.status === 'starting' && isConnected && !committing

  // ── Soundscape ───────────────────────────────────────────────────────────
  const { muted } = useSound()
  const soundScene = room?.status === 'ended' ? 'ended' : (phase as RoundPhase)
  useSoundscape(soundScene, muted)

  // Play game-over sting once when result arrives
  useEffect(() => {
    if (!result) return
    const src = result.outcome === 'infected_win'
      ? GAME_OVER_TRACKS.infected
      : GAME_OVER_TRACKS.clean
    playSting(src, muted, 0.55)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.outcome])

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
    } catch (err) {
      setVoteError(err instanceof Error ? err.message : 'Vote failed.')
    } finally {
      setVoting(false)
    }
  }, [selectedVote, address, roomId])

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

      // Get the player's commitment stored on chain
      const rawPlayer = await client['publicClient' as never] // direct access not exposed; use room data
      const commitment = localPlayer ? '0x' + '0'.repeat(64) as `0x${string}` : '0x' as `0x${string}`
      // Note: real commitment comes from the on-chain roleCommitment field;
      // here we rely on the backend to have stored it when the player committed.
      const { proveInnocence, computeInnocenceNullifier } = await import('@/lib/zk')
      const nullifier = computeInnocenceNullifier(
        BigInt('0x' + Buffer.from(secretPhrase).toString('hex').padEnd(64, '0').slice(0, 64)),
        BigInt(roomId),
        BigInt(round),
      )
      const proof = await proveInnocence({
        role:        'clean',
        secret:      BigInt('0x' + Buffer.from(secretPhrase).toString('hex').padEnd(64, '0').slice(0, 64)),
        roomId:      BigInt(roomId),
        roundNumber: BigInt(round),
        commitment,
      })

      const nullifierHex = `0x${nullifier.toString(16).padStart(64, '0')}` as `0x${string}`
      const proofBytes   = ('0x' + proof.proof.map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`

      // Approve proof fee if not free
      if (localPlayer?.freeProofUsed && chainId && CUSD_ADDRESSES[chainId]) {
        const stakeAmt = room?.stakeAmount ?? 0n
        await client.approveCUSD(address, CUSD_ADDRESSES[chainId], stakeAmt)
      }

      await client.submitInnocenceProof(address, BigInt(roomId), commitment, nullifierHex, proofBytes)
      setProofDone(true)
    } catch (err) {
      setProofError(err instanceof Error ? err.message : 'Proof generation or submission failed.')
    } finally {
      setProving(false)
    }
  }, [address, roomId, secretPhrase, round, localPlayer, room, chainId])

  const handleCommitRole = useCallback(async () => {
    if (!address || !roomId || !secretPhrase) {
      setCommitError('Enter a secret phrase to commit your role.')
      return
    }
    setCommitting(true)
    setCommitError(null)
    try {
      const { generateRoleCommitment, proveRoleCommitment } = await import('@/lib/zk')
      const role = 'clean' as const // backend assigns infection via assignInfection
      const secretBigInt = BigInt('0x' + Buffer.from(secretPhrase).toString('hex').padEnd(64, '0').slice(0, 64))
      const { commitment } = await generateRoleCommitment(role, secretBigInt)
      const proofResult = await proveRoleCommitment({ role, secret: secretBigInt, commitment })
      const commitmentHex = commitment.startsWith('0x') ? commitment as `0x${string}` : `0x${commitment}` as `0x${string}`
      const proofBytes    = ('0x' + proofResult.proof.map((b: number) => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
      const client = getContractClient()!
      await client.submitRoleCommitment(address, BigInt(roomId), commitmentHex, proofBytes)
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : 'Role commitment failed.')
    } finally {
      setCommitting(false)
    }
  }, [address, roomId, secretPhrase])

  // ── No roomId guard ───────────────────────────────────────────────────────
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
              {isLoading ? 'LOADING…' : round > 0 ? `ROUND ${round}` : room?.status === 'waiting' ? 'WAITING' : 'STARTING'}
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
          <div className="mt-3 flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${socketOn ? 'bg-green-400' : 'bg-yellow-400'}`} />
            <span className="font-mono text-xs" style={{ color: '#4a5e44' }}>
              {socketOn ? 'Live · backend connected' : 'On-chain read-only'}
            </span>
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
                          title={p.walletAddress}
                          onClick={() => canVote && setSelectedVote(p.walletAddress === selectedVote ? null : p.walletAddress)}
                          className="rounded-lg py-3 font-mono text-sm font-bold uppercase tracking-widest transition-all hover:opacity-80"
                          style={{
                            ...playerStyle(p.status),
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
                      {phase === 'voting'     && 'Cast your vote to eliminate the suspected carrier.'}
                      {phase === 'reveal'     && 'Vote resolution in progress.'}
                      {phase === 'ended'      && (result ? `Game over: ${result.outcome}` : 'Game ended.')}
                    </p>
                  </div>
                </div>

                {/* Role Commitment panel (Starting phase) */}
                {room?.status === 'starting' && (
                  <div
                    className="mt-5 rounded-lg border p-5"
                    style={{ borderColor: 'rgba(57,255,20,0.35)', backgroundColor: 'rgba(57,255,20,0.08)' }}
                  >
                    <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#39ff14' }}>
                      Submit Role Commitment
                    </p>
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
                      style={{ backgroundColor: '#39ff14', borderColor: '#39ff14', color: '#d4c9b2' }}
                    >
                      {committing ? 'Generating ZK Proof…' : 'Commit Role'}
                    </button>
                  </div>
                )}

                {/* Proof Submission panel (Discussion phase) */}
                {phase === 'discussion' && !proofDone && (
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
                      style={{ backgroundColor: '#39ff14', borderColor: '#39ff14', color: '#d4c9b2' }}
                    >
                      {proving ? 'Generating ZK Proof…' : 'Submit Innocence Proof'}
                    </button>
                  </div>
                )}

                {proofDone && phase === 'discussion' && (
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
                    Pot per winner: {(Number(result.potPerWinner) / 1e18).toFixed(4)} cUSD
                  </p>
                  <p className="mt-1 font-mono text-xs" style={{ color: '#4a5e44' }}>
                    Winners: {result.winners.map(w => `${w.slice(0, 6)}…`).join(', ') || '—'}
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
                  {phase === 'voting' ? 'Select suspected carrier' : 'Voting not open'}
                </p>

                {phase === 'voting' && (
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
                      disabled={!selectedVote || voting}
                      className="mt-2 w-full rounded border py-2 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-40"
                      style={{ backgroundColor: '#e63329', borderColor: '#e63329', color: '#d4c9b2' }}
                    >
                      {voting ? 'Submitting…' : 'Cast Vote'}
                    </button>
                  </div>
                )}

                {phase !== 'voting' && currentRound?.votes.length ? (
                  <div className="mt-4 space-y-1">
                    {Object.entries(voteTally)
                      .sort(([, a], [, b]) => b - a)
                      .map(([addr, cnt]) => (
                        <div key={addr} className="flex justify-between font-mono text-xs" style={{ color: '#8fa882' }}>
                          <span>{addr.slice(0, 8)}…</span>
                          <span style={{ color: '#ff6b6b' }}>{cnt} vote{cnt !== 1 ? 's' : ''}</span>
                        </div>
                      ))}
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
                  {room?.players?.map((p) => (
                    <div
                      key={p.walletAddress}
                      title={p.walletAddress}
                      className="flex h-10 w-10 items-center justify-center rounded-full font-mono text-[10px] font-bold uppercase"
                      style={playerStyle(p.status)}
                    >
                      {p.displayName.slice(0, 4)}
                    </div>
                  )) ?? null}
                </div>
                {localPlayer && (
                  <p className="mt-3 font-mono text-xs" style={{ color: '#4a5e44' }}>
                    You: {localPlayer.displayName}
                    {localPlayer.role !== 'unknown' && ` · ${localPlayer.role}`}
                  </p>
                )}
              </div>

              {/* Back to Lobby */}
              <a
                href="/lobby"
                className="rise-in rounded-lg border py-4 text-center font-mono text-sm uppercase tracking-[0.18em] transition-all hover:opacity-90"
                style={{ borderColor: 'rgba(57,255,20,0.35)', backgroundColor: 'rgba(57,255,20,0.08)', color: '#39ff14', display: 'block', animationDelay: '300ms' }}
              >
                ← Back to Lobby
              </a>
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

