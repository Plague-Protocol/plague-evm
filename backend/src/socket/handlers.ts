import { Server, Socket } from 'socket.io'
import { logger } from '../lib/logger'
import type { GameEvent } from '../types/game'
import { chainAdapter } from '../services/chainAdapter'
import { listExpiredWaitingRooms, setRoomStatus } from '../repositories/rooms'
import { keccak256, toBytes } from 'viem'

type RawRoom = Awaited<ReturnType<typeof chainAdapter.getRoom>>

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
 */
async function collectExpiredRoomIds(nowSecs: number): Promise<Set<string>> {
  const ids = new Set<string>()
  const expiredPersistedRooms = await listExpiredWaitingRooms(new Date())
  for (const room of expiredPersistedRooms) {
    ids.add(room.roomId)
  }
  const count = await chainAdapter.getRoomCount()
  for (let id = 1n; id <= count; id++) {
    try {
      const rawRoom = await chainAdapter.getRoom(id)
      // RoomStatus.Waiting = 0
      if (rawRoom.status !== 0) continue
      if (Number(rawRoom.expiresAt) > nowSecs) continue
      ids.add(id.toString())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn(`[expiry-monitor] failed to inspect room ${id}: ${message}`)
    }
  }
  return ids
}

async function processExpiredRoom(io: Server, roomId: string): Promise<void> {
  try {
    await chainAdapter.expireRoom(BigInt(roomId))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(`[expiry-monitor] failed to expire room ${roomId} on-chain: ${message}`)
    return
  }
  try {
    await setRoomStatus(roomId, 'ended')
  } catch {
    // Some rooms are created directly on-chain from the frontend and do not
    // have a persisted room record yet.
  }
  const event: GameEvent = {
    type: 'room_expired',
    roomId,
    payload: {},
    timestamp: Date.now(),
  }
  io.to(roomId).emit('game_event', event)
  logger.info(`[expiry-monitor] expired waiting room ${roomId}`)
}

async function enrichEventArgs(
  eventName: string,
  args: Record<string, unknown>,
  roomId: string,
): Promise<Record<string, unknown>> {
  const enriched = { ...args }
  if (eventName !== 'RoundStarted' && eventName !== 'PhaseChanged') return enriched
  try {
    const rawRoom = await chainAdapter.getRoom(BigInt(roomId))
    const phase = eventName === 'PhaseChanged'
      ? Number(args.phase)
      : rawRoom.currentPhase
    let durationMs = 0
    if (phase === 1) durationMs = Number(rawRoom.config.discussionDurationSecs) * 1000
    else if (phase === 2) durationMs = Number(rawRoom.config.votingDurationSecs) * 1000
    enriched.durationMs = durationMs
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(`[socket] failed to enrich ${eventName} for room ${roomId}: ${message}`)
  }
  return enriched
}

