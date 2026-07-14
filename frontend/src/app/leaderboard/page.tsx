'use client'

import { useEffect, useState, useMemo } from 'react'
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

type LeaderboardResponse = {
  players: LeaderboardPlayer[]
  totalGames: number
  generatedAt: string
}

type Tab = 'global' | 'season0' | 'proofs' | 'week'

const TABS: { id: Tab; label: string }[] = [
  { id: 'global',  label: 'Global' },
  { id: 'season0', label: 'Season 0' },
  { id: 'proofs',  label: 'Proof Leaders' },
  { id: 'week',    label: 'This Week' },
]

const RANK_COLORS = ['#f5c518', '#8fa882', '#cd7f32']

function filterAndSort(players: LeaderboardPlayer[], tab: Tab): LeaderboardPlayer[] {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  switch (tab) {
    case 'global':
    case 'season0':
      return [...players].sort((a, b) => b.wins - a.wins || b.proofs - a.proofs)
    case 'proofs':
      return [...players].sort((a, b) => b.proofs - a.proofs || b.wins - a.wins)
    case 'week':
      return players
        .filter(p => p.lastPlayedAt && new Date(p.lastPlayedAt).getTime() >= weekAgo)
        .sort((a, b) => b.wins - a.wins || b.proofs - a.proofs)
  }
}

function getThisWeekTop(players: LeaderboardPlayer[]): LeaderboardPlayer | null {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  return [...players]
    .filter(p => p.lastPlayedAt && new Date(p.lastPlayedAt).getTime() >= cutoff)
    .sort((a, b) => b.wins - a.wins)[0] ?? null
}

// Shared grid template — header and rows must match exactly
const ROW_GRID = '2.5rem 1fr 5rem 5rem'

