import { Router } from 'express'
import { z } from 'zod'
import { recoverMessageAddress } from 'viem'
import { prisma } from '../db/prisma'
import { chainAdapter } from '../services/chainAdapter'
import { logger } from '../lib/logger'

export const configRouter = Router()

/**
 * Admin-editable site config, one JSON value per key. Reads are public;
 * writes must be signed by the contract's admin() wallet — the wallet is
 * the credential, no shared secret to distribute. The signed message binds
 * the key, a timestamp (replay window below) and the exact payload.
 */

const EDITABLE_KEYS = ['bounty'] as const
type EditableKey = typeof EDITABLE_KEYS[number]

/** How stale a signed edit may be before it's rejected. */
const SIGNATURE_WINDOW_MS = 5 * 60 * 1000

const ValueSchemas: Record<EditableKey, z.ZodTypeAny> = {
  bounty: z.object({
    active: z.boolean(),
    // Emptiness is enforced client-side only when active — an inactive
    // (hidden) card may be saved blank.
    title:  z.string().trim().max(80),
    body:   z.string().trim().max(400),
    prize:  z.string().trim().max(60).optional(),
    endsAt: z.string().trim().max(40).optional(),
  }),
}

const PutSchema = z.object({
  address:   z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  timestamp: z.number().int(),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  // The raw JSON string the wallet signed — verified byte-for-byte, then
  // parsed and validated. Signing the exact string avoids any dependence
  // on key ordering between the two stringify passes.
  valueJson: z.string().max(2000),
})

/** The exact string the admin wallet signs. Must match the frontend builder. */
export function configMessage(key: string, timestamp: number, valueJson: string): string {
  return `plague-config:${key}:${timestamp}:${valueJson}`
}

function isEditableKey(key: string): key is EditableKey {
  return (EDITABLE_KEYS as readonly string[]).includes(key)
}

configRouter.get('/:key', async (req, res) => {
  const { key } = req.params
  if (!isEditableKey(key)) return res.status(404).json({ error: 'unknown_key' })
  try {
    const row = await prisma.siteConfig.findUnique({ where: { key } })
    res.json({
      value: row ? JSON.parse(row.value) : null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: message })
  }
})

configRouter.put('/:key', async (req, res) => {
  const { key } = req.params
  if (!isEditableKey(key)) return res.status(404).json({ error: 'unknown_key' })

  const parsed = PutSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const { address, timestamp, signature, valueJson } = parsed.data

  let rawValue: unknown
  try {
    rawValue = JSON.parse(valueJson)
  } catch {
    return res.status(400).json({ error: 'invalid_json' })
  }
  const valueParsed = ValueSchemas[key].safeParse(rawValue)
  if (!valueParsed.success) return res.status(400).json({ error: valueParsed.error.flatten() })

  if (Math.abs(Date.now() - timestamp) > SIGNATURE_WINDOW_MS) {
    return res.status(401).json({ error: 'stale_signature', message: 'Signature expired — try again.' })
  }

  try {
    const signer = await recoverMessageAddress({
      message: configMessage(key, timestamp, valueJson),
      signature: signature as `0x${string}`,
    })
    if (signer.toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({ error: 'bad_signature' })
    }
    const admin = await chainAdapter.getAdmin()
    if (signer.toLowerCase() !== admin.toLowerCase()) {
      return res.status(403).json({ error: 'not_admin', message: 'Only the contract admin can edit site config.' })
    }

    const stored = JSON.stringify(valueParsed.data)
    const row = await prisma.siteConfig.upsert({
      where:  { key },
      create: { key, value: stored },
      update: { value: stored },
    })
    logger.info(`[config] ${key} updated by admin ${signer}`)
    res.json({ success: true, value: JSON.parse(row.value), updatedAt: row.updatedAt.toISOString() })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: message })
  }
})
