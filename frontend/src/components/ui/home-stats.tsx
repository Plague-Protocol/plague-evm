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

export function HeroStats() {
  const [stats, setStats] = useState<SiteStats | null>(null)

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/leaderboard/stats`)
      .then(r => r.ok ? r.json() : null)
      .then((data: SiteStats | null) => { if (data) setStats(data) })
      .catch(() => {/* keep static fallback */})
  }, [])

  const gamesCount   = useCountUp(stats ? stats.totalGames : null)
  const zombiesCount = useCountUp(stats ? stats.zombiesCaught : null)

  const items = [
    { icon: '🧟', value: gamesCount !== null ? formatCount(gamesCount) : '—', label: 'Matches Played' },
    { icon: '🩸', value: zombiesCount !== null ? formatCount(zombiesCount) : '—', label: 'Zombies Caught' },
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
            {stat.value}
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#7fa06c' }}>
            {stat.label}
          </span>
        </div>
      ))}
    </>
  )
}
