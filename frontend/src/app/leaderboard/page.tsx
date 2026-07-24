'use client'

import { useEffect, useState, useMemo } from 'react'
import { SiteNav } from '@/components/ui/site-nav'
import { SiteFooter } from '@/components/ui/site-footer'

type LeaderboardPlayer = {
  address: string
  displayName: string
  wins: number
  losses: number
  draws: number
  proofs: number
  survivals?: number
  points?: number
  gamesPlayed: number
  winRate: number
  lastPlayedAt: string | null
}

type SeasonBoard = {
  id: string
  name: string
  startsAt: string | null
  endsAt: string | null
  current: boolean
  games: number
  rows: LeaderboardPlayer[]
}

type LeaderboardResponse = {
  global?: LeaderboardPlayer[]
  monthly?: LeaderboardPlayer[]
  seasons?: SeasonBoard[]
  /** Legacy field — older backend deploys return only this (all-time rows). */
  players?: LeaderboardPlayer[]
  totalGames: number
  monthlyGames?: number
  generatedAt: string
}

// 'monthly', or 'season:<id>', or the legacy 'global' fallback.
type Tab = string

// Mirrors POINTS in backend/src/routes/leaderboard.ts — keep in sync.
const POINTS = { win: 10, draw: 4, loss: 1, shield: 3, survival: 2 } as const

/** Fallback for rows from a backend that predates server-side points. */
function computePoints(p: LeaderboardPlayer): number {
  return (
    p.wins * POINTS.win +
    p.draws * POINTS.draw +
    p.losses * POINTS.loss +
    p.proofs * POINTS.shield +
    (p.survivals ?? 0) * POINTS.survival
  )
}

function pointsOf(p: LeaderboardPlayer): number {
  return p.points ?? computePoints(p)
}

function sortByPoints(players: LeaderboardPlayer[]): LeaderboardPlayer[] {
  return [...players].sort((a, b) =>
    pointsOf(b) - pointsOf(a) || b.wins - a.wins || b.proofs - a.proofs
  )
}

function seasonWindow(s: SeasonBoard): string {
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en', { month: 'short', year: 'numeric' })
  const start = s.startsAt ? fmt(s.startsAt) : 'Genesis'
  const end = s.endsAt ? fmt(s.endsAt) : 'ongoing'
  return `${start} → ${end}`
}

const RANK_COLORS = ['#f5c518', '#8fa882', '#cd7f32']

// Shared grid template — header and rows must match exactly
const ROW_GRID = '2.5rem 1fr 5rem 4rem 4.5rem'

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
        className={`flex h-9 w-9 items-center justify-center rounded-lg font-heading text-lg leading-none${rank === 1 ? ' toxic-pulse' : ''}`}
        style={{ backgroundColor: `${rankColor}22`, color: rankColor }}
      >
        {rank}
      </div>

      {/* Player info */}
      <div className="min-w-0">
        <p className="truncate font-heading text-lg leading-none" style={{ color: '#d4c9b2' }}>
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

      {/* Points */}
      <div className="text-center">
        <p className="font-heading text-2xl leading-none" style={{ color: '#f5c518' }}>{pointsOf(player).toLocaleString()}</p>
      </div>

      {/* Wins */}
      <div className="text-center">
        <p className="font-heading text-2xl leading-none" style={{ color: '#6b8e23' }}>{player.wins}</p>
      </div>

      {/* Shields */}
      <div className="text-center">
        <p className="font-heading text-2xl leading-none" style={{ color: '#e63329' }}>{player.proofs}</p>
      </div>
    </div>
  )
}

