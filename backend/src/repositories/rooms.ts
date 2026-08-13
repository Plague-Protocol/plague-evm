import type { Room, RoomStatus } from '../generated/prisma/client'
import { prisma } from '../db/prisma'
import { redis } from '../db/redis'
import { invalidateLeaderboardCache } from '../lib/leaderboardCache'

const WAITING_SET_KEY = 'rooms:waiting'
const roomKey = (roomId: string) => `room:${roomId}`

export type CreateRoomRecordInput = {
  roomId: string
  hostAddress: string
  maxPlayers: number
  stakeAmount: string
  proofFee: string
  expiresAt: Date
  chainId: number
  contractAddress: string
}

export async function createRoomRecord(input: CreateRoomRecordInput): Promise<Room> {
  const room = await prisma.room.create({
    data: {
      roomId: input.roomId,
      hostAddress: input.hostAddress,
      status: 'waiting',
      maxPlayers: input.maxPlayers,
      stakeAmount: input.stakeAmount,
      proofFee: input.proofFee,
      expiresAt: input.expiresAt,
      chainId: input.chainId,
      contractAddress: input.contractAddress,
    },
  })

  await cacheRoom(room)
  return room
}

export async function getRoomRecord(roomId: string): Promise<Room | null> {
  const cached = await redis.get(roomKey(roomId))
  if (cached) return JSON.parse(cached) as Room

  const room = await prisma.room.findUnique({ where: { roomId } })
  if (room) await cacheRoom(room)
  return room
}

