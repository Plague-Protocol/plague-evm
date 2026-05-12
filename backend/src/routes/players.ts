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
 * Returns 409 if the nickname is already taken by another player.
 */
playerRouter.put('/nickname', async (req, res) => {
  const parsed = NicknameSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() })
  }
  const { address, nickname } = parsed.data
  // Case-insensitive uniqueness check — normalise to lowercase for comparison
  const normalised = nickname.toLowerCase()
  const existing = await prisma.playerNickname.findFirst({
    where: {
      nickname: { equals: normalised, mode: 'insensitive' },
      NOT: { address },
    },
  })
  if (existing) {
    return res.status(409).json({ error: 'This display name is already taken.' })
  }
  try {
    const record = await prisma.playerNickname.upsert({
      where: { address },
      update: { nickname },
      create: { address, nickname },
    })
    res.json({ address: record.address, nickname: record.nickname })
  } catch (err: unknown) {
    // Catch Prisma unique constraint violation (P2002) as a race-condition fallback
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
      return res.status(409).json({ error: 'This display name is already taken.' })
    }
    throw err
  }
})

/**
 * GET /api/players/check-nickname?nickname=X
 * Check if a nickname is available. Returns { available: boolean }.
 */
playerRouter.get('/check-nickname', async (req, res) => {
  const nickname = String(req.query.nickname ?? '').trim()
  if (!nickname || nickname.length > 20) {
    return res.status(400).json({ error: 'Invalid nickname' })
  }
  const address = String(req.query.address ?? '').trim() || undefined
  const existing = await prisma.playerNickname.findFirst({
    where: {
      nickname: { equals: nickname, mode: 'insensitive' },
      ...(address ? { NOT: { address } } : {}),
    },
  })
  res.json({ available: !existing })
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
