'use client'

import { SiteNav } from '@/components/ui/site-nav'
import { useEffect, useState } from 'react'

// ─── Mock room data ─────────────────────────────────────────────────────────
// expiresInSecs: seconds from page-load until the room expires (waiting rooms only)
// stake / proofFee: XLM amounts for display
const ROOM_TEMPLATES = [
  {
    name: 'Genesis Lobby',
    desc: 'Fast room for onboarding testers',
    players: 4,
    max: 8,
    stake: 10,
    proofFee: 2,
    status: 'waiting',
    expiresInSecs: 427,   // ~7 min remaining
  },
  {
    name: 'Infection Testnet',
    desc: 'Contract event replay room',
    players: 6,
    max: 6,
    stake: 20,
    proofFee: 5,
    status: 'active',
    expiresInSecs: null,  // active rooms don't expire
  },
  {
    name: 'Zero Proof Squad',
    desc: 'Noir proof pipeline dry run',
    players: 5,
    max: 10,
    stake: 5,
    proofFee: 1,
    status: 'waiting',
    expiresInSecs: 73,    // ~1 min remaining — almost gone
  },
] as const

const statusColor: Record<string, string> = {
  waiting: '#1a7a4a',
  active:  '#f5c518',
  full:    '#e63329',
  ended:   '#4a5568',
}

const statusLabel: Record<string, string> = {
  waiting: 'Join',
  active:  'Spectate',
  full:    'Full',
  ended:   'Ended',
}

