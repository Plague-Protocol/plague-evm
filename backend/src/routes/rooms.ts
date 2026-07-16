import { Router } from 'express'
import { z } from 'zod'
import { isAddress } from 'viem'
import { chainAdapter } from '../services/chainAdapter'
import { createRoomRecord, getActiveRoomByHost, listWaitingRooms } from '../repositories/rooms'
import { prisma } from '../db/prisma'

export const roomRouter = Router()

// EVM address: 0x followed by 40 hex chars
const EvmAddress = z.string().refine(isAddress, { message: 'Invalid EVM address' })

const CreateRoomSchema = z.object({
  hostAddress:  EvmAddress,
  maxPlayers:   z.number().int().min(4).max(20),
  stakeAmount:  z.string()
    .regex(/^\d+$/, 'Must be a decimal bigint string')
    .refine(v => BigInt(v) > 0n, { message: 'Stake amount must be greater than zero' }), // wei as string
  proofFee:     z.string().regex(/^\d+$/, 'Must be a decimal bigint string'),
  expirySecs:   z.number().int().min(60).max(86400).optional().default(600),
})

/**
 * GET /api/rooms
 * List open (Waiting) rooms.
 */
roomRouter.get('/', async (_req, res) => {
  try {
    const rooms = await listWaitingRooms()
    res.json({ rooms })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: message })
  }
})

/**
 * GET /api/rooms/names?ids=1,2,3
 * Batch-fetch display names for many rooms in ONE request.
 *
 * The lobby renders up to RECENT_ROOM_LIMIT rooms; fetching a name per room
 * fired that many parallel requests at this host, tripping the browser's
 * per-host socket cap (ERR_INSUFFICIENT_RESOURCES) and starving the /api/rpc
 * call — which then looked like an RPC/Alchemy failure. One query fixes it.
 *
 * Must be registered BEFORE `/:id` so "names" isn't parsed as a room id.
 * Returns { names: { "<roomId>": string | null } } — every requested id is
 * present so the client can rely on the shape.
 */
roomRouter.get('/names', async (req, res) => {
  const raw = typeof req.query.ids === 'string' ? req.query.ids : ''
  const ids = raw.split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s)).slice(0, 200)
  try {
    const names: Record<string, string | null> = {}
    for (const id of ids) names[id] = null
    if (ids.length > 0) {
      const rooms = await prisma.room.findMany({
        where: { roomId: { in: ids } },
        select: { roomId: true, name: true },
      })
      for (const r of rooms) names[r.roomId] = r.name ?? null
    }
    res.json({ names })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: message })
  }
})

/**
 * GET /api/rooms/:id
 * Get a specific room's on-chain state.
 */
roomRouter.get('/:id', async (req, res) => {
  const roomId = BigInt(req.params.id)
  try {
    const room = await chainAdapter.getRoom(roomId)
    res.json({ room })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(404).json({ error: message })
  }
})

/**
 * POST /api/rooms
 * Create a room on-chain via the backend signer and return the new roomId.
 *
 * The backend server wallet covers gas for room creation. Players sign their
 * own transactions (joinRoom, castVote, etc.) directly from the frontend.
 */
roomRouter.post('/', async (req, res) => {
  const parsed = CreateRoomSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() })
  }

  const { hostAddress, maxPlayers, stakeAmount, proofFee, expirySecs } = parsed.data
  try {
    const existingRoom = await getActiveRoomByHost(hostAddress)
    if (existingRoom) {
      return res.status(409).json({
        error: `Address ${hostAddress} already has an active room (${existingRoom.roomId}). Wait for it to end before creating a new one.`,
      })
    }

    const roomId = await chainAdapter.createRoom(
      maxPlayers,
      BigInt(stakeAmount),
      BigInt(proofFee),
      expirySecs,
    )

    const expiresAt = new Date(Date.now() + expirySecs * 1000)
    const chainId = process.env.NETWORK === 'mainnet' ? 42220 : 44787
    const contractAddress = process.env.CONTRACT_ADDRESS ?? ''
    if (!contractAddress) throw new Error('CONTRACT_ADDRESS env var is not set')

    await createRoomRecord({
      roomId: roomId.toString(),
      hostAddress,
      maxPlayers,
      stakeAmount,
      proofFee,
      expiresAt,
      chainId,
      contractAddress,
    })

    res.status(201).json({ roomId: roomId.toString() })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: message })
  }
})

const RoomNameSchema = z.object({
  name: z.string().min(1).max(40).trim(),
})

/**
 * PUT /api/rooms/:id/name
 * Set or update the display name of a room (off-chain).
 * Body: { name: string }
 */