function PlayerRow({ player, rank }: { player: LeaderboardPlayer; rank: number }) {
  const rankColor = RANK_COLORS[rank - 1] ?? '#4a5e44'
  const isTop3 = rank <= 3

  return (
    <div
      className="rise-in grid items-center gap-4 rounded-xl border px-5 py-4 transition-all duration-150 hover:scale-[1.005]"
      style={{
        gridTemplateColumns: ROW_GRID,
        borderColor: isTop3 ? `${rankColor}44` : 'rgba(107,142,35,0.12)',
        backgroundColor: isTop3 ? `${rankColor}0a` : '#0e180d',
        animationDelay: `${Math.min((rank - 1) * 45, 450)}ms`,
      }}
    >
      {/* Rank — #1 gets the slow toxic glow */}
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-lg font-display text-lg leading-none${rank === 1 ? ' toxic-pulse' : ''}`}
        style={{ backgroundColor: `${rankColor}22`, color: rankColor }}
      >
        {rank}
      </div>

      {/* Player info */}
      <div className="min-w-0">
        <p className="truncate font-display text-lg leading-none" style={{ color: '#d4c9b2' }}>
          {player.displayName}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {player.lastPlayedAt && (
            <span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: '#4a5e44' }}>
              {new Date(player.lastPlayedAt).toLocaleDateString()}
            </span>
          )}
          <span
            className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase"
            style={{ backgroundColor: 'rgba(245,197,24,0.1)', color: '#f5c518' }}
          >
            {Math.round(player.winRate * 100)}% win rate
          </span>
          <span
            className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase"
            style={{
              backgroundColor: player.wins >= player.losses ? 'rgba(26,122,74,0.15)' : 'rgba(230,51,41,0.15)',
              color: player.wins >= player.losses ? '#1a7a4a' : '#e63329',
            }}
          >
            {player.wins}W / {player.losses}L / {player.draws}D
          </span>
        </div>
      </div>

      {/* Wins */}
      <div className="text-center">
        <p className="font-display text-2xl leading-none" style={{ color: '#6b8e23' }}>{player.wins}</p>
      </div>

      {/* Proofs */}
      <div className="text-center">
        <p className="font-display text-2xl leading-none" style={{ color: '#e63329' }}>{player.proofs}</p>
      </div>
    </div>
  )
}

const PAGE_SIZE = 10

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('global')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        setLoading(true)
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
        const res = await fetch(`${backendUrl}/api/leaderboard`, { signal: controller.signal })
        if (!res.ok) throw new Error(`Leaderboard request failed: ${res.status}`)
        const json = await res.json() as LeaderboardResponse
        setData({ players: json.players ?? [], totalGames: json.totalGames ?? 0, generatedAt: json.generatedAt })
        setError(null)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Failed to load leaderboard.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [])

  const sorted = useMemo(() => {
    if (!data) return []
    return filterAndSort(data.players, activeTab)
  }, [data, activeTab])

  // Reset to page 1 whenever tab or data changes
  useEffect(() => { setPage(1) }, [activeTab, data])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageSlice = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const pageOffset = (page - 1) * PAGE_SIZE

  const totalProofs = useMemo(() => data?.players.reduce((s, p) => s + p.proofs, 0) ?? 0, [data])
  const thisWeekTop = useMemo(() => data ? getThisWeekTop(data.players) : null, [data])

  return (
    <main
      className="min-h-screen"
      style={{
        backgroundColor: '#060b06',
        color: '#d4c9b2',
        backgroundImage: 'url(/images/bg-leaderboard.webp)',
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
        backgroundAttachment: 'fixed',
      }}
    >
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundColor: 'rgba(6,11,6,0.85)', zIndex: 0 }} />

      <div className="relative" style={{ zIndex: 1 }}>
        {/* Nav */}
        <div className="sticky top-0 z-50 px-4 pt-4 sm:px-8 sm:pt-6">
          <div className="mx-auto w-full max-w-6xl">
            <SiteNav currentPath="/leaderboard" />
          </div>
        </div>

        {/* Hero header */}
        <header className="px-6 py-14 text-center">
          <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-5">
            <span className="font-mono text-xs uppercase tracking-[0.3em]" style={{ color: '#6b8e23' }}>
              Season Zero
            </span>
            <h1
              className="font-display text-5xl font-black leading-none sm:text-7xl lg:text-8xl"
              style={{
                background: 'linear-gradient(135deg, #cc1414 0%, #c97a12 50%, #6b8e23 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              LEADERBOARD
            </h1>
            <p className="max-w-lg font-mono text-sm" style={{ color: '#8fa882' }}>
              Global rankings of the deadliest operatives on Celo.
            </p>

            {/* Tabs */}
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {TABS.map(tab => {
                const isActive = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className="rounded-full border-2 px-5 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-all duration-150 hover:opacity-90"
                    style={{
                      borderColor: isActive ? '#6b8e23' : 'rgba(107,142,35,0.25)',
                      backgroundColor: isActive ? 'rgba(107,142,35,0.15)' : 'transparent',
                      color: isActive ? '#6b8e23' : '#4a5e44',
                    }}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="px-4 pb-20 sm:px-6">
          <div className="mx-auto w-full max-w-6xl">
            <div className="grid gap-8 lg:grid-cols-[1fr_300px]">

              {/* Table */}
              <article
                className="rise-in rounded-xl border p-5"
                style={{ backgroundColor: '#0a100a', borderColor: 'rgba(107,142,35,0.18)' }}
              >
                {/* Header row */}
                <div
                  className="mb-3 grid items-center gap-4 rounded-lg border px-5 py-3"
                  style={{
                    gridTemplateColumns: ROW_GRID,
                    borderColor: 'rgba(107,142,35,0.25)',
                    backgroundColor: '#0e180d',
                  }}
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>#</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>Operative</span>
                  <span className="text-center font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#6b8e23' }}>Wins</span>
                  <span className="text-center font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#e63329' }}>Proofs</span>
                </div>

                {/* Rows */}
                <div className="space-y-2">
                  {loading && (
                    <div className="rounded-xl border p-6 font-mono text-sm" style={{ borderColor: 'rgba(107,142,35,0.15)', color: '#4a5e44' }}>
                      Loading rankings…
                    </div>
                  )}
                  {error && (
                    <div className="rounded-xl border p-6 font-mono text-sm" style={{ borderColor: 'rgba(230,51,41,0.2)', color: '#e63329' }}>
                      {error}
                    </div>
                  )}
                  {!loading && !error && sorted.length === 0 && (
                    <div className="rounded-xl border p-6 font-mono text-sm" style={{ borderColor: 'rgba(107,142,35,0.15)', color: '#4a5e44' }}>
                      {activeTab === 'week'
                        ? 'No games played this week yet.'
                        : 'No completed games yet. Rankings will appear once rooms finish.'}
                    </div>
                  )}
                  {pageSlice.map((player, i) => (
                    <PlayerRow key={player.address} player={player} rank={pageOffset + i + 1} />
                  ))}
                </div>

                {/* Pagination */}
                {!loading && !error && totalPages > 1 && (
                  <div className="mt-5 flex items-center justify-between border-t pt-4" style={{ borderColor: 'rgba(107,142,35,0.12)' }}>
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="rounded-lg border px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all disabled:opacity-30"
                      style={{ borderColor: 'rgba(107,142,35,0.3)', color: '#6b8e23', backgroundColor: 'transparent' }}
                    >
                      ← Prev
                    </button>
                    <span className="font-mono text-xs" style={{ color: '#4a5e44' }}>
                      Page {page} / {totalPages} &nbsp;·&nbsp; {sorted.length} operatives
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="rounded-lg border px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all disabled:opacity-30"
                      style={{ borderColor: 'rgba(107,142,35,0.3)', color: '#6b8e23', backgroundColor: 'transparent' }}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </article>

              {/* Sidebar */}
              <aside className="flex flex-col gap-5">

                {/* Stats */}
                <div
                  className="rise-in rounded-xl border p-5"
                  style={{ backgroundColor: '#0a100a', borderColor: 'rgba(107,142,35,0.18)', animationDelay: '80ms' }}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>Season 0 Stats</p>
                  <div className="mt-4 space-y-2">
                    {[
                      { label: 'Total games',    value: loading ? '…' : String(data?.totalGames ?? 0),       color: '#6b8e23' },
                      { label: 'Total proofs',   value: loading ? '…' : String(totalProofs),                  color: '#e63329' },
                      { label: 'Chain uptime',   value: '99.9%',                                             color: '#f5c518' },
                    ].map(s => (
                      <div
                        key={s.label}
                        className="flex items-center justify-between rounded-lg border px-4 py-3"
                        style={{ borderColor: 'rgba(107,142,35,0.15)', backgroundColor: '#0e180d' }}
                      >
                        <span className="font-mono text-xs uppercase tracking-[0.14em]" style={{ color: '#4a5e44' }}>{s.label}</span>
                        <span className="font-display text-2xl leading-none" style={{ color: s.color }}>{s.value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Weekly champion */}
                <div
                  className="rise-in rounded-xl border p-5"
                  style={{ backgroundColor: '#0a100a', borderColor: 'rgba(132,204,22,0.2)', animationDelay: '160ms' }}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#84cc16' }}>This Week&apos;s Champion</p>
                  {thisWeekTop ? (
                    <>
                      <p className="mt-3 font-display text-2xl leading-none" style={{ color: '#d4c9b2' }}>{thisWeekTop.displayName}</p>
                      <div className="mt-3 flex gap-4">
                        <div className="text-center">
                          <p className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: '#4a5e44' }}>Wins</p>
                          <p className="mt-1 font-display text-2xl leading-none" style={{ color: '#6b8e23' }}>{thisWeekTop.wins}</p>
                        </div>
                        <div className="text-center">
                          <p className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: '#4a5e44' }}>Proofs</p>
                          <p className="mt-1 font-display text-2xl leading-none" style={{ color: '#e63329' }}>{thisWeekTop.proofs}</p>
                        </div>
                        <div className="text-center">
                          <p className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: '#4a5e44' }}>Rate</p>
                          <p className="mt-1 font-display text-2xl leading-none" style={{ color: '#f5c518' }}>
                            {Math.round(thisWeekTop.winRate * 100)}%
                          </p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="mt-3 font-mono text-xs" style={{ color: '#4a5e44' }}>
                      {loading ? 'Loading…' : 'No games played this week yet.'}
                    </p>
                  )}
                </div>

                {/* Tab context blurb */}
                <div
                  className="rise-in rounded-xl border p-5"
                  style={{ backgroundColor: '#0a100a', borderColor: 'rgba(107,142,35,0.12)', animationDelay: '240ms' }}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>Viewing</p>
                  <p className="mt-2 font-display text-xl leading-none" style={{ color: '#d4c9b2' }}>
                    {TABS.find(t => t.id === activeTab)?.label}
                  </p>
                  <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
                    {activeTab === 'global'  && 'All-time rankings sorted by total wins, then proof count.'}
                    {activeTab === 'season0' && 'Season 0 standings — the inaugural Zombie Plague season.'}
                    {activeTab === 'proofs'  && 'Ranked by total innocence proofs submitted on-chain.'}
                    {activeTab === 'week'    && 'Players active in the last 7 days, ranked by wins.'}
                  </p>
                  <p className="mt-3 font-mono text-[10px]" style={{ color: '#4a5e44' }}>
                    {sorted.length} operative{sorted.length !== 1 ? 's' : ''} shown
                  </p>
                </div>

              </aside>
            </div>
          </div>
        </div>

        {/* Footer CTA */}
        <section className="px-6 py-20 text-center" style={{ backgroundColor: 'rgba(6,11,6,0.9)' }}>
          <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6">
            <h2
              className="font-display text-4xl font-black leading-none sm:text-6xl"
              style={{
                background: 'linear-gradient(135deg, #cc1414, #c97a12)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              CLAIM YOUR RANK.
            </h2>
            <p className="font-mono text-sm sm:text-base" style={{ color: '#8fa882' }}>
              Join a match and prove your innocence — or conceal your guilt.
            </p>
            <a
              href="/lobby"
              className="rounded-lg border px-8 py-4 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90"
              style={{
                background: 'linear-gradient(135deg, #cc1414, #c97a12)',
                borderColor: 'transparent',
                color: '#060b06',
                boxShadow: '0 0 24px rgba(107,142,35,0.35)',
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
