'use client'

import { useEffect, useState } from 'react'

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

// ── Hero stat strip (3 columns) ──────────────────────────────────────────────

export function HeroStats() {
  const [stats, setStats] = useState<SiteStats | null>(null)

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/leaderboard/stats`)
      .then(r => r.ok ? r.json() : null)
      .then((data: SiteStats | null) => { if (data) setStats(data) })
      .catch(() => {/* keep static fallback */})
  }, [])

  const items = [
    { icon: '🧟', value: stats ? formatCount(stats.totalGames) : '—', label: 'Matches Played' },
    { icon: '🩸', value: stats ? formatCount(stats.zombiesCaught) : '—', label: 'Zombies Caught' },
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
          <span className="font-display text-3xl sm:text-5xl font-bold leading-none" style={{ color: '#d4c9b2' }}>
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

// ── CTA section mini-stats (3 inline) ────────────────────────────────────────

export function CtaStats() {
  const [stats, setStats] = useState<SiteStats | null>(null)

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/leaderboard/stats`)
      .then(r => r.ok ? r.json() : null)
      .then((data: SiteStats | null) => { if (data) setStats(data) })
      .catch(() => {})
  }, [])

  const items = [
    { value: stats ? formatCount(stats.totalGames)    : '—', label: 'Matches Played' },
    { value: '< 5s',                                          label: 'Per Move' },
    { value: '99.9%',                                         label: 'Chain Uptime' },
  ]

  return (
    <>
      {items.map((s) => (
        <div key={s.label} className="flex flex-col items-center gap-2 text-center">
          <span className="font-display text-2xl sm:text-4xl font-bold" style={{ color: '#d4c9b2' }}>
            {s.value}
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#7fa06c' }}>
            {s.label}
          </span>
        </div>
      ))}
    </>
  )
}
