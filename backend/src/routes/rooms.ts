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
