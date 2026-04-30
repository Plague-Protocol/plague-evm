import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'
import { roomRouter } from './routes/rooms'
import { setupSocketHandlers } from './socket/handlers'
import { logger } from './lib/logger'

dotenv.config()

const app = express()
const httpServer = createServer(app)

// ─── Middleware ─────────────────────────────────────────────────────────────

app.use(helmet())
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }))
app.use(express.json())

// ─── REST Routes ────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true }))
app.use('/api/rooms', roomRouter)

// ─── Socket.io ──────────────────────────────────────────────────────────────

const io = new Server(httpServer, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000' },
})

setupSocketHandlers(io)

// ─── Start ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4000
httpServer.listen(PORT, () => {
  logger.info(`Plague backend running on port ${PORT}`)
})

export { app, io }