export function startRoomExpiryMonitor(io: Server, intervalMs = 15_000): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const nowSecs = Math.floor(Date.now() / 1000)
      const expiredRoomIds = await collectExpiredRoomIds(nowSecs)
      if (expiredRoomIds.size === 0) return
      for (const roomId of expiredRoomIds) {
        await processExpiredRoom(io, roomId)
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
  const unwatch = chainAdapter.watchAll(async ({ eventName, args }) => {
    const roomId = (args.roomId as bigint | undefined)?.toString()
    if (!roomId) return

    const timestamp = Date.now()
    const enrichedArgs = await enrichEventArgs(eventName, args, roomId)

    if (eventName === 'InfectionAssigned') {
      const player = (enrichedArgs.player as string) ?? ''
      const socketId = playerSockets.get(roomId)?.get(player.toLowerCase())
      if (!socketId) return
      io.to(socketId).emit('game_event', {
        type: 'infection_assigned', roomId, payload: { player }, timestamp,
      } as GameEvent)
      return
    }

    const mapped = mapChainEventToGameEvent(eventName, enrichedArgs, roomId, timestamp)
    if (!mapped) return
    // mapChainEventToGameEvent can return a single event or an array
    if (Array.isArray(mapped)) {
      for (const ev of mapped) io.to(roomId).emit('game_event', ev)
    } else {
      io.to(roomId).emit('game_event', mapped)
    }
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
          rawRoom.players.map(addr =>
            chainAdapter.getPlayer(BigInt(roomId), addr)
          )
        )
        socket.emit('room_state', { room: rawRoom, players: rawPlayers })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // InvalidRoom() selector 0x353cbf17 — room ID does not exist on-chain
        if (message.includes('0x353cbf17') || message.includes('InvalidRoom')) {
          logger.debug(`[socket] room ${roomId} not found on-chain`)
          socket.emit('room_state', { room: null, players: [], error: 'room_not_found' })
        } else {
          logger.warn(`[socket] failed to load room_state for ${roomId}: ${message}`)
          socket.emit('room_state', { room: null, players: [] })
        }
      }
      logger.info(`${socket.id} subscribed to room ${roomId}`)
    })

    /**
     * Player leaves a room
     */
    socket.on('leave_room', ({ roomId, playerAddress }: { roomId: string; playerAddress?: string }) => {
      socket.leave(roomId)
      if (playerAddress) {
        playerSockets.get(roomId)?.delete(playerAddress.toLowerCase())
      }
    })

    /**
     * Phase timer tick — backend manages phase transitions
     */
    socket.on('request_phase_advance', async ({ roomId }: { roomId: string }) => {
      try {
        const rawRoom = await chainAdapter.getRoom(BigInt(roomId))
        const phaseStartedAt = Number(rawRoom.phaseStartedAt) * 1000

        // RoomStatus.Active = 2
        if (rawRoom.status !== 2) return

        const now = Date.now()

        // RoundPhase.Discussion = 1
        if (rawRoom.currentPhase === 1) {
          const durationMs = Number(rawRoom.config.discussionDurationSecs) * 1000
          if (now < phaseStartedAt + durationMs) return
          await chainAdapter.openVoting(BigInt(roomId))
          return
        }

        // RoundPhase.Voting = 2
        if (rawRoom.currentPhase === 2) {
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
     */
    socket.on('assign_infection', async ({ roomId, round }: { roomId: string; round: number }) => {
      try {
        const rawRoom = await chainAdapter.getRoom(BigInt(roomId))

        // Active + Infection only
        if (rawRoom.status !== 2 || rawRoom.currentPhase !== 0) return

        const playerAddrs = rawRoom.players
        const playerStates = await Promise.all(
          playerAddrs.map(addr => chainAdapter.getPlayer(BigInt(roomId), addr))
        )

        const cleanAlive: `0x${string}`[] = []
        for (let i = 0; i < playerAddrs.length; i++) {
          if (playerStates[i].status === 0) cleanAlive.push(playerAddrs[i])
        }
        if (cleanAlive.length === 0) return

        const blockHash = await chainAdapter.getLatestBlockHash()
        const seed = `${roomId}:${round}:${blockHash}`
        const h = BigInt(keccak256(toBytes(seed)))
        const idx = Number(h % BigInt(cleanAlive.length))
        const target = cleanAlive[idx]

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
     */
    socket.on('submit_proof', async (payload: {
      roomId: string
      playerAddress: string
      commitment: string
      nullifier: string
      zkProof: string
      isFreeProof: boolean
    }) => {
      const { roomId: rid, playerAddress } = payload
      try {
        const rawRoom = await chainAdapter.getRoom(BigInt(rid))
        if (rawRoom.status !== 2) {
          socket.emit('proof_error', { roomId: rid, message: 'Room is not active' })
          return
        }
        // RoundPhase.Discussion = 1
        if (rawRoom.currentPhase !== 1) {
          socket.emit('proof_error', { roomId: rid, message: 'Proof submission only allowed during Discussion phase' })
          return
        }
        const rawPlayer = await chainAdapter.getPlayer(BigInt(rid), playerAddress as `0x${string}`)
        if (rawPlayer.addr === '0x0000000000000000000000000000000000000000') {
          socket.emit('proof_error', { roomId: rid, message: 'Player not in room' })
          return
        }
        if (rawPlayer.status === 2) {
          socket.emit('proof_error', { roomId: rid, message: 'Eliminated players cannot submit proofs' })
          return
        }
        if (rawPlayer.hasProofThisRound) {
          socket.emit('proof_error', { roomId: rid, message: 'Already submitted a proof this round' })
          return
        }
        // The actual contract call is signed by the player from the frontend.
        // Acknowledge receipt so the client knows validation passed.
        socket.emit('proof_ack', { roomId: rid, playerAddress })
        logger.info(`[socket] proof_ack for player ${playerAddress} in room ${rid}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(`[socket] submit_proof validation failed for room ${rid}: ${message}`)
        socket.emit('proof_error', { roomId: rid, message })
      }
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
): GameEvent | GameEvent[] | null {
  switch (eventName) {
    case 'PlayerJoined':
      return { type: 'player_joined', roomId, payload: { address: String(args.player) }, timestamp }
    case 'GameStarted':
      return { type: 'game_started', roomId, payload: {}, timestamp }
    case 'RoundStarted':
      return { type: 'round_started', roomId, payload: { round: Number(args.round) }, timestamp }
    case 'PhaseChanged': {
      const phase = Number(args.phase)
      // Emit phase_changed for all clients
      const events: GameEvent[] = [
        { type: 'phase_changed', roomId, payload: { phase }, timestamp },
      ]
      // Emit companion events so clients can show/hide proof window reactively
      if (phase === 1) {
        // RoundPhase.Discussion
        events.push({ type: 'proof_window_open', roomId, payload: {}, timestamp })
      } else if (phase === 2) {
        // RoundPhase.Voting
        events.push({ type: 'proof_window_closed', roomId, payload: {}, timestamp })
      }
      return events
    }
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
    case 'PatientZeroUpdated':
      return {
        type: 'patient_zero_updated',
        roomId,
        payload: { patientZero: String(args.patientZero) },
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

/**
 * Role-commitment monitor — polls for rooms in Starting status and triggers
 * beginActivePhase once all players have submitted their role commitments.
 *
 * There is no on-chain event for submitRoleCommitment, so we must poll.
 * Default interval: 5 seconds.
 */
async function processRoomForCommitment(id: bigint): Promise<void> {
  const rawRoom = await chainAdapter.getRoom(id)
  // RoomStatus.Starting = 1
  if (rawRoom.status !== 1) return
  const playerAddrs = rawRoom.players
  if (playerAddrs.length === 0) return
  const playerStates = await Promise.all(
    playerAddrs.map(addr => chainAdapter.getPlayer(id, addr))
  )
  const allCommitted = playerStates.every(p => p.roleCommitted === true)
  if (!allCommitted) return
  try {
    await chainAdapter.beginActivePhase(id)
    logger.info(`[role-commitment-monitor] beginActivePhase called for room ${id}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Ignore "WrongPhase" — another process may have already advanced it
    if (!message.includes('WrongPhase')) {
      logger.warn(`[role-commitment-monitor] failed for room ${id}: ${message}`)
    }
  }
}

export function startRoleCommitmentMonitor(_io: Server, intervalMs = 5_000): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const count = await chainAdapter.getRoomCount()
      for (let id = 1n; id <= count; id++) {
        await processRoomForCommitment(id)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`[role-commitment-monitor] tick error: ${message}`)
    }
  }, intervalMs)
}

/**
 * Phase-advance monitor — server-side replacement for the client-initiated
 * request_phase_advance socket event. Polls Active rooms and advances
 * Discussion → Voting and Voting → Reveal when their timers expire.
 *
 * Default interval: 5 seconds.
 */
async function handleInfectionPhase(id: bigint, rawRoom: RawRoom): Promise<void> {
  try {
    const playerAddrs = rawRoom.players
    const playerStates = await Promise.all(
      playerAddrs.map(addr => chainAdapter.getPlayer(id, addr))
    )
    const cleanAlive: `0x${string}`[] = []
    for (let i = 0; i < playerAddrs.length; i++) {
      if (playerStates[i].status === 0) cleanAlive.push(playerAddrs[i])
    }
    if (cleanAlive.length === 0) return
    const blockHash = await chainAdapter.getLatestBlockHash()
    const round = Number(rawRoom.currentRound)
    const h = BigInt(keccak256(toBytes(`${id}:${round}:${blockHash}`)))
    const target = cleanAlive[Number(h % BigInt(cleanAlive.length))]
    await chainAdapter.assignInfection(id, target)
    logger.info(`[phase-advance-monitor] assignInfection called for room ${id} round ${round} target ${target}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!message.includes('WrongPhase') && !message.includes('NotActive') && !message.includes('InvalidInfectionTarget')) {
      logger.warn(`[phase-advance-monitor] assignInfection failed for room ${id}: ${message}`)
    }
  }
}

async function handleDiscussionPhase(id: bigint, rawRoom: RawRoom, now: number): Promise<void> {
  const phaseStartedAt = Number(rawRoom.phaseStartedAt) * 1000
  const durationMs = Number(rawRoom.config.discussionDurationSecs) * 1000
  if (now < phaseStartedAt + durationMs) return
  try {
    await chainAdapter.openVoting(id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!message.includes('WrongPhase') && !message.includes('NotActive')) {
      logger.warn(`[phase-advance-monitor] openVoting failed for room ${id}: ${message}`)
    }
  }
}

async function handleVotingPhase(id: bigint, rawRoom: RawRoom, now: number): Promise<void> {
  const phaseStartedAt = Number(rawRoom.phaseStartedAt) * 1000
  const durationMs = Number(rawRoom.config.votingDurationSecs) * 1000
  if (now < phaseStartedAt + durationMs) return
  try {
    await chainAdapter.resolveRound(id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!message.includes('WrongPhase') && !message.includes('NotActive')) {
      logger.warn(`[phase-advance-monitor] resolveRound failed for room ${id}: ${message}`)
    }
  }
}

async function processActiveRoom(id: bigint, rawRoom: RawRoom, now: number): Promise<void> {
  const phase = Number(rawRoom.currentPhase)
  if (phase === 0) await handleInfectionPhase(id, rawRoom)
  else if (phase === 1) await handleDiscussionPhase(id, rawRoom, now)
  else if (phase === 2) await handleVotingPhase(id, rawRoom, now)
}

export function startPhaseAdvanceMonitor(_io: Server, intervalMs = 5_000): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const count = await chainAdapter.getRoomCount()
      const now = Date.now()
      for (let id = 1n; id <= count; id++) {
        const rawRoom = await chainAdapter.getRoom(id)
        // RoomStatus.Active = 2
        if (rawRoom.status !== 2) continue
        await processActiveRoom(id, rawRoom, now)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`[phase-advance-monitor] tick error: ${message}`)
    }
  }, intervalMs)
}
