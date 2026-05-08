'use client'

import { useEffect, useState } from 'react'
import { SiteNav } from '@/components/ui/site-nav'

type LeaderboardPlayer = {
  address: string
  displayName: string
  wins: number
  losses: number
  draws: number
  proofs: number
  gamesPlayed: number
  winRate: number
  lastPlayedAt: string | null
}

const rankColors = ['#f5c518', '#8fa882', '#cd7f32', '#4a5e44']
const tabs = ['Global', 'Season 0', 'Proof Leaders', 'This Week']

export default function LeaderboardPage() {
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const loadLeaderboard = async () => {
      try {
        setLoading(true)
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
        const res = await fetch(`${backendUrl}/api/leaderboard`, { signal: controller.signal })
        if (!res.ok) throw new Error(`Leaderboard request failed: ${res.status}`)
        const data = await res.json() as { players?: LeaderboardPlayer[] }
        setPlayers(data.players ?? [])
        setError(null)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Failed to load leaderboard.')
        setPlayers([])
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void loadLeaderboard()
    return () => controller.abort()
  }, [])

  let leaderboardBody: React.ReactNode
  if (loading) {
    leaderboardBody = (
      <div className="rounded-xl border p-6 font-mono text-sm" style={{ borderColor: 'rgba(57,255,20,0.18)', backgroundColor: '#0e180d', color: '#8fa882' }}>
        Loading leaderboard data…
      </div>
    )
  } else if (error) {
    leaderboardBody = (
      <div className="rounded-xl border p-6 font-mono text-sm" style={{ borderColor: 'rgba(230,51,41,0.18)', backgroundColor: '#0e180d', color: '#e63329' }}>
        {error}
      </div>
    )
  } else if (players.length === 0) {
    leaderboardBody = (
      <div className="rounded-xl border p-6 font-mono text-sm" style={{ borderColor: 'rgba(57,255,20,0.18)', backgroundColor: '#0e180d', color: '#8fa882' }}>
        No completed games yet. Rankings will appear here once rooms finish.
      </div>
    )
  } else {
    leaderboardBody = (
      <>
        {players.map((player, index) => (
          <div
            key={player.address}
            className="rise-in grid gap-6 rounded-xl border p-6 transition-all duration-200 hover:scale-[1.01]"
            style={{
              gridTemplateColumns: 'auto 1fr auto auto',
              borderColor: 'rgba(57,255,20,0.18)',
              backgroundColor: '#0e180d',
              animationDelay: `${index * 80}ms`,
            }}
          >
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl font-display text-xl leading-none"
              style={{ backgroundColor: `${rankColors[index % rankColors.length]}22`, color: rankColors[index % rankColors.length] }}
            >
              {index + 1}
            </div>
            <div className="min-w-0">
              <p className="font-display text-xl leading-none" style={{ color: '#d4c9b2' }}>
                {player.displayName}
              </p>
              <p className="mt-1 font-mono text-xs uppercase tracking-[0.14em]" style={{ color: '#4a5e44' }}>
                {player.lastPlayedAt ? `Last played ${new Date(player.lastPlayedAt).toLocaleDateString()}` : 'No recent game'}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span
                  className="rounded-full px-3 py-0.5 font-mono text-[10px] uppercase"
                  style={{ backgroundColor: 'rgba(245,197,24,0.12)', color: '#f5c518' }}
                >
                  {Math.round(player.winRate * 100)}% win rate
                </span>
                <span
                  className="rounded-full px-3 py-0.5 font-mono text-[10px] uppercase"
                  style={{
                    backgroundColor: player.wins >= player.losses ? 'rgba(26,122,74,0.2)' : 'rgba(230,51,41,0.2)',
                    color: player.wins >= player.losses ? '#1a7a4a' : '#e63329',
                  }}
                >
                  {player.wins}W / {player.losses}L / {player.draws}D
                </span>
              </div>
            </div>
            <div
              className="flex flex-col items-center justify-center rounded-xl px-4 py-2 text-center"
              style={{ backgroundColor: 'rgba(57,255,20,0.1)' }}
            >
              <p className="font-mono text-[10px] uppercase" style={{ color: '#4a5e44' }}>Wins</p>
              <p className="font-display text-2xl leading-none" style={{ color: '#d4c9b2' }}>{player.wins}</p>
            </div>
            <div
              className="flex flex-col items-center justify-center rounded-xl px-4 py-2 text-center"
              style={{ backgroundColor: 'rgba(230,51,41,0.1)' }}
            >
              <p className="font-mono text-[10px] uppercase" style={{ color: '#4a5e44' }}>Proofs</p>
              <p className="font-display text-2xl leading-none" style={{ color: '#e63329' }}>{player.proofs}</p>
            </div>
          </div>
        ))}
      </>
    )
  }

  return (
    <main className="min-h-screen" style={{ backgroundColor: '#060b06', color: '#d4c9b2', backgroundImage: 'url(/images/bg-zombie-portrait.jpg)', backgroundSize: 'cover', backgroundPosition: 'center top', backgroundAttachment: 'fixed' }}>
      {/* Nav */}
      <div className="px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="mx-auto w-full max-w-6xl">
          <SiteNav currentPath="/leaderboard" />
        </div>
      </div>

      {/* Dark overlay for readability */}
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundColor: 'rgba(6,11,6,0.82)', zIndex: 0 }} />
      <div className="relative" style={{ zIndex: 1 }}>

      {/* Header */}
      <header className="px-6 py-16">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 text-center">
          <span className="font-mono text-xs uppercase tracking-[0.3em]" style={{ color: '#39ff14' }}>
            Season Zero
          </span>
          <h1
            className="font-display text-6xl font-black leading-none sm:text-7xl lg:text-8xl"
            style={{
              background: 'linear-gradient(135deg, #cc1414, #39ff14)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            LEADERBOARD
          </h1>
          <p className="max-w-xl font-body text-lg" style={{ color: '#8fa882' }}>
            Global rankings of the deadliest operatives on Celo.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {tabs.map((tab, i) => (
              <button
                key={tab}
                className="rounded-full border-2 px-8 py-3 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90"
                style={{
                  borderColor: i === 0 ? '#39ff14' : 'rgba(57,255,20,0.3)',
                  backgroundColor: i === 0 ? 'rgba(57,255,20,0.15)' : 'transparent',
                  color: i === 0 ? '#39ff14' : '#4a5e44',
                }}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="px-6 pb-20">
        <div className="mx-auto w-full max-w-6xl">
          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">

            {/* Table */}
            <article
              className="rise-in rounded-lg border p-6"
              style={{ backgroundColor: '#0a100a', borderColor: 'rgba(57,255,20,0.2)' }}
            >
              {/* Table header */}
              <div
                className="mb-4 grid gap-6 rounded-xl border-2 p-6"
                style={{ gridTemplateColumns: 'auto 1fr auto auto', borderColor: 'rgba(57,255,20,0.35)', backgroundColor: '#0e180d' }}
              >
                <span className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>#</span>
                <span className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>Operative</span>
                <span className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>Wins</span>
                <span className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>Proofs</span>
              </div>

              <div className="space-y-3">
                {leaderboardBody}
              </div>
            </article>

            {/* Right sidebar */}
            <aside className="flex flex-col gap-6">
              {/* Your Stats */}
              <div
                className="rise-in rounded-lg border p-10"
                style={{ backgroundColor: '#0a100a', borderColor: 'rgba(57,255,20,0.2)', animationDelay: '100ms' }}
              >
                <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>Your Stats</p>
                <p className="mt-3 font-display text-3xl leading-none" style={{ color: '#d4c9b2' }}>Season 0</p>
                <div className="mt-6 space-y-4">
                  {[
                    { label: 'Completed games', value: String(players.reduce((sum, row) => sum + row.gamesPlayed, 0)) },
                    { label: 'Top rank', value: players.length > 0 ? '#1' : '—' },
                    { label: 'Tracked players', value: String(players.length) },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="flex items-center justify-between rounded-lg border px-4 py-3"
                      style={{ borderColor: 'rgba(57,255,20,0.2)', backgroundColor: '#0e180d' }}
                    >
                      <span className="font-mono text-xs uppercase tracking-[0.16em]" style={{ color: '#4a5e44' }}>
                        {s.label}
                      </span>
                      <span className="font-display text-2xl leading-none" style={{ color: '#d4c9b2' }}>
                        {s.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Season Metrics */}
              <div
                className="rise-in rounded-lg border p-6"
                style={{ backgroundColor: '#0a100a', borderColor: 'rgba(143,168,130,0.2)', animationDelay: '180ms' }}
              >
                <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#8fa882' }}>
                  Season Metrics
                </p>
                <div className="mt-4 space-y-3">
                  {[
                    { label: 'Recorded matches', value: '146', color: '#39ff14' },
                    { label: 'Proof submissions', value: '824', color: '#8fa882' },
                    { label: 'Wallets onboarded', value: '311', color: '#84cc16' },
                  ].map((m) => (
                    <div
                      key={m.label}
                      className="flex items-center justify-between rounded-lg border px-4 py-3"
                      style={{ borderColor: 'rgba(143,168,130,0.18)', backgroundColor: '#0e180d' }}
                    >
                      <span className="font-mono text-xs uppercase tracking-[0.14em]" style={{ color: '#4a5e44' }}>
                        {m.label}
                      </span>
                      <span className="font-display text-2xl leading-none" style={{ color: m.color }}>
                        {m.value}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Season Progress */}
                <div
                  className="mt-5 rounded-lg border p-5"
                  style={{ borderColor: 'rgba(57,255,20,0.2)', backgroundColor: '#0e180d' }}
                >
                  <div className="flex justify-between">
                    <p className="font-mono text-xs uppercase tracking-[0.16em]" style={{ color: '#4a5e44' }}>
                      Season progress
                    </p>
                    <p className="font-mono text-xs" style={{ color: '#39ff14' }}>68%</p>
                  </div>
                  <div className="mt-3 h-3 rounded-full" style={{ backgroundColor: 'rgba(57,255,20,0.12)' }}>
                    <div
                      className="h-3 w-[68%] rounded-full"
                      style={{ background: 'linear-gradient(90deg, #39ff14, #8fa882)' }}
                    />
                  </div>
                </div>
              </div>

              {/* Weekly Highlight */}
              <div
                className="rise-in rounded-lg border p-6"
                style={{ backgroundColor: '#0a100a', borderColor: 'rgba(132,204,22,0.2)', animationDelay: '260ms' }}
              >
                <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#84cc16' }}>
                  Weekly Highlight
                </p>
                <p className="mt-3 font-display text-2xl leading-none" style={{ color: '#d4c9b2' }}>NovaLatch</p>
                <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
                  Best proof conversion rate this week with 14 validated innocence submissions.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </div>

      {/* Footer CTA */}
      <section className="px-6 py-24 text-center" style={{ backgroundColor: 'rgba(6,11,6,0.9)' }}>
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-8">
          <h2
            className="font-display text-6xl font-black leading-none sm:text-7xl lg:text-8xl"
            style={{
              background: 'linear-gradient(135deg, #cc1414, #39ff14)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            CLAIM YOUR RANK.
          </h2>
          <p className="font-body text-2xl" style={{ color: '#8fa882' }}>
            Join a match and prove your innocence — or conceal your guilt.
          </p>
          <a
            href="/lobby"
            className="rounded-lg border px-12 py-6 font-mono text-lg font-bold uppercase tracking-wider transition-all hover:opacity-90"
            style={{
              background: 'linear-gradient(135deg, #cc1414, #39ff14)',
              borderColor: 'transparent',
              color: '#060b06',
              boxShadow: '0 0 24px rgba(57,255,20,0.4)',
            }}
          >
            Enter the Lobby
          </a>
        </div>
      </section>
    </div>
    </main>
  )
}