export async function listWaitingRooms(): Promise<Room[]> {
  const ids = await redis.smembers(WAITING_SET_KEY)
  if (ids.length > 0) {
    const keys = ids.map(roomKey)
    const cachedRooms = await redis.mget(keys)
    const rooms: Room[] = []
    for (const r of cachedRooms) {
      if (!r) continue
      rooms.push(JSON.parse(r) as Room)
    }

    const now = Date.now()
    return rooms.filter(r => r.status === 'waiting' && new Date(r.expiresAt).getTime() > now)
  }

  const rooms = await prisma.room.findMany({
    where: {
      status: 'waiting',
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  })

  for (const room of rooms) {
    await cacheRoom(room)
  }

  return rooms
}

/**
 * Rooms that are mid-game (`starting` or `active`).
 *
 * Read cache only — the chain is the authority, and the arena hub still does an
 * on-chain read for the list it renders. This exists so the nav live-dot can
 * ask "is anything running?" on every page without an RPC enumeration.
 *
 * Accuracy caveat: a room whose status update failed (no persisted record for
 * on-chain-created rooms) is missing here. Under-reporting is the safe
 * direction — a missing dot beats a dot that leads nowhere.
 *
 * The age bound is the other half of that. `active` is cleared by the game-end
 * and expiry paths, but a backend restart mid-game leaves a row stranded there
 * with nothing to clear it — which would light the live indicator forever. A
 * game runs for minutes, so anything older than this is stale by definition.
 */
const LIVE_ROOM_MAX_AGE_MS = 6 * 60 * 60 * 1000

export async function listLiveRooms(): Promise<Room[]> {
  return prisma.room.findMany({
    where: {
      status: { in: ['starting', 'active'] },
      createdAt: { gt: new Date(Date.now() - LIVE_ROOM_MAX_AGE_MS) },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
}

export async function listExpiredWaitingRooms(now = new Date()): Promise<Room[]> {
  // Always use Postgres as the authority for expiry to avoid missing rooms due to cache evictions.
  return prisma.room.findMany({
    where: {
      status: 'waiting',
      expiresAt: { lte: now },
    },
    orderBy: { expiresAt: 'asc' },
  })
}

export async function setRoomStatus(roomId: string, status: RoomStatus): Promise<Room | null> {
  const room = await prisma.room.update({
    where: { roomId },
    data: { status },
  })
  await cacheRoom(room)
  return room
}

/**
 * Set a room's status, creating the record first if it does not exist.
 *
 * Rooms are created directly on-chain by the lobby — the backend only ever
 * learns about one if the host also named it (`PUT /:id/name` upserts). So an
 * unnamed player-made room has no row, `setRoomStatus` throws, and the room
 * stays invisible to anything reading Postgres. That was harmless while status
 * only fed the name check; it is not harmless now that `/api/rooms/live`
 * answers "is a match running?" for the nav.
 *
 * Chain-derived fields are supplied by the caller (only the socket layer has a
 * chain adapter), so this stays a pure persistence concern.
 */
export async function setRoomStatusEnsuring(
  roomId: string,
  status: RoomStatus,
  fallback: Omit<CreateRoomRecordInput, 'roomId'>,
): Promise<Room> {
  const room = await prisma.room.upsert({
    where:  { roomId },
    update: { status },
    create: { roomId, status, ...fallback },
  })
  await cacheRoom(room)
  return room
}

export async function getActiveRoomByHost(address: string): Promise<Room | null> {
  return prisma.room.findFirst({
    where: {
      hostAddress: { equals: address.toLowerCase(), mode: 'insensitive' },
      status: { in: ['waiting', 'starting', 'active'] },
    },
  })
}

export async function deleteRoomRecord(roomId: string): Promise<void> {
  await prisma.room.delete({ where: { roomId } })
  await redis.del(roomKey(roomId))
  await redis.srem(WAITING_SET_KEY, roomId)
}

export type CreateGameSummaryInput = {
  roomId: string
  chainId: number
  contractAddress: string
  outcome: string
  totalRounds: number
  totalPot: string
  potPerWinner: string
  winnerCount: number
  endedAt: Date
  players: Array<{
    address: string
    displayNameSnapshot?: string | null
    result: string
    proofsSubmittedTotal: number
    statusAtEnd: string
    joinedAt?: Date | null
  }>
}

export async function upsertGameSummary(input: CreateGameSummaryInput): Promise<void> {
  await prisma.gameSummary.upsert({
    where: { roomId: input.roomId },
    update: {
      chainId: input.chainId,
      contractAddress: input.contractAddress,
      outcome: input.outcome,
      totalRounds: input.totalRounds,
      totalPot: input.totalPot,
      potPerWinner: input.potPerWinner,
      winnerCount: input.winnerCount,
      endedAt: input.endedAt,
      players: {
        deleteMany: {},
        create: input.players.map(player => ({
          address: player.address,
          displayNameSnapshot: player.displayNameSnapshot ?? null,
          result: player.result,
          proofsSubmittedTotal: player.proofsSubmittedTotal,
          statusAtEnd: player.statusAtEnd,
          joinedAt: player.joinedAt ?? undefined,
        })),
      },
    },
    create: {
      roomId: input.roomId,
      chainId: input.chainId,
      contractAddress: input.contractAddress,
      outcome: input.outcome,
      totalRounds: input.totalRounds,
      totalPot: input.totalPot,
      potPerWinner: input.potPerWinner,
      winnerCount: input.winnerCount,
      endedAt: input.endedAt,
      players: {
        create: input.players.map(player => ({
          address: player.address,
          displayNameSnapshot: player.displayNameSnapshot ?? null,
          result: player.result,
          proofsSubmittedTotal: player.proofsSubmittedTotal,
          statusAtEnd: player.statusAtEnd,
          joinedAt: player.joinedAt ?? undefined,
        })),
      },
    },
  })
  // A new/updated summary changes every leaderboard aggregate — covers both
  // the live GameEnded path and the backfill scan through this one funnel.
  invalidateLeaderboardCache()
}

export async function getLeaderboardSummaries(limit = 100) {
  return prisma.gameSummary.findMany({
    orderBy: { endedAt: 'desc' },
    take: limit,
    include: {
      players: true,
    },
  })
}

async function cacheRoom(room: Room): Promise<void> {
  await redis.set(roomKey(room.roomId), JSON.stringify(room), 'EX', 60)

  if (room.status === 'waiting') {
    await redis.sadd(WAITING_SET_KEY, room.roomId)
  } else {
    await redis.srem(WAITING_SET_KEY, room.roomId)
  }
}
