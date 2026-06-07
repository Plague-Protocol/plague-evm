import { Router } from 'express'
import { z } from 'zod'
import { chainAdapter } from '../services/chainAdapter'
import { logger } from '../lib/logger'

/**
 * Bot-coordination API.
 *
 * The bot pool runs as a separate process (agents/src/runner.ts). It is the
 * single authority over which bots are idle vs. in a game. This router is a thin
 * coordinator between human players and that pool:
 *
 *   - The runner heartbeats its availability here   (POST /state, runner-only)
 *   - Humans ask to add bots to their room          (POST /add)
 *   - The runner drains queued requests              (GET  /requests, runner-only)
 *   - The frontend reads current availability        (GET  /availability)
 *
 * State is in-memory: the backend is single-process, so map/array access is
 * race-safe (same pattern as the commitment reservations in routes/rooms.ts).
 */
export const botRouter = Router()

const STALE_MS = 20_000 // runner considered offline if no heartbeat within this window

interface RunnerState {
  available: number
  total: number
  maxStakeWei: string
  updatedAt: number
}

interface BotJoinRequest {
  roomId: string
  count: number
  ts: number
}

let runnerState: RunnerState | null = null
let pendingRequests: BotJoinRequest[] = []

function runnerOnline(now = Date.now()): boolean {
  return !!runnerState && now - runnerState.updatedAt < STALE_MS
}

function pendingCount(): number {
  return pendingRequests.reduce((sum, r) => sum + r.count, 0)
}

/** Availability after subtracting requests the runner hasn't picked up yet. */
function effectiveAvailable(): number {
  if (!runnerOnline()) return 0
  return Math.max(0, (runnerState?.available ?? 0) - pendingCount())
}

// ── Runner authentication ─────────────────────────────────────────────────────

function runnerAuthorized(req: { header: (n: string) => string | undefined }): boolean {
  const secret = process.env.BOT_RUNNER_SECRET
  if (!secret) return true // not configured → open (dev only)
  return req.header('x-bot-secret') === secret
}

// ── Public: availability ──────────────────────────────────────────────────────

/**
 * GET /api/bots/availability
 * Current bot-pool availability for the frontend.
 */
botRouter.get('/availability', (_req, res) => {
  res.json({
    online:      runnerOnline(),
    available:   effectiveAvailable(),
    total:       runnerState?.total ?? 0,
    maxStakeWei: runnerState?.maxStakeWei ?? '0',
  })
})

// ── Public: request bots for a room ───────────────────────────────────────────

const AddBotsSchema = z.object({
  roomId: z.string().regex(/^\d+$/, 'roomId must be a numeric string'),
  count:  z.number().int().min(1).max(20),
})

/**
 * POST /api/bots/add  { roomId, count }
 * Ask the pool to send up to `count` bots to a Waiting room. Validates the room
 * is joinable and its stake is within the pool's cap, then queues the request.
 * Returns how many bots were actually queued (may be fewer than requested).
 */
botRouter.post('/add', async (req, res) => {
  const parsed = AddBotsSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() })
  }
  const { roomId, count } = parsed.data

  if (!runnerOnline()) {
    return res.status(503).json({ error: 'bots_offline', message: 'The bot pool is currently offline.' })
  }

  try {
    const room = await chainAdapter.getRoom(BigInt(roomId))

    // RoomStatus.Waiting = 0 — bots can only be added before the game starts.
    if (Number(room.status) !== 0) {
      return res.status(409).json({ error: 'wrong_phase', message: 'Bots can only join a room that is still waiting.' })
    }

    const stake = BigInt(room.config.stakeAmount)
    const cap   = BigInt(runnerState?.maxStakeWei ?? '0')
    if (stake > cap) {
      return res.status(409).json({
        error: 'stake_too_high',
        message: `Bots only join rooms staking ≤ ${cap.toString()} wei. This room stakes ${stake.toString()} wei.`,
      })
    }

    const freeSeats = Number(room.config.maxPlayers) - room.players.length
    const accept = Math.min(count, freeSeats, effectiveAvailable())
    if (accept <= 0) {
      return res.status(409).json({
        error: 'unavailable',
        message: freeSeats <= 0 ? 'The room is already full.' : 'No bots are available right now.',
      })
    }

    pendingRequests.push({ roomId, count: accept, ts: Date.now() })
    logger.info(`[bots] queued ${accept} bot(s) for room ${roomId} (requested ${count})`)
    return res.json({ queued: accept })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ error: 'lookup_failed', message })
  }
})

// ── Runner-only: heartbeat + drain ────────────────────────────────────────────

const StateSchema = z.object({
  available:   z.number().int().min(0),
  total:       z.number().int().min(0),
  maxStakeWei: z.string().regex(/^\d+$/),
})

/**
 * POST /api/bots/state  (runner-only)
 * The pool reports its current availability and stake cap.
 */
botRouter.post('/state', (req, res) => {
  if (!runnerAuthorized(req)) return res.status(401).json({ error: 'unauthorized' })
  const parsed = StateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  runnerState = { ...parsed.data, updatedAt: Date.now() }
  res.json({ ok: true })
})

/**
 * GET /api/bots/requests  (runner-only)
 * Returns and clears the queued join requests for the pool to act on.
 */
botRouter.get('/requests', (req, res) => {
  if (!runnerAuthorized(req)) return res.status(401).json({ error: 'unauthorized' })
  const requests = pendingRequests
  pendingRequests = []
  res.json({ requests })
})
