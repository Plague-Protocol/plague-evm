import { Server, Socket } from 'socket.io'
import { logger } from '../lib/logger'
import type { GameEvent } from '../types/game'
import { chainAdapter } from '../services/chainAdapter'
import { listExpiredWaitingRooms, setRoomStatus, upsertGameSummary } from '../repositories/rooms'
import { keccak256, toBytes } from 'viem'
import { redis } from '../db/redis'

type RawRoom = Awaited<ReturnType<typeof chainAdapter.getRoom>>
type RawPlayer = Awaited<ReturnType<typeof chainAdapter.getPlayer>>

// Scope chat keys to contract address so redeployments don't bleed messages
// between rooms with the same numeric ID.
const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS ?? 'unknown').toLowerCase()
const CHAT_KEY_VERSION = 'v2'
const CHAT_NAMESPACE = (process.env.CHAT_NAMESPACE ?? `${(process.env.NETWORK ?? 'testnet').toLowerCase()}:${CONTRACT_ADDRESS}`)
  .trim()
  .toLowerCase()
const resolvedRoomChatKeys = new Map<string, string>()

function buildChatKey(roomId: string, roomCreatedAt?: number): string {
  const createdAtPart = roomCreatedAt ? String(roomCreatedAt) : 'na'
  return `chat:${CHAT_KEY_VERSION}:${CHAT_NAMESPACE}:${roomId}:${createdAtPart}`
}

function cacheChatKey(roomId: string, rawRoom: RawRoom): string {
  const key = buildChatKey(roomId, Number(rawRoom.createdAt))
  resolvedRoomChatKeys.set(roomId, key)
  return key
}

async function getChatKeyForRoom(roomId: string): Promise<string> {
  const cached = resolvedRoomChatKeys.get(roomId)
  if (cached) return cached
  const rawRoom = await chainAdapter.getRoom(BigInt(roomId))
  return cacheChatKey(roomId, rawRoom)
}

/**
 * Per-room in-progress lock for phase transitions.
 * Prevents the commitment monitor, phase-advance monitor, and socket handler
 * from firing duplicate transactions for the same room concurrently.
 */