/** Format seconds → MM:SS */
function formatCountdown(secs: number): string {
  if (secs <= 0) return '00:00'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Colour the countdown: green → amber (< 3 min) → red (< 1 min) */
function countdownColor(secs: number): string {
  if (secs <= 60)  return '#e63329'
  if (secs <= 180) return '#f5c518'
  return '#84cc16'
}

export default function LobbyPage() {
  // Initialise expiresAt timestamps on first client render (avoids hydration mismatch)
  const [expiresAtMap, setExpiresAtMap] = useState<Record<string, number>>({})
  const [now, setNow] = useState(0)

  useEffect(() => {
    const init = Date.now()
    const map: Record<string, number> = {}
    ROOM_TEMPLATES.forEach((r) => {
      if (r.expiresInSecs !== null) {
        map[r.name] = init + r.expiresInSecs * 1000
      }
    })
    setExpiresAtMap(map)
    setNow(init)

    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <main className="min-h-screen" style={{ backgroundColor: '#0a0e27', color: '#f0f4f8' }}>
      {/* Nav */}
      <div className="px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="mx-auto w-full max-w-6xl">
          <SiteNav currentPath="/lobby" />
        </div>
      </div>

      {/* Header */}
      <header className="px-6 py-16">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 text-center">
          <span className="font-mono text-xs uppercase tracking-[0.3em]" style={{ color: '#a855f7' }}>
            Game Lobby
          </span>
          <h1
            className="font-display text-6xl font-bold leading-none sm:text-7xl lg:text-8xl"
            style={{
              background: 'linear-gradient(135deg, #f0f4f8, #a855f7)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            ACTIVE ROOMS
          </h1>
          <p className="max-w-xl font-body text-lg" style={{ color: '#b4c1d1' }}>
            Join a waiting room, stake XLM, and lock in your role before the game starts. Once a game begins, the join window closes permanently.
          </p>
        </div>
      </header>

      <div className="px-6 pb-20">
        <div className="mx-auto w-full max-w-6xl">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">

            {/* Left column: Create Room + Party Queue */}
            <div className="flex flex-col gap-6">
              <article
                className="rise-in rounded-lg border p-8"
                style={{ backgroundColor: '#161b35', borderColor: 'rgba(168,85,247,0.3)' }}
              >
                <h2 className="font-display text-2xl leading-none" style={{ color: '#f0f4f8' }}>
                  Create Room
                </h2>
                <div className="mt-6 space-y-4">
                  <input
                    className="w-full rounded-lg border bg-transparent px-4 py-3 font-mono text-sm focus:outline-none"
                    style={{ borderColor: 'rgba(168,85,247,0.4)', color: '#f0f4f8' }}
                    defaultValue="Night Shift"
                    aria-label="Room name"
                    readOnly
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <input
                      className="w-full rounded-lg border bg-transparent px-4 py-3 font-mono text-sm focus:outline-none"
                      style={{ borderColor: 'rgba(168,85,247,0.4)', color: '#f0f4f8' }}
                      defaultValue="6 players"
                      aria-label="Max players"
                      readOnly
                    />
                    <input
                      className="w-full rounded-lg border bg-transparent px-4 py-3 font-mono text-sm focus:outline-none"
                      style={{ borderColor: 'rgba(168,85,247,0.4)', color: '#f0f4f8' }}
                      defaultValue="10 XLM stake"
                      aria-label="Stake"
                      readOnly
                    />
                  </div>
                  <button
                    className="w-full rounded-lg border py-3 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90"
                    style={{ backgroundColor: '#e63329', borderColor: '#e63329', color: '#f0f4f8', boxShadow: '4px 4px 0px #a855f7' }}
                  >
                    Create Room (Demo)
                  </button>
                  <button
                    className="w-full rounded-lg border py-3 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90"
                    style={{ backgroundColor: 'transparent', borderColor: 'rgba(168,85,247,0.5)', color: '#a855f7' }}
                  >
                    Connect Freighter (Next)
                  </button>
                </div>

                <div className="mt-6 grid grid-cols-3 gap-3">
                  {[
                    { label: 'Stake', value: '10' },
                    { label: 'Rounds', value: '7' },
                    { label: 'Mode', value: 'ZK' },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="rounded-lg border p-3 text-center"
                      style={{ borderColor: 'rgba(168,85,247,0.2)', backgroundColor: '#1a1f3a' }}
                    >
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#7a8592' }}>
                        {s.label}
                      </p>
                      <p className="mt-2 font-display text-2xl leading-none" style={{ color: '#f0f4f8' }}>
                        {s.value}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              {/* Party Queue */}
              <article
                className="rise-in rounded-lg border p-6"
                style={{ backgroundColor: '#161b35', borderColor: 'rgba(6,182,212,0.2)', animationDelay: '100ms' }}
              >
                <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#06b6d4' }}>
                  Party Queue
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {['AM', 'ZR', 'NX', 'KQ', 'VT'].map((player) => (
                    <div
                      key={player}
                      className="flex h-10 w-10 items-center justify-center rounded-full border-2 font-display text-base"
                      style={{ borderColor: '#a855f7', backgroundColor: '#1a1f3a', color: '#a855f7' }}
                    >
                      {player}
                    </div>
                  ))}
                </div>
                <p className="mt-4 font-mono text-xs leading-relaxed" style={{ color: '#7a8592' }}>
                  Players appear here once wallet auth and room subscriptions are wired up.
                </p>
              </article>
            </div>

            {/* Right column: Room List */}
            <article
              className="rise-in rounded-lg border p-6"
              style={{ backgroundColor: '#161b35', borderColor: 'rgba(168,85,247,0.2)', animationDelay: '80ms' }}
            >
              <div className="flex items-end justify-between gap-4">
                <h2 className="font-display text-2xl leading-none" style={{ color: '#f0f4f8' }}>
                  Join Existing
                </h2>
                <span
                  className="rounded-full border px-3 py-1 font-mono text-xs"
                  style={{ borderColor: 'rgba(168,85,247,0.3)', color: '#a855f7' }}
                >
                  3 rooms online
                </span>
              </div>

              <ul className="mt-6 space-y-4">
                {ROOM_TEMPLATES.map((room, i) => {
                  const expiresAt = expiresAtMap[room.name] ?? 0
                  const secsLeft = expiresAt > 0 ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : 0
                  const isExpiring = room.status === 'waiting' && secsLeft > 0 && secsLeft <= 180

                  return (
                    <li
                      key={room.name}
                      className="rise-in rounded-lg border p-5 transition-all duration-200 hover:scale-[1.01]"
                      style={{
                        backgroundColor: '#1a1f3a',
                        borderColor: isExpiring ? 'rgba(245,197,24,0.35)' : 'rgba(168,85,247,0.2)',
                        animationDelay: `${160 + i * 80}ms`,
                      }}
                    >
                      {/* Top row: name + status badges */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="h-2 w-2 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: statusColor[room.status], boxShadow: `0 0 6px ${statusColor[room.status]}` }}
                        />
                        <span className="font-display text-lg leading-none" style={{ color: '#f0f4f8' }}>
                          {room.name}
                        </span>
                        {room.status === 'active' && (
                          <span
                            className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest"
                            style={{ backgroundColor: 'rgba(245,197,24,0.15)', color: '#f5c518', border: '1px solid rgba(245,197,24,0.3)' }}
                          >
                            In Progress
                          </span>
                        )}
                        {isExpiring && (
                          <span
                            className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest"
                            style={{ backgroundColor: 'rgba(230,51,41,0.12)', color: '#e63329', border: '1px solid rgba(230,51,41,0.3)' }}
                          >
                            Closing Soon
                          </span>
                        )}
                      </div>

                      <p className="mt-1 font-mono text-xs" style={{ color: '#7a8592' }}>
                        {room.desc}
                      </p>

                      {/* Stats + action row */}
                      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                        <div className="flex flex-wrap gap-4">
                          {/* Players */}
                          <div className="text-center">
                            <p className="font-mono text-[10px] uppercase" style={{ color: '#7a8592' }}>Players</p>
                            <p className="font-display text-lg leading-none" style={{ color: '#f0f4f8' }}>
                              {room.players}/{room.max}
                            </p>
                          </div>
                          {/* Stake */}
                          <div className="text-center">
                            <p className="font-mono text-[10px] uppercase" style={{ color: '#7a8592' }}>Stake</p>
                            <p className="font-display text-lg leading-none" style={{ color: '#84cc16' }}>
                              {room.stake} XLM
                            </p>
                          </div>
                          {/* Proof Fee */}
                          <div className="text-center">
                            <p className="font-mono text-[10px] uppercase" style={{ color: '#7a8592' }}>Proof Fee</p>
                            <p className="font-display text-lg leading-none" style={{ color: '#06b6d4' }}>
                              {room.proofFee} XLM
                            </p>
                          </div>
                          {/* Expiry countdown — waiting rooms only */}
                          {room.status === 'waiting' && expiresAt > 0 && (
                            <div className="text-center">
                              <p className="font-mono text-[10px] uppercase" style={{ color: '#7a8592' }}>Expires</p>
                              <p
                                className="font-mono text-lg leading-none tabular-nums"
                                style={{ color: countdownColor(secsLeft) }}
                              >
                                {formatCountdown(secsLeft)}
                              </p>
                            </div>
                          )}
                        </div>

                        <button
                          className="rounded border px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-all hover:opacity-90"
                          style={{
                            backgroundColor: room.status === 'waiting' ? '#e63329' : 'transparent',
                            borderColor: room.status === 'waiting' ? '#e63329' : 'rgba(168,85,247,0.5)',
                            color: room.status === 'waiting' ? '#f0f4f8' : '#a855f7',
                          }}
                        >
                          {statusLabel[room.status]}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>

              {/* Integration Roadmap */}
              <div
                className="mt-6 rounded-lg border p-5"
                style={{ borderColor: 'rgba(132,204,22,0.25)', backgroundColor: 'rgba(132,204,22,0.05)' }}
              >
                <h3 className="font-display text-lg leading-none" style={{ color: '#84cc16' }}>
                  Integration Roadmap
                </h3>
                <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#b4c1d1' }}>
                  Next milestone: wallet auth, room creation, and stake escrow wired to Soroban contracts
                  and backend APIs.
                </p>
              </div>
            </article>
          </div>
        </div>
      </div>
    </main>
  )
}
