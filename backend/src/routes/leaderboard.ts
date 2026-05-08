import { Router } from 'express'
import { prisma } from '../db/prisma'

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

leaderboardRouter.get('/', async (_req, res) => {
  try {
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