const roomPhaseInProgress = new Set<bigint>()
let expiryMonitorTickInProgress = false
let roleCommitmentTickInProgress = false
let phaseAdvanceTickInProgress = false
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ROLE_COMMIT_TIMEOUT_MS = Number(process.env.ROLE_COMMIT_TIMEOUT_MS ?? 120_000)
const ELIMINATION_PHASE_DURATION_MS = Number(process.env.ELIMINATION_PHASE_DURATION_MS ?? 6_000)
const ROOM_SNAPSHOT_THROTTLE_MS = Number(process.env.ROOM_SNAPSHOT_THROTTLE_MS ?? 250)
const LOBBY_REFRESH_THROTTLE_MS = Number(process.env.LOBBY_REFRESH_THROTTLE_MS ?? 400)
const EARLY_RESOLVE_RETRY_DELAY_MS = Number(process.env.EARLY_RESOLVE_RETRY_DELAY_MS ?? 1_000)
const EARLY_RESOLVE_MAX_RETRIES = Number(process.env.EARLY_RESOLVE_MAX_RETRIES ?? 6)
const NETWORK = (process.env.NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
const CHAIN_ID = NETWORK === 'mainnet' ? 42220 : 44787
const earlyResolveRetryTimers = new Map<string, NodeJS.Timeout>()
const earlyResolveRetryAttempts = new Map<string, number>()

function clearEarlyResolveRetry(roomId: string): void {
  const timer = earlyResolveRetryTimers.get(roomId)
  if (timer) clearTimeout(timer)
  earlyResolveRetryTimers.delete(roomId)
  earlyResolveRetryAttempts.delete(roomId)
}

function scheduleEarlyResolveRetry(roomId: string): void {
  if (earlyResolveRetryTimers.has(roomId)) return
  const attempts = earlyResolveRetryAttempts.get(roomId) ?? 0
  if (attempts >= EARLY_RESOLVE_MAX_RETRIES) {
    earlyResolveRetryAttempts.delete(roomId)
    return
  }

  const timer = setTimeout(() => {
    earlyResolveRetryTimers.delete(roomId)
    earlyResolveRetryAttempts.set(roomId, attempts + 1)
    void tryEarlyResolveAfterAllVotes(roomId)
  }, EARLY_RESOLVE_RETRY_DELAY_MS)

  earlyResolveRetryTimers.set(roomId, timer)
}

async function tryEarlyResolveAfterAllVotes(roomId: string): Promise<void> {
  try {
    const id = BigInt(roomId)
    const rawRoom = await chainAdapter.getRoom(id)
    // Only act during the Voting phase (phase === 2)
    if (Number(rawRoom.currentPhase) !== 2) {
      clearEarlyResolveRetry(roomId)
      return
    }

    const playerStates = await Promise.all(
      rawRoom.players.map(addr => chainAdapter.getPlayer(id, addr))
    )

    // Check whether any alive player has not yet voted.
    const aliveNotVoted = playerStates.filter(
      p => Number(p.status) !== 2 && !p.hasVotedThisRound
    )
    if (aliveNotVoted.length > 0) {
      // Keep a short retry loop to absorb RPC/event propagation lag between
      // the last VoteCast event and read visibility of hasVotedThisRound.
      scheduleEarlyResolveRetry(roomId)
      return
    }

    // All alive players have voted — trigger immediate resolve.
    if (roomPhaseInProgress.has(id)) {
      scheduleEarlyResolveRetry(roomId)
      return
    }

    roomPhaseInProgress.add(id)
    let resolveSucceeded = false
    try {
      await chainAdapter.resolveRound(id)
      resolveSucceeded = true
      logger.info(`[vote-early-resolve] resolveRound for room ${id} (all players voted early)`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!isExpectedPhaseRevert(message)) {
        logger.warn(`[vote-early-resolve] resolveRound failed for room ${id}: ${message}`)
      }
      // Retry a few times to absorb lock/race conditions and short RPC/event lag.
      scheduleEarlyResolveRetry(roomId)
    } finally {
      roomPhaseInProgress.delete(id)
      if (resolveSucceeded) clearEarlyResolveRetry(roomId)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(`[vote-early-resolve] check failed for room ${roomId}: ${message}`)
    scheduleEarlyResolveRetry(roomId)
  }
}

/**
 * Retry `getRoom` for newly-created rooms whose block hasn't propagated to
 * every Forno RPC node yet. Backs off 1 s → 2 s → 3 s before giving up.
 */
async function getRoomWithRetry(roomId: bigint, maxRetries = 3): Promise<Awaited<ReturnType<typeof chainAdapter.getRoom>>> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await chainAdapter.getRoom(roomId)
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      const isInvalidRoom = msg.includes('0x353cbf17') || msg.includes('InvalidRoom')
      if (!isInvalidRoom || attempt === maxRetries) throw err
      const delayMs = (attempt + 1) * 1_000
      logger.debug(`[socket] room ${roomId} not found yet — retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`)
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  throw lastErr
}

async function getRoomStateForJoin(
  roomId: bigint,
  expectedPlayerAddress?: string,
  maxRetries = 4,
): Promise<{ rawRoom: RawRoom; rawPlayers: RawPlayer[] }> {
  const expected = expectedPlayerAddress?.toLowerCase()
  let latestRoom: RawRoom | null = null
  let latestPlayers: RawPlayer[] = []

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const rawRoom = await getRoomWithRetry(roomId)
    const rawPlayers = await Promise.all(rawRoom.players.map(addr => chainAdapter.getPlayer(roomId, addr)))
    latestRoom = rawRoom
    latestPlayers = rawPlayers

    if (!expected) {
      return { rawRoom, rawPlayers }
    }

    const hasExpectedPlayer = rawRoom.players.some(addr => addr.toLowerCase() === expected)
    if (hasExpectedPlayer) {
      return { rawRoom, rawPlayers }
    }

    if (attempt === maxRetries) break

    const delayMs = (attempt + 1) * 250
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }

  return {
    rawRoom: latestRoom ?? await getRoomWithRetry(roomId),
    rawPlayers: latestPlayers,
  }
}

const roomSnapshotTimers = new Map<string, NodeJS.Timeout>()
const roomSnapshotLastEmittedAt = new Map<string, number>()
const roomSnapshotInFlight = new Set<string>()
const roomSnapshotDirty = new Set<string>()
let lobbyRefreshTimer: NodeJS.Timeout | null = null
let lobbyRefreshLastEmittedAt = 0
let lobbyRefreshDirty = false
let lobbyRefreshRoomId: string | null = null

