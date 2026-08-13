'use client'

/**
 * ArenaHub — what `/game` shows when there is no `?room=` in the URL.
 *
 * The "Match" nav item points at a bare `/game`, so every visitor who clicks it
 * without a room link used to land on a dead end ("No room specified." → Back to
 * Lobby) even while a game was running. That is the single most common way to
 * arrive at this app and it reported the game as empty.
 *
 * Three tiers, most specific first:
 *   1. You are in a room  → go straight there. This is what people expect the
 *      tab to do, and it is the whole reported complaint.
 *   2. A match is live    → offer to spectate. Spectating needs no wallet and no
 *      transaction, so it works for a first-time visitor.
 *   3. Nothing is running → the hub proper: next scheduled window, the last
 *      outbreak's result, and a route into the lobby. Never a dead end.
 *
 * Room state is read from the chain (the same recent-window multicall the lobby
 * uses) because that is the authority. The backend's `/api/rooms/live` is only
 * consulted by the nav dot, which needs a cheap answer on every page.
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SiteNav } from '@/components/ui/site-nav'
import { NextWindowBanner } from '@/components/ui/next-window-banner'
import { useWallet } from '@/hooks/useWallet'
import { createContractClient } from '@/lib/contract'
import { formatToken } from '@/lib/format'
import { quarantineCode } from '@/lib/roomLabel'

/** Matches the lobby's scan window so both pages agree on what "recent" means. */
const RECENT_ROOM_LIMIT = 60
const STABLE_TOKEN = 'USDm'
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'

const ROOM_STATUS_MAP: Record<number, 'waiting' | 'starting' | 'active' | 'ended'> = {
  0: 'waiting', 1: 'starting', 2: 'active', 3: 'ended',
}

type LiveRoom = {
  id: bigint
  status: 'waiting' | 'starting' | 'active' | 'ended'
  players: number
  playerAddresses: string[]
  maxPlayers: number
  pot: bigint
  stakeAmount: bigint
  /** ms epoch; only meaningful while the room is still `waiting`. */
  expiresAt: number
  name?: string | null
}

type RecentGame = {
  roomId: string
  outcome: string
  totalRounds: number
  totalPot: string
  winnerCount: number
  endedAt: string
  playerCount: number
  winners: Array<{ address: string; displayName: string | null }>
}

