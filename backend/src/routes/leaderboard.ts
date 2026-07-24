import { Router } from 'express'
import type { Prisma } from '../generated/prisma/client'
import { prisma } from '../db/prisma'
import { chainAdapter } from '../services/chainAdapter'
import { upsertGameSummary } from '../repositories/rooms'
import { logger } from '../lib/logger'

export const leaderboardRouter = Router()

type LeaderboardRow = {
  address: string
  displayName: string
  wins: number
  losses: number
  draws: number
  proofs: number
  survivals: number
  points: number
  gamesPlayed: number
  winRate: number
  lastPlayedAt: string | null
}

/**
 * Aggregate points formula. Weighs every way a player engages: winning,
 * fighting to a draw, showing up at all, spending money on shields
 * (innocence proofs), and surviving to the end of a game. Mirrored in the
 * frontend's "How points work" card — keep the two in sync.
 */
export const POINTS = {
  win: 100,
  draw: 40,
  loss: 10,
  shield: 15,   // per innocence proof submitted (costs the proof fee in USDm)
  survival: 20, // reached game end without being eliminated
} as const

/**
 * Backfill GameSummary records for any ended rooms on-chain that are
 * missing from the database (e.g. games that finished while the backend
 * was offline and missed the live GameEnded event).
 */
async function backfillMissingSummaries(): Promise<number> {
  let backfilled = 0
  try {
    const roomCount = await chainAdapter.getRoomCount()
    if (roomCount === 0n) return 0

    // Fetch existing summaries to know which rooms are already persisted.
    const existingRoomIds = new Set(
      (await prisma.gameSummary.findMany({ select: { roomId: true } }))
        .map(r => r.roomId)
    )

    for (let id = 1n; id <= roomCount; id++) {
      const roomIdStr = id.toString()
      if (existingRoomIds.has(roomIdStr)) continue

      try {
        const rawRoom = await chainAdapter.getRoom(id)
        // RoomStatus.Ended = 3
        if (Number(rawRoom.status) !== 3) continue

        const rawPlayers = await Promise.all(
          rawRoom.players.map(addr => chainAdapter.getPlayer(id, addr))
        )
        const totalPot = rawPlayers.reduce(
          (sum, player) => sum + BigInt(player.staked.toString()),
          0n
        )

        // Try to get outcome from event logs, fall back to inferring from player states
        const endedLog = await chainAdapter.getGameEndedLogs(id)
        let endedOutcome = endedLog?.outcome ?? 2

        // If no log found, infer from player states
        if (!endedLog) {
          const alivePlayers = rawPlayers.filter(p => Number(p.status) !== 2)
          const infectedAlive = alivePlayers.filter(p => Number(p.status) === 1).length
          const cleanAlive = alivePlayers.filter(p => Number(p.status) === 0).length
          if (infectedAlive === 0 && cleanAlive > 0) endedOutcome = 0 // clean_win
          else if (infectedAlive > cleanAlive) endedOutcome = 1 // infected_win
          else endedOutcome = 2 // draw
        }

        let winningFaction: 'clean' | 'infected' | null = null
        if (endedOutcome === 0) winningFaction = 'clean'
        else if (endedOutcome === 1) winningFaction = 'infected'

        const alivePlayers = rawPlayers.filter(p => Number(p.status) !== 2)
        const winnerAddresses = winningFaction
          ? alivePlayers
              .filter(p => Number(p.status) === (winningFaction === 'clean' ? 0 : 1))
              .map(p => p.addr)
          : alivePlayers.map(p => p.addr)
        const winnerCount = winnerAddresses.length
        const potPerWinner = winnerCount > 0 ? totalPot / BigInt(winnerCount) : 0n

        // Look up nicknames
        const nicknameRows = await prisma.playerNickname.findMany({
          where: { address: { in: rawPlayers.map(p => p.addr.toLowerCase()) } },
        })
        const nicknameByAddress = new Map(nicknameRows.map(r => [r.address.toLowerCase(), r.nickname]))

        const playerSummaries = rawPlayers.map(player => {
          const status = Number(player.status)
          let result: 'win' | 'loss' | 'draw' = 'loss'
          if (endedOutcome === 2) {
            result = 'draw'
          } else if (winningFaction !== null) {
            const winningStatus = winningFaction === 'clean' ? 0 : 1
            result = status === winningStatus ? 'win' : 'loss'
          }

          let statusAtEnd: 'eliminated' | 'infected' | 'clean' = 'clean'
          if (status === 2) statusAtEnd = 'eliminated'
          else if (status === 1) statusAtEnd = 'infected'

          const nickname = nicknameByAddress.get(player.addr.toLowerCase())

          return {
            address: player.addr,
            displayNameSnapshot: nickname ?? `${player.addr.slice(0, 6)}…${player.addr.slice(-4)}`,
            result,
            proofsSubmittedTotal: Number(player.proofsSubmittedTotal),
            statusAtEnd,
            joinedAt: new Date(Number(player.joinedAt) * 1000),
          }
        })

        let outcomeLabel: 'clean_win' | 'infected_win' | 'max_rounds_draw' = 'max_rounds_draw'
        if (endedOutcome === 0) outcomeLabel = 'clean_win'
        else if (endedOutcome === 1) outcomeLabel = 'infected_win'

        const chainId = Number(process.env.CHAIN_ID ?? 11142220)

        await upsertGameSummary({
          roomId: roomIdStr,
          chainId,
          contractAddress: process.env.CONTRACT_ADDRESS ?? '',
          outcome: outcomeLabel,
          totalRounds: Number(rawRoom.currentRound ?? 0),
          totalPot: totalPot.toString(),
          potPerWinner: potPerWinner.toString(),
          winnerCount,
          endedAt: new Date(),
          players: playerSummaries,
        })

        backfilled++
        logger.info(`[leaderboard] backfilled GameSummary for room ${roomIdStr}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(`[leaderboard] failed to backfill room ${roomIdStr}: ${message}`)
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(`[leaderboard] backfill scan failed: ${message}`)
  }
  return backfilled
}

leaderboardRouter.post('/backfill', async (_req, res) => {
  try {
    const backfilled = await backfillMissingSummaries()
    res.json({ success: true, backfilled })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: message })
  }
})

type SummaryWithPlayers = Prisma.GameSummaryGetPayload<{ include: { players: true } }>

function aggregateRows(
  summaries: SummaryWithPlayers[],
  nicknameByAddress: Map<string, string>
): LeaderboardRow[] {
  const statsByAddress = new Map<string, LeaderboardRow>()

  for (const summary of summaries) {
    for (const player of summary.players) {
      const address = player.address.toLowerCase()
      const existing = statsByAddress.get(address) ?? {
        address: player.address,
        displayName: nicknameByAddress.get(address) ?? player.displayNameSnapshot ?? `${player.address.slice(0, 6)}…${player.address.slice(-4)}`,
        wins: 0,
        losses: 0,
        draws: 0,
        proofs: 0,
        survivals: 0,
        points: 0,
        gamesPlayed: 0,
        winRate: 0,
        lastPlayedAt: null,
      }

      existing.displayName = nicknameByAddress.get(address) ?? existing.displayName
      existing.proofs += player.proofsSubmittedTotal
      existing.gamesPlayed += 1
      if (player.statusAtEnd !== 'eliminated') existing.survivals += 1
      // Summaries arrive newest-first; only take the first (most recent) endedAt.
      existing.lastPlayedAt ??= summary.endedAt.toISOString()

      if (player.result === 'win') existing.wins += 1
      else if (player.result === 'draw') existing.draws += 1
      else existing.losses += 1

      existing.winRate = existing.gamesPlayed > 0
        ? Number((existing.wins / existing.gamesPlayed).toFixed(3))
        : 0

      existing.points =
        existing.wins * POINTS.win +
        existing.draws * POINTS.draw +
        existing.losses * POINTS.loss +
        existing.proofs * POINTS.shield +
        existing.survivals * POINTS.survival

      statsByAddress.set(address, existing)
    }
  }

  return Array.from(statsByAddress.values()).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.wins !== a.wins) return b.wins - a.wins
    if (b.proofs !== a.proofs) return b.proofs - a.proofs
    return (a.displayName ?? a.address).localeCompare(b.displayName ?? b.address)
  })
}

leaderboardRouter.get('/', async (_req, res) => {
  try {
    // Always check the chain for missing summaries (function skips already-persisted rooms).
    const backfilled = await backfillMissingSummaries()
    if (backfilled > 0) {
      logger.info(`[leaderboard] backfilled ${backfilled} game summaries from chain`)
    }

    const summaries = await prisma.gameSummary.findMany({
      orderBy: { endedAt: 'desc' },
      include: {
        players: true,
      },
    })

    const nicknameRows = await prisma.playerNickname.findMany()
    const nicknameByAddress = new Map(nicknameRows.map(row => [row.address.toLowerCase(), row.nickname]))

    // Monthly window = current calendar month, UTC.
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const monthlySummaries = summaries.filter(s => s.endedAt >= monthStart)

    const global = aggregateRows(summaries, nicknameByAddress)
    const monthly = aggregateRows(monthlySummaries, nicknameByAddress)

    res.json({
      global,
      monthly,
      // Legacy alias kept so an older frontend deploy keeps working.
      players: global,
      totalGames: summaries.length,
      monthlyGames: monthlySummaries.length,
      monthStart: monthStart.toISOString(),
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: message })
  }
})

/**
 * GET /api/leaderboard/stats
 * Lightweight aggregate counts for the homepage hero stats.
 * No backfill — reads only persisted summaries.
 */
leaderboardRouter.get('/stats', async (_req, res) => {
  try {
    const [totalGames, totalPlayers, zombiesCaught] = await Promise.all([
      prisma.gameSummary.count(),
      prisma.gameSummaryPlayer.groupBy({ by: ['address'] }).then(r => r.length),
      // "Zombie caught" = games where clean players won (Patient Zero was identified)
      prisma.gameSummary.count({ where: { outcome: 'clean_win' } }),
    ])
    res.json({ totalGames, totalPlayers, zombiesCaught })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: message })
  }
})