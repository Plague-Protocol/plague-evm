'use client'

import { useEffect, useRef, useState } from 'react'

interface SiteStats {
  totalGames: number
  totalPlayers: number
  zombiesCaught: number
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

/** Count 0→target over ~1.2s (ease-out cubic) when the value first arrives.
 *  Jumps straight to the target under prefers-reduced-motion. */
function useCountUp(target: number | null): number | null {
  const [display, setDisplay] = useState<number | null>(null)
  const startedRef = useRef(false)
  useEffect(() => {
    if (target === null) return
    if (startedRef.current) {
      setDisplay(target) // later refreshes jump straight there
      return
    }
    startedRef.current = true
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(target)
      return
    }
    const t0 = performance.now()
    const DURATION = 1_200
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / DURATION)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(Math.round(target * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return display
}

// ── Hero stat strip (3 columns) ──────────────────────────────────────────────

/** Last-known stats survive reloads so a slow/failed fetch shows yesterday's
 *  real numbers instead of placeholders. A dash on a real-money game's landing
 *  page reads as "nobody plays here" — reviewer feedback, 2026-07. */
const STATS_CACHE_KEY = 'plague:home-stats'

function readCachedStats(): SiteStats | null {
  try {
    const raw = localStorage.getItem(STATS_CACHE_KEY)
    return raw ? JSON.parse(raw) as SiteStats : null
  } catch { return null }
}

/** Pulsing placeholder shown only when we have no number at all (first ever
 *  visit while the fetch is in flight). Reads as "loading", not "zero". */
function StatSkeleton() {
  return (
    <span
      className="inline-block h-[1em] w-14 animate-pulse rounded"
      style={{ backgroundColor: 'rgba(107,142,35,0.25)' }}
      aria-label="loading"
    />
  )
}

export function HeroStats() {
  const [stats, setStats] = useState<SiteStats | null>(null)

  useEffect(() => {
    setStats(readCachedStats()) // instant paint with last-known real numbers
    fetch(`${BACKEND_URL}/api/leaderboard/stats`, { signal: AbortSignal.timeout(8000) })
      .then(r => r.ok ? r.json() : null)
      .then((data: SiteStats | null) => {
        if (!data) return
        setStats(data)
        try { localStorage.setItem(STATS_CACHE_KEY, JSON.stringify(data)) } catch { /* private mode */ }
      })
      .catch(() => {/* cached value (if any) stays up */})
  }, [])

  const gamesCount   = useCountUp(stats ? stats.totalGames : null)
  const zombiesCount = useCountUp(stats ? stats.zombiesCaught : null)

  const items = [
    { icon: '🧟', value: gamesCount !== null ? formatCount(gamesCount) : null, label: 'Matches Played' },
    { icon: '🩸', value: zombiesCount !== null ? formatCount(zombiesCount) : null, label: 'Zombies Caught' },
    { icon: '🟢', value: '99.9%', label: 'Chain Uptime' },
  ]

  return (
    <>
      {items.map((stat) => (
        <div
          key={stat.label}
          className="flex flex-col items-center gap-2 sm:gap-3 rounded-2xl border p-4 sm:p-8 text-center transition-all hover:scale-[1.02]"
          style={{ borderColor: 'rgba(107,142,35,0.15)', backgroundColor: 'rgba(12,19,9,0.85)' }}
        >
          <span className="text-3xl sm:text-5xl">{stat.icon}</span>
          <span className="font-heading text-3xl sm:text-5xl font-bold leading-none" style={{ color: '#d4c9b2' }}>
            {stat.value ?? <StatSkeleton />}
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#7fa06c' }}>
            {stat.label}
          </span>
        </div>
      ))}
    </>
  )
}
