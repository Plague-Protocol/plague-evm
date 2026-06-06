'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'
import { createPublicClient, webSocket } from 'viem'
import { celoSepolia, celo } from 'viem/chains'
import { createContractClient } from '@/lib/contract'
import type { GameState, GameEvent, GameOutcome, Room, Player, Round, RoundPhase } from '@/types/game'

// ── Contract client (read-only, no wallet needed) ─────────────────────────────

function getContractClient() {
  const network = (process.env.NEXT_PUBLIC_NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
  const address = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}` | undefined
  if (!address) return null
  return createContractClient({ contractAddress: address, network })
}

/**
 * Retry getRoom for newly-created rooms whose block hasn't propagated to every
 * Forno RPC node yet (load-balanced cluster inconsistency). Backs off 1s→2s→3s.
 */
async function getRoomWithRetry(
  client: ReturnType<typeof getContractClient>,
  roomId: bigint,
  maxRetries = 3,
): ReturnType<NonNullable<typeof client>['getRoom']> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await client!.getRoom(roomId)
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      const isInvalidRoom = msg.includes('InvalidRoom') || msg.includes('0x353cbf17')
      if (!isInvalidRoom || attempt === maxRetries) throw err
      await new Promise(r => setTimeout(r, (attempt + 1) * 1_000))
    }
  }
  throw lastErr
}

// ── Backend meta helpers (nicknames + room name) ──────────────────────────────

async function fetchNicknames(addresses: string[]): Promise<Record<string, string>> {
  if (addresses.length === 0) return {}
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
  try {
    const res = await fetch(`${backendUrl}/api/players/nicknames`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses }),
    })
    if (!res.ok) return {}
    const data = await res.json() as { nicknames: Record<string, string> }
    return data.nicknames ?? {}
  } catch {
    return {}
  }
}

async function applyNicknames(players: Player[]): Promise<Player[]> {
  const nicknames = await fetchNicknames(players.map(p => p.walletAddress))
  return players.map(p => {
    const nick = nicknames[p.walletAddress] ?? nicknames[p.walletAddress.toLowerCase()]
    return nick ? { ...p, displayName: nick } : p
  })
}

async function fetchRoomName(roomId: string): Promise<string | null> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
  try {
    const res = await fetch(`${backendUrl}/api/rooms/${roomId}/name`)
    if (!res.ok) return null
    const data = await res.json() as { name: string | null }
    return data.name
  } catch {
    return null
  }
}

// ── Phase numeric → string mapping (mirrors Solidity RoundPhase enum) ─────────
const PHASE_MAP: Record<number, RoundPhase> = {
  0: 'infection',
  1: 'discussion',
  2: 'voting',
  3: 'reveal',
  4: 'ended',
}

// ── Status numeric → string (PlayerStatus enum) ───────────────────────────────
const PLAYER_STATUS_MAP: Record<number, 'clean' | 'infected' | 'eliminated'> = {
  0: 'clean',
  1: 'infected',
  2: 'eliminated',
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ELIMINATION_PHASE_DURATION_MS = Number(process.env.NEXT_PUBLIC_ELIMINATION_PHASE_DURATION_MS ?? 6_000)
const SNAPSHOT_STALE_MS = Number(process.env.NEXT_PUBLIC_SNAPSHOT_STALE_MS ?? 1_000)
const PLATFORM_FEE_NUMERATOR = 3n
const PLATFORM_FEE_DENOMINATOR = 1000n

function computeWinnerShare(totalPot: bigint, winnerCount: number): bigint {
  if (winnerCount <= 0 || totalPot <= 0n) return 0n
  const fee = (totalPot * PLATFORM_FEE_NUMERATOR) / PLATFORM_FEE_DENOMINATOR
  const distributable = totalPot - fee
  return distributable / BigInt(winnerCount)
}

// ── Map raw on-chain room to Room type ────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRoom(raw: any): Room {
  const statusMap: Record<number, 'waiting' | 'starting' | 'active' | 'ended'> = {
    0: 'waiting',
    1: 'starting',
    2: 'active',
    3: 'ended',
  }
  return {
    id:            String(raw.id),
    contractAddress: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? '',
    hostAddress:   raw.host,
    players:       [],
    maxPlayers:    Number(raw.config.maxPlayers),
    minPlayers:    Number(raw.config.minPlayers),
    stakeAmount:   BigInt(raw.config.stakeAmount ?? '0'),
    proofFee:      BigInt(raw.config.proofFee ?? '0'),
    status:        statusMap[Number(raw.status)] ?? 'ended',
    currentRound:  Number(raw.currentRound),
    maxRounds:     Number(raw.config.maxRounds),
    createdAt:     Number(raw.createdAt) * 1000,
    expiresAt:     Number(raw.expiresAt) * 1000,
    startedAt:     raw.startedAt ? Number(raw.startedAt) * 1000 : undefined,
  }
}

// ── Map raw on-chain player data to Player type ───────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPlayer(raw: any, address: string, playerNum?: number): Player {
  const voteTarget = String(raw.voteTarget ?? '').toLowerCase()
  const hasVoteTarget = voteTarget && voteTarget !== '0x0000000000000000000000000000000000000000'
  return {
    id:                   address,
    walletAddress:        address,
    displayName:          playerNum ? `Player ${playerNum}` : `${address.slice(0, 6)}…${address.slice(-4)}`,
    status:               PLAYER_STATUS_MAP[Number(raw.status)] ?? 'clean',
    role:                 'unknown',
    isEliminated:         Number(raw.status) === 2,
    stakedAmount:         BigInt(raw.staked ?? '0'),
    joinedAt:             Number(raw.joinedAt) * 1000,
    freeProofUsed:        raw.freeProofUsed,
    proofsSubmittedTotal: Number(raw.proofsSubmittedTotal),
    hasProofThisRound:    Boolean(raw.hasProofThisRound),
    hasVotedThisRound:    Boolean(raw.hasVotedThisRound),
    roleCommitted:        Boolean(raw.roleCommitted),
    voteTarget:           hasVoteTarget ? String(raw.voteTarget) : undefined,
    // Keep commitment only if actually set (non-zero bytes32)
    roleCommitment: raw.roleCommitment && raw.roleCommitment !== '0x0000000000000000000000000000000000000000000000000000000000000000'
      ? String(raw.roleCommitment)
      : undefined,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildRoundFromRaw(rawRoom: any, players: Player[]): Round | null {
  const roomStatus = Number(rawRoom.status)
  const roundNumber = Number(rawRoom.currentRound ?? 0)
  if (roundNumber < 1 || (roomStatus !== 2 && roomStatus !== 3)) return null

  const phase = PHASE_MAP[Number(rawRoom.currentPhase)] ?? 'ended'
  const startedAt = Number(rawRoom.phaseStartedAt ?? 0) * 1000
  let phaseDurationMs = 0
  if (phase === 'discussion') phaseDurationMs = Number(rawRoom.config?.discussionDurationSecs ?? 0) * 1000
  if (phase === 'voting') phaseDurationMs = Number(rawRoom.config?.votingDurationSecs ?? 0) * 1000
  if (phase === 'reveal') phaseDurationMs = ELIMINATION_PHASE_DURATION_MS

  const votes = players
    .filter(p => p.hasVotedThisRound && !!p.voteTarget)
    .map(p => ({ voterAddress: p.walletAddress, targetAddress: p.voteTarget as string, timestamp: startedAt }))

  return {
    number: roundNumber,
    phase,
    infectedThisRound: [],
    eliminatedThisRound: [],
    votes,
    proofSubmissions: [],
    drainAmount: 0n,
    startedAt,
    phaseEndsAt: phaseDurationMs > 0 ? startedAt + phaseDurationMs : startedAt,
  }
}

async function enrichLocalRole(
  client: ReturnType<typeof getContractClient>,
  roomId: bigint,
  localPlayer: Player | null,
): Promise<Player | null> {
  if (!client || localPlayer?.status !== 'infected') return localPlayer
  const patientZero = await client.getCurrentPatientZero(roomId).catch(() => ZERO_ADDRESS as `0x${string}`)
  return {
    ...localPlayer,
    role: patientZero.toLowerCase() === localPlayer.walletAddress.toLowerCase()
      ? 'patient_zero'
      : 'infected',
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useGameState(roomId: string | null, playerAddress: string | null = null) {
  const [state, setState] = useState<GameState>({
    room:        null,
    localPlayer: null,
    currentRound: null,
    result:      null,
    isConnected: false,
    isLoading:   false,
    error:       null,
  })

  const socketRef         = useRef<Socket | null>(null)
  const feedRef           = useRef<string[]>([])
  const pendingOutcomeRef = useRef<GameOutcome | null>(null)
  const socketConnectedRef = useRef(false)
  const lastSnapshotAtRef = useRef(0)
  const [feed, setFeed] = useState<string[]>([])

  const applySocketSnapshot = useCallback(async (
    snapshot: { room?: unknown; players?: unknown[] },
    rid: string,
    pAddr: string | null,
  ) => {
    if (!snapshot?.room) return

    const room = mapRoom(snapshot.room)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawPlayers = (snapshot.players ?? []).map((p: any, idx: number) => mapPlayer(p, p.addr ?? p.address, idx + 1))
    const [enrichedPlayers, roomName] = await Promise.all([
      applyNicknames(rawPlayers),
      fetchRoomName(rid),
    ])
    room.players = enrichedPlayers
    if (roomName) room.name = roomName
    const chainRound = buildRoundFromRaw(snapshot.room, room.players)
    let localPlayer = pAddr
      ? room.players.find(p => p.walletAddress.toLowerCase() === pAddr.toLowerCase()) ?? null
      : null
    localPlayer = await enrichLocalRole(getContractClient(), BigInt(rid), localPlayer)

    setState(prev => ({
      ...prev,
      room,
      localPlayer,
      currentRound: chainRound,
      isLoading: false,
      error: null,
    }))
    lastSnapshotAtRef.current = Date.now()
  }, [])

  // ── Append to live event feed ───────────────────────────────────────────────
  const appendFeed = useCallback((msg: string) => {
    feedRef.current = [msg, ...feedRef.current.slice(0, 49)]
    setFeed([...feedRef.current])
  }, [])

  // ── Handle a socket game_event ─────────────────────────────────────────────
  const handleEvent = useCallback((event: GameEvent) => {
    const p = event.payload

    switch (event.type) {
      case 'player_joined':
        appendFeed(`A new player joined the room.`)
        setState(prev => {
          if (!prev.room) return prev
          const joinedAddress = String(p.address).toLowerCase()
          const already = prev.room.players.some(pl => pl.walletAddress.toLowerCase() === joinedAddress)
          if (already) return prev
          const playerNum = prev.room.players.length + 1
          const newPlayer: Player = {
            id:                   String(p.address),
            walletAddress:        String(p.address),
            displayName:          `Player ${playerNum}`,
            status:               'clean',
            role:                 'unknown',
            isEliminated:         false,
            stakedAmount:         0n,
            joinedAt:             event.timestamp,
            freeProofUsed:        false,
            proofsSubmittedTotal: 0,
            hasProofThisRound:    false,
            hasVotedThisRound:    false,
            roleCommitted:        false,
          }
          if (!prev.room) return prev
          return { ...prev, room: { ...prev.room, players: [...prev.room.players, newPlayer] } }
        })
        break

      case 'game_started':
        appendFeed('Game started — set your Shield Password to begin.')
        setState(prev => prev.room ? { ...prev, room: { ...prev.room, status: 'starting', startedAt: event.timestamp } } : prev)
        break

      case 'round_started':
        appendFeed(`Round ${p.round} started. Infection resolves before discussion opens.`)
        setState(prev => {
          if (!prev.room) return prev
          const round: Round = {
            number:            Number(p.round),
            phase:             'infection',
            infectedThisRound: [],
            eliminatedThisRound: [],
            votes:             [],
            proofSubmissions:  [],
            drainAmount:       0n,
            startedAt:         event.timestamp,
            phaseEndsAt:       event.timestamp + Number(p.durationMs ?? 0),
          }
          return { ...prev, room: { ...prev.room, status: 'active', currentRound: Number(p.round) }, currentRound: round }
        })
        break

      case 'phase_changed': {
        const phaseName = PHASE_MAP[Number(p.phase)] ?? 'ended'
        appendFeed(`Phase changed: ${phaseName.toUpperCase()}`)
        if (phaseName === 'reveal') {
          appendFeed('Elimination results are being finalized now.')
        }
        if (phaseName === 'infection') {
          appendFeed('Applying infection for this round before discussion/voting.')
        }
        setState(prev => {
          const updatedRound = prev.currentRound
            ? { ...prev.currentRound, phase: phaseName, phaseEndsAt: event.timestamp + Number(p.durationMs ?? 0) }
            : null
          return { ...prev, currentRound: updatedRound }
        })
        break
      }

      case 'vote_cast':
        appendFeed(`A vote was cast this round.`)
        setState(prev => {
          if (!prev.currentRound) return prev
          const vote = { voterAddress: String(p.voter), targetAddress: String(p.target), timestamp: event.timestamp }
          return { ...prev, currentRound: { ...prev.currentRound, votes: [...prev.currentRound.votes, vote] } }
        })
        break

      case 'proof_submitted':
        setState(prev => {
          const playerAddr = String(p.player).toLowerCase()
          const playerName = prev.room?.players.find(pl => pl.walletAddress.toLowerCase() === playerAddr)?.displayName
          const label = playerName ?? `${playerAddr.slice(0, 6)}…${playerAddr.slice(-4)}`
          appendFeed(`${label} activated their Shield.`)
          return prev
        })
        break

      case 'player_eliminated':
        setState(prev => {
          const targetAddr = String(p.player).toLowerCase()
          const prior = prev.room?.players.find(pl => pl.walletAddress.toLowerCase() === targetAddr)
          const targetLabel = prior?.displayName ?? `${targetAddr.slice(0, 6)}…${targetAddr.slice(-4)}`
          if (prior?.status === 'infected') {
            appendFeed(`Infected eliminated: ${targetLabel}.`)
          } else if (prior?.status === 'clean') {
            appendFeed(`Clean player eliminated: ${targetLabel}.`)
          } else {
            appendFeed(`${targetLabel} was eliminated.`)
          }

          return {
            ...prev,
            room: prev.room ? {
              ...prev.room,
              players: prev.room.players.map(pl =>
                pl.walletAddress === p.player
                  ? { ...pl, status: 'eliminated' as const, isEliminated: true }
                  : pl
              ),
            } : null,
            currentRound: prev.currentRound ? {
              ...prev.currentRound,
              eliminatedThisRound: [...prev.currentRound.eliminatedThisRound, String(p.player)],
            } : null,
          }
        })
        break

      case 'player_saved_by_proof':
        setState(prev => {
          const savedAddr = String(p.player).toLowerCase()
          const savedName = prev.room?.players.find(pl => pl.walletAddress.toLowerCase() === savedAddr)?.displayName
          const savedLabel = savedName ?? `${savedAddr.slice(0, 6)}…${savedAddr.slice(-4)}`
          appendFeed(`Saved by innocence proof: ${savedLabel}.`)
          return prev
        })
        break

      case 'vote_resolved':
        appendFeed(`Vote result: ${String(p.message)}`)
        break

      case 'infection_assigned':
        // Private event — only delivered to the newly infected player
        appendFeed('You have been INFECTED. You are now an agent of the plague.')
        setState(prev => ({
          ...prev,
          localPlayer: prev.localPlayer ? { ...prev.localPlayer, role: 'infected', status: 'infected' } : null,
        }))
        break

      case 'patient_zero_updated':
        appendFeed('A new Patient Zero has risen through the ranks.')
        setState(prev => {
          if (!prev.localPlayer) return prev
          const isLocalPatientZero =
            String(p.patientZero).toLowerCase() === prev.localPlayer.walletAddress.toLowerCase()
          if (!isLocalPatientZero) return prev
          return { ...prev, localPlayer: { ...prev.localPlayer, role: 'patient_zero' } }
        })
        break

      case 'game_ended': {
        const OUTCOME_MAP: Record<number, GameOutcome> = {
          0: 'clean_win',
          1: 'infected_win',
          2: 'max_rounds_draw',
        }
        const outcome: GameOutcome = OUTCOME_MAP[Number(p.outcome)] ?? 'max_rounds_draw'
        pendingOutcomeRef.current = outcome
        appendFeed(`Game over — ${outcome.replaceAll('_', ' ')}`)
        setState(prev => {
          if (!prev.room) return prev
          const totalPot = prev.room.stakeAmount * BigInt(prev.room.players.length)
          return {
            ...prev,
            room: { ...prev.room, status: 'ended' },
            result: {
              outcome,
              // Winners are finalized from PotDrained events and/or chain refresh,
              // because local role visibility can hide infected identities.
              winners: prev.result?.winners ?? [],
              losers: prev.result?.losers ?? [],
              totalPot,
              potPerWinner: prev.result?.potPerWinner ?? 0n,
              rounds: prev.currentRound?.number ?? 0,
            },
          }
        })
        break
      }

      case 'pot_drained': {
        const winner = String(p.winner)
        const amount = BigInt(typeof p.amount === 'string' || typeof p.amount === 'number' ? String(p.amount) : '0')
        appendFeed(`Pot distributed — winner received ${(Number(amount) / 1e18).toFixed(4)} USDm.`)
        setState(prev => {
          const outcome = pendingOutcomeRef.current ?? 'max_rounds_draw'
          if (!prev.result) {
            // pot_drained arrived before game_ended — build a partial result
            return {
              ...prev,
              result: {
                outcome,
                winners: [winner],
                losers: [],
                potPerWinner: amount,
                totalPot: amount,
                rounds: prev.currentRound?.number ?? 0,
              },
            }
          }
          const updatedWinners = prev.result.winners.includes(winner)
            ? prev.result.winners
            : [...prev.result.winners, winner]
          return {
            ...prev,
            result: { ...prev.result, winners: updatedWinners, potPerWinner: amount },
          }
        })
        break
      }

      case 'room_expired':
        appendFeed('Room expired — all stakes refunded.')
        setState(prev => prev.room ? { ...prev, room: { ...prev.room, status: 'ended' } } : prev)
        break

      case 'proof_window_open':
        appendFeed('Shield activation window OPEN — Discussion phase.')
        break

      case 'proof_window_closed':
        appendFeed('Shield activation window CLOSED — Voting phase starting.')
        break

      default:
        break
    }
  }, [appendFeed])

  // ── Load room state from chain ─────────────────────────────────────────────
  const loadRoomFromChain = useCallback(async (rid: string, playerAddress?: string) => {
    const client = getContractClient()
    if (!client) return
    try {
      setState(prev => ({ ...prev, isLoading: true }))
      const raw = await getRoomWithRetry(client, BigInt(rid))
      const room = mapRoom(raw)

      // Load each player's data from chain
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const players: Player[] = await Promise.all((raw as any).players.map(async (addr: string, idx: number) => {
        const pRaw = await client.getPlayer(BigInt(rid), addr as `0x${string}`)
        return mapPlayer(pRaw, addr, idx + 1)
      }))
      const [enrichedPlayers, roomName] = await Promise.all([
        applyNicknames(players),
        fetchRoomName(rid),
      ])
      room.players = enrichedPlayers
      if (roomName) room.name = roomName
      const chainRound = buildRoundFromRaw(raw, room.players)

      let localPlayer = playerAddress
        ? room.players.find(p => p.walletAddress.toLowerCase() === playerAddress.toLowerCase()) ?? null
        : null
      localPlayer = await enrichLocalRole(client, BigInt(rid), localPlayer)

      // When the room has ended, infer the outcome from on-chain player states so the
      // game-over overlay is shown even when live socket events were missed.
      if (room.status === 'ended') {
        const cleanAlive    = players.filter(p => !p.isEliminated && p.status === 'clean')
        const infectedAlive = players.filter(p => !p.isEliminated && p.status === 'infected')
        let outcome: GameOutcome = 'max_rounds_draw'
        let winners: Player[] = [...cleanAlive, ...infectedAlive]
        let losers: Player[] = []
        if (infectedAlive.length === 0) {
          outcome = 'clean_win'
          winners = cleanAlive
          losers  = infectedAlive
        } else if (infectedAlive.length > cleanAlive.length) {
          outcome = 'infected_win'
          winners = infectedAlive
          losers  = cleanAlive
        } else if (
          (infectedAlive.length === 1 && cleanAlive.length === 1) ||
          room.currentRound >= room.maxRounds
        ) {
          outcome = 'max_rounds_draw'
          winners = [...cleanAlive, ...infectedAlive]
          losers  = []
        }
        const totalPot     = room.stakeAmount * BigInt(room.players.length)
        const potPerWinner = computeWinnerShare(totalPot, winners.length)
        setState(prev => ({
          ...prev,
          room,
          localPlayer,
          result: {
            outcome,
            winners:      winners.map(p => p.walletAddress),
            losers:       losers.map(p => p.walletAddress),
            totalPot,
            potPerWinner,
            rounds:       room.currentRound,
          },
          currentRound: chainRound ?? {
            number:              room.currentRound,
            phase:               'ended' as RoundPhase,
            infectedThisRound:   [],
            eliminatedThisRound: [],
            votes:               [],
            proofSubmissions:    [],
            drainAmount:         0n,
            startedAt:           0,
            phaseEndsAt:         0,
          },
          isLoading: false,
          error:     null,
        }))
        return
      }

      setState(prev => ({
        ...prev,
        room,
        localPlayer,
        currentRound: chainRound,
        isLoading: false,
        error: null,
      }))
    } catch (err) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load room data.',
      }))
    }
  }, [])

  // ── Connect to socket and subscribe to room ────────────────────────────────
  useEffect(() => {
    if (!roomId) return

    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'

    setState(prev => ({ ...prev, isLoading: true, isConnected: false }))

    const socket = io(backendUrl, { transports: ['websocket'] })
    socketRef.current = socket

    socket.on('connect', () => {
      socketConnectedRef.current = true
      lastSnapshotAtRef.current = Date.now()
      setState(prev => ({ ...prev, isConnected: true }))
      socket.emit('join_room', {
        roomId,
        playerAddress,
      })
    })

    socket.on('room_state', async (initialState: { room: unknown; players: unknown[]; error?: string }) => {
      // Server sends full room snapshot on join
      if (initialState?.room) {
        await applySocketSnapshot(initialState, roomId, playerAddress)
      } else if (initialState?.error === 'room_not_found') {
        // Backend couldn't read the room (may be a brand-new room the RPC hasn't indexed
        // yet).  Try a direct chain read; only set the error if that also fails.
        try {
          await loadRoomFromChain(roomId, playerAddress ?? undefined)
        } catch {
          setState(prev => ({ ...prev, isLoading: false, error: 'Room not found.' }))
        }
      } else {
        // Fallback: read from chain
        loadRoomFromChain(roomId, playerAddress ?? undefined)
      }
    })

    socket.on('room_snapshot', async (snapshot: { room?: unknown; players?: unknown[] }) => {
      await applySocketSnapshot(snapshot, roomId, playerAddress)
    })

    socket.on('game_event', handleEvent)
    socket.on('room_refresh_requested', () => {
      // Backend emits room_snapshot immediately after this event.
      // Keep chain reads for the offline fallback path only.
      if (!socketConnectedRef.current) {
        loadRoomFromChain(roomId, playerAddress ?? undefined)
      }
    })

    socket.on('connect_error', (err) => {
      // Socket unavailable — fall back to chain read
      socketConnectedRef.current = false
      loadRoomFromChain(roomId, playerAddress ?? undefined)
      setState(prev => ({ ...prev, isConnected: false, error: `Backend offline: ${err.message}. Showing on-chain data.` }))
    })

    socket.on('disconnect', () => {
      socketConnectedRef.current = false
      setState(prev => ({ ...prev, isConnected: false }))
    })

    socket.on('reconnect', () => {
      socket.emit('join_room', { roomId, playerAddress })
    })

    return () => {
      socket.off('room_refresh_requested')
      socket.off('room_snapshot')
      socket.disconnect()
      socketRef.current = null
    }
  }, [roomId, playerAddress, handleEvent, loadRoomFromChain, applySocketSnapshot])

  // ── Polling fallback: re-sync from chain when socket is offline ──────────────
  // Only fires while the socket is disconnected; once reconnected the server
  // pushes all state updates so polling is redundant and wasteful.
  useEffect(() => {
    if (!roomId) return
    const id = setInterval(() => {
      if (socketConnectedRef.current) return
      if (!navigator.onLine) return
      loadRoomFromChain(roomId, playerAddress ?? undefined)
    }, 5_000)
    return () => clearInterval(id)
  }, [roomId, playerAddress, loadRoomFromChain])

  const refresh = useCallback(() => {
    if (roomId) loadRoomFromChain(roomId, playerAddress ?? undefined)
  }, [roomId, playerAddress, loadRoomFromChain])

  // ── Direct WebSocket chain event watcher ──────────────────────────────────
  // Resilience layer: only force a chain re-sync when socket snapshots are
  // stale (or disconnected), avoiding redundant reads during healthy socket flow.
  useEffect(() => {
    if (!roomId) return
    const wsUrl = process.env.NEXT_PUBLIC_WS_RPC_URL
    if (!wsUrl) return
    const network = (process.env.NEXT_PUBLIC_NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
    const contractAddr = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}` | undefined
    if (!contractAddr) return

    const chain = network === 'mainnet' ? celo : celoSepolia
    let unwatch: (() => void) | null = null

    try {
      const wsClient = createPublicClient({ chain, transport: webSocket(wsUrl) })
      const roomBigInt = BigInt(roomId)
      unwatch = wsClient.watchEvent({
        address: contractAddr,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onLogs: (logs: any[]) => {
          // All PlagueGame events have roomId as the first indexed topic.
          const relevant = logs.some(log => {
            if (!log.topics?.[1]) return false
            try { return BigInt(log.topics[1]) === roomBigInt } catch { return false }
          })
          if (!relevant) return

          const snapshotAge = Date.now() - lastSnapshotAtRef.current
          const snapshotIsStale = snapshotAge > SNAPSHOT_STALE_MS

          if (!socketConnectedRef.current || snapshotIsStale) {
            loadRoomFromChain(roomId, playerAddress ?? undefined)
          }
        },
        onError: () => {
          // WS errors are non-fatal; the polling fallback and socket.io handle it.
        },
      })
    } catch {
      // If the WS transport fails to initialise (bad URL etc.), degrade silently.
    }

    return () => {
      try { unwatch?.() } catch { /* ignore */ }
    }
  }, [roomId, playerAddress, loadRoomFromChain])

  return { ...state, feed, socket: socketRef.current, refresh }
}

