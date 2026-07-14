'use client'

/**
 * OnlineCount — live "N online" presence badge with a breathing green dot.
 * Polls the backend's connected-socket count every 30s; renders nothing until
 * the first successful fetch (and disappears again if the backend goes away),
 * so it never shows a dead "0 online".
 */

import { useEffect, useState } from 'react'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
const POLL_MS = 30_000

export function OnlineCount() {
  const [online, setOnline] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/presence`)
        if (!r.ok) throw new Error()
        const j = (await r.json()) as { online?: number }
        if (!cancelled) setOnline(typeof j.online === 'number' ? j.online : null)
      } catch {
        if (!cancelled) setOnline(null)
      }
    }
    void load()
    const id = setInterval(() => void load(), POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (online === null) return null

  return (
    <span
      className="flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]"
      style={{ borderColor: 'rgba(107,142,35,0.3)', backgroundColor: 'rgba(107,142,35,0.08)', color: '#8fa882' }}
      title={`${online} connected right now`}
    >
      <span className="relative flex h-2 w-2">
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
          style={{ backgroundColor: '#84cc16', animationDuration: '2.4s' }}
        />
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: '#84cc16' }} />
      </span>
      {online} online
    </span>
  )
}
