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
 * Quarantine-ward flavour words used to auto-assign a display name on a
 * player's first connect. The point is to never show a new player a blank
 * identity: "Player 3" reads like a bug, "Subject 47" reads deliberate — and
 * seeing a name they didn't choose is what prompts them to go change it.
 * Every entry stays well under the 20-char cap once a number is appended.
 */
const NAME_PREFIXES = [
  'Subject', 'Carrier', 'Specimen', 'Patient',
  'Host', 'Vector', 'Strain', 'Vessel',
] as const

/**
 * Draw a thematic name that no one holds yet. Early attempts stay in the
 * two-digit range because "Subject 47" reads better than "Subject 4193"; if
 * that space is crowded we widen rather than fail, so a busy pool still
 * resolves. Returns null only if even the wide range keeps colliding, in which
 * case the caller falls back to leaving the player unnamed.
 */
async function generateUniqueNickname(): Promise<string | null> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const ceiling = attempt < 8 ? 99 : 9999
    const prefix  = NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)]
    const candidate = `${prefix} ${Math.floor(Math.random() * ceiling) + 1}`
    const taken = await prisma.playerNickname.findFirst({
      where: { nickname: { equals: candidate, mode: 'insensitive' } },
    })
    if (!taken) return candidate
  }
  return null
}

/**
 * POST /api/players/ensure-nickname
 * Return this player's display name, assigning a generated one if they have
 * none yet. Idempotent: an existing name is always returned untouched, so this
 * is safe to call on every connect.
 * Body: { address: string }
 * Returns { nickname: string | null, generated: boolean }
 */
playerRouter.post('/ensure-nickname', async (req, res) => {
  const parsed = z.object({ address: EvmAddress }).safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid EVM address' })
  }
  const { address } = parsed.data

  const existing = await prisma.playerNickname.findUnique({ where: { address } })
  if (existing) {
    return res.json({ nickname: existing.nickname, generated: false })
  }

  const candidate = await generateUniqueNickname()
  if (!candidate) {
    return res.json({ nickname: null, generated: false })
  }

  try {
    const record = await prisma.playerNickname.create({
      data: { address, nickname: candidate },
    })
    return res.json({ nickname: record.nickname, generated: true })
  } catch (err: unknown) {
    // P2002 here means a concurrent request won the race — either on this
    // address (two tabs connecting at once) or on the generated name itself.
    // Re-read rather than retry: if this address now has a name, that name is
    // the answer, and reporting it as pre-existing keeps the "generated" flag
    // honest so the client doesn't double-toast.
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
      const now = await prisma.playerNickname.findUnique({ where: { address } })
      return res.json({ nickname: now?.nickname ?? null, generated: false })
    }
    throw err
  }
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
