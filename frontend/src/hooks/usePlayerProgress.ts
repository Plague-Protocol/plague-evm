'use client'

/**
 * usePlayerProgress — the player's rank, streak and distance to the next rung.
 *
 * Fetched once, when a game ENDS. That is the only moment a player is reliably
 * looking at the screen and the only one where "what would coming back get me"
 * is a live question — and it is also the moment they are about to close the
 * tab, which is the behaviour this is trying to change.
 *
 * Deliberately NOT loaded on mount or polled: it would be a request per page
 * view for information nobody has asked for yet, and the endpoint aggregates a
 * player's whole history.
 *
 * Failure is silent and non-blocking. This is a nice-to-have on top of a result
 * card that has to work regardless, so a backend hiccup, an offline phone, or a
 * player with no finished games yet all simply render nothing.
 */

import { useEffect, useState } from 'react'

export interface RankInfo { tier: number; name: string; at: number }

export interface PlayerProgress {
  address: string
  points: number
  gamesPlayed: number
  wins: number
  currentStreak: number
  bestStreak: number
  rank: RankInfo
  next: RankInfo | null
  toNext: number
  /** Progress through the current band, 0..1. */
  fraction: number
}

export function usePlayerProgress(
  address: string | null | undefined,
  /** Flip true once the game is over; nothing is fetched before that. */
  enabled: boolean,
) {
  const [progress, setProgress] = useState<PlayerProgress | null>(null)

  useEffect(() => {
    if (!enabled || !address) return
    const base = process.env.NEXT_PUBLIC_BACKEND_URL
    if (!base) return

    const controller = new AbortController()
    // Small delay so the request never competes with the endgame animation, and
    // so the backend has settled the game summary it is about to be asked about.
    const timer = setTimeout(() => {
      fetch(`${base}/api/leaderboard/progress/${address}`, { signal: controller.signal })
        .then(r => (r.ok ? r.json() : null))
        .then(data => { if (data && !controller.signal.aborted) setProgress(data) })
        .catch(() => {}) // decoration on top of a card that must work without it
    }, 1_200)

    return () => { clearTimeout(timer); controller.abort() }
  }, [address, enabled])

  return progress
}
