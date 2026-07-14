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
import {
  setupSocketHandlers,
  startRoomExpiryMonitor,
  startRoleCommitmentMonitor,
  startPhaseAdvanceMonitor,
} from './socket/handlers'
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

// ─── Socket.io ──────────────────────────────────────────────────────────────

const io = new Server(httpServer, {
  cors: { origin: allowedOrigins },
})

setupSocketHandlers(io)
startRoomExpiryMonitor(io)
startRoleCommitmentMonitor(io)
startPhaseAdvanceMonitor(io)

// Live presence: connected socket count (players + lobby visitors). Declared
// after `io` exists; route registration order doesn't matter for Express.
app.get('/api/presence', (_req, res) => {
  res.json({ online: io.engine.clientsCount })
})

// ─── Start ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4000
httpServer.listen(PORT, () => {
  logger.info(`Plague backend running on port ${PORT}`)
})

export { app, io }
