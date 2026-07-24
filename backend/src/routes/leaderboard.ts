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
  win: 7,
  draw: 3,     // kept under half a win so stalling a game into a draw
               // is never the smart play
  loss: 1,
  shield: 3,   // per innocence proof submitted — costs real USDm (proof fee)
               // and is capped at one per round, so it can't be grinded
  survival: 2, // reached game end without being eliminated
} as const

type SeasonDef = {
  id: string
  name: string
  startsAt: string | null // ISO UTC; null = from genesis
  endsAt: string | null   // ISO UTC (exclusive); null = ongoing/current
}

/**
 * Named leaderboard seasons, chronological. Games are bucketed by endedAt.
 * To archive the current season and start a fresh board: set endsAt on the
 * last entry and append the new season, e.g.
 *   { id: 'season-0', name: 'Season Zero', startsAt: null, endsAt: '2027-01-01T00:00:00Z' },
 *   { id: 'season-1', name: 'Season One',  startsAt: '2027-01-01T00:00:00Z', endsAt: null },
 * then redeploy the backend. Adjacent seasons should share the boundary
 * instant (endsAt is exclusive, startsAt inclusive) so no game falls in a gap.
 */
export const SEASONS: SeasonDef[] = [
  { id: 'season-0', name: 'Season Zero', startsAt: null, endsAt: null },
]

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

        // Chain-derived end time. phaseStartedAt is the last phase flip
        // before the room ended, i.e. within one round of the true end.
        // Stamping new Date() here would date every backfilled game to the
        // backfill run and corrupt the monthly leaderboard window.
        const endedSecs =
          Number(rawRoom.phaseStartedAt ?? 0) ||
          Number(rawRoom.startedAt ?? 0) ||
          Number(rawRoom.createdAt ?? 0)
        const endedAt = endedSecs > 0 ? new Date(endedSecs * 1000) : new Date()

        await upsertGameSummary({
          roomId: roomIdStr,
          chainId,
          contractAddress: process.env.CONTRACT_ADDRESS ?? '',
          outcome: outcomeLabel,
          totalRounds: Number(rawRoom.currentRound ?? 0),
          totalPot: totalPot.toString(),
          potPerWinner: potPerWinner.toString(),
          winnerCount,
          endedAt,
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

/**
 * POST /api/leaderboard/repair-timestamps
 * One-off repair for summaries whose endedAt was stamped with the backfill
 * run time instead of the on-chain end time (the pre-2026-07-24 backfill did
 * this, which made the monthly board identical to the global one). Re-reads
 * each room and resets endedAt to the chain-derived time when they disagree
 * by more than an hour. Idempotent — safe to run repeatedly.
 */
leaderboardRouter.post('/repair-timestamps', async (_req, res) => {
  try {
    const summaries = await prisma.gameSummary.findMany({
      select: { id: true, roomId: true, endedAt: true },
    })
    let repaired = 0
    let failed = 0
    for (const s of summaries) {
      try {
        const rawRoom = await chainAdapter.getRoom(BigInt(s.roomId))
        const endedSecs =
          Number(rawRoom.phaseStartedAt ?? 0) ||
          Number(rawRoom.startedAt ?? 0) ||
          Number(rawRoom.createdAt ?? 0)
        if (endedSecs <= 0) continue
        const chainEndedAt = new Date(endedSecs * 1000)
        if (Math.abs(chainEndedAt.getTime() - s.endedAt.getTime()) > 60 * 60 * 1000) {
          await prisma.gameSummary.update({ where: { id: s.id }, data: { endedAt: chainEndedAt } })
          repaired++
        }
      } catch (err) {
        failed++
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(`[leaderboard] repair failed for room ${s.roomId}: ${message}`)
      }
    }
    logger.info(`[leaderboard] timestamp repair: ${repaired} fixed of ${summaries.length} (${failed} unreadable)`)
    res.json({ success: true, scanned: summaries.length, repaired, failed })
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

    // Boards for the current + up to 5 previous calendar months (UTC),
    // skipping past months with no games. months[0] is always the current one.
    const months: {
      id: string
      name: string
      startsAt: string
      endsAt: string
      current: boolean
      games: number
      rows: LeaderboardRow[]
    }[] = []
    for (let i = 0; i < 6; i++) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1))
      const windowed = summaries.filter(s => s.endedAt >= start && s.endedAt < end)
      if (i > 0 && windowed.length === 0) continue
      months.push({
        id: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
        name: start.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        current: i === 0,
        games: windowed.length,
        rows: aggregateRows(windowed, nicknameByAddress),
      })
    }

    const seasons = SEASONS.map(s => {
      const start = s.startsAt ? new Date(s.startsAt) : null
      const end = s.endsAt ? new Date(s.endsAt) : null
      const windowed = summaries.filter(x =>
        (!start || x.endedAt >= start) && (!end || x.endedAt < end)
      )
      return {
        id: s.id,
        name: s.name,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        current: s.endsAt === null,
        games: windowed.length,
        rows: aggregateRows(windowed, nicknameByAddress),
      }
    })

    res.json({
      global,
      monthly,
      months,
      seasons,
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