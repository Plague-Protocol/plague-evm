import { Router } from 'express'
import { z } from 'zod'
import { isAddress } from 'viem'
import { chainAdapter } from '../services/chainAdapter'

// TODO: Issue #19 - Implement full rooms API (wire up DB/Redis persistence)

export const roomRouter = Router()

// EVM address: 0x followed by 40 hex chars
const EvmAddress = z.string().refine(isAddress, { message: 'Invalid EVM address' })

const CreateRoomSchema = z.object({
  hostAddress:  EvmAddress,
  maxPlayers:   z.number().int().min(4).max(20),
  stakeAmount:  z.string().regex(/^\d+$/, 'Must be a decimal bigint string'), // wei as string
  proofFee:     z.string().regex(/^\d+$/, 'Must be a decimal bigint string'),
  expirySecs:   z.number().int().min(60).max(86400).optional().default(600),
})

/**
 * GET /api/rooms
 * List open (Waiting) rooms.
 * TODO: Issue #19 — fetch from Redis/DB cache, fallback to on-chain events
 */
roomRouter.get('/', async (_req, res) => {
  res.json({ rooms: [], message: 'TODO: fetch from Redis/DB — see issue #19' })
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
 *
 * TODO: Issue #19 — validate hostAddress is connected (optional), store in DB
 */
roomRouter.post('/', async (req, res) => {
  const parsed = CreateRoomSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() })
  }

  const { maxPlayers, stakeAmount, proofFee, expirySecs } = parsed.data
  try {
    const roomId = await chainAdapter.createRoom(
      maxPlayers,
      BigInt(stakeAmount),
      BigInt(proofFee),
      expirySecs,
    )
    res.status(201).json({ roomId: roomId.toString() })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: message })
  }
})

