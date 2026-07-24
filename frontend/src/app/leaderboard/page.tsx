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

type MonthBoard = {
  id: string
  name: string
  startsAt: string
  endsAt: string
  current: boolean
  games: number
  rows: LeaderboardPlayer[]
}

type LeaderboardResponse = {
  global?: LeaderboardPlayer[]
  monthly?: LeaderboardPlayer[]
  months?: MonthBoard[]
  seasons?: SeasonBoard[]
  /** Legacy field — older backend deploys return only this (all-time rows). */
  players?: LeaderboardPlayer[]
  totalGames: number
  monthlyGames?: number
  generatedAt: string
}

// 'monthly', or 'season:<id>', or the legacy 'global' fallback.
type Tab = string

/** Admin-editable bounty card content (backend /api/config/bounty). */
type BountyConfig = {
  active: boolean
  title: string
  body: string
  prize?: string
  endsAt?: string
}

// Mirrors POINTS in backend/src/routes/leaderboard.ts — keep in sync.
const POINTS = { win: 7, draw: 5, loss: 2, shield: 3 } as const

/** Fallback for rows from a backend that predates server-side points. */
function computePoints(p: LeaderboardPlayer): number {
  return (
    p.wins * POINTS.win +
    p.draws * POINTS.draw +
    p.losses * POINTS.loss +
    p.proofs * POINTS.shield
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

/** "active 2d ago"-style label from the player's newest finished game. */
function activeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 60) return 'active just now'
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `active ${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days <= 30) return `active ${days}d ago`
  return `last seen ${new Date(iso).toLocaleDateString()}`
}

function seasonWindow(s: SeasonBoard): string {
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en', { month: 'short', year: 'numeric' })
  const start = s.startsAt ? fmt(s.startsAt) : 'Genesis'
  const end = s.endsAt ? fmt(s.endsAt) : 'ongoing'
  return `${start} → ${end}`
}

const RANK_COLORS = ['#f5c518', '#8fa882', '#cd7f32']

// Shared grid template — header and rows must match exactly. Phones get a
// 3-column layout (#, operative, points; wins/shields live in the W/L/D chip)
// so the table never forces horizontal scrolling on narrow screens.
const ROW_GRID_CLASS =
  'grid-cols-[2rem_minmax(0,1fr)_3.5rem] sm:grid-cols-[2.5rem_minmax(0,1fr)_5rem_4rem_4.5rem] gap-2 sm:gap-4 px-3 sm:px-5'

function PlayerRow({ player, rank }: { player: LeaderboardPlayer; rank: number }) {
  const rankColor = RANK_COLORS[rank - 1] ?? '#4a5e44'
  const isTop3 = rank <= 3

  return (
    <div
      className={`rise-in grid items-center ${ROW_GRID_CLASS} rounded-xl border py-4 transition-all duration-150 hover:scale-[1.005]`}
      style={{
        borderColor: isTop3 ? `${rankColor}44` : 'rgba(107,142,35,0.12)',
        backgroundColor: isTop3 ? `${rankColor}0a` : '#0e180d',
        animationDelay: `${Math.min((rank - 1) * 45, 450)}ms`,
      }}
    >
      {/* Rank — #1 gets the slow toxic glow */}
      <div
        className={`flex h-7 w-7 items-center justify-center rounded-lg font-heading text-base leading-none sm:h-9 sm:w-9 sm:text-lg${rank === 1 ? ' toxic-pulse' : ''}`}
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
              {activeAgo(player.lastPlayedAt)}
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
        <p className="font-heading text-xl sm:text-2xl leading-none" style={{ color: '#f5c518' }}>{pointsOf(player).toLocaleString()}</p>
      </div>

      {/* Wins — desktop only; phones see it in the W/L/D chip */}
      <div className="hidden text-center sm:block">
        <p className="font-heading text-2xl leading-none" style={{ color: '#6b8e23' }}>{player.wins}</p>
      </div>

      {/* Shields — desktop only */}
      <div className="hidden text-center sm:block">
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
  const [bounty, setBounty] = useState<BountyConfig | null>(null)

  // Live bounty card content — independent of the leaderboard fetch so a
  // failure in either doesn't blank the other.
  useEffect(() => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
    fetch(`${backendUrl}/api/config/bounty`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => setBounty(j?.value ?? null))
      .catch(() => { /* keep the default teaser */ })
  }, [])

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

  // Current + past calendar months (months[0] is always the current one);
  // absent on a backend that predates month history.
  const monthBoards = useMemo(
    () => (data?.months ?? []).map(m => ({ ...m, rows: sortByPoints(m.rows) })),
    [data]
  )
  const [selectedMonthId, setSelectedMonthId] = useState<string | null>(null)
  const activeMonth = monthBoards.find(m => m.id === selectedMonthId) ?? monthBoards[0] ?? null

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
    activeTab === 'monthly' ? (activeMonth?.rows ?? monthlyRows)
    : activeTab === 'global' ? globalRows
    : seasonBoards.get(activeTab) ?? globalRows

  // Reset paging (and month selection when leaving the tab) on any view change
  useEffect(() => { setPage(1) }, [activeTab, selectedMonthId, data])
  useEffect(() => { setSelectedMonthId(null) }, [activeTab])

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

            {/* Month picker — current month plus archived past months */}
            {activeTab === 'monthly' && monthBoards.length > 1 && (
              <div className="flex flex-wrap justify-center gap-1.5">
                {monthBoards.map(m => {
                  const isActive = m.id === activeMonth?.id
                  return (
                    <button
                      key={m.id}
                      onClick={() => setSelectedMonthId(m.id)}
                      className="rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-all duration-150 hover:opacity-90"
                      style={{
                        borderColor: isActive ? 'rgba(245,197,24,0.5)' : 'rgba(107,142,35,0.2)',
                        backgroundColor: isActive ? 'rgba(245,197,24,0.1)' : 'transparent',
                        color: isActive ? '#f5c518' : '#4a5e44',
                      }}
                    >
                      {m.name}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Active board window */}
            <p className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#4a5e44' }}>
              {activeTab === 'monthly'
                ? activeMonth
                  ? `${activeMonth.name} — ${activeMonth.current ? 'resets on the 1st (UTC)' : 'archived month'}`
                  : `${monthName} — resets on the 1st (UTC)`
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
                  className={`mb-3 grid items-center ${ROW_GRID_CLASS} rounded-lg border py-3`}
                  style={{
                    borderColor: 'rgba(107,142,35,0.25)',
                    backgroundColor: '#0e180d',
                  }}
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>#</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>Operative</span>
                  <span className="text-center font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#f5c518' }}>Points</span>
                  <span className="hidden text-center font-mono text-[10px] uppercase tracking-[0.2em] sm:block" style={{ color: '#6b8e23' }}>Wins</span>
                  <span className="hidden text-center font-mono text-[10px] uppercase tracking-[0.2em] sm:block" style={{ color: '#e63329' }}>Shields</span>
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
                      Page {page} / {totalPages}<span className="hidden sm:inline"> &nbsp;·&nbsp; {sorted.length} operatives</span>
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

                {/* Champion NFT card — the month's #1, styled as a collectible */}
                <div className="champion-scene rise-in">
                  <div className="champion-card">
                    <div className="champion-inner p-5 text-center">
                      <p
                        className="font-heading text-xl font-bold uppercase tracking-[0.14em]"
                        style={{ color: '#f5c518', textShadow: '0 0 12px rgba(245,197,24,0.35)' }}
                      >
                        ★ {monthName} Champion ★
                      </p>
                      {monthChampion ? (
                        <>
                          <div
                            className="mx-auto mt-4 flex h-16 w-16 items-center justify-center rounded-full border-2 font-display text-3xl"
                            style={{ borderColor: 'rgba(245,197,24,0.6)', color: '#f5c518', backgroundColor: 'rgba(245,197,24,0.08)' }}
                          >
                            {monthChampion.displayName.charAt(0).toUpperCase()}
                          </div>
                          <p className="mt-3 truncate font-heading text-2xl leading-none" style={{ color: '#d4c9b2' }}>
                            {monthChampion.displayName}
                          </p>
                          <div className="mt-4 flex justify-center gap-5">
                            <div>
                              <p className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: '#4a5e44' }}>Points</p>
                              <p className="mt-1 font-heading text-2xl leading-none" style={{ color: '#f5c518' }}>{pointsOf(monthChampion).toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: '#4a5e44' }}>Wins</p>
                              <p className="mt-1 font-heading text-2xl leading-none" style={{ color: '#6b8e23' }}>{monthChampion.wins}</p>
                            </div>
                            <div>
                              <p className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: '#4a5e44' }}>Shields</p>
                              <p className="mt-1 font-heading text-2xl leading-none" style={{ color: '#e63329' }}>{monthChampion.proofs}</p>
                            </div>
                          </div>
                        </>
                      ) : (
                        <p className="mt-4 font-mono text-xs" style={{ color: '#4a5e44' }}>
                          {loading ? 'Loading…' : 'The throne is empty — top this month’s board to claim it.'}
                        </p>
                      )}
                      <p
                        className="mt-4 border-t pt-3 font-mono text-[9px] uppercase tracking-[0.22em]"
                        style={{ color: '#4a5e44', borderColor: 'rgba(245,197,24,0.15)' }}
                      >
                        Zombie Plague · No. 1 of {monthlyRows.length || '—'}
                      </p>
                      <div className="champion-sheen" />
                    </div>
                  </div>
                </div>

                {/* How points work */}
                <div
                  className="rise-in rounded-xl border p-5"
                  style={{ backgroundColor: '#0a100a', borderColor: 'rgba(245,197,24,0.2)', animationDelay: '80ms' }}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#f5c518' }}>How Points Work</p>
                  <div className="mt-4 space-y-2">
                    {[
                      { label: 'Win a game',        value: `+${POINTS.win}`,    color: '#6b8e23' },
                      { label: 'Draw',              value: `+${POINTS.draw}`,   color: '#f5c518' },
                      { label: 'Shield used',       value: `+${POINTS.shield}`, color: '#e63329' },
                      { label: 'Loss (still counts)', value: `+${POINTS.loss}`, color: '#8fa882' },
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
                  {bounty?.active ? (
                    <>
                      <p className="mt-3 font-heading text-xl leading-tight" style={{ color: '#d4c9b2' }}>
                        {bounty.title}
                      </p>
                      <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
                        {bounty.body}
                      </p>
                      {(bounty.prize || bounty.endsAt) && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {bounty.prize && (
                            <span
                              className="rounded-full px-2.5 py-1 font-mono text-[10px] font-bold uppercase"
                              style={{ backgroundColor: 'rgba(245,197,24,0.12)', color: '#f5c518' }}
                            >
                              {bounty.prize}
                            </span>
                          )}
                          {bounty.endsAt && (
                            <span
                              className="rounded-full px-2.5 py-1 font-mono text-[10px] uppercase"
                              style={{ backgroundColor: 'rgba(107,142,35,0.12)', color: '#8fa882' }}
                            >
                              ends {bounty.endsAt}
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="mt-3 font-heading text-xl leading-tight" style={{ color: '#d4c9b2' }}>
                        Monthly bounty seasons are coming.
                      </p>
                      <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#8fa882' }}>
                        Prize pools for the top of the This Month board, funded by
                        platform fees. Details will be announced here first —
                        champions crowned before launch will be remembered.
                      </p>
                    </>
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
