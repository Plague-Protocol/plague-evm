'use client'

/**
 * OnlineCount — live "N online" presence badge with a breathing green dot.
 *
 * Heartbeat model: every open tab POSTs a presence ping every 30s and renders
 * the returned count. Keyed by the connected wallet address when available
 * (two tabs of one player count once) or an anonymous per-tab id otherwise —
 * so demo visitors and lobby browsers count, and bots (which never run this
 * code) never do. Renders nothing until the first successful ping, so it
 * never shows a dead "0 online" when the backend is unreachable.
 */

import { useEffect, useState } from 'react'
import { useWallet } from '@/hooks/useWallet'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
const PING_MS = 30_000

/** Stable anonymous id for this tab (survives navigation, not tab close). */
function anonId(): string {
  try {
    let id = sessionStorage.getItem('zp-presence-id')
    if (!id) {
      id = `a:${crypto.randomUUID()}`
      sessionStorage.setItem('zp-presence-id', id)
    }
    return id
  } catch {
    return 'a:unknown'
  }
}

export function OnlineCount() {
  const { address } = useWallet()
  const [online, setOnline] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const ping = async () => {
      try {
        const key = address ? `w:${address.toLowerCase()}` : anonId()
        const r = await fetch(`${BACKEND_URL}/api/presence/ping`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        })
        if (!r.ok) throw new Error()
        const j = (await r.json()) as { online?: number }
        if (!cancelled) setOnline(typeof j.online === 'number' ? j.online : null)
      } catch {
        if (!cancelled) setOnline(null)
      }
    }
    void ping()
    const id = setInterval(() => void ping(), PING_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [address])

  if (online === null) return null

  return (
    <span
      className="flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]"
      style={{ borderColor: 'rgba(107,142,35,0.3)', backgroundColor: 'rgba(107,142,35,0.08)', color: '#8fa882' }}
      title={`${online} ${online === 1 ? 'person' : 'people'} on the site right now`}
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
