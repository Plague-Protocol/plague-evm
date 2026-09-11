'use client'

/**
 * useTopPlayer — the address currently first on the global leaderboard.
 *
 * 🚨 THIS IS A TARGET, NOT A PRIVILEGE.
 * The crown is deliberately cosmetic. A mechanical perk for the leader — a free
 * Shield every round was the version considered — inverts the game it is meant
 * to reward: a player who can prove innocence for free every round is removed
 * from the deduction entirely, and worse, cannot use the perk at all once
 * infected, so declining to use it becomes the tell. It also compounds, since
 * the same players then keep winning and the board ossifies.
 *
 * Marking the leader instead makes holding the top spot HARDER, which is the
 * version worth having: everyone knows who to gang up on.
 *
 * Fails silent by design. A leaderboard that is down, slow or empty just means
 * no crown — never a blocked render, and never a thrown error inside a live
 * game.
 */

import { useEffect, useState } from 'react'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? ''

interface LeaderboardRow {
  address?: string
  points?: number
}

/**
 * Lower-cased address of the global leader, or null while unknown.
 *
 * Cached per session: the leaderboard only moves when a game ends, and the
 * arena mounts this on every room. Refetching per mount would add a request to
 * the hot path for a value that changes a few times a day.
 */
let cached: string | null | undefined

export function useTopPlayer(): string | null {
  const [address, setAddress] = useState<string | null>(cached ?? null)

  useEffect(() => {
    if (cached !== undefined) return
    if (!BACKEND_URL) { cached = null; return }
    let cancelled = false

    void (async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/leaderboard`)
        if (!res.ok) throw new Error(String(res.status))
        const body: { global?: LeaderboardRow[] } = await res.json()
        const rows = body.global ?? []
        // A board with nobody on it, or a leader on zero points, has no leader
        // worth crowning — an empty season would otherwise crown whoever
        // happened to sort first.
        const top = rows[0]
        const next = top?.address && (top.points ?? 0) > 0
          ? top.address.toLowerCase()
          : null
        cached = next
        if (!cancelled) setAddress(next)
      } catch {
        cached = null
      }
    })()

    return () => { cancelled = true }
  }, [])

  return address
}
