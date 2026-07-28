'use client'

/**
 * NextWindowBanner — countdown to the next scheduled play window ("Zombie Hour").
 *
 * Cold-start play: a 4+ player real-money game with an always-on queue spreads
 * two players across 24 empty hours; a promoted fixed-time window concentrates
 * them into one full lobby. This banner is the on-site half of that plan — the
 * announcement itself is admin-set at /admin (SiteConfig key `schedule`, same
 * signed-write path as the bounty card), so windows are scheduled without a
 * deploy. Renders nothing when no window is configured/active, or once the
 * window is more than `durationMins` past.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'

type ScheduleConfig = {
  active: boolean
  title: string
  startsAt: string
  note?: string
  durationMins?: number
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
const DEFAULT_DURATION_MINS = 60

function formatDelta(ms: number): string {
  const mins = Math.floor(ms / 60_000)
  const days = Math.floor(mins / (60 * 24))
  const hours = Math.floor((mins % (60 * 24)) / 60)
  const m = mins % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${String(m).padStart(2, '0')}m`
  const secs = Math.floor((ms % 60_000) / 1000)
  return `${m}m ${String(secs).padStart(2, '0')}s`
}

export function NextWindowBanner({ className = '' }: { readonly className?: string }) {
  const [config, setConfig] = useState<ScheduleConfig | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/config/schedule`, { signal: AbortSignal.timeout(8000) })
      .then(r => (r.ok ? r.json() : null))
      .then(j => setConfig(j?.value ?? null))
      .catch(() => { /* no banner is a fine failure mode */ })
  }, [])

  const startsAtMs = config ? Date.parse(config.startsAt) : Number.NaN
  const live = config
    ? now >= startsAtMs && now < startsAtMs + (config.durationMins ?? DEFAULT_DURATION_MINS) * 60_000
    : false
  const upcoming = config ? now < startsAtMs : false

  // Tick only while visible; every second inside the last hour, else sparse.
  useEffect(() => {
    if (!config?.active || (!upcoming && !live)) return
    const near = live || startsAtMs - now < 60 * 60_000
    const id = setInterval(() => setNow(Date.now()), near ? 1_000 : 30_000)
    return () => clearInterval(id)
  }, [config, upcoming, live, startsAtMs, now])

  if (!config?.active || Number.isNaN(startsAtMs) || (!upcoming && !live)) return null

  const localTime = new Date(startsAtMs).toLocaleString(undefined, {
    weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short',
  })

  return (
    <Link
      href="/lobby"
      className={`block rounded-lg border px-4 py-3 transition-all hover:brightness-110 ${className}`}
      style={live
        ? { borderColor: 'rgba(230,51,41,0.6)', backgroundColor: 'rgba(230,51,41,0.1)', boxShadow: '0 0 18px rgba(230,51,41,0.25)' }
        : { borderColor: 'rgba(245,197,24,0.5)', backgroundColor: 'rgba(245,197,24,0.07)' }}
    >
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center">
        <span
          className="font-mono text-[10px] font-bold uppercase tracking-[0.22em]"
          style={{ color: live ? '#e63329' : '#f5c518' }}
        >
          {live
            ? <><span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full align-middle" style={{ backgroundColor: '#e63329' }} />{config.title} · LIVE NOW</>
            : <>☣ {config.title} · {localTime}</>}
        </span>
        {!live && (
          <span className="font-heading text-lg leading-none tabular-nums" style={{ color: '#f5c518' }}>
            {formatDelta(startsAtMs - now)}
          </span>
        )}
        {config.note && (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: '#8fa882' }}>
            {config.note}
          </span>
        )}
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] underline underline-offset-2" style={{ color: live ? '#e63329' : '#6b8e23' }}>
          {live ? 'Join the outbreak →' : 'Set a reminder — lobby opens here'}
        </span>
      </div>
    </Link>
  )
}