function getContractClient() {
  const network = (process.env.NEXT_PUBLIC_NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
  const addr    = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}` | undefined
  if (!addr) return null
  return createContractClient({ contractAddress: addr, network })
}

/** "clean_win" → "Survivors held" etc. Outcome strings come from GameSummary. */
function outcomeLabel(outcome: string): { text: string; color: string } {
  if (outcome === 'clean_win')    return { text: 'Survivors held',  color: '#6b8e23' }
  if (outcome === 'infected_win') return { text: 'Outbreak spread', color: '#e63329' }
  return { text: 'Stalemate', color: '#f5c518' }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function labelFor(room: LiveRoom): string {
  return room.name ? room.name : quarantineCode(room.id)
}

export function ArenaHub() {
  const router = useRouter()
  const { address } = useWallet()

  const [rooms, setRooms]     = useState<LiveRoom[] | null>(null)
  const [recent, setRecent]   = useState<RecentGame[]>([])
  const [loadError, setError] = useState<string | null>(null)

  // Expiry checks need a clock, and reading Date.now() during render makes the
  // memos non-idempotent. Ten seconds is fine — room expiry is minute-scale.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(id)
  }, [])

  // A redirect must fire once. Without this guard the room scan's refresh
  // interval re-triggers router.replace on every pass, which stacks history
  // entries and fights the user's back button.
  const redirectedRef = useRef(false)

  const loadRooms = useCallback(async () => {
    const client = getContractClient()
    if (!client) {
      setError('Contract address not configured.')
      setRooms([])
      return
    }
    try {
      const total  = Number(await client.getRoomCount())
      const window = Math.min(total, RECENT_ROOM_LIMIT)
      const ids    = Array.from({ length: window }, (_, i) => BigInt(total - i))
      const batch  = await client.getRooms(ids)

      const rows: LiveRoom[] = []
      for (const { id, room } of batch) {
        if (!room) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw: any = room
        rows.push({
          id,
          status:          ROOM_STATUS_MAP[Number(raw.status)] ?? 'ended',
          players:         raw.players?.length ?? 0,
          playerAddresses: (raw.players ?? []) as string[],
          maxPlayers:      Number(raw.config.maxPlayers),
          pot:             raw.pot,
          stakeAmount:     raw.config.stakeAmount,
          expiresAt:       Number(raw.expiresAt) * 1000,
        })
      }

      // Names are cosmetic — a failure here must not blank the room list.
      try {
        const idList = rows.map(r => r.id.toString()).join(',')
        const res = await fetch(`${BACKEND_URL}/api/rooms/names?ids=${idList}`)
        if (res.ok) {
          const data = await res.json() as { names: Record<string, string | null> }
          for (const row of rows) row.name = data.names?.[row.id.toString()] ?? null
        }
      } catch { /* fall back to ward codes */ }

      setRooms(rows)
      setError(null)
    } catch {
      setError('Could not reach the chain. Retrying…')
      setRooms(prev => prev ?? [])
    }
  }, [])

  useEffect(() => {
    void loadRooms()
    const id = setInterval(() => {
      // Pointless work in a background tab, and it burns RPC budget.
      if (!document.hidden) void loadRooms()
    }, 15_000)
    return () => clearInterval(id)
  }, [loadRooms])

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/rooms/recent?limit=3`, { signal: AbortSignal.timeout(8000) })
      .then(r => (r.ok ? r.json() : null))
      .then(j => setRecent(j?.games ?? []))
      .catch(() => { /* the recap is a bonus panel, not load-bearing */ })
  }, [])

  // ── Tier 1: the room this wallet is already sitting in ────────────────────
  //
  // An expired waiting room is deliberately excluded. It can no longer be
  // joined or started on-chain, so redirecting into one would strand the player
  // on a board that says "Waiting for players" and never moves — worse than the
  // dead end this component replaces.
  const myRoom = useMemo(() => {
    if (!address || !rooms) return null
    const me = address.toLowerCase()
    return rooms.find(r =>
      r.status !== 'ended' &&
      !(r.status === 'waiting' && now >= r.expiresAt) &&
      r.playerAddresses.some(p => p.toLowerCase() === me),
    ) ?? null
  }, [rooms, address, now])

  useEffect(() => {
    if (!myRoom || redirectedRef.current) return
    redirectedRef.current = true
    router.replace(`/game?room=${myRoom.id.toString()}`)
  }, [myRoom, router])

  // ── Tier 2: matches in progress ───────────────────────────────────────────
  const liveRooms = useMemo(
    () => (rooms ?? []).filter(r => r.status === 'active' || r.status === 'starting'),
    [rooms],
  )
  const openRooms = useMemo(
    () => (rooms ?? []).filter(r =>
      r.status === 'waiting' && r.players < r.maxPlayers && now < r.expiresAt,
    ),
    [rooms, now],
  )

  const loading = rooms === null

  return (
    <main
      className="min-h-screen"
      style={{
        backgroundColor: '#060b06',
        color: '#d4c9b2',
        backgroundImage: 'url(/images/bg-game.webp)',
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
        backgroundAttachment: 'fixed',
      }}
    >
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundColor: 'rgba(6,11,6,0.88)', zIndex: 0 }} />

      {/* Container, padding and nav treatment all match the lobby/game/leaderboard
          shell. Anything narrower reads as an inset page rather than the same site. */}
      <div className="relative px-4 pb-10 sm:px-8" style={{ zIndex: 1 }}>
        <div className="sticky top-0 z-50 -mx-4 px-4 pt-4 sm:-mx-8 sm:px-8 sm:pt-6">
          <div className="mx-auto w-full max-w-6xl">
            <SiteNav currentPath="/game" />
          </div>
        </div>
        <div className="mx-auto w-full max-w-6xl">

        {/* Redirecting into your own room — don't flash the hub behind it. */}
        {myRoom ? (
          <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
            <p className="font-display text-3xl" style={{ color: '#6b8e23' }}>Rejoining {labelFor(myRoom)}…</p>
            <p className="font-mono text-xs" style={{ color: '#8fa882' }}>You have a match in progress.</p>
          </div>
        ) : (
          <>
            <header className="mt-6 text-center">
              <h1 className="font-display text-4xl sm:text-5xl" style={{ color: '#d4c9b2' }}>The Arena</h1>
              <p className="mt-2 font-mono text-xs uppercase tracking-[0.22em]" style={{ color: '#7d9a72' }}>
                {loading
                  ? 'scanning the ward…'
                  : liveRooms.length > 0
                    ? `${liveRooms.length} outbreak${liveRooms.length === 1 ? '' : 's'} in progress`
                    : 'no active outbreak'}
              </p>
            </header>

            <div className="mt-5"><NextWindowBanner /></div>

            {loadError && (
              <p className="mt-4 text-center font-mono text-xs" style={{ color: '#e63329' }}>{loadError}</p>
            )}

            {/* ── Live matches ─────────────────────────────────────────── */}
            <section className="mt-6">
              <h2 className="font-heading text-lg uppercase tracking-wider" style={{ color: '#8fa882' }}>
                Live now
              </h2>

              {loading ? (
                <p className="mt-3 font-mono text-xs" style={{ color: '#7d9a72' }}>Loading…</p>
              ) : liveRooms.length === 0 ? (
                <div
                  className="mt-3 rounded-xl border p-6 text-center"
                  style={{ borderColor: 'rgba(107,142,35,0.2)', backgroundColor: 'rgba(6,11,6,0.75)' }}
                >
                  <p className="font-mono text-sm" style={{ color: '#8fa882' }}>
                    The ward is quiet. Nothing is being played right now.
                  </p>
                  <p className="mt-2 font-mono text-xs" style={{ color: '#7d9a72' }}>
                    {openRooms.length > 0
                      ? `${openRooms.length} room${openRooms.length === 1 ? '' : 's'} waiting for players — take a seat and start one.`
                      : 'Open a room and the bots will fill the empty seats.'}
                  </p>
                  <Link
                    href="/lobby"
                    className="mt-4 inline-block rounded border px-5 py-2 font-mono text-xs font-bold uppercase tracking-widest transition-all hover:brightness-125"
                    style={{ borderColor: '#6b8e23', color: '#6b8e23' }}
                  >
                    Go to Lobby
                  </Link>
                </div>
              ) : (
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {liveRooms.map(room => (
                    <li
                      key={room.id.toString()}
                      className="rounded-xl border p-4"
                      style={{ borderColor: 'rgba(245,197,24,0.35)', backgroundColor: 'rgba(6,11,6,0.8)' }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-heading text-base" style={{ color: '#d4c9b2' }}>
                            {labelFor(room)}
                          </p>
                          <p className="mt-1 font-mono text-[11px] uppercase tracking-wider" style={{ color: '#f5c518' }}>
                            ● {room.status === 'starting' ? 'starting' : 'in progress'}
                          </p>
                        </div>
                        <span className="whitespace-nowrap font-mono text-xs" style={{ color: '#8fa882' }}>
                          {room.players}/{room.maxPlayers}
                        </span>
                      </div>

                      <p className="mt-3 font-mono text-xs" style={{ color: '#7d9a72' }}>
                        Pot {formatToken(room.pot)} {STABLE_TOKEN}
                      </p>

                      <Link
                        href={`/game?room=${room.id.toString()}`}
                        className="mt-3 block rounded border px-4 py-2 text-center font-mono text-xs font-bold uppercase tracking-widest transition-all hover:brightness-125"
                        style={{ borderColor: '#f5c518', color: '#f5c518' }}
                      >
                        Spectate
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ── Last outbreaks ───────────────────────────────────────── */}
            {recent.length > 0 && (
              <section className="mt-8">
                <h2 className="font-heading text-lg uppercase tracking-wider" style={{ color: '#8fa882' }}>
                  Last outbreaks
                </h2>
                <ul className="mt-3 space-y-2">
                  {recent.map(game => {
                    const label = outcomeLabel(game.outcome)
                    return (
                      <li
                        key={game.roomId}
                        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border px-4 py-3"
                        style={{ borderColor: 'rgba(107,142,35,0.15)', backgroundColor: 'rgba(6,11,6,0.7)' }}
                      >
                        <span className="font-heading text-sm" style={{ color: '#d4c9b2' }}>
                          {quarantineCode(BigInt(game.roomId))}
                        </span>
                        <span className="font-mono text-xs" style={{ color: label.color }}>{label.text}</span>
                        <span className="font-mono text-[11px]" style={{ color: '#7d9a72' }}>
                          {game.playerCount} players · {game.totalRounds} rounds · {formatToken(game.totalPot)} {STABLE_TOKEN}
                        </span>
                        <span className="font-mono text-[11px]" style={{ color: '#7d9a72' }}>
                          {timeAgo(game.endedAt)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
                <Link
                  href="/leaderboard"
                  className="mt-3 inline-block font-mono text-xs uppercase tracking-wider transition-all hover:brightness-125"
                  style={{ color: '#6b8e23' }}
                >
                  See the leaderboard →
                </Link>
              </section>
            )}

            {/* ── Route out ────────────────────────────────────────────── */}
            {liveRooms.length > 0 && (
              <div className="mt-8 text-center">
                <Link
                  href="/lobby"
                  className="inline-block rounded border px-6 py-3 font-mono text-xs font-bold uppercase tracking-widest transition-all hover:brightness-125"
                  style={{ borderColor: '#6b8e23', color: '#6b8e23' }}
                >
                  Play your own match
                </Link>
              </div>
            )}

          </>
        )}
        </div>
      </div>
    </main>
  )
}
