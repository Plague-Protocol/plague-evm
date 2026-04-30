'use client'

import { SiteNav } from '@/components/ui/site-nav'
import { useEffect, useState, useCallback } from 'react'
import { useWallet } from '@/hooks/useWallet'
import { createContractClient } from '@/lib/contract'
import { useRouter } from 'next/navigation'

// ── cUSD contract addresses ───────────────────────────────────────────────────
const CUSD_ADDRESSES: Record<number, `0x${string}`> = {
  44787: '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1', // Alfajores
  42220: '0x765DE816845861e75A25fCA122bb6022DB77Eaca', // Mainnet
}

const statusColor: Record<string, string> = {
  waiting:  '#1a7a4a',
  starting: '#a855f7',
  active:   '#f5c518',
  ended:    '#4a5568',
}

const statusLabel: Record<string, string> = {
  waiting:  'Join',
  starting: 'Starting',
  active:   'Spectate',
  ended:    'Ended',
}

/** Format seconds → MM:SS */
function formatCountdown(secs: number): string {
  if (secs <= 0) return '00:00'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function countdownColor(secs: number): string {
  if (secs <= 60)  return '#e63329'
  if (secs <= 180) return '#f5c518'
  return '#84cc16'
}

const ROOM_STATUS_MAP: Record<number, 'waiting' | 'starting' | 'active' | 'ended'> = {
  0: 'waiting', 1: 'starting', 2: 'active', 3: 'ended',
}

interface RoomRow {
  id: bigint
  status: 'waiting' | 'starting' | 'active' | 'ended'
  players: number
  maxPlayers: number
  stakeAmount: bigint
  proofFee: bigint
  expiresAt: number   // unix ms
  pot: bigint
  host: string
}

function getContractClient() {
  const network = (process.env.NEXT_PUBLIC_NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
  const addr    = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}` | undefined
  if (!addr) return null
  return createContractClient({ contractAddress: addr, network })
}

export default function LobbyPage() {
  const router = useRouter()
  const { isConnected, address, chainId, connect } = useWallet()

  // ── Room list from chain ───────────────────────────────────────────────────
  const [rooms, setRooms]           = useState<RoomRow[]>([])
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [roomsError, setRoomsError] = useState<string | null>(null)

  // ── Create room form state ─────────────────────────────────────────────────
  const [maxPlayers, setMaxPlayers]   = useState(6)
  const [stakeInput, setStakeInput]   = useState('10')
  const [proofFeeInput, setProofFeeInput] = useState('2')
  const [creating, setCreating]       = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // ── Join state ─────────────────────────────────────────────────────────────
  const [joiningId, setJoiningId] = useState<bigint | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)

  // ── Ticker ─────────────────────────────────────────────────────────────────
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // ── Load rooms from contract ───────────────────────────────────────────────
  const loadRooms = useCallback(async () => {
    const client = getContractClient()
    if (!client) {
      setRoomsError('Contract address not configured. Set NEXT_PUBLIC_CONTRACT_ADDRESS.')
      return
    }
    setLoadingRooms(true)
    setRoomsError(null)
    try {
      const count = await client.getRoomCount()
      const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1))
      const rows: RoomRow[] = []
      await Promise.all(ids.map(async (id) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw: any = await client.getRoom(id)
          rows.push({
            id,
            status:     ROOM_STATUS_MAP[Number(raw.status)] ?? 'ended',
            players:    raw.players?.length ?? 0,
            maxPlayers: Number(raw.config.maxPlayers),
            stakeAmount: raw.config.stakeAmount,
            proofFee:   raw.config.proofFee,
            expiresAt:  Number(raw.expiresAt) * 1000,
            pot:        raw.pot,
            host:       raw.host,
          })
        } catch {
          // skip rooms that fail to load (e.g. non-existent)
        }
      }))
      // Sort: waiting first, then by id desc
      rows.sort((a, b) => {
        if (a.status === 'waiting' && b.status !== 'waiting') return -1
        if (a.status !== 'waiting' && b.status === 'waiting') return 1
        return Number(b.id - a.id)
      })
      setRooms(rows)
    } catch (err) {
      setRoomsError(err instanceof Error ? err.message : 'Failed to load rooms from contract.')
    } finally {
      setLoadingRooms(false)
    }
  }, [])

  useEffect(() => { loadRooms() }, [loadRooms])

  // ── Create Room ────────────────────────────────────────────────────────────
  const handleCreateRoom = async () => {
    if (!isConnected || !address) { await connect(); return }
    const client = getContractClient()
    if (!client) return
    const stakeWei = BigInt(Math.round(Number.parseFloat(stakeInput) * 1e18))
    const feeWei   = BigInt(Math.round(Number.parseFloat(proofFeeInput) * 1e18))
    setCreating(true)
    setCreateError(null)
    try {
      // Approve stake + proofFee buffer in cUSD before calling createRoom
      // (backend will auto-stake when startGame triggers)
      const cUSDAddr = chainId ? CUSD_ADDRESSES[chainId] : undefined
      if (cUSDAddr) {
        await client.approveCUSD(address, cUSDAddr, stakeWei * BigInt(maxPlayers) + feeWei * 10n)
      }
      const newId = await client.createRoom(address, maxPlayers, stakeWei, feeWei, 600)
      await loadRooms()
      router.push(`/game?room=${newId.toString()}`)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Room creation failed.')
    } finally {
      setCreating(false)
    }
  }

  // ── Join Room ──────────────────────────────────────────────────────────────
  const handleJoin = async (room: RoomRow) => {
    if (room.status !== 'waiting') {
      router.push(`/game?room=${room.id.toString()}`)
      return
    }
    if (!isConnected || !address) { await connect(); return }
    const client = getContractClient()
    if (!client) return
    setJoiningId(room.id)
    setJoinError(null)
    try {
      const cUSDAddr = chainId ? CUSD_ADDRESSES[chainId] : undefined
      if (cUSDAddr) {
        await client.approveCUSD(address, cUSDAddr, room.stakeAmount)
      }
      await client.joinRoom(address, room.id)
      router.push(`/game?room=${room.id.toString()}`)
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Failed to join room.')
    } finally {
      setJoiningId(null)
    }
  }

  let createBtnLabel = 'Connect & Create'
  if (isConnected) createBtnLabel = 'Create Room'
  if (creating) createBtnLabel = 'Creating\u2026'

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
            Join a waiting room, stake cUSD, and lock in your role before the game starts. Once a game begins, the join window closes permanently.
          </p>
        </div>
      </header>

      <div className="px-6 pb-20">
        <div className="mx-auto w-full max-w-6xl">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">

            {/* Left column: Create Room */}
            <div className="flex flex-col gap-6">
              <article
                className="rise-in rounded-lg border p-8"
                style={{ backgroundColor: '#161b35', borderColor: 'rgba(168,85,247,0.3)' }}
              >
                <h2 className="font-display text-2xl leading-none" style={{ color: '#f0f4f8' }}>
                  Create Room
                </h2>
                <div className="mt-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="maxPlayers" className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#7a8592' }}>
                        Max Players
                      </label>
                      <input
                        id="maxPlayers"
                        type="number"
                        min={4}
                        max={20}
                        value={maxPlayers}
                        onChange={e => setMaxPlayers(Number(e.target.value))}
                        className="mt-2 w-full rounded-lg border bg-transparent px-4 py-3 font-mono text-sm focus:outline-none"
                        style={{ borderColor: 'rgba(168,85,247,0.4)', color: '#f0f4f8' }}
                      />
                    </div>
                    <div>
                      <label htmlFor="stakeInput" className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#7a8592' }}>
                        Stake (cUSD)
                      </label>
                      <input
                        id="stakeInput"
                        type="number"
                        min={0}
                        step={0.1}
                        value={stakeInput}
                        onChange={e => setStakeInput(e.target.value)}
                        className="mt-2 w-full rounded-lg border bg-transparent px-4 py-3 font-mono text-sm focus:outline-none"
                        style={{ borderColor: 'rgba(168,85,247,0.4)', color: '#f0f4f8' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="proofFeeInput" className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#7a8592' }}>
                      Proof Fee (cUSD per extra proof)
                    </label>
                    <input
                      id="proofFeeInput"
                      type="number"
                      min={0}
                      step={0.1}
                      value={proofFeeInput}
                      onChange={e => setProofFeeInput(e.target.value)}
                      className="mt-2 w-full rounded-lg border bg-transparent px-4 py-3 font-mono text-sm focus:outline-none"
                      style={{ borderColor: 'rgba(168,85,247,0.4)', color: '#f0f4f8' }}
                    />
                  </div>

                  {createError && (
                    <p className="font-mono text-xs" style={{ color: '#e63329' }}>{createError}</p>
                  )}

                  <button
                    onClick={handleCreateRoom}
                    disabled={creating}
                    className="w-full rounded-lg border py-3 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-50"
                    style={{ backgroundColor: '#e63329', borderColor: '#e63329', color: '#f0f4f8', boxShadow: '4px 4px 0px #a855f7' }}
                  >
                    {createBtnLabel}
                  </button>
                </div>

                <div className="mt-6 grid grid-cols-3 gap-3">
                  {[
                    { label: 'Stake',   value: `${stakeInput} cUSD` },
                    { label: 'Players', value: `${maxPlayers}` },
                    { label: 'Mode',    value: 'ZK' },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="rounded-lg border p-3 text-center"
                      style={{ borderColor: 'rgba(168,85,247,0.2)', backgroundColor: '#1a1f3a' }}
                    >
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#7a8592' }}>
                        {s.label}
                      </p>
                      <p className="mt-2 font-display text-xl leading-none" style={{ color: '#f0f4f8' }}>
                        {s.value}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              {/* Wallet status */}
              <article
                className="rise-in rounded-lg border p-6"
                style={{ backgroundColor: '#161b35', borderColor: 'rgba(6,182,212,0.2)', animationDelay: '100ms' }}
              >
                <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#06b6d4' }}>
                  Wallet
                </p>
                {isConnected && address ? (
                  <div className="mt-3 space-y-1">
                    <p className="font-mono text-sm" style={{ color: '#f0f4f8' }}>
                      {address.slice(0, 10)}…{address.slice(-6)}
                    </p>
                    <p className="font-mono text-xs" style={{ color: '#84cc16' }}>
                      Connected · {chainId === 42220 ? 'Mainnet' : 'Alfajores'}
                    </p>
                  </div>
                ) : (
                  <button
                    onClick={connect}
                    className="mt-3 w-full rounded-lg border py-2 font-mono text-sm uppercase tracking-wider transition-all hover:opacity-90"
                    style={{ borderColor: 'rgba(168,85,247,0.5)', color: '#a855f7' }}
                  >
                    Connect Wallet
                  </button>
                )}
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
                <div className="flex items-center gap-3">
                  <span
                    className="rounded-full border px-3 py-1 font-mono text-xs"
                    style={{ borderColor: 'rgba(168,85,247,0.3)', color: '#a855f7' }}
                  >
                    {loadingRooms ? '…' : `${rooms.filter(r => r.status !== 'ended').length} rooms`}
                  </span>
                  <button
                    onClick={loadRooms}
                    disabled={loadingRooms}
                    className="rounded border px-3 py-1 font-mono text-xs uppercase tracking-wider transition-all hover:opacity-80 disabled:opacity-40"
                    style={{ borderColor: 'rgba(168,85,247,0.3)', color: '#a855f7' }}
                  >
                    ↺
                  </button>
                </div>
              </div>

              {roomsError && (
                <p className="mt-4 font-mono text-xs" style={{ color: '#e63329' }}>{roomsError}</p>
              )}

              {joinError && (
                <p className="mt-2 font-mono text-xs" style={{ color: '#e63329' }}>{joinError}</p>
              )}

              {loadingRooms && (
                <p className="mt-6 text-center font-mono text-xs" style={{ color: '#7a8592' }}>
                  Loading rooms from chain…
                </p>
              )}

              {!loadingRooms && rooms.length === 0 && !roomsError && (
                <p className="mt-6 text-center font-mono text-xs" style={{ color: '#7a8592' }}>
                  No rooms found. Create the first one.
                </p>
              )}

              <ul className="mt-6 space-y-4">
                {rooms.map((room, i) => {
                  const secsLeft = room.status === 'waiting'
                    ? Math.max(0, Math.floor((room.expiresAt - now) / 1000))
                    : 0
                  const isExpiring  = room.status === 'waiting' && secsLeft > 0 && secsLeft <= 180
                  const isJoining   = joiningId === room.id
                  const stakeCUSD   = (Number(room.stakeAmount) / 1e18).toFixed(2)
                  const feeCUSD     = (Number(room.proofFee) / 1e18).toFixed(2)
                  const potCUSD     = (Number(room.pot) / 1e18).toFixed(2)
                  const isDisabled  = room.status === 'ended' || isJoining

                  return (
                    <li
                      key={room.id.toString()}
                      className="rise-in rounded-lg border p-5 transition-all duration-200 hover:scale-[1.01]"
                      style={{
                        backgroundColor:  '#1a1f3a',
                        borderColor: isExpiring ? 'rgba(245,197,24,0.35)' : 'rgba(168,85,247,0.2)',
                        animationDelay:   `${160 + i * 80}ms`,
                      }}
                    >
                      {/* Top row */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="h-2 w-2 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: statusColor[room.status], boxShadow: `0 0 6px ${statusColor[room.status]}` }}
                        />
                        <span className="font-display text-lg leading-none" style={{ color: '#f0f4f8' }}>
                          Room #{room.id.toString()}
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
                        Host: {room.host.slice(0, 8)}…{room.host.slice(-4)}
                      </p>

                      {/* Stats + action row */}
                      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                        <div className="flex flex-wrap gap-4">
                          <div className="text-center">
                            <p className="font-mono text-[10px] uppercase" style={{ color: '#7a8592' }}>Players</p>
                            <p className="font-display text-lg leading-none" style={{ color: '#f0f4f8' }}>
                              {room.players}/{room.maxPlayers}
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="font-mono text-[10px] uppercase" style={{ color: '#7a8592' }}>Stake</p>
                            <p className="font-display text-lg leading-none" style={{ color: '#84cc16' }}>
                              {stakeCUSD} cUSD
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="font-mono text-[10px] uppercase" style={{ color: '#7a8592' }}>Proof Fee</p>
                            <p className="font-display text-lg leading-none" style={{ color: '#06b6d4' }}>
                              {feeCUSD} cUSD
                            </p>
                          </div>
                          {room.status === 'active' && (
                            <div className="text-center">
                              <p className="font-mono text-[10px] uppercase" style={{ color: '#7a8592' }}>Pot</p>
                              <p className="font-display text-lg leading-none" style={{ color: '#f5c518' }}>
                                {potCUSD} cUSD
                              </p>
                            </div>
                          )}
                          {room.status === 'waiting' && room.expiresAt > 0 && (
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
                          onClick={() => handleJoin(room)}
                          disabled={isDisabled}
                          className="rounded border px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-40"
                          style={{
                            backgroundColor: room.status === 'waiting' ? '#e63329' : 'transparent',
                            borderColor:     room.status === 'waiting' ? '#e63329' : 'rgba(168,85,247,0.5)',
                            color:           room.status === 'waiting' ? '#f0f4f8' : '#a855f7',
                          }}
                        >
                          {isJoining ? 'Joining…' : statusLabel[room.status]}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </article>
          </div>
        </div>
      </div>
    </main>
  )
}