roomRouter.put('/:id/name', async (req, res) => {
  const parsed = RoomNameSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() })
  }
  const roomId = req.params.id
  const name = parsed.data.name
  try {
    // Reject if another active room already has this name
    const conflict = await prisma.room.findFirst({
      where: { name, status: { not: 'ended' }, NOT: { roomId } },
      select: { roomId: true },
    })
    if (conflict) {
      return res.status(409).json({ error: `A room named "${name}" is already active.` })
    }

    // Try update first (room already in DB)
    const existing = await prisma.room.findUnique({ where: { roomId }, select: { id: true } })
    if (existing) {
      const room = await prisma.room.update({ where: { roomId }, data: { name } })
      return res.json({ name: room.name })
    }

    // Room was created directly on-chain — fetch its data and upsert.
    // RPC propagation can lag a fresh createRoom tx, so retry briefly before
    // failing. Without this the lobby PUT silently 404s and the name is lost.
    let onChain: any = null  // eslint-disable-line @typescript-eslint/no-explicit-any
    let lastErr: unknown = null
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        onChain = await chainAdapter.getRoom(BigInt(roomId))
        break
      } catch (err) {
        lastErr = err
        await new Promise(r => setTimeout(r, 750))
      }
    }
    if (!onChain) throw lastErr ?? new Error(`Room ${roomId} not found on chain`)
    const chainId = process.env.NETWORK === 'mainnet' ? 42220 : 44787
    const contractAddress = process.env.CONTRACT_ADDRESS ?? ''
    const room = await prisma.room.upsert({
      where: { roomId },
      update: { name },
      create: {
        roomId,
        name,
        hostAddress: onChain.host as string,
        maxPlayers: Number(onChain.config.maxPlayers),
        stakeAmount: onChain.config.stakeAmount.toString(),
        proofFee: onChain.config.proofFee.toString(),
        expiresAt: new Date(Number(onChain.expiresAt) * 1000),
        chainId,
        contractAddress,
      },
    })
    res.json({ name: room.name })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(404).json({ error: message })
  }
})

/**
 * POST /api/rooms/:id/reserve-commitment
 * Pre-flight uniqueness check for Shield Password commitments.
 *
 * Two players using the same passphrase produce the same Poseidon commitment,
 * which then collides at Shield-activation time (the innocence-proof nullifier
 * derives from the same secret). The smart contract enforces uniqueness too —
 * this endpoint is the zero-gas friendly path so a colliding player never
 * burns a revert. Single-process backend means the Map insert serialises and
 * is race-safe. If the backend is unreachable the frontend falls back to a
 * best-effort client-side warning; the contract is the final guard.
 *
 * Body: { commitment: 0x{64 hex}, address: 0x{40 hex} }
 *   200 ok            → reserved (or refreshed for the same address)
 *   409 taken_on_chain → another player has already committed this hash
 *   409 taken_reserved → another player just reserved this hash (TTL)
 *   400 / 500          → input or chain read error
 */
const ReserveCommitmentSchema = z.object({
  commitment: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'commitment must be 32-byte hex'),
  address:    EvmAddress,
})

const RESERVATION_TTL_MS = 60_000
const commitmentReservations = new Map<string, Map<string, { address: string; expiresAt: number }>>()

function getRoomReservations(roomId: string): Map<string, { address: string; expiresAt: number }> {
  let m = commitmentReservations.get(roomId)
  if (!m) {
    m = new Map()
    commitmentReservations.set(roomId, m)
  }
  return m
}

function purgeExpiredReservations(m: Map<string, { address: string; expiresAt: number }>, now: number): void {
  for (const [k, v] of m) {
    if (v.expiresAt <= now) m.delete(k)
  }
}

roomRouter.post('/:id/reserve-commitment', async (req, res) => {
  const parsed = ReserveCommitmentSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() })
  }
  const roomId = req.params.id
  const { commitment, address } = parsed.data
  const commitmentLower = commitment.toLowerCase()
  const addressLower    = address.toLowerCase()

  try {
    // RoomStatus.Starting = 1 — only the starting phase has commitments.
    const rawRoom = await chainAdapter.getRoom(BigInt(roomId))
    if (Number(rawRoom.status) !== 1) {
      return res.status(409).json({ error: 'wrong_phase', message: 'Room is not in commit phase.' })
    }

    // 1. Has anyone else in this room already committed this hash on-chain?
    const players = await Promise.all(
      rawRoom.players.map(p => chainAdapter.getPlayer(BigInt(roomId), p))
    )
    const onChainCollide = players.find(p =>
      p.addr.toLowerCase() !== addressLower &&
      typeof p.roleCommitment === 'string' &&
      p.roleCommitment.toLowerCase() === commitmentLower &&
      // ignore the zero-bytes32 default
      p.roleCommitment !== '0x0000000000000000000000000000000000000000000000000000000000000000'
    )
    if (onChainCollide) {
      return res.status(409).json({
        error:   'taken_on_chain',
        message: 'That Shield Password is already committed by another player. Pick a different one.',
      })
    }

    // 2. Has another address just reserved it in the last minute?
    const now = Date.now()
    const reservations = getRoomReservations(roomId)
    purgeExpiredReservations(reservations, now)
    const existing = reservations.get(commitmentLower)
    if (existing && existing.address.toLowerCase() !== addressLower) {
      return res.status(409).json({
        error:   'taken_reserved',
        message: 'Another player just claimed that Shield Password. Pick a different one.',
      })
    }

    // 3. Reserve (idempotent for the same address — extends TTL).
    reservations.set(commitmentLower, { address, expiresAt: now + RESERVATION_TTL_MS })
    return res.json({ ok: true, expiresAt: now + RESERVATION_TTL_MS })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ error: 'lookup_failed', message })
  }
})

/**
 * GET /api/rooms/:id/name
 * Get the display name of a room.
 */
roomRouter.get('/:id/name', async (req, res) => {
  const roomId = req.params.id
  try {
    const room = await prisma.room.findUnique({ where: { roomId }, select: { name: true } })
    res.json({ name: room?.name ?? null })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: message })
  }
})
