import { Router } from 'express'
import { z } from 'zod'
import { isAddress } from 'viem'
import { prisma } from '../db/prisma'

export const playerRouter = Router()

const EvmAddress = z.string().refine(isAddress, { message: 'Invalid EVM address' })

const NicknameSchema = z.object({
  address:  EvmAddress,
  nickname: z.string().min(1).max(20).trim(),
})

/**
 * PUT /api/players/nickname
 * Set or update a player's display nickname (upsert by address).
 * Body: { address: string, nickname: string }
 */
playerRouter.put('/nickname', async (req, res) => {
  const parsed = NicknameSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() })
  }
  const { address, nickname } = parsed.data
  const record = await prisma.playerNickname.upsert({
    where: { address },
    update: { nickname },
    create: { address, nickname },
  })
  res.json({ address: record.address, nickname: record.nickname })
})

/**
 * GET /api/players/:address/nickname
 * Get a player's display nickname. Returns { nickname: null } if not set.
 */
playerRouter.get('/:address/nickname', async (req, res) => {
  const addrParse = EvmAddress.safeParse(req.params.address)
  if (!addrParse.success) {
    return res.status(400).json({ error: 'Invalid EVM address' })
  }
  const record = await prisma.playerNickname.findUnique({
    where: { address: addrParse.data },
  })
  res.json({ nickname: record?.nickname ?? null })
})

/**
 * POST /api/players/nicknames
 * Bulk-fetch nicknames for a list of addresses.
 * Body: { addresses: string[] }
 */
playerRouter.post('/nicknames', async (req, res) => {
  const schema = z.object({ addresses: z.array(EvmAddress).max(50) })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() })
  }
  const records = await prisma.playerNickname.findMany({
    where: { address: { in: parsed.data.addresses } },
  })
  const map: Record<string, string> = {}
  for (const r of records) map[r.address] = r.nickname
  res.json({ nicknames: map })
})
