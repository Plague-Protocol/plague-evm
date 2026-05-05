'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'
import { createContractClient } from '@/lib/contract'
import type { GameState, GameEvent, GameOutcome, Room, Player, Round, RoundPhase } from '@/types/game'

// ── Contract client (read-only, no wallet needed) ─────────────────────────────

function getContractClient() {
  const network = (process.env.NEXT_PUBLIC_NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
  const address = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}` | undefined
  if (!address) return null
  return createContractClient({ contractAddress: address, network })
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
    // Keep commitment only if actually set (non-zero bytes32)
    roleCommitment: raw.roleCommitment && raw.roleCommitment !== '0x0000000000000000000000000000000000000000000000000000000000000000'
      ? String(raw.roleCommitment)
      : undefined,
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

  const socketRef    = useRef<Socket | null>(null)
  const feedRef      = useRef<string[]>([])
  const pendingOutcomeRef = useRef<GameOutcome | null>(null)
  const [feed, setFeed] = useState<string[]>([])

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
          const already = prev.room.players.some(pl => pl.walletAddress === p.address)
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
          }
          if (!prev.room) return prev
          return { ...prev, room: { ...prev.room, players: [...prev.room.players, newPlayer] } }
        })
        break

      case 'game_started':
        appendFeed('Game started — submit your role commitment.')
        setState(prev => prev.room ? { ...prev, room: { ...prev.room, status: 'starting' } } : prev)
        break

      case 'round_started':
        appendFeed(`Round ${p.round} started.`)
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
        appendFeed(`Phase → ${phaseName.toUpperCase()}`)
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
        appendFeed(`An innocence proof was submitted.`)
        break

      case 'player_eliminated':
        appendFeed(`A player has been ELIMINATED.`)
        setState(prev => ({
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
        }))
        break

      case 'player_saved_by_proof':
        appendFeed(`A player was SAVED by their innocence proof.`)
        break

      case 'vote_resolved':
        appendFeed(`Vote resolved: ${String(p.message)}`)
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
        appendFeed('The patient zero mantle has passed to a new host.')
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
          const alivePlayers = prev.room.players.filter(pl => !pl.isEliminated)
          const cleanAlive = alivePlayers.filter(pl => pl.status === 'clean')
          const infectedAlive = alivePlayers.filter(pl => pl.status === 'infected')
          let winners: string[] = []
          let losers: string[] = []
          if (outcome === 'clean_win') {
            winners = cleanAlive.map(pl => pl.walletAddress)
            losers  = infectedAlive.map(pl => pl.walletAddress)
          } else if (outcome === 'infected_win') {
            winners = infectedAlive.map(pl => pl.walletAddress)
            losers  = cleanAlive.map(pl => pl.walletAddress)
          }
          return {
            ...prev,
            room: { ...prev.room, status: 'ended' },
            result: {
              outcome,
              winners,
              losers,
              potPerWinner: 0n,
              totalPot: prev.room.stakeAmount * BigInt(prev.room.players.length),
              rounds: prev.currentRound?.number ?? 0,
            },
          }
        })
        break
      }

      case 'pot_drained': {
        const winner = String(p.winner)
        const amount = BigInt(typeof p.amount === 'string' || typeof p.amount === 'number' ? String(p.amount) : '0')
        appendFeed(`Pot distributed — winner received ${(Number(amount) / 1e18).toFixed(4)} cUSD.`)
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
        appendFeed('Proof submission window OPEN — Discussion phase.')
        break

      case 'proof_window_closed':
        appendFeed('Proof submission window CLOSED — Voting phase starting.')
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
      const raw = await client.getRoom(BigInt(rid))
      const room = mapRoom(raw)

      // Load each player's data from chain
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const players: Player[] = await Promise.all((raw as any).players.map(async (addr: string, idx: number) => {
        const pRaw = await client.getPlayer(BigInt(rid), addr as `0x${string}`)
        return mapPlayer(pRaw, addr, idx + 1)
      }))
      room.players = players

      const localPlayer = playerAddress
        ? players.find(p => p.walletAddress.toLowerCase() === playerAddress.toLowerCase()) ?? null
        : null

      setState(prev => ({ ...prev, room, localPlayer, isLoading: false, error: null }))
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
      setState(prev => ({ ...prev, isConnected: true }))
      socket.emit('join_room', {
        roomId,
        playerAddress,
      })
    })

    socket.on('room_state', (initialState: { room: unknown; players: unknown[]; error?: string }) => {
      // Server sends full room snapshot on join
      if (initialState?.room) {
        const room = mapRoom(initialState.room)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        room.players = (initialState.players ?? []).map((p: any, idx: number) => mapPlayer(p, p.addr ?? p.address, idx + 1))
        const localPlayer = playerAddress
          ? room.players.find(p => p.walletAddress.toLowerCase() === playerAddress.toLowerCase()) ?? null
          : null
        setState(prev => ({ ...prev, room, localPlayer, isLoading: false }))
      } else if (initialState?.error === 'room_not_found') {
        // Room does not exist on-chain — no point re-reading the chain
        setState(prev => ({ ...prev, isLoading: false, error: 'Room not found.' }))
      } else {
        // Fallback: read from chain
        loadRoomFromChain(roomId, playerAddress ?? undefined)
      }
    })

    socket.on('game_event', handleEvent)

    socket.on('connect_error', (err) => {
      // Socket unavailable — fall back to chain read
      loadRoomFromChain(roomId, playerAddress ?? undefined)
      setState(prev => ({ ...prev, isConnected: false, error: `Backend offline: ${err.message}. Showing on-chain data.` }))
    })

    socket.on('disconnect', () => {
      setState(prev => ({ ...prev, isConnected: false }))
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [roomId, playerAddress, handleEvent, loadRoomFromChain])

  return { ...state, feed, socket: socketRef.current }
}