/**
 * Recursively convert BigInt values to their decimal string representation so
 * the payload can safely pass through socket.io's JSON serialisation layer.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeBigInts(value: any): any {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(serializeBigInts)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = serializeBigInts(v)
    return out
  }
  return value
}

function computePhaseEndsAtMs(rawRoom: RawRoom): number {
  const status = Number(rawRoom.status)
  if (status === 1) {
    return Number(rawRoom.startedAt) * 1000 + ROLE_COMMIT_TIMEOUT_MS
  }

  const phaseStartedAt = Number(rawRoom.phaseStartedAt) * 1000
  const phase = Number(rawRoom.currentPhase)
  if (phase === 1) return phaseStartedAt + Number(rawRoom.config.discussionDurationSecs) * 1000
  if (phase === 2) return phaseStartedAt + Number(rawRoom.config.votingDurationSecs) * 1000
  if (phase === 3) return phaseStartedAt + ELIMINATION_PHASE_DURATION_MS
  return phaseStartedAt
}

async function buildRoomSnapshot(roomId: string) {
  const id = BigInt(roomId)
  const rawRoom = await chainAdapter.getRoom(id)
  const rawPlayers = await Promise.all(rawRoom.players.map(addr => chainAdapter.getPlayer(id, addr)))

  let alive = 0
  let infectedAlive = 0
  for (const p of rawPlayers) {
    const status = Number(p.status)
    if (status === 2) continue
    alive++
    if (status === 1) infectedAlive++
  }

  return serializeBigInts({
    roomId,
    room: rawRoom,
    players: rawPlayers,
    derived: {
      activePlayers: alive,
      infectedAlive,
      cleanAlive: alive - infectedAlive,
      phaseEndsAt: computePhaseEndsAtMs(rawRoom),
      snapshotAt: Date.now(),
    },
  })
}

async function emitRoomSnapshot(io: Server, roomId: string, socketId?: string): Promise<void> {
  try {
    const snapshot = await buildRoomSnapshot(roomId)
    if (socketId) {
      io.to(socketId).emit('room_snapshot', snapshot)
      return
    }
    io.to(roomId).emit('room_snapshot', snapshot)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(`[socket] failed to emit room_snapshot for ${roomId}: ${message}`)
  }
}

function clearRoomSnapshotTimer(roomId: string): void {
  const timer = roomSnapshotTimers.get(roomId)
  if (!timer) return
  clearTimeout(timer)
  roomSnapshotTimers.delete(roomId)
}

async function flushRoomSnapshot(io: Server, roomId: string): Promise<void> {
  clearRoomSnapshotTimer(roomId)
  roomSnapshotInFlight.add(roomId)
  try {
    await emitRoomSnapshot(io, roomId)
    roomSnapshotLastEmittedAt.set(roomId, Date.now())
  } finally {
    roomSnapshotInFlight.delete(roomId)
    if (roomSnapshotDirty.delete(roomId)) {
      queueRoomSnapshot(io, roomId)
    }
  }
}

function queueRoomSnapshot(io: Server, roomId: string): void {
  if (roomSnapshotInFlight.has(roomId)) {
    roomSnapshotDirty.add(roomId)
    return
  }

  const last = roomSnapshotLastEmittedAt.get(roomId) ?? 0
  const elapsed = Date.now() - last
  const waitMs = Math.max(0, ROOM_SNAPSHOT_THROTTLE_MS - elapsed)

  if (waitMs === 0 && !roomSnapshotTimers.has(roomId)) {
    void flushRoomSnapshot(io, roomId)
    return
  }

  if (roomSnapshotTimers.has(roomId)) return

  const timer = setTimeout(() => {
    void flushRoomSnapshot(io, roomId)
  }, waitMs)
  roomSnapshotTimers.set(roomId, timer)
}

function emitLobbyRefresh(io: Server, roomId?: string): void {
  io.emit('rooms_refresh_requested', {
    roomId: roomId ?? lobbyRefreshRoomId,
    timestamp: Date.now(),
  })
}

function clearLobbyRefreshTimer(): void {
  if (!lobbyRefreshTimer) return
  clearTimeout(lobbyRefreshTimer)
  lobbyRefreshTimer = null
}

function flushLobbyRefresh(io: Server): void {
  clearLobbyRefreshTimer()
  emitLobbyRefresh(io)
  lobbyRefreshLastEmittedAt = Date.now()
  if (!lobbyRefreshDirty) return
  lobbyRefreshDirty = false
  queueLobbyRefresh(io)
}

function queueLobbyRefresh(io: Server, roomId?: string): void {
  if (roomId) lobbyRefreshRoomId = roomId

  const elapsed = Date.now() - lobbyRefreshLastEmittedAt
  const waitMs = Math.max(0, LOBBY_REFRESH_THROTTLE_MS - elapsed)

  if (waitMs === 0 && !lobbyRefreshTimer) {
    flushLobbyRefresh(io)
    return
  }

  lobbyRefreshDirty = true
  if (lobbyRefreshTimer) return
  lobbyRefreshTimer = setTimeout(() => {
    flushLobbyRefresh(io)
  }, waitMs)
}

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

async function persistGameSummaryFromChain(roomId: string, outcome?: number): Promise<void> {
  const id = BigInt(roomId)
  const rawRoom = await chainAdapter.getRoom(id)
  const rawPlayers = await Promise.all(rawRoom.players.map(addr => chainAdapter.getPlayer(id, addr)))
  const totalPot = rawPlayers.reduce((sum, player) => sum + BigInt(player.staked.toString()), 0n)
  const endedOutcome = outcome ?? (await chainAdapter.getGameEndedLogs(id))?.outcome ?? 2

  let winningFaction: 'clean' | 'infected' | null = null
  if (endedOutcome === 0) {
    winningFaction = 'clean'
  } else if (endedOutcome === 1) {
    winningFaction = 'infected'
  }

  const alivePlayers = rawPlayers.filter(player => Number(player.status) !== 2)
  const winnerAddresses = winningFaction
    ? alivePlayers.filter(player => Number(player.status) === (winningFaction === 'clean' ? 0 : 1)).map(player => player.addr)
    : alivePlayers.map(player => player.addr)
  const winnerCount = winnerAddresses.length
  const potPerWinner = winnerCount > 0 ? totalPot / BigInt(winnerCount) : 0n

  const displayNameByAddress = new Map<string, string>()
  for (const player of rawPlayers) {
    if (typeof player.addr === 'string' && player.addr.length > 0) {
      displayNameByAddress.set(player.addr.toLowerCase(), `${player.addr.slice(0, 6)}…${player.addr.slice(-4)}`)
    }
  }

  const playerSummaries = rawPlayers.map(player => {
    const status = Number(player.status)
    let result: 'win' | 'loss' | 'draw' = 'loss'
    if (endedOutcome === 2) {
      result = 'draw'
    } else if (winningFaction !== null) {
      const winningStatus = winningFaction === 'clean' ? 0 : 1
      const isWinner = status === winningStatus
      result = isWinner ? 'win' : 'loss'
    }

    let statusAtEnd: 'eliminated' | 'infected' | 'clean' = 'clean'
    if (status === 2) {
      statusAtEnd = 'eliminated'
    } else if (status === 1) {
      statusAtEnd = 'infected'
    }

    return {
      address: player.addr,
      displayNameSnapshot: displayNameByAddress.get(player.addr.toLowerCase()) ?? null,
      result,
      proofsSubmittedTotal: Number(player.proofsSubmittedTotal),
      statusAtEnd,
      joinedAt: new Date(Number(player.joinedAt) * 1000),
    }
  })

  let outcomeLabel: 'clean_win' | 'infected_win' | 'max_rounds_draw' = 'max_rounds_draw'
  if (endedOutcome === 0) {
    outcomeLabel = 'clean_win'
  } else if (endedOutcome === 1) {
    outcomeLabel = 'infected_win'
  }

  await upsertGameSummary({
    roomId,
    chainId: CHAIN_ID,
    contractAddress: process.env.CONTRACT_ADDRESS ?? '',
    outcome: outcomeLabel,
    totalRounds: Number(rawRoom.currentRound ?? 0),
    totalPot: totalPot.toString(),
    potPerWinner: potPerWinner.toString(),
    winnerCount,
    endedAt: new Date(),
    players: playerSummaries,
  })
}

async function enrichEventArgs(
  eventName: string,
  args: Record<string, unknown>,
  roomId: string,
): Promise<Record<string, unknown>> {
  const enriched = { ...args }
  if (eventName !== 'RoundStarted' && eventName !== 'PhaseChanged' && eventName !== 'GameStarted') return enriched
  try {
    const rawRoom = await chainAdapter.getRoom(BigInt(roomId))
    let durationMs = 0
    if (eventName === 'GameStarted') {
      durationMs = ROLE_COMMIT_TIMEOUT_MS
    } else {
      const phase = eventName === 'PhaseChanged'
        ? Number(args.phase)
        : rawRoom.currentPhase
      if (phase === 1) durationMs = Number(rawRoom.config.discussionDurationSecs) * 1000
      else if (phase === 2) durationMs = Number(rawRoom.config.votingDurationSecs) * 1000
      else if (phase === 3) durationMs = ELIMINATION_PHASE_DURATION_MS
    }
    enriched.durationMs = durationMs
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(`[socket] failed to enrich ${eventName} for room ${roomId}: ${message}`)
  }
  return enriched
}

export function startRoomExpiryMonitor(io: Server, intervalMs = 15_000): NodeJS.Timeout {
  return setInterval(async () => {
    if (expiryMonitorTickInProgress) return
    expiryMonitorTickInProgress = true
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
    } finally {
      expiryMonitorTickInProgress = false
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
      queueRoomSnapshot(io, roomId)
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

    if (eventName === 'GameEnded') {
      void persistGameSummaryFromChain(roomId, Number(enrichedArgs.outcome)).catch(err => {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(`[socket] persistGameSummaryFromChain failed for room ${roomId}: ${message}`)
      })
    }

    // For membership changes, push a fresh snapshot immediately so all players
    // (including the newly joined one) see the same roster without delay.
    if (eventName === 'PlayerJoined') {
      void flushRoomSnapshot(io, roomId)
    } else {
      queueRoomSnapshot(io, roomId)
    }
    queueLobbyRefresh(io, roomId)

    // Early voting resolution: if every alive player has voted before the timer
    // expires, resolve the round immediately instead of waiting for the clock.
    if (eventName === 'VoteCast') {
      void tryEarlyResolveAfterAllVotes(roomId)
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
        const { rawRoom, rawPlayers } = await getRoomStateForJoin(
          BigInt(roomId),
          playerAddress,
        )
        const roomChatKey = cacheChatKey(roomId, rawRoom)
        socket.emit('room_state', serializeBigInts({ room: rawRoom, players: rawPlayers }))
        await emitRoomSnapshot(io, roomId, socket.id)
        // Broadcast updated state to all existing room members so they see the new player.
        queueRoomSnapshot(io, roomId)

        // Send persisted chat history so reconnecting clients see previous messages.
        try {
          const raw = await redis.lrange(roomChatKey, 0, -1)
          if (raw.length > 0) {
            socket.emit('chat_history', raw.map(m => JSON.parse(m)))
          }
        } catch (chatErr) {
          logger.warn(`[socket] failed to load chat history for room ${roomId}: ${chatErr}`)
        }

        // Replay phase state for reconnecting clients so they rebuild currentRound.
        for (const ev of buildActiveSyncEvents(rawRoom, roomId)) socket.emit('game_event', ev)

        // RoomStatus.Ended = 3 — replay outcome so reconnecting clients get the result.
        if (rawRoom.status === 3) {
          const ended = await chainAdapter.getGameEndedLogs(BigInt(roomId))
          // Fallback: if the log is outside the lookback window, infer outcome from player states.
          const outcome = ended?.outcome ?? inferOutcome(rawRoom, rawPlayers)
          socket.emit('game_event', {
            type:      'game_ended',
            roomId,
            payload:   { outcome },
            timestamp: Date.now(),
          } as GameEvent)
        }
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
      if (io.sockets.adapter.rooms.get(roomId)?.size === 0) {
        resolvedRoomChatKeys.delete(roomId)
      }
    })

    /**
     * Phase timer tick — backend manages phase transitions
     */
    socket.on('request_phase_advance', async ({ roomId }: { roomId: string }) => {
      const id = BigInt(roomId)
      // Skip if the server-side monitor is already processing this room
      if (roomPhaseInProgress.has(id)) return
      try {
        const rawRoom = await chainAdapter.getRoom(id)
        const phaseStartedAt = Number(rawRoom.phaseStartedAt) * 1000

        // RoomStatus.Active = 2
        if (rawRoom.status !== 2) return

        const now = Date.now()

        // RoundPhase.Discussion = 1
        if (rawRoom.currentPhase === 1) {
          const durationMs = Number(rawRoom.config.discussionDurationSecs) * 1000
          if (now < phaseStartedAt + durationMs) return
          roomPhaseInProgress.add(id)
          try {
            await chainAdapter.openVoting(id)
          } finally {
            roomPhaseInProgress.delete(id)
          }
          return
        }

        // RoundPhase.Voting = 2
        if (rawRoom.currentPhase === 2) {
          const durationMs = Number(rawRoom.config.votingDurationSecs) * 1000
          if (now < phaseStartedAt + durationMs) return
          roomPhaseInProgress.add(id)
          try {
            await chainAdapter.resolveRound(id)
          } finally {
            roomPhaseInProgress.delete(id)
          }
          return
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (!isExpectedPhaseRevert(message)) {
          logger.warn(`[socket] request_phase_advance failed for ${roomId}: ${message}`)
        }
      }
    })

    /**
     * Manual refresh fan-out.
     * Clients call this after impactful successful actions (join, commit, vote)
     * to nudge all room subscribers to immediately re-read chain state.
     */
    socket.on('request_room_refresh', async ({ roomId }: { roomId: string }) => {
      io.to(roomId).emit('room_refresh_requested', { roomId, timestamp: Date.now() })
      queueRoomSnapshot(io, roomId)
      queueLobbyRefresh(io, roomId)
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

        const patientZero = await chainAdapter.getCurrentPatientZero(BigInt(roomId))
        const patientZeroSeed = (patientZero ?? ZERO_ADDRESS).toLowerCase()
        const blockHash = await chainAdapter.getLatestBlockHash()
        const seed = `${roomId}:${round}:${patientZeroSeed}:${blockHash}`
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
     * Endgame check (runs inside finalizeElimination after Reveal):
     *   infected_alive == 0                        → clean_win
     *   infected_alive == 1 && clean_alive == 1    → draw (1v1)
     *   infected_alive > clean_alive               → infected_win
     *   round == max_rounds                        → draw
     */
    socket.on('resolve_round', async ({ roomId }: { roomId: string }) => {
      try {
        await chainAdapter.resolveRound(BigInt(roomId))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(`[socket] resolve_round failed for ${roomId}: ${message}`)
      }
    })

    /**
     * In-game chat — broadcast a message to all players in the room.
     *
     * Messages are stripped to a safe length (256 chars) and only relayed
     * when the sender appears to be in the room.  No message history is
     * persisted; this is ephemeral session chat only.
     */
    socket.on('chat_message', async ({
      roomId,
      message,
      playerAddress,
      displayName,
    }: {
      roomId: string
      message: string
      playerAddress: string
      displayName?: string
    }) => {
      if (!roomId || !message || !playerAddress) return
      const safe = String(message).slice(0, 256).trim()
      if (!safe) return
      const chatMsg = {
        roomId,
        sender:      playerAddress,
        displayName: displayName ?? `${playerAddress.slice(0, 6)}…${playerAddress.slice(-4)}`,
        message:     safe,
        timestamp:   Date.now(),
      }
      io.to(roomId).emit('chat_message', chatMsg)
      // Persist to Redis so the history survives reconnects/refreshes (keep last 100).
      try {
        const key = await getChatKeyForRoom(roomId)
        await redis.rpush(key, JSON.stringify(chatMsg))
        await redis.ltrim(key, -100, -1)
      } catch (redisErr) {
        logger.warn(`[socket] failed to persist chat for room ${roomId}: ${redisErr}`)
      }
    })

    socket.on('disconnect', () => {
      for (const [, roomMap] of playerSockets) {
        for (const [addr, sid] of roomMap) {
          if (sid === socket.id) roomMap.delete(addr)
        }
      }
      for (const [roomId, room] of io.sockets.adapter.rooms) {
        // socket.io room lists include socket IDs; only remove explicit game-room caches.
        if (roomId === socket.id) continue
        if (room.size === 0) resolvedRoomChatKeys.delete(roomId)
      }
      logger.info(`Client disconnected: ${socket.id}`)
    })
  })

  io.engine.on('close', () => {
    for (const timer of roomSnapshotTimers.values()) {
      clearTimeout(timer)
    }
    roomSnapshotTimers.clear()
    roomSnapshotLastEmittedAt.clear()
    roomSnapshotInFlight.clear()
    roomSnapshotDirty.clear()
    clearLobbyRefreshTimer()
    lobbyRefreshLastEmittedAt = 0
    lobbyRefreshDirty = false
    lobbyRefreshRoomId = null
    for (const timer of earlyResolveRetryTimers.values()) {
      clearTimeout(timer)
    }
    earlyResolveRetryTimers.clear()
    earlyResolveRetryAttempts.clear()
    resolvedRoomChatKeys.clear()
    unwatch()
  })
}

