'use client'

/**
 * How many matches are being played right now, for the nav's live indicator.
 *
 * Reads the backend's Postgres-backed `/api/rooms/live` rather than the chain:
 * this runs on every page, and an on-chain room enumeration per page load is
 * exactly the unbatched-eth_call load that already hurt this app's LCP once.
 *
 * Under-reports rather than over-reports — a room whose status write failed is
 * simply absent. A missing dot is a far better failure than a dot that leads a
 * player to an empty arena.
 */

import { useEffect, useState } from 'react'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
const POLL_MS = 30_000

export function useLiveMatchCount(): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      // A backgrounded tab cannot show the dot to anyone.
      if (document.hidden) return
      try {
        const res = await fetch(`${BACKEND_URL}/api/rooms/live`, { signal: AbortSignal.timeout(8000) })
        if (!res.ok) return
        const data = await res.json() as { count?: number }
        if (!cancelled) setCount(typeof data.count === 'number' ? data.count : 0)
      } catch {
        // Backend down / offline: leave the last known value rather than
        // flicking the dot off and on as connectivity wobbles.
      }
    }

    void load()
    const id = setInterval(load, POLL_MS)
    // Coming back to the tab should refresh immediately, not up to 30s later.
    const onVisible = () => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return count
}
