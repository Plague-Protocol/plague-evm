'use client'

/**
 * What is being played right now, for the nav's Arena indicator.
 *
 * Two different signals, and the second is the valuable one:
 *   - `count`  — somebody is playing. A soft nudge.
 *   - `mine`   — *your* room is live. A host who created a room and wandered
 *                off has nothing else telling them it started; the lobby only
 *                watches for that while you are sitting on the lobby page.
 *
 * Reads the backend's `/api/rooms/live` rather than the chain: this runs on
 * every page, and a per-page room enumeration is the unbatched-eth_call load
 * that hurt this app's LCP once already. The endpoint verifies its candidates
 * against the chain server-side, so the answer is authoritative without the
 * client paying for it.
 */

import { useEffect, useState } from 'react'
import { useWallet } from '@/hooks/useWallet'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
const POLL_MS = 30_000

type LiveRoom = { roomId: string; players?: string[] }

export type LiveMatches = {
  /** Matches in progress across the whole app. */
  count: number
  /** The connected wallet's own live room id, if it has one. */
  mine: string | null
}

export function useLiveMatches(): LiveMatches {
  const { address } = useWallet()
  const [rooms, setRooms] = useState<LiveRoom[]>([])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      // A backgrounded tab cannot show the indicator to anyone.
      if (document.hidden) return
      try {
        const res = await fetch(`${BACKEND_URL}/api/rooms/live`, { signal: AbortSignal.timeout(8000) })
        if (!res.ok) return
        const data = await res.json() as { rooms?: LiveRoom[] }
        if (!cancelled) setRooms(Array.isArray(data.rooms) ? data.rooms : [])
      } catch {
        // Backend down / offline: keep the last known value rather than
        // flicking the indicator off and on as connectivity wobbles.
      }
    }

    void load()
    const id = setInterval(load, POLL_MS)
    // Returning to the tab should refresh at once, not up to 30s later.
    const onVisible = () => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const me = address?.toLowerCase() ?? null
  const mine = me
    ? rooms.find(r => r.players?.some(p => p.toLowerCase() === me))?.roomId ?? null
    : null

  return { count: rooms.length, mine }
}
