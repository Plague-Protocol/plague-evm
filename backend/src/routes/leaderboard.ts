import { Router } from 'express'
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
  gamesPlayed: number
  winRate: number
  lastPlayedAt: string | null
}

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
          gamesPlayed: 0,
          winRate: 0,
          lastPlayedAt: null,
        }

        existing.displayName = nicknameByAddress.get(address) ?? existing.displayName
        existing.proofs += player.proofsSubmittedTotal
        existing.gamesPlayed += 1
        existing.lastPlayedAt = summary.endedAt.toISOString()

        if (player.result === 'win') existing.wins += 1
        else if (player.result === 'draw') existing.draws += 1
        else existing.losses += 1

        existing.winRate = existing.gamesPlayed > 0
          ? Number((existing.wins / existing.gamesPlayed).toFixed(3))
          : 0

        statsByAddress.set(address, existing)
      }
    }

    const rows = Array.from(statsByAddress.values()).sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins
      if (b.proofs !== a.proofs) return b.proofs - a.proofs
      return (a.displayName ?? a.address).localeCompare(b.displayName ?? b.address)
    })

    res.json({
      players: rows,
      totalGames: summaries.length,
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
      prisma.gameSummaryPlayer.count({
        where: { statusAtEnd: 'infected', result: 'loss' },
      }),
    ])
    res.json({ totalGames, totalPlayers, zombiesCaught })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: message })
  }
})