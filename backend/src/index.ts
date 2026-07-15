import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'
import { roomRouter } from './routes/rooms'
import { proveRouter } from './routes/prove'
import { playerRouter } from './routes/players'
import { leaderboardRouter } from './routes/leaderboard'
import { botRouter } from './routes/bots'
import { rpcRouter } from './routes/rpc'
import {
  setupSocketHandlers,
  startRoomExpiryMonitor,
  startRoleCommitmentMonitor,
  startPhaseAdvanceMonitor,
} from './socket/handlers'
import { startRpcHealthMonitor } from './services/chainAdapter'
import { logger } from './lib/logger'

dotenv.config()

const app = express()
const httpServer = createServer(app)

// ─── Middleware ─────────────────────────────────────────────────────────────

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'https://zplague.xyz',
  'https://www.zplague.xyz',
  'https://z-plague.vercel.app',
]

app.use(helmet())
app.use(cors({ origin: allowedOrigins }))
app.use(express.json())

// ─── REST Routes ────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true }))
app.use('/api/rooms', roomRouter)
app.use('/api/prove', proveRouter)
app.use('/api/players', playerRouter)
app.use('/api/leaderboard', leaderboardRouter)
app.use('/api/bots', botRouter)
app.use('/api/rpc', rpcRouter)

// ─── Socket.io ──────────────────────────────────────────────────────────────

const io = new Server(httpServer, {
  cors: { origin: allowedOrigins },
})

setupSocketHandlers(io)
startRoomExpiryMonitor(io)
startRoleCommitmentMonitor(io)
startPhaseAdvanceMonitor(io)
startRpcHealthMonitor()

// ─── Live presence ──────────────────────────────────────────────────────────
// Heartbeat model: every open tab POSTs a ping every ~30s; "online" = distinct
// identities seen within the TTL. Keyed by wallet address when connected
// (multiple tabs of one player dedupe) or an anonymous per-tab id otherwise
// (demo/lobby visitors count too). Deliberately NOT io.engine.clientsCount:
// sockets only exist on lobby/game pages (home visitors were invisible) and
// every bot opens one per game (a bot match read as "6 online").
const PRESENCE_TTL_MS = 90_000
const presenceSeen = new Map<string, number>()

function presenceCount(): number {
  const now = Date.now()
  for (const [key, at] of presenceSeen) {
    if (now - at > PRESENCE_TTL_MS) presenceSeen.delete(key)
  }
  return presenceSeen.size
}

app.post('/api/presence/ping', (req, res) => {
  const key = (req.body as { key?: unknown } | undefined)?.key
  if (typeof key === 'string' && key.length > 0 && key.length <= 80) {
    presenceSeen.set(key, Date.now())
  }
  res.json({ online: presenceCount() })
})

app.get('/api/presence', (_req, res) => {
  res.json({ online: presenceCount() })
})

// ─── Start ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4000
httpServer.listen(PORT, () => {
  logger.info(`Plague backend running on port ${PORT}`)
})

export { app, io }