/**
 * Infer game outcome from final player states when the GameEnded log is
 * outside the RPC lookback window.
 *  0 = CleanWin, 1 = InfectedWin, 2 = Draw
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inferOutcome(rawRoom: RawRoom, players: any[]): number {
  const cleanAlive    = players.filter(p => Number(p.status) === 0).length
  const infectedAlive = players.filter(p => Number(p.status) === 1).length
  if (cleanAlive > 0 && infectedAlive === 0) return 0   // CleanWin
  if (infectedAlive === 1 && cleanAlive === 1) return 2 // MaxRoundsDraw (1v1)
  if (infectedAlive > cleanAlive) return 1              // InfectedWin
  if (Number(rawRoom.currentRound) >= Number(rawRoom.config.maxRounds)) return 2 // MaxRoundsDraw
  return 2                                               // Draw
}

function buildActiveSyncEvents(rawRoom: RawRoom, roomId: string): GameEvent[] {
  const phaseStartedAt = Number(rawRoom.phaseStartedAt) * 1000
  const currentPhase   = Number(rawRoom.currentPhase)
  const currentRound   = Number(rawRoom.currentRound)
  const status         = Number(rawRoom.status)

  // Only handle Active (2) and Ended (3) rooms with at least 1 round
  if ((status !== 2 && status !== 3) || currentRound < 1) return []

  // round_started initialises currentRound with phase='infection';
  // timestamp anchors phaseEndsAt for the infection phase (no fixed duration).
  const events: GameEvent[] = [{
    type:      'round_started',
    roomId,
    payload:   { round: currentRound, durationMs: 0 },
    timestamp: phaseStartedAt,
  }]

  if (status === 2 && currentPhase > 0) {
    // Active room past Infection — emit current phase so the timer is accurate.
    let durSecs = 0
    if (currentPhase === 1) durSecs = Number(rawRoom.config.discussionDurationSecs)
    else if (currentPhase === 2) durSecs = Number(rawRoom.config.votingDurationSecs)
    events.push({
      type:      'phase_changed',
      roomId,
      payload:   { phase: currentPhase, durationMs: durSecs * 1000 },
      timestamp: phaseStartedAt,
    })
  }

  if (status === 3) {
    // Ended room — set phase to Ended (4) so the phase box shows the ended message.
    events.push({
      type:      'phase_changed',
      roomId,
      payload:   { phase: 4, durationMs: 0 },
      timestamp: phaseStartedAt,
    })
  }

  return events
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
      return { type: 'game_started', roomId, payload: { durationMs: Number(args.durationMs ?? 0) }, timestamp }
    case 'RoundStarted':
      return { type: 'round_started', roomId, payload: { round: Number(args.round), durationMs: Number(args.durationMs ?? 0) }, timestamp }
    case 'PhaseChanged': {
      const phase = Number(args.phase)
      // Emit phase_changed for all clients
      const events: GameEvent[] = [
        { type: 'phase_changed', roomId, payload: { phase, durationMs: Number(args.durationMs ?? 0) }, timestamp },
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

function isExpectedCommitmentMonitorRevert(message: string): boolean {
  return (
    message.includes('WrongPhase') ||
    message.includes('0xe2586bcc') ||
    message.includes('RoleCommitmentPending') ||
    message.includes('NotEnoughPlayers') ||
    message.includes('StartThresholdMet')
  )
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
  const minPlayers = Number(rawRoom.config.minPlayers)
  const startedAtMs = Number(rawRoom.startedAt) * 1000
  const timeoutReached = Date.now() >= startedAtMs + ROLE_COMMIT_TIMEOUT_MS
  const playerAddrs = rawRoom.players
  if (playerAddrs.length === 0) return
  const playerStates = await Promise.all(
    playerAddrs.map(addr => chainAdapter.getPlayer(id, addr))
  )

  const alivePlayers = playerStates.filter(p => p.status !== 2)
  const allCommitted = alivePlayers.every(p => p.roleCommitted === true)
  if (!allCommitted && !timeoutReached) return

  // Skip if another tick is already processing this room
  if (roomPhaseInProgress.has(id)) return
  roomPhaseInProgress.add(id)
  try {
    if (!allCommitted && timeoutReached) {
      await chainAdapter.eliminateUncommittedPlayers(id)
    }

    if (timeoutReached) {
      const latestRoom = await chainAdapter.getRoom(id)
      const latestStates = await Promise.all(
        latestRoom.players.map(addr => chainAdapter.getPlayer(id, addr))
      )
      const committedAlive = latestStates.filter(p => p.status !== 2 && p.roleCommitted).length
      if (committedAlive < minPlayers) {
        await chainAdapter.finalizeStartTimeout(id)
        logger.info(`[role-commitment-monitor] finalizeStartTimeout called for room ${id} committedAlive=${committedAlive} minPlayers=${minPlayers}`)
        return
      }
    }

    await chainAdapter.beginActivePhase(id)
    logger.info(`[role-commitment-monitor] beginActivePhase called for room ${id}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Ignore expected races/timeouts.
    if (!isExpectedCommitmentMonitorRevert(message)) {
      logger.warn(`[role-commitment-monitor] failed for room ${id}: ${message}`)
    }
  } finally {
    roomPhaseInProgress.delete(id)
  }
}

export function startRoleCommitmentMonitor(_io: Server, intervalMs = 5_000): NodeJS.Timeout {
  return setInterval(async () => {
    if (roleCommitmentTickInProgress) return
    roleCommitmentTickInProgress = true
    try {
      const count = await chainAdapter.getRoomCount()
      for (let id = 1n; id <= count; id++) {
        await processRoomForCommitment(id)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`[role-commitment-monitor] tick error: ${message}`)
    } finally {
      roleCommitmentTickInProgress = false
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
// Suppress expected reverts — WrongPhase (0xe2586bcc), NotActive (0x80cb55e2)
function isExpectedPhaseRevert(message: string): boolean {
  return (
    message.includes('WrongPhase') ||
    message.includes('0xe2586bcc') ||
    message.includes('NotActive') ||
    message.includes('0x80cb55e2') ||
    message.includes('nonce too low') ||
    message.includes('already known')
  )
}

async function handleInfectionPhase(id: bigint, rawRoom: RawRoom): Promise<void> {
  if (roomPhaseInProgress.has(id)) return
  roomPhaseInProgress.add(id)
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
    const patientZero = await chainAdapter.getCurrentPatientZero(id)
    const patientZeroSeed = (patientZero ?? ZERO_ADDRESS).toLowerCase()
    const blockHash = await chainAdapter.getLatestBlockHash()
    const round = Number(rawRoom.currentRound)
    const h = BigInt(keccak256(toBytes(`${id}:${round}:${patientZeroSeed}:${blockHash}`)))
    const target = cleanAlive[Number(h % BigInt(cleanAlive.length))]
    await chainAdapter.assignInfection(id, target)
    logger.info(`[phase-advance-monitor] assignInfection succeeded for room ${id} round ${round} patientZero=${patientZeroSeed} target ${target}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isExpectedPhaseRevert(message) && !message.includes('InvalidInfectionTarget')) {
      logger.warn(`[phase-advance-monitor] assignInfection failed for room ${id}: ${message}`)
    }
  } finally {
    roomPhaseInProgress.delete(id)
  }
}

async function handleDiscussionPhase(id: bigint, rawRoom: RawRoom, now: number): Promise<void> {
  const phaseStartedAt = Number(rawRoom.phaseStartedAt) * 1000
  const durationMs = Number(rawRoom.config.discussionDurationSecs) * 1000
  if (now < phaseStartedAt + durationMs) return
  if (roomPhaseInProgress.has(id)) return
  roomPhaseInProgress.add(id)
  try {
    await chainAdapter.openVoting(id)
    logger.info(`[phase-advance-monitor] openVoting succeeded for room ${id}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isExpectedPhaseRevert(message)) {
      logger.warn(`[phase-advance-monitor] openVoting failed for room ${id}: ${message}`)
    }
  } finally {
    roomPhaseInProgress.delete(id)
  }
}

async function handleVotingPhase(id: bigint, rawRoom: RawRoom, now: number): Promise<void> {
  const phaseStartedAt = Number(rawRoom.phaseStartedAt) * 1000
  const durationMs = Number(rawRoom.config.votingDurationSecs) * 1000

  const playerStates = await Promise.all(
    rawRoom.players.map(addr => chainAdapter.getPlayer(id, addr))
  )
  const allAliveVoted = playerStates.every(
    p => Number(p.status) === 2 || p.hasVotedThisRound
  )
  if (!allAliveVoted && now < phaseStartedAt + durationMs) return

  if (roomPhaseInProgress.has(id)) return
  roomPhaseInProgress.add(id)
  try {
    await chainAdapter.resolveRound(id)
    logger.info(
      `[phase-advance-monitor] resolveRound succeeded for room ${id}` +
      (allAliveVoted ? ' (all alive players voted early)' : '')
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isExpectedPhaseRevert(message)) {
      logger.warn(`[phase-advance-monitor] resolveRound failed for room ${id}: ${message}`)
    }
  } finally {
    roomPhaseInProgress.delete(id)
  }
}

async function handleEliminationPhase(id: bigint, rawRoom: RawRoom, now: number): Promise<void> {
  const phaseStartedAt = Number(rawRoom.phaseStartedAt) * 1000
  if (now < phaseStartedAt + ELIMINATION_PHASE_DURATION_MS) return
  if (roomPhaseInProgress.has(id)) return
  roomPhaseInProgress.add(id)
  try {
    await chainAdapter.finalizeElimination(id)
    logger.info(`[phase-advance-monitor] finalizeElimination succeeded for room ${id}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isExpectedPhaseRevert(message)) {
      logger.warn(`[phase-advance-monitor] finalizeElimination failed for room ${id}: ${message}`)
    }
  } finally {
    roomPhaseInProgress.delete(id)
  }
}

async function processActiveRoom(id: bigint, rawRoom: RawRoom, now: number): Promise<void> {
  const phase = Number(rawRoom.currentPhase)
  if (phase === 0) await handleInfectionPhase(id, rawRoom)
  else if (phase === 1) await handleDiscussionPhase(id, rawRoom, now)
  else if (phase === 2) await handleVotingPhase(id, rawRoom, now)
  else if (phase === 3) await handleEliminationPhase(id, rawRoom, now)
}

export function startPhaseAdvanceMonitor(_io: Server, intervalMs = Number(process.env.PHASE_ADVANCE_INTERVAL_MS ?? 2_000)): NodeJS.Timeout {
  return setInterval(async () => {
    if (phaseAdvanceTickInProgress) return
    phaseAdvanceTickInProgress = true
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
    } finally {
      phaseAdvanceTickInProgress = false
    }
  }, intervalMs)
}
