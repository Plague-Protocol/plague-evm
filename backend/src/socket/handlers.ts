import { Server, Socket } from 'socket.io'
import { logger } from '../lib/logger'
import type { GameEvent } from '../types/game'
import { chainAdapter } from '../services/chainAdapter'
import { listExpiredWaitingRooms, setRoomStatus } from '../repositories/rooms'
import { keccak256, toBytes } from 'viem'

// TODO: Issue #20 - Implement full socket event handlers
// TODO: Issue #21 - Implement room state sync via Redis

/**
 * Room expiry monitor — runs on a fixed interval server-side.
 *
 * Checks all rooms with status === 'waiting' whose expires_at has passed.
 * For each expired room:
 *   1. Calls contract.expire_room(room_id) — refunds all staked players.
 *   2. Broadcasts a room_expired event to all room subscribers.
 *   3. Removes the room from the active room registry.
 *
 * This runs independently of any client socket connection, so expiry is
 * enforced even if no player is watching the room at that moment.
 *
 * Default check interval: 15 seconds.
 * TODO: Issue #47 — implement DB/Redis room registry and contract call
 */
export function startRoomExpiryMonitor(io: Server, intervalMs = 15_000): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const expired = await listExpiredWaitingRooms(new Date())
      if (expired.length === 0) return

      for (const room of expired) {
        const roomId = room.roomId
        try {
          await chainAdapter.expireRoom(BigInt(roomId))
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          logger.warn(`[expiry-monitor] failed to expire room ${roomId} on-chain: ${message}`)
          continue
        }

        await setRoomStatus(roomId, 'ended')

        const event: GameEvent = {
          type: 'room_expired',
          roomId,
          payload: {},
          timestamp: Date.now(),
        }
        io.to(roomId).emit('game_event', event)
        logger.info(`[expiry-monitor] expired waiting room ${roomId}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`[expiry-monitor] tick error: ${message}`)
    }
  }, intervalMs)
}

export function setupSocketHandlers(io: Server) {
  // Map (roomId -> playerAddressLower -> socketId) for private events.
  const playerSockets = new Map<string, Map<string, string>>()

  // Start a single chain watcher for the whole server process.
  // It will broadcast public events to the room, and route private events using playerSockets.
  const unwatch = chainAdapter.watchAll(({ eventName, args }) => {
    const roomId = (args.roomId as bigint | undefined)?.toString()
    if (!roomId) return

    const timestamp = Date.now()

    if (eventName === 'InfectionAssigned') {
      const player = String(args.player ?? '')
      const roomMap = playerSockets.get(roomId)
      const socketId = roomMap?.get(player.toLowerCase())
      if (!socketId) return

      const event: GameEvent = {
        type: 'infection_assigned',
        roomId,
        payload: { player },
        timestamp,
      }
      io.to(socketId).emit('game_event', event)
      return
    }

    const mapped = mapChainEventToGameEvent(eventName, args, roomId, timestamp)
    if (!mapped) return
    io.to(roomId).emit('game_event', mapped)
  })

  io.on('connection', (socket: Socket) => {
    logger.info(`Client connected: ${socket.id}`)

    /**
     * Subscribe to a room's real-time events (socket only — NOT game join).
     *
     * This handler lets any connected client receive events for a room.
     * It does NOT add the player to the game or grant participation rights.
     *
     * Game joining (staking, role commitment) is done via the contract:
     *   contract.join_room(room_id)  — only valid while room.status == 'waiting'
     *
     * Players who subscribe after status is 'active' can spectate (receive
     * events) but will never receive private infection_assigned events, cannot
     * vote, cannot submit proofs, and are not eligible for payouts.
     *
     * TODO: Issue #20
     */
    socket.on('join_room', async ({ roomId, playerAddress }: { roomId: string; playerAddress: string }) => {
      socket.join(roomId)
      if (playerAddress) {
        const lower = playerAddress.toLowerCase()
        const roomMap = playerSockets.get(roomId) ?? new Map<string, string>()
        roomMap.set(lower, socket.id)
        playerSockets.set(roomId, roomMap)
      }

      try {
        const rawRoom = await chainAdapter.getRoom(BigInt(roomId))
        const rawPlayers = await Promise.all(
          (rawRoom as any).players.map((addr: string) =>
            chainAdapter.getPlayer(BigInt(roomId), addr as `0x${string}`)
          )
        )
        socket.emit('room_state', { room: rawRoom, players: rawPlayers })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(`[socket] failed to load room_state for ${roomId}: ${message}`)
        socket.emit('room_state', { room: null, players: [] })
      }
      logger.info(`${socket.id} subscribed to room ${roomId}`)
    })

    /**
     * Player leaves a room
     * TODO: Issue #20
     */
    socket.on('leave_room', ({ roomId }: { roomId: string }) => {
      socket.leave(roomId)
    })

    /**
     * Phase timer tick — backend manages phase transitions
     * TODO: Issue #23
     */
    socket.on('request_phase_advance', async ({ roomId }: { roomId: string }) => {
      try {
        const rawRoom: any = await chainAdapter.getRoom(BigInt(roomId))
        const status = Number(rawRoom.status)
        const phase = Number(rawRoom.currentPhase)
        const phaseStartedAt = Number(rawRoom.phaseStartedAt) * 1000

        // RoomStatus.Active = 2
        if (status !== 2) return

        const now = Date.now()

        // RoundPhase.Discussion = 1
        if (phase === 1) {
          const durationMs = Number(rawRoom.config.discussionDurationSecs) * 1000
          if (now < phaseStartedAt + durationMs) return
          await chainAdapter.openVoting(BigInt(roomId))
          return
        }

        // RoundPhase.Voting = 2
        if (phase === 2) {
          const durationMs = Number(rawRoom.config.votingDurationSecs) * 1000
          if (now < phaseStartedAt + durationMs) return
          await chainAdapter.resolveRound(BigInt(roomId))
          return
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(`[socket] request_phase_advance failed for ${roomId}: ${message}`)
      }
    })

    /**
     * Infection assignment — system assigns each round, NOT player-chosen.
     *
     * Normal case:
     *   target = eligible_clean_alive_players[
     *     hash(roomId, round, prevTxHash) % count
     *   ]
     *
     * Only the infected player receives the private 'infection_assigned' event.
     * No event reveals who caused the infection.
     *
     * TODO: Issue #22
     */
    socket.on('assign_infection', async ({ roomId, round }: { roomId: string; round: number }) => {
      try {
        const rawRoom: any = await chainAdapter.getRoom(BigInt(roomId))
        const status = Number(rawRoom.status)
        const phase = Number(rawRoom.currentPhase)

        // Active + Infection only
        if (status !== 2 || phase !== 0) return

        const playerAddrs: string[] = (rawRoom.players ?? []) as string[]
        const playerStates = await Promise.all(
          playerAddrs.map(addr => chainAdapter.getPlayer(BigInt(roomId), addr as `0x${string}`))
        )

        const cleanAlive: string[] = []
        for (let i = 0; i < playerAddrs.length; i++) {
          const st: any = playerStates[i]
          const pStatus = Number(st.status)
          if (pStatus === 0) cleanAlive.push(playerAddrs[i])
        }
        if (cleanAlive.length === 0) return

        const blockHash = await chainAdapter.getLatestBlockHash()
        const seed = `${roomId}:${round}:${blockHash}`
        const h = BigInt(keccak256(toBytes(seed)))
        const idx = Number(h % BigInt(cleanAlive.length))
        const target = cleanAlive[idx] as `0x${string}`

        await chainAdapter.assignInfection(BigInt(roomId), target)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(`[socket] assign_infection failed for ${roomId}: ${message}`)
      }
    })

    /**
     * Proof submission during the Discussion phase.
     *
     * The window opens at the start of discussion and closes the moment
     * voting begins. No proofs are accepted after that.
     *
     * This is a strategic bet: the player commits BEFORE knowing who
     * will be the top-voted target. Key rules:
     *   - 1 free proof per player per game (free_proof_used flag)
     *   - proof_fee charged for subsequent proofs (added to pot)
     *   - max 1 per player per round (nullifier-enforced)
     *   - only CLEAN players can produce a valid proof (infected fail circuit)
     *
     * What the proof does at resolve time:
     *   - Sole top-voted + has proof → saved, no elimination
     *   - Tied top-voted, any infected in tie → infected eliminated; protected clean survive
     *   - Tied top-voted, no infected, some unprotected → unprotected eliminated
     *   - Tied top-voted, all have proofs → all survive, no extra infection (PZ-only rule)
     *
     * TODO: Issue #45
     */
    socket.on('submit_proof', async (payload: {
      roomId: string
      playerAddress: string
      commitment: string
      nullifier: string
      zkProof: string
      isFreeProof: boolean
    }) => {
      // TODO: Issue #45
      // 1. Verify current phase is Discussion
      // 2. Verify player is alive
      // 3. Forward to contract: submitInnocenceProof(...)
      // 4. On success, broadcast proof_submitted event (address only, no outcome)
      // 5. Lock out further submissions from this player this round
    })

    /**
     * Round resolution — called after voting phase ends.
     *
     * Proof window was closed before voting began. Resolution uses
     * whatever proofs players chose to submit during discussion.
     *
     * Resolution cases (see contract spec for full algorithm):
     *   A: Single top candidate, no proof → eliminated
     *   B: Single top candidate, has proof → saved, no elimination
     *   C: Tied, some unprotected → unprotected candidate eliminated
     *   D: Tied, all have proofs → one randomly infected (not eliminated)
     *
     * Absent vote rule:
     *   Players who didn't vote get their vote cast for the current
     *   leading target (prevents mass-abstention collusion by infected).
     *
     * Endgame check after each resolve:
     *   infected_alive == 0            → clean_win
     *   infected_alive >= clean_alive  → infected_win  (includes 1 vs 1)
     *   round == max_rounds            → infected_win (time expired)
     *
     * TODO: Issue #46
     */
    socket.on('resolve_round', async ({ roomId }: { roomId: string }) => {
      try {
        await chainAdapter.resolveRound(BigInt(roomId))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(`[socket] resolve_round failed for ${roomId}: ${message}`)
      }
    })

    socket.on('disconnect', () => {
      for (const [, roomMap] of playerSockets) {
        for (const [addr, sid] of roomMap) {
          if (sid === socket.id) roomMap.delete(addr)
        }
      }
      logger.info(`Client disconnected: ${socket.id}`)
    })
  })

  io.engine.on('close', () => {
    unwatch()
  })
}

function mapChainEventToGameEvent(
  eventName: string,
  args: Record<string, unknown>,
  roomId: string,
  timestamp: number,
): GameEvent | null {
  switch (eventName) {
    case 'PlayerJoined':
      return { type: 'player_joined', roomId, payload: { address: String(args.player) }, timestamp }
    case 'GameStarted':
      return { type: 'game_started', roomId, payload: {}, timestamp }
    case 'RoundStarted':
      return { type: 'round_started', roomId, payload: { round: Number(args.round) }, timestamp }
    case 'PhaseChanged':
      return { type: 'phase_changed', roomId, payload: { phase: Number(args.phase) }, timestamp }
    case 'VoteCast':
      return {
        type: 'vote_cast',
        roomId,
        payload: { voter: String(args.voter), target: String(args.target) },
        timestamp,
      }
    case 'ProofSubmitted':
      return { type: 'proof_submitted', roomId, payload: { player: String(args.player) }, timestamp }
    case 'PlayerEliminated':
      return { type: 'player_eliminated', roomId, payload: { player: String(args.player) }, timestamp }
    case 'PlayerSavedByProof':
      return { type: 'player_saved_by_proof', roomId, payload: { player: String(args.player) }, timestamp }
    case 'VoteResolved':
      return { type: 'vote_resolved', roomId, payload: { message: String(args.message) }, timestamp }
    case 'GameEnded':
      return { type: 'game_ended', roomId, payload: { outcome: Number(args.outcome) }, timestamp }
    case 'PotDrained':
      return {
        type: 'pot_drained',
        roomId,
        payload: { winner: String(args.winner), amount: String(args.amount) },
        timestamp,
      }
    case 'RoomExpired':
      return { type: 'room_expired', roomId, payload: {}, timestamp }
    default:
      return null
  }
}

/**
 * Broadcast a game event to all players in a room
 */
export function broadcastEvent(io: Server, roomId: string, event: GameEvent) {
  io.to(roomId).emit('game_event', event)
}