const PAGE_SIZE = 10

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('monthly')
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
        setData(json)
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

  const globalRows = useMemo(
    () => data ? sortByPoints(data.global ?? data.players ?? []) : [],
    [data]
  )
  // Legacy backends can't provide per-month aggregates; approximate with
  // all-time rows for players active this month until the backend redeploys.
  const monthlyRows = useMemo(() => {
    if (!data) return []
    if (data.monthly) return sortByPoints(data.monthly)
    const monthStart = new Date()
    monthStart.setUTCDate(1)
    monthStart.setUTCHours(0, 0, 0, 0)
    return sortByPoints(
      (data.players ?? []).filter(p => p.lastPlayedAt && new Date(p.lastPlayedAt) >= monthStart)
    )
  }, [data])

  const seasonBoards = useMemo(() => {
    const map = new Map<string, LeaderboardPlayer[]>()
    for (const s of data?.seasons ?? []) map.set(`season:${s.id}`, sortByPoints(s.rows))
    return map
  }, [data])

  // This Month first and default: a board that resets on the 1st is winnable
  // for a newcomer, while long-running totals read as an unreachable wall.
  // Seasons come newest-first; a backend without seasons degrades to Global.
  const tabs = useMemo<{ id: Tab; label: string }[]>(() => {
    const seasonTabs = (data?.seasons ?? [])
      .slice()
      .reverse()
      .map(s => ({ id: `season:${s.id}`, label: s.name }))
    return [
      { id: 'monthly', label: 'This Month' },
      ...(seasonTabs.length > 0 ? seasonTabs : [{ id: 'global', label: 'Global' }]),
    ]
  }, [data])

  const activeSeason = (data?.seasons ?? []).find(s => `season:${s.id}` === activeTab) ?? null

  const sorted =
    activeTab === 'monthly' ? monthlyRows
    : activeTab === 'global' ? globalRows
    : seasonBoards.get(activeTab) ?? globalRows

  // Reset to page 1 whenever tab or data changes
  useEffect(() => { setPage(1) }, [activeTab, data])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageSlice = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const pageOffset = (page - 1) * PAGE_SIZE

  const totalShields = useMemo(() => globalRows.reduce((s, p) => s + p.proofs, 0), [globalRows])
  const monthChampion = monthlyRows[0] ?? null
  const monthName = new Date().toLocaleString('en', { month: 'long' })

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
              Ranked by Points
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
              Every game counts — wins, draws, shields and survival all earn points.
              The monthly board resets on the 1st; seasons carry the long record,
              and a closed season is archived forever.
            </p>

            {/* Tabs */}
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {tabs.map(tab => {
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

            {/* Active board window */}
            <p className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#4a5e44' }}>
              {activeTab === 'monthly'
                ? `${monthName} — resets on the 1st (UTC)`
                : activeSeason
                  ? `${seasonWindow(activeSeason)}${activeSeason.current ? ' · current season' : ' · archived'}`
                  : 'All-time record'}
            </p>
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
                  <span className="text-center font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#f5c518' }}>Points</span>
                  <span className="text-center font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#6b8e23' }}>Wins</span>
                  <span className="text-center font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#e63329' }}>Shields</span>
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
                      {activeTab === 'monthly'
                        ? `No games finished in ${monthName} yet — the first survivor tops this board.`
                        : activeSeason && !activeSeason.current
                          ? `No games were recorded in ${activeSeason.name}.`
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

                {/* How points work */}
                <div
                  className="rise-in rounded-xl border p-5"
                  style={{ backgroundColor: '#0a100a', borderColor: 'rgba(245,197,24,0.2)', animationDelay: '80ms' }}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#f5c518' }}>How Points Work</p>
                  <div className="mt-4 space-y-2">
                    {[
                      { label: 'Win a game',        value: `+${POINTS.win}`,      color: '#6b8e23' },
                      { label: 'Draw',              value: `+${POINTS.draw}`,     color: '#f5c518' },
                      { label: 'Play (even a loss)', value: `+${POINTS.loss}`,    color: '#8fa882' },
                      { label: 'Shield used',       value: `+${POINTS.shield}`,   color: '#e63329' },
                      { label: 'Survive to the end', value: `+${POINTS.survival}`, color: '#c97a12' },
                    ].map(s => (
                      <div
                        key={s.label}
                        className="flex items-center justify-between rounded-lg border px-4 py-2.5"
                        style={{ borderColor: 'rgba(107,142,35,0.15)', backgroundColor: '#0e180d' }}
                      >
                        <span className="font-mono text-xs" style={{ color: '#8fa882' }}>{s.label}</span>
                        <span className="font-heading text-xl leading-none" style={{ color: s.color }}>{s.value}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 font-mono text-[10px] leading-relaxed" style={{ color: '#4a5e44' }}>
                    Shields are on-chain innocence proofs — each one costs the room&apos;s proof fee.
                  </p>
                </div>

                {/* Bounties teaser */}
                <div
                  className="rise-in rounded-xl border p-5"
                  style={{ backgroundColor: '#0a100a', borderColor: 'rgba(204,20,20,0.3)', animationDelay: '120ms' }}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#cc1414' }}>Bounties</p>
                  <p className="mt-3 font-heading text-xl leading-tight" style={{ color: '#d4c9b2' }}>
                    Monthly bounty seasons are coming.
                  </p>
                  <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
                    Prize pools for the top of the This Month board, funded by
                    platform fees. Details will be announced here first —
                    champions crowned before launch will be remembered.
                  </p>
                </div>

                {/* Monthly champion */}
                <div
                  className="rise-in rounded-xl border p-5"
                  style={{ backgroundColor: '#0a100a', borderColor: 'rgba(132,204,22,0.2)', animationDelay: '160ms' }}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#84cc16' }}>{monthName} Champion</p>
                  {monthChampion ? (
                    <>
                      <p className="mt-3 font-heading text-2xl leading-none" style={{ color: '#d4c9b2' }}>{monthChampion.displayName}</p>
                      <div className="mt-3 flex gap-4">
                        <div className="text-center">
                          <p className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: '#4a5e44' }}>Points</p>
                          <p className="mt-1 font-heading text-2xl leading-none" style={{ color: '#f5c518' }}>{pointsOf(monthChampion).toLocaleString()}</p>
                        </div>
                        <div className="text-center">
                          <p className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: '#4a5e44' }}>Wins</p>
                          <p className="mt-1 font-heading text-2xl leading-none" style={{ color: '#6b8e23' }}>{monthChampion.wins}</p>
                        </div>
                        <div className="text-center">
                          <p className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: '#4a5e44' }}>Shields</p>
                          <p className="mt-1 font-heading text-2xl leading-none" style={{ color: '#e63329' }}>{monthChampion.proofs}</p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="mt-3 font-mono text-xs" style={{ color: '#4a5e44' }}>
                      {loading ? 'Loading…' : `No games in ${monthName} yet — the throne is empty.`}
                    </p>
                  )}
                </div>

                {/* All-time stats */}
                <div
                  className="rise-in rounded-xl border p-5"
                  style={{ backgroundColor: '#0a100a', borderColor: 'rgba(107,142,35,0.18)', animationDelay: '240ms' }}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>All-Time Stats</p>
                  <div className="mt-4 space-y-2">
                    {[
                      { label: 'Total games',   value: loading ? '…' : String(data?.totalGames ?? 0), color: '#6b8e23' },
                      { label: 'Total shields', value: loading ? '…' : String(totalShields),          color: '#e63329' },
                      { label: 'Operatives',    value: loading ? '…' : String(globalRows.length),     color: '#f5c518' },
                    ].map(s => (
                      <div
                        key={s.label}
                        className="flex items-center justify-between rounded-lg border px-4 py-3"
                        style={{ borderColor: 'rgba(107,142,35,0.15)', backgroundColor: '#0e180d' }}
                      >
                        <span className="font-mono text-xs uppercase tracking-[0.14em]" style={{ color: '#4a5e44' }}>{s.label}</span>
                        <span className="font-heading text-2xl leading-none" style={{ color: s.color }}>{s.value}</span>
                      </div>
                    ))}
                  </div>
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

        <SiteFooter />
      </div>
    </main>
  )
}
