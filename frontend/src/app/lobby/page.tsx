'use client'

import { SiteNav } from '@/components/ui/site-nav'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { useWallet } from '@/hooks/useWallet'
import { useSoundscape } from '@/hooks/useSoundscape'
import { useSound } from '@/providers/sound-provider'
import { createContractClient, createFaucetClient, readCUSDBalance } from '@/lib/contract'
import { formatToken } from '@/lib/format'
import { quarantineCode, roomLabel } from '@/lib/roomLabel'
import { BotControls } from '@/components/lobby/bot-controls'
import { useRouter } from 'next/navigation'
import { io } from 'socket.io-client'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

// ── USDm contract addresses ───────────────────────────────────────────────────
const CUSD_ADDRESSES: Record<number, `0x${string}`> = {
  11142220: '0xae10a9e08d979e7d154d3b0212fb7cbf70fa6bb1', // Celo Sepolia (Mock USDm)
  42220: '0x765DE816845861e75A25fCA122bb6898B8B1282a',   // Celo Mainnet (USDm)
}

// Token name shown to users — always USDm.
const STABLE_TOKEN = 'USDm'

// Floor for the per-extra-Shield fee (contract field is proofFee). The fee is
// 1% of stake; tiny stakes round that to ~0 and look free, so this fixed
// minimum keeps it a visible charge. Pricing/anti-spam only — the player pays
// their own gas, so this isn't a platform cost to recover. 0.001 USDm = 1e15
// wei. Override with NEXT_PUBLIC_MIN_PROOF_FEE_WEI.
const MIN_PROOF_FEE_WEI = BigInt(process.env.NEXT_PUBLIC_MIN_PROOF_FEE_WEI ?? '1000000000000000')

/** Proof fee for a given stake input: max(1% of stake, floor). */
function proofFeeWeiFor(stakeInput: string): bigint {
  const f = Number.parseFloat(stakeInput)
  const stakeWei = Number.isFinite(f) && f > 0 ? BigInt(Math.round(f * 1e18)) : 0n
  const onePct = stakeWei / 100n
  return onePct > MIN_PROOF_FEE_WEI ? onePct : MIN_PROOF_FEE_WEI
}

/** A waiting room whose join window has elapsed. */
function isExpiredWaiting(room: RoomRow, now: number): boolean {
  return room.status === 'waiting' && now >= room.expiresAt
}

/**
 * Whether a room belongs in the "Join Existing" list. Ended rooms and other
 * people's expired rooms are hidden (not joinable = clutter); the viewer's OWN
 * expired room stays visible so they can still tap "End & Refund".
 */
function isVisibleRoom(room: RoomRow, now: number, myRoomId: bigint | null): boolean {
  if (room.status === 'ended') return false
  if (isExpiredWaiting(room, now) && room.id !== myRoomId) return false
  return true
}

// Notice for a player who already has a room. A waiting room can only be ended
// after it expires, and an active game must play out — the wording reflects that.
function activeRoomNotice(ar: RoomRow, now: number): string {
  const label = roomLabel(ar)
  if (ar.status === 'active' || ar.status === 'starting') {
    return `Your game in ${label} is in progress — you can create a new room once it ends.`
  }
  if (ar.players >= ar.maxPlayers) {
    return `${label} is full — auto-starting now.`
  }
  if (now >= ar.expiresAt) {
    return `${label} has expired — tap “End & Refund” on its card to reclaim your stake and free up, then create a new one.`
  }
  return `You have an open room (${label}) waiting for players. It frees up when it fills and plays out, or when it expires.`
}

// Turn raw viem/RPC errors into a calm, non-alarming message. A failed room load
// is almost always a brief public-RPC hiccup, not a broken app.
function friendlyRoomsError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/failed to fetch|http request failed|fetch failed|timeout|timed out|network|load failed|econn|429|too many requests/i.test(msg)) {
    return 'Network is busy right now — couldn’t reach Celo for a moment. Tap ↺ to retry.'
  }
  return 'Couldn’t load rooms just now. Tap ↺ to retry.'
}

const statusColor: Record<string, string> = {
  waiting:  '#1a7a4a',
  starting: '#6b8e23',
  active:   '#f5c518',
  ended:    '#4a5e44',
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

function sortLobbyRooms(a: RoomRow, b: RoomRow): number {
  if (a.status === 'waiting' && b.status !== 'waiting') return -1
  if (a.status !== 'waiting' && b.status === 'waiting') return 1
  return Number(b.id - a.id)
}

function formatCUSDBalance(balance: bigint): string {
  return (Number(balance) / 1e18).toFixed(2)
}

function claimSuccessMessage(claimed: boolean): string {
  return claimed ? '50 USDm dropped to your wallet!' : ''
}

function getCreateButtonLabel(isConnected: boolean, creating: boolean): string {
  if (creating) return 'Creating\u2026'
  // Always "Create Room" \u2014 the flow prompts sign-in on click if needed.
  return 'Create Room'
}

interface RoomRow {
  id: bigint
  status: 'waiting' | 'starting' | 'active' | 'ended'
  players: number
  playerAddresses: string[]
  maxPlayers: number
  stakeAmount: bigint
  proofFee: bigint
  expiresAt: number   // unix ms
  pot: bigint
  host: string
  name?: string | null
}

function getContractClient() {
  const network = (process.env.NEXT_PUBLIC_NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
  const addr    = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}` | undefined
  if (!addr) return null
  return createContractClient({ contractAddress: addr, network })
}

async function requestRoomRefresh(roomId: string): Promise<void> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
  await new Promise<void>((resolve) => {
    const socket = io(backendUrl, { transports: ['websocket'], forceNew: true })
    const done = () => {
      socket.disconnect()
      resolve()
    }
    socket.on('connect', () => {
      socket.emit('request_room_refresh', { roomId })
      setTimeout(done, 80)
    })
    socket.on('connect_error', done)
    setTimeout(done, 1200)
  })
}

/** Reads the caller's stablecoin balance and throws a user-friendly error if it is below `required`. */
async function assertSufficientCUSD(
  address: `0x${string}`,
  cUSDAddr: `0x${string}`,
  required: bigint,
  network: 'testnet' | 'mainnet',
  tokenLabel = STABLE_TOKEN,
): Promise<void> {
  const balance = await readCUSDBalance(address, cUSDAddr, network)
  if (balance < required) {
    const have = (Number(balance) / 1e18).toFixed(2)
    const need = (Number(required) / 1e18).toFixed(2)
    const faucetHint = network === 'testnet' ? ' Use the faucet to claim test tokens.' : ''
    throw new Error(`Insufficient ${tokenLabel} balance. You need ${need} ${tokenLabel} but your wallet only holds ${have} ${tokenLabel}.${faucetHint}`)
  }
}

interface CreateRoomActionArgs {
  isConnected: boolean
  address: `0x${string}` | null
  chainId: number | null
  connect: () => Promise<void>
  maxPlayers: number
  stakeInput: string
  roomNameInput: string
  setCreating: (value: boolean) => void
  loadRooms: () => Promise<void>
  pushToGame: (roomId: bigint) => void
}

async function runCreateRoomAction(args: CreateRoomActionArgs) {
  const {
    isConnected,
    address,
    chainId,
    connect,
    maxPlayers,
    stakeInput,
    roomNameInput,
    setCreating,
    loadRooms,
    pushToGame,
  } = args

  if (!isConnected || !address) {
    await connect()
    return
  }

  const client = getContractClient()
  if (!client) return

  const stakeFloat = Number.parseFloat(stakeInput)
  if (!Number.isFinite(stakeFloat) || stakeFloat <= 0) {
    throw new Error('Stake amount must be greater than zero.')
  }

  const stakeWei = BigInt(Math.round(stakeFloat * 1e18))
  if (stakeWei <= 0n) {
    throw new Error('Stake amount must be greater than zero.')
  }

  const onePctFee = stakeWei / 100n
  const feeWei    = onePctFee > MIN_PROOF_FEE_WEI ? onePctFee : MIN_PROOF_FEE_WEI
  setCreating(true)

  try {
    const network  = (process.env.NEXT_PUBLIC_NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
    const cUSDAddr = chainId ? CUSD_ADDRESSES[chainId] : undefined
    if (cUSDAddr) {
      await assertSufficientCUSD(address, cUSDAddr, stakeWei, network)
      // Only the host's stake is needed upfront — createRoom auto-joins them.
      await client.approveCUSD(address, cUSDAddr, stakeWei)
    }
    const newId = await client.createRoom(address, maxPlayers, stakeWei, feeWei, 600)
    // Persist room name off-chain
    const trimmedName = roomNameInput.trim()
    if (trimmedName) {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
      const nameRes = await fetch(`${backendUrl}/api/rooms/${newId.toString()}/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      }).catch(() => null)
      if (nameRes?.status === 409) {
        toast.error(`"${trimmedName}" is already taken by an active room. Your room was created as ${quarantineCode(newId)}.`)
      } else if (!nameRes?.ok) {
        toast.error(`Your room was created (${quarantineCode(newId)}) but the name "${trimmedName}" could not be saved. You can set it from the game page.`)
      }
    }
    await loadRooms()
    pushToGame(newId)
  } catch (err) {
    toast.error(getFriendlyError(err))
  } finally {
    setCreating(false)
  }
}

interface JoinRoomActionArgs {
  room: RoomRow
  isConnected: boolean
  address: `0x${string}` | null
  chainId: number | null
  connect: () => Promise<void>
  setJoiningId: (value: bigint | null) => void
  pushToGame: (roomId: bigint) => void
}

async function runJoinRoomAction(args: JoinRoomActionArgs) {
  const {
    room,
    isConnected,
    address,
    chainId,
    connect,
    setJoiningId,
    pushToGame,
  } = args

  if (room.status !== 'waiting') {
    pushToGame(room.id)
    return
  }

  // Block join if the room timer has already elapsed
  if (Date.now() >= room.expiresAt) {
    toast.error('This room has expired and is no longer accepting players.')
    return
  }

  if (!isConnected || !address) {
    await connect()
    return
  }

  const client = getContractClient()
  if (!client) return

  setJoiningId(room.id)

  try {
    const network  = (process.env.NEXT_PUBLIC_NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
    const cUSDAddr = chainId ? CUSD_ADDRESSES[chainId] : undefined
    if (cUSDAddr) {
      await assertSufficientCUSD(address, cUSDAddr, room.stakeAmount, network)
      await client.approveCUSD(address, cUSDAddr, room.stakeAmount)
    }
    await client.joinRoom(address, room.id)

    // Auto-start: if the room is now full AND the caller is the host, start the game
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated: any = await client.getRoom(room.id)
    const nowFull = (updated.players?.length ?? 0) >= Number(updated.config.maxPlayers)
    if (nowFull && address.toLowerCase() === (updated.host as string).toLowerCase()) {
      await client.startGame(address, room.id)
    }

    await requestRoomRefresh(room.id.toString())

    pushToGame(room.id)
  } catch (err) {
    toast.error(getFriendlyError(err))
  } finally {
    setJoiningId(null)
  }
}

// ── RoomCard ──────────────────────────────────────────────────────────────────

interface RoomCardProps {
  readonly room: RoomRow
  readonly index: number
  readonly now: number
  readonly address: `0x${string}` | null
  readonly myActiveRoom: RoomRow | null
  readonly joiningId: bigint | null
  readonly endingRoomId: bigint | null
  readonly onJoin: (room: RoomRow) => void
  readonly onEnd: (room: RoomRow) => void
}

interface JoinButtonState {
  bg: string
  border: string
  color: string
  label: string
  disabled: boolean
}

const CONTRACT_ERROR_MESSAGES: Record<string, string> = {
  InvalidRoom:             'Room not found. It may have been created by a concurrent transaction — please try again.',
  AlreadyJoined:           'You have already joined this room.',
  RoomNotWaiting:          'This room is no longer accepting players.',
  RoomExpiredError:        'This room has expired.',
  RoomFull:                'This room is full.',
  WrongStakeAmount:        'Stake amount mismatch. Please refresh and try again.',
  NotHost:                 'Only the host can perform this action.',
  NotEnoughPlayers:        'Not enough players to start the game.',
  TooManyActiveRooms:      'The contract has reached its room limit. Please wait for a room to finish.',
  Unauthorized:            'You are not authorised to perform this action.',
  // require() string reasons from the contract
  'cUSD transferFrom failed': `${STABLE_TOKEN} transfer failed. Check your balance and that the contract is approved.`,
  'cUSD transfer failed':     `${STABLE_TOKEN} transfer failed. Check your balance and try again.`,
  'maxPlayers must be 4-20':  'Max players must be between 4 and 20.',
  'stakeAmount must be > 0':  'Stake amount must be greater than zero.',
}

function getFriendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/user (rejected|denied)/i.test(msg)) return 'Transaction cancelled.'
  if (/Insufficient (cUSD|USDm) balance/i.test(msg)) return msg   // our own pre-check — pass through verbatim
  if (/insufficient funds/i.test(msg)) return 'Insufficient CELO to pay gas. Add CELO to your wallet first.'
  // Named custom errors decoded by viem (error names appear as-is in the message)
  for (const [name, friendly] of Object.entries(CONTRACT_ERROR_MESSAGES)) {
    if (msg.includes(name)) return friendly
  }
  if (/execution reverted/i.test(msg)) {
    // viem 2.x formats the reason as: "Details: execution reverted: {reason}"
    const detailsMatch = /execution reverted:\s*([^\n]+)/i.exec(msg)
    const reason = detailsMatch?.[1]?.trim()
    if (reason) return `Transaction reverted: ${reason}`
    return 'Transaction reverted by the contract.'
  }
  return 'Transaction failed. Please try again.'
}

function getJoinButtonState(
  room: RoomRow,
  isMyRoom: boolean,
  isFull: boolean,
  isExpired: boolean,
  lockedOut: boolean,
  isJoining: boolean,
): JoinButtonState {
  const expired = isExpired && room.status === 'waiting'
  const disabled = room.status === 'ended' || isJoining || lockedOut
    || expired
    || (room.status === 'waiting' && isFull)

  if (isJoining) return { bg: 'transparent', border: 'rgba(107,142,35,0.5)', color: '#6b8e23', label: 'Joining\u2026', disabled }

  if (isMyRoom && isFull && room.status === 'waiting') {
    return { bg: 'transparent', border: 'rgba(107,142,35,0.3)', color: '#4a5e44', label: 'Starting\u2026', disabled }
  }
  if (isMyRoom && isExpired) {
    return { bg: 'transparent', border: 'rgba(143,168,130,0.25)', color: '#4a5e44', label: 'Expired', disabled }
  }
  if (isMyRoom) {
    return { bg: 'transparent', border: 'rgba(107,142,35,0.5)', color: '#6b8e23', label: 'Rejoin', disabled }
  }
  if (lockedOut || (isExpired && room.status === 'waiting')) {
    return { bg: 'transparent', border: 'rgba(143,168,130,0.25)', color: '#4a5e44', label: lockedOut ? 'Locked' : 'Expired', disabled }
  }
  if (room.status === 'waiting') {
    return { bg: '#e63329', border: '#e63329', color: '#d4c9b2', label: statusLabel[room.status], disabled }
  }
  if (room.status === 'starting') {
    return { bg: 'transparent', border: 'rgba(143,168,130,0.25)', color: '#4a5e44', label: 'Starting\u2026', disabled: true }
  }
  return { bg: 'transparent', border: 'rgba(107,142,35,0.5)', color: '#6b8e23', label: statusLabel[room.status], disabled }
}

function RoomCard({
  room, index, now, address, myActiveRoom,
  joiningId, endingRoomId,
  onJoin, onEnd,
}: Readonly<RoomCardProps>) {
  const reduced = useReducedMotion()
  // Pulse the player count when it changes while mounted (someone joined/left).
  // Render-time state adjustment — the React-endorsed "previous value" pattern.
  const [prevPlayers, setPrevPlayers] = useState(room.players)
  const playersJustChanged = prevPlayers !== room.players
  if (playersJustChanged) setPrevPlayers(room.players)
  const secsLeft    = room.status === 'waiting'
    ? Math.max(0, Math.floor((room.expiresAt - now) / 1000))
    : 0
  const isExpired   = room.status === 'waiting' && now >= room.expiresAt
  const isExpiring  = room.status === 'waiting' && !isExpired && secsLeft <= 180
  const isFull      = room.players >= room.maxPlayers
  const isJoining   = joiningId === room.id
  const isEnding    = endingRoomId === room.id
  const isMyRoom    = myActiveRoom?.id === room.id
  const isMyHost    = isMyRoom && !!address && room.host.toLowerCase() === address.toLowerCase()
  const lockedOut   = !!myActiveRoom && !isMyRoom
  const stakeCUSD   = formatToken(room.stakeAmount)
  const feeCUSD     = formatToken(room.proofFee)
  const potCUSD     = formatToken(room.pot)

  // Any participant (host OR a player who joined) can end their own expired room:
  // expireRoom is permissionless on-chain and refunds every staker, so this frees
  // a non-host from being locked out of creating/joining a new room. isMyRoom is
  // true whenever the connected wallet hosts or has joined this room.
  const showEndRoom  = isMyRoom && room.status === 'waiting' && isExpired && !isFull
  const joinBtn      = getJoinButtonState(room, isMyRoom, isFull, isExpired, lockedOut, isJoining)

  let cardBorderColor = 'rgba(107,142,35,0.2)'
  if (isExpired && room.status === 'waiting') cardBorderColor = 'rgba(143,168,130,0.15)'
  else if (isExpiring) cardBorderColor = 'rgba(245,197,24,0.35)'

  return (
    <motion.li
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      whileHover={reduced ? undefined : { scale: 1.01 }}
      transition={{
        layout: { type: 'spring', stiffness: 350, damping: 32 },
        default: { duration: 0.4, ease: 'easeOut', delay: Math.min(index * 0.06, 0.35) },
        exit: { duration: 0.25, ease: 'easeIn', delay: 0 },
      }}
      className="rounded-lg border p-5"
      style={{ backgroundColor: '#0e180d', borderColor: cardBorderColor }}
    >
      {/* Top row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: statusColor[room.status], boxShadow: `0 0 6px ${statusColor[room.status]}` }} />
        <span className="font-heading text-lg leading-none" style={{ color: '#d4c9b2' }}>
          {roomLabel(room)}
        </span>
        {room.status === 'active' && (
          <span className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest" style={{ backgroundColor: 'rgba(245,197,24,0.15)', color: '#f5c518', border: '1px solid rgba(245,197,24,0.3)' }}>
            In Progress
          </span>
        )}
        {isExpired && room.status === 'waiting' && (
          <span className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest" style={{ backgroundColor: 'rgba(143,168,130,0.08)', color: '#4a5e44', border: '1px solid rgba(143,168,130,0.2)' }}>
            Expired
          </span>
        )}
        {isExpiring && (
          <span className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest" style={{ backgroundColor: 'rgba(230,51,41,0.12)', color: '#e63329', border: '1px solid rgba(230,51,41,0.3)' }}>
            Closing Soon
          </span>
        )}
        {isFull && room.status === 'waiting' && (
          <span className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest" style={{ backgroundColor: 'rgba(107,142,35,0.1)', color: '#6b8e23', border: '1px solid rgba(107,142,35,0.3)' }}>
            Full
          </span>
        )}
      </div>

      <p className="mt-1 font-mono text-xs" style={{ color: '#4a5e44' }}>Host: {room.host.slice(0, 8)}…{room.host.slice(-4)}{room.name ? ` · #${room.id.toString()}` : ''}</p>

      {/* Stats + action row */}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-4">
          <div className="text-center">
            <p className="font-mono text-[10px] uppercase" style={{ color: '#4a5e44' }}>Players</p>
            {/* Keyed remount pulses gold when the count changes while mounted */}
            <motion.p
              key={room.players}
              initial={playersJustChanged && !reduced ? { scale: 1.5, color: '#f5c518' } : false}
              animate={{ scale: 1, color: '#d4c9b2' }}
              transition={{ type: 'spring', stiffness: 300, damping: 16 }}
              className="font-heading text-lg leading-none"
            >{room.players}/{room.maxPlayers}</motion.p>
          </div>
          <div className="text-center">
            <p className="font-mono text-[10px] uppercase" style={{ color: '#4a5e44' }}>Stake</p>
            <p className="font-heading text-lg leading-none" style={{ color: '#84cc16' }}>{stakeCUSD} {STABLE_TOKEN}</p>
          </div>
          <div className="text-center">
            <p className="font-mono text-[10px] uppercase" style={{ color: '#4a5e44' }}>Proof Fee</p>
            <p className="font-heading text-lg leading-none" style={{ color: '#8fa882' }}>{feeCUSD} {STABLE_TOKEN}</p>
          </div>
          {room.status === 'active' && (
            <div className="text-center">
              <p className="font-mono text-[10px] uppercase" style={{ color: '#4a5e44' }}>Pot</p>
              <p className="font-heading text-lg leading-none" style={{ color: '#f5c518' }}>{potCUSD} {STABLE_TOKEN}</p>
            </div>
          )}
          {room.status === 'waiting' && room.expiresAt > 0 && (
            <div className="text-center">
              <p className="font-mono text-[10px] uppercase" style={{ color: '#4a5e44' }}>Expires</p>
              <p className="font-mono text-lg leading-none tabular-nums" style={{ color: isExpired ? '#4a5e44' : countdownColor(secsLeft) }}>
                {isExpired ? '00:00' : formatCountdown(secsLeft)}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          {showEndRoom && (
            <button
              onClick={() => onEnd(room)}
              disabled={isEnding}
              title="Ends this expired room and refunds all staked USDm to every player."
              className="rounded border px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-40"
              style={{ borderColor: '#e63329', color: '#e63329', backgroundColor: 'rgba(230,51,41,0.08)' }}
            >
              {isEnding ? 'Ending\u2026' : 'End & Refund'}
            </button>
          )}
          <button
            onClick={() => onJoin(room)}
            disabled={joinBtn.disabled}
            className="rounded border px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: joinBtn.bg, borderColor: joinBtn.border, color: joinBtn.color }}
          >
            {joinBtn.label}
          </button>
        </div>
      </div>

      {/* Host can fill an open room with bots to try the game solo. */}
      {isMyHost && room.status === 'waiting' && !isFull && !isExpired && (
        <BotControls roomId={room.id} stakeAmount={room.stakeAmount} freeSeats={room.maxPlayers - room.players} />
      )}

    </motion.li>
  )
}

export default function LobbyPage() {
  const router = useRouter()
  const { isConnected, address, chainId, connect, switchToCelo } = useWallet()
  const { muted } = useSound()
  useSoundscape('lobby', muted)

  // ── Room list from chain ───────────────────────────────────────────────────
  const [rooms, setRooms]           = useState<RoomRow[]>([])
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const hasLoadedOnceRef = useRef(false)
  const [roomsError, setRoomsError] = useState<string | null>(null)

  // ── Create room form state ─────────────────────────────────────────────────
  const [maxPlayers, setMaxPlayers]   = useState(6)
  const [stakeInput, setStakeInput]   = useState('')
  const [roomNameInput, setRoomNameInput] = useState('')
  const [creating, setCreating]       = useState(false)

  // ── Player nickname state ──────────────────────────────────────────────────
  const [nicknameInput, setNicknameInput] = useState('')
  const [savedNickname, setSavedNickname] = useState<string | null>(null)
  const [savingNickname, setSavingNickname] = useState(false)
  const [editingNickname, setEditingNickname] = useState(false)
  const [nicknameAvailable, setNicknameAvailable] = useState<boolean | null>(null)
  const [checkingNickname, setCheckingNickname] = useState(false)
  const lobbyRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nicknameCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Debounced nickname availability check ─────────────────────────────────
  useEffect(() => {
    if (nicknameCheckTimerRef.current) clearTimeout(nicknameCheckTimerRef.current)
    const trimmed = nicknameInput.trim()
    if (!trimmed || trimmed.length < 1 || trimmed === savedNickname) {
      setNicknameAvailable(null)
      setCheckingNickname(false)
      return
    }
    setCheckingNickname(true)
    nicknameCheckTimerRef.current = setTimeout(async () => {
      try {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
        const params = new URLSearchParams({ nickname: trimmed })
        if (address) params.set('address', address)
        const res = await fetch(`${backendUrl}/api/players/check-nickname?${params}`)
        if (res.ok) {
          const data = await res.json() as { available: boolean }
          setNicknameAvailable(data.available)
        }
      } catch { /* silently ignore */ }
      setCheckingNickname(false)
    }, 400)
    return () => {
      if (nicknameCheckTimerRef.current) clearTimeout(nicknameCheckTimerRef.current)
    }
  }, [nicknameInput, savedNickname, address])

  // ── Join state ─────────────────────────────────────────────────────────────
  const [joiningId, setJoiningId] = useState<bigint | null>(null)

  // ── End Room state ─────────────────────────────────────────────────────────
  const [endingRoomId, setEndingRoomId] = useState<bigint | null>(null)

  // ── Detect if connected player is already in an active room ───────────────
  const myActiveRoom = useMemo<RoomRow | null>(() => {
    if (!address) return null
    const addrLower = address.toLowerCase()
    return rooms.find(
      r => r.status !== 'ended' &&
        (r.host.toLowerCase() === addrLower ||
         r.playerAddresses.some(p => p.toLowerCase() === addrLower))
    ) ?? null
  }, [rooms, address])

  // ── Faucet / balance state ─────────────────────────────────────────────────
  const [cusdBalance, setCusdBalance]           = useState<string | null>(null)
  const [nextClaimTimestamp, setNextClaimTimestamp] = useState<number>(0)
  const [claiming, setClaiming]                 = useState(false)

  // ── Derived faucet values ──────────────────────────────────────────────────
  const network     = (process.env.NEXT_PUBLIC_NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
  const faucetAddr  = process.env.NEXT_PUBLIC_FAUCET_ADDRESS as `0x${string}` | undefined
  const isTestnet   = chainId !== 42220
  const showFaucet  = network === 'testnet' && !!faucetAddr

  // ── Ticker ─────────────────────────────────────────────────────────────────
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // cooldown seconds remaining (0 = can claim now)
  const cooldownSecs = Math.max(0, nextClaimTimestamp - Math.floor(now / 1000))

  // ── Load faucet / cUSD balance ─────────────────────────────────────────────
  const loadFaucetInfo = useCallback(async () => {
    if (!isConnected || !address || !chainId) return
    const cUSDAddr = CUSD_ADDRESSES[chainId]
    if (!cUSDAddr) return
    try {
      const bal = await readCUSDBalance(address, cUSDAddr, chainId === 42220 ? 'mainnet' : 'testnet')
      setCusdBalance(formatCUSDBalance(bal))
    } catch { /* silently ignore */ }
    if (!faucetAddr || !showFaucet) return
    try {
      const fc   = createFaucetClient({ faucetAddress: faucetAddr, network: 'testnet' })
      const next = await fc.getNextClaimAt(address)
      setNextClaimTimestamp(Number(next))
    } catch { /* silently ignore */ }
  }, [isConnected, address, chainId, faucetAddr, showFaucet])

  useEffect(() => { loadFaucetInfo() }, [loadFaucetInfo])

  // ── Claim test cUSD ────────────────────────────────────────────────────────
  const handleClaim = async () => {
    if (!isConnected || !address || !faucetAddr) return
    // Ensure user is on Celo Sepolia before claiming
    const knownCeloChains = [42220, 44787, 11142220]
    if (chainId && !knownCeloChains.includes(chainId)) {
      try {
        await switchToCelo('testnet')
      } catch {
        toast.error('Please switch to Celo Sepolia to claim test tokens.')
        return
      }
    }
    const fc = createFaucetClient({ faucetAddress: faucetAddr, network: 'testnet' })
    setClaiming(true)
    try {
      await fc.claim(address)
      toast.success(claimSuccessMessage(true))
      await loadFaucetInfo()
    } catch (err) {
      toast.error(getFriendlyError(err))
    } finally {
      setClaiming(false)
    }
  }

  // ── Load own nickname on connect ──────────────────────────────────────────
  useEffect(() => {
    if (!address) return
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
    fetch(`${backendUrl}/api/players/${address}/nickname`)
      .then(r => r.json())
      .then((d: { nickname: string | null }) => {
        setSavedNickname(d.nickname)
        setNicknameInput(d.nickname ?? '')
        setEditingNickname(!d.nickname)
      })
      .catch(() => { /* silently ignore */ })
  }, [address])

  const handleSaveNickname = useCallback(async () => {
    if (!address) return
    const trimmed = nicknameInput.trim()
    if (!trimmed) return
    setSavingNickname(true)
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
      const res = await fetch(`${backendUrl}/api/players/nickname`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, nickname: trimmed }),
      })
      if (res.status === 409) {
        const data = await res.json() as { error: string }
        toast.error(data.error || 'This display name is already taken.')
        setNicknameAvailable(false)
        return
      }
      if (!res.ok) throw new Error('Failed to save')
      setSavedNickname(trimmed)
      setEditingNickname(false)
      setNicknameAvailable(null)
      toast.success(`Nickname saved: ${trimmed}`)
    } catch {
      toast.error('Could not save nickname. Try again.')
    } finally {
      setSavingNickname(false)
    }
  }, [address, nicknameInput])

  // ── Load room names after rooms load ────────────────────────────────────────
  const loadRooms = useCallback(async () => {
    const client = getContractClient()
    if (!client) {
      setRoomsError('Contract address not configured. Set NEXT_PUBLIC_CONTRACT_ADDRESS.')
      return
    }
    if (!hasLoadedOnceRef.current) setLoadingRooms(true)
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
            status:          ROOM_STATUS_MAP[Number(raw.status)] ?? 'ended',
            players:         raw.players?.length ?? 0,
            playerAddresses: (raw.players ?? []) as string[],
            maxPlayers:      Number(raw.config.maxPlayers),
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
      rows.sort(sortLobbyRooms)
      // Fetch room names from backend
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
      await Promise.all(rows.map(async row => {
        try {
          const r = await fetch(`${backendUrl}/api/rooms/${row.id.toString()}/name`)
          if (r.ok) {
            const d = await r.json() as { name: string | null }
            row.name = d.name
          }
        } catch { /* non-fatal */ }
      }))
      setRooms(rows)
    } catch (err) {
      setRoomsError(friendlyRoomsError(err))
    } finally {
      hasLoadedOnceRef.current = true
      setHasLoadedOnce(true)
      setLoadingRooms(false)
    }
  }, [])

  useEffect(() => { loadRooms() }, [loadRooms])

  useEffect(() => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
    const socket = io(backendUrl, { transports: ['websocket'] })

    const scheduleLobbyReload = () => {
      if (lobbyRefreshTimerRef.current) return
      lobbyRefreshTimerRef.current = setTimeout(() => {
        lobbyRefreshTimerRef.current = null
        void loadRooms()
      }, 300)
    }

    socket.on('rooms_refresh_requested', scheduleLobbyReload)

    return () => {
      socket.off('rooms_refresh_requested', scheduleLobbyReload)
      socket.disconnect()
      if (lobbyRefreshTimerRef.current) {
        clearTimeout(lobbyRefreshTimerRef.current)
        lobbyRefreshTimerRef.current = null
      }
    }
  }, [loadRooms])

  // ── Create / Join actions ──────────────────────────────────────────────────
  const pushToGame = useCallback((roomId: bigint) => {
    router.push(`/game?room=${roomId.toString()}`)
  }, [router])

  const handleCreateRoom = useCallback(async () => {
    if (myActiveRoom) {
      toast.error(`You are already in ${roomLabel(myActiveRoom)}. Leave or wait for it to end before creating a new one.`)
      return
    }
    await runCreateRoomAction({
      isConnected,
      address,
      chainId,
      connect,
      maxPlayers,
      stakeInput,
      roomNameInput,
      setCreating,
      loadRooms,
      pushToGame,
    })
  }, [isConnected, address, chainId, connect, maxPlayers, stakeInput, roomNameInput, loadRooms, pushToGame, myActiveRoom])

  const handleJoin = useCallback(async (room: RoomRow) => {
    // Already in this room — navigate back only if room hasn't expired
    if (myActiveRoom?.id === room.id) {
      if (myActiveRoom.status === 'waiting' && Date.now() >= myActiveRoom.expiresAt) {
        toast.error('This room has expired. End it before navigating to the game.')
        return
      }
      pushToGame(room.id)
      return
    }
    // In a different active room — block
    if (myActiveRoom) {
      toast.error(`You are already in ${roomLabel(myActiveRoom)}. You cannot join another room until that one ends.`)
      return
    }
    await runJoinRoomAction({
      room,
      isConnected,
      address,
      chainId,
      connect,
      setJoiningId,
      pushToGame,
    })
  }, [isConnected, address, chainId, connect, pushToGame, myActiveRoom])

  // ── End Room (any participant expires a timed-out waiting room; refunds all) ──
  const handleEndRoom = useCallback(async (room: RoomRow) => {
    if (!address) return
    const client = getContractClient()
    if (!client) return
    setEndingRoomId(room.id)
    try {
      await client.expireRoom(address, room.id)
      await loadRooms()
    } catch (err) {
      toast.error(getFriendlyError(err))
    } finally {
      setEndingRoomId(null)
    }
  }, [address, loadRooms])

  // ── Periodic room refresh (10 s) to catch state changes from other players ─
  useEffect(() => {
    const id = setInterval(() => {
      if (!navigator.onLine) return
      loadRooms()
    }, 10_000)
    return () => clearInterval(id)
  }, [loadRooms])

  const createBtnLabel = getCreateButtonLabel(isConnected, creating)

  return (
    <main className="min-h-screen" style={{ backgroundColor: '#060b06', color: '#d4c9b2', backgroundImage: 'url(/images/bg-lobby.webp)', backgroundSize: 'cover', backgroundPosition: 'center top', backgroundAttachment: 'fixed' }}>
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundColor: 'rgba(6,11,6,0.85)', zIndex: 0 }} />
      <div className="relative" style={{ zIndex: 1 }}>
      {/* Nav */}
      <div className="sticky top-0 z-50 px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="mx-auto w-full max-w-6xl">
          <SiteNav currentPath="/lobby" />
        </div>
      </div>

      {/* Header */}
      <header className="px-4 sm:px-6 py-8 sm:py-16">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 text-center">
          <span className="font-mono text-xs uppercase tracking-[0.3em]" style={{ color: '#6b8e23' }}>
            Game Lobby
          </span>
          <h1
            className="font-display text-3xl font-bold leading-none sm:text-6xl lg:text-8xl"
            style={{
              background: 'linear-gradient(135deg, #cc1414, #c8b89a)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            ACTIVE ROOMS
          </h1>
          <p className="max-w-xl font-body text-sm sm:text-lg" style={{ color: '#8fa882' }}>
            Pick a room, stake your {STABLE_TOKEN}, and get in before it locks. Once the match starts,
            no one else can join.
          </p>
        </div>
      </header>

      {/* Active game banner */}
      {myActiveRoom && myActiveRoom.status !== 'ended' && myActiveRoom.status !== 'waiting' && (
        <div className="px-6 pb-2">
          <div className="mx-auto w-full max-w-6xl">
            <div
              className="flex items-center justify-between gap-4 rounded-lg border px-5 py-4"
              style={{ backgroundColor: 'rgba(107,142,35,0.07)', borderColor: 'rgba(107,142,35,0.45)' }}
            >
              <div className="flex items-center gap-3">
                <span className="inline-block h-2 w-2 rounded-full bg-green-400" style={{ boxShadow: '0 0 6px #6b8e23' }} />
                <span className="font-mono text-sm" style={{ color: '#d4c9b2' }}>
                  You are in{' '}
                  <span style={{ color: '#6b8e23' }}>
                    {roomLabel(myActiveRoom)}
                  </span>
                  {' — '}
                  <span className="uppercase tracking-widest" style={{ color: '#4a5e44' }}>
                    {myActiveRoom.status}
                  </span>
                </span>
              </div>
              <button
                onClick={() => pushToGame(myActiveRoom.id)}
                className="rounded border px-4 py-2 font-mono text-xs font-bold uppercase tracking-widest transition-all hover:brightness-125 active:scale-95"
                style={{ borderColor: '#6b8e23', color: '#6b8e23', backgroundColor: 'rgba(107,142,35,0.1)' }}
              >
                Return to Game →
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="px-6 pb-20">
        <div className="mx-auto w-full max-w-6xl">
          <div className="grid gap-6 sm:gap-8 lg:grid-cols-[0.9fr_1.1fr]">

            {/* Left column: Create Room — order-2 on mobile so Join list appears first */}
            <div className="order-2 lg:order-1 flex flex-col gap-6">
              <article
                className="rise-in rounded-lg border p-5 sm:p-8"
                style={{ backgroundColor: '#0a100a', borderColor: 'rgba(107,142,35,0.3)' }}
              >
                <h2 className="font-heading text-2xl leading-none" style={{ color: '#d4c9b2' }}>
                  Create Room
                </h2>
                <div className="mt-6 space-y-4">
                  <div>
                    <label htmlFor="roomName" className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#4a5e44' }}>
                      Room Name <span style={{ color: '#4a5e44' }}>(optional)</span>
                    </label>
                    <input
                      id="roomName"
                      type="text"
                      maxLength={40}
                      placeholder="e.g. The Cursed Village"
                      value={roomNameInput}
                      onChange={e => setRoomNameInput(e.target.value)}
                      className="mt-2 w-full rounded-lg border bg-transparent px-4 py-3 font-mono text-sm focus:outline-none placeholder:opacity-30"
                      style={{ borderColor: 'rgba(107,142,35,0.4)', color: '#d4c9b2' }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="maxPlayers" className="block whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.04em]" style={{ color: '#4a5e44' }}>
                        Max Players <span style={{ color: '#2e4a2e' }}>(4–20)</span>
                      </label>
                      <input
                        id="maxPlayers"
                        type="number"
                        min={4}
                        max={20}
                        value={maxPlayers}
                        onChange={e => setMaxPlayers(Number(e.target.value))}
                        className="mt-2 w-full rounded-lg border bg-transparent px-4 py-3 font-mono text-sm focus:outline-none"
                        style={{ borderColor: 'rgba(107,142,35,0.4)', color: '#d4c9b2' }}
                      />
                    </div>
                    <div>
                      <label htmlFor="stakeInput" className="block whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.04em]" style={{ color: '#4a5e44' }}>
                        Stake <span style={{ color: '#2e4a2e' }}>(&gt; 0)</span>
                      </label>
                      <input
                        id="stakeInput"
                        type="number"
                        min={0.000000000000000001}
                        step={0.1}
                        placeholder="e.g. 0.5 USDm"
                        value={stakeInput}
                        onChange={e => setStakeInput(e.target.value)}
                        className="mt-2 w-full rounded-lg border bg-transparent px-4 py-3 font-mono text-sm focus:outline-none placeholder:opacity-40"
                        style={{ borderColor: 'rgba(107,142,35,0.4)', color: '#d4c9b2' }}
                      />
                    </div>
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#4a5e44' }}>
                    Shield fee: {formatToken(proofFeeWeiFor(stakeInput))} {STABLE_TOKEN} per extra Shield
                    {' '}(1% of stake, min {formatToken(MIN_PROOF_FEE_WEI)}). First Shield is free.
                  </p>

                  {myActiveRoom && (
                    <p className="font-mono text-xs" style={{ color: myActiveRoom.players >= myActiveRoom.maxPlayers ? '#6b8e23' : '#f5c518' }}>
                      {activeRoomNotice(myActiveRoom, now)}
                    </p>
                  )}

                  <button
                    onClick={handleCreateRoom}
                    disabled={creating || !!myActiveRoom}
                    className="w-full rounded-lg border py-3 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-50"
                    style={{ backgroundColor: '#cc1414', borderColor: '#cc1414', color: '#d4c9b2', boxShadow: '4px 4px 0px #6b8e23' }}
                  >
                    {createBtnLabel}
                  </button>
                </div>

                <div className="mt-6 grid grid-cols-3 gap-3">
                  {[
                    { label: 'Stake',   value: `${stakeInput} ${STABLE_TOKEN}` },
                    { label: 'Players', value: `${maxPlayers}` },
                    { label: 'Mode',    value: 'ZK' },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="rounded-lg border p-3 text-center"
                      style={{ borderColor: 'rgba(107,142,35,0.2)', backgroundColor: '#0e180d' }}
                    >
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#4a5e44' }}>
                        {s.label}
                      </p>
                      <p className="mt-2 font-heading text-xl leading-none" style={{ color: '#d4c9b2' }}>
                        {s.value}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              {/* Wallet status */}
              <article
                className="rise-in rounded-lg border p-6"
                style={{ backgroundColor: '#0a100a', borderColor: 'rgba(143,168,130,0.2)', animationDelay: '100ms' }}
              >
                <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#8fa882' }}>
                  Account
                </p>
                {isConnected && address ? (
                  <div className="mt-3 space-y-3">
                    <div className="space-y-1">
                      <p className="font-mono text-sm" style={{ color: '#d4c9b2' }}>
                        {savedNickname ?? `${address.slice(0, 10)}…${address.slice(-6)}`}
                      </p>
                      <p className="font-mono text-xs" style={{ color: '#84cc16' }}>
                        Connected · {chainId === 42220 ? 'Mainnet' : 'Celo Sepolia'}
                      </p>
                    </div>

                    {/* Nickname */}
                    <div className="space-y-1">
                      {!editingNickname ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#4a5e44' }}>Display Name</span>
                          <button
                            aria-label="Edit display name"
                            onClick={() => { setNicknameInput(savedNickname ?? ''); setEditingNickname(true) }}
                            className="rounded p-0.5 transition-opacity hover:opacity-70"
                            style={{ color: '#4a5e44', lineHeight: 1 }}
                          >
                            {/* pencil icon */}
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <>
                          <label htmlFor="nicknameInput" className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#4a5e44' }}>Display Name</label>
                          <div className="flex gap-2">
                            <input
                              id="nicknameInput"
                              type="text"
                              maxLength={20}
                              placeholder="Anonymous"
                              value={nicknameInput}
                              onChange={e => setNicknameInput(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && nicknameAvailable !== false && handleSaveNickname()}
                              autoFocus
                              className="min-w-0 flex-1 rounded border bg-transparent px-3 py-2 font-mono text-xs focus:outline-none placeholder:opacity-30"
                              style={{
                                borderColor: nicknameAvailable === false ? 'rgba(230,51,41,0.5)' : 'rgba(107,142,35,0.4)',
                                color: '#d4c9b2',
                              }}
                            />
                            <button
                              onClick={handleSaveNickname}
                              disabled={savingNickname || !nicknameInput.trim() || nicknameAvailable === false}
                              className="rounded border px-3 py-2 font-mono text-xs uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-40"
                              style={{ borderColor: 'rgba(107,142,35,0.4)', color: '#6b8e23' }}
                            >
                              {savingNickname ? '…' : 'Save'}
                            </button>
                            {savedNickname && (
                              <button
                                onClick={() => { setEditingNickname(false); setNicknameAvailable(null) }}
                                className="rounded border px-3 py-2 font-mono text-xs uppercase tracking-wider transition-all hover:opacity-90"
                                style={{ borderColor: 'rgba(212,201,178,0.2)', color: '#8fa882' }}
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                          {/* Availability feedback */}
                          {nicknameInput.trim() && nicknameInput.trim() !== savedNickname && (
                            <p className="mt-1 font-mono text-[10px]" style={{
                              color: checkingNickname ? '#4a5e44' : nicknameAvailable === true ? '#6b8e23' : nicknameAvailable === false ? '#e63329' : '#4a5e44',
                            }}>
                              {checkingNickname ? 'Checking…' : nicknameAvailable === true ? '✓ Available' : nicknameAvailable === false ? '✗ Already taken' : ''}
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    <div className="rounded border px-3 py-2" style={{ borderColor: 'rgba(107,142,35,0.15)', backgroundColor: '#0e180d' }}>
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#4a5e44' }}>{STABLE_TOKEN} Balance</p>
                      <p className="mt-1 font-mono text-base" style={{ color: cusdBalance ? '#84cc16' : '#4a5e44' }}>
                        {cusdBalance ? `${cusdBalance} ${STABLE_TOKEN}` : '…'}
                      </p>
                    </div>

                    {/* Testnet faucet */}
                    {showFaucet && isTestnet && (
                      <div className="space-y-2">
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#4a5e44' }}>Test Faucet</p>
                        <div className="rounded border px-3 py-2" style={{ borderColor: 'rgba(245,197,24,0.25)', backgroundColor: 'rgba(245,197,24,0.06)' }}>
                          <p className="font-mono text-[11px]" style={{ color: '#f5c518' }}>
                            Step 1: Get CELO gas first, then claim USDm here.
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <a
                              href="https://faucet.celo.org/celo-sepolia"
                              target="_blank"
                              rel="noreferrer"
                              className="rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider"
                              style={{ borderColor: 'rgba(245,197,24,0.35)', color: '#f5c518' }}
                            >
                              Celo Faucet
                            </a>
                            <a
                              href="https://cloud.google.com/application/web3/faucet/celo/sepolia"
                              target="_blank"
                              rel="noreferrer"
                              className="rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider"
                              style={{ borderColor: 'rgba(245,197,24,0.35)', color: '#f5c518' }}
                            >
                              Google Faucet
                            </a>
                          </div>
                        </div>
                        {cooldownSecs > 0 ? (
                          <div className="flex items-center justify-between rounded border px-3 py-2" style={{ borderColor: 'rgba(143,168,130,0.2)', backgroundColor: '#0e180d' }}>
                            <p className="font-mono text-xs" style={{ color: '#4a5e44' }}>Next claim in</p>
                            <p className="font-mono text-sm tabular-nums" style={{ color: '#8fa882' }}>{formatCountdown(cooldownSecs)}</p>
                          </div>
                        ) : (
                          <button
                            onClick={handleClaim}
                            disabled={claiming}
                            className="w-full rounded border py-2 font-mono text-xs font-bold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-50"
                            style={{ borderColor: 'rgba(107,142,35,0.45)', color: '#6b8e23', backgroundColor: 'rgba(107,142,35,0.06)' }}
                          >
                            {claiming ? 'Claiming…' : 'Claim 50 test USDm'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    <button
                      onClick={connect}
                      className="w-full rounded-lg border py-2 font-mono text-sm uppercase tracking-wider transition-all hover:opacity-90"
                      style={{ borderColor: 'rgba(107,142,35,0.5)', color: '#6b8e23' }}
                    >
                      Play Now
                    </button>
                    <button
                      onClick={() => router.push('/demo')}
                      className="w-full rounded-lg py-2 font-mono text-xs uppercase tracking-wider transition-all hover:opacity-80"
                      style={{ color: '#4a5e44' }}
                    >
                      or try the free demo — no sign-in →
                    </button>
                  </div>
                )}
              </article>
            </div>

            {/* Right column: Room List — order-1 on mobile so it appears first */}
            <article
              className="order-1 lg:order-2 rise-in rounded-lg border p-4 sm:p-6"
              style={{ backgroundColor: '#0a100a', borderColor: 'rgba(107,142,35,0.2)', animationDelay: '80ms' }}
            >
              <div className="flex items-end justify-between gap-4">
                <h2 className="font-heading text-2xl leading-none" style={{ color: '#d4c9b2' }}>
                  Join Existing
                </h2>
                <div className="flex items-center gap-3">
                  <span
                    className="rounded-full border px-3 py-1 font-mono text-xs"
                    style={{ borderColor: 'rgba(107,142,35,0.3)', color: '#6b8e23' }}
                  >
                    {`${rooms.filter(r => isVisibleRoom(r, now, myActiveRoom?.id ?? null)).length} rooms`}
                    {loadingRooms && hasLoadedOnce && (
                      <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full animate-pulse align-middle" style={{ backgroundColor: '#6b8e23' }} />
                    )}
                  </span>
                  <button
                    onClick={loadRooms}
                    disabled={loadingRooms}
                    className="rounded border px-3 py-1 font-mono text-xs uppercase tracking-wider transition-all hover:opacity-80 disabled:opacity-40"
                    style={{ borderColor: 'rgba(107,142,35,0.3)', color: '#6b8e23' }}
                  >
                    ↺
                  </button>
                </div>
              </div>

              {/* Discoverability: most visitors won't realize they can play solo. */}
              <div
                className="mt-3 rounded border px-3 py-2 font-mono text-[11px] leading-relaxed"
                style={{ borderColor: 'rgba(107,142,35,0.25)', backgroundColor: 'rgba(107,142,35,0.06)', color: '#8fa882' }}
              >
                🤖 Want to try it solo? <span style={{ color: '#d4c9b2' }}>Create a room</span> and add bots to fill the seats — no other players needed.
              </div>

              {roomsError && (
                <div
                  className="mt-4 flex items-center gap-2 rounded border px-3 py-2 font-mono text-xs"
                  style={{ borderColor: 'rgba(245,197,24,0.35)', backgroundColor: 'rgba(245,197,24,0.08)', color: '#f5c518' }}
                >
                  <span>{roomsError}</span>
                </div>
              )}

              {loadingRooms && rooms.length === 0 && (
                <p className="mt-6 text-center font-mono text-xs" style={{ color: '#4a5e44' }}>
                  Loading rooms from chain…
                </p>
              )}

              {!loadingRooms && rooms.filter(r => isVisibleRoom(r, now, myActiveRoom?.id ?? null)).length === 0 && !roomsError && (
                <p className="mt-6 text-center font-mono text-xs" style={{ color: '#4a5e44' }}>
                  No open rooms yet — create one and add bots to play instantly.
                </p>
              )}

              <ul className="mt-6 space-y-4 max-h-[320px] sm:max-h-[480px] overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                <AnimatePresence mode="popLayout">
                  {rooms
                    .filter(r => isVisibleRoom(r, now, myActiveRoom?.id ?? null))
                    .map((room, i) => (
                      <RoomCard
                        key={room.id.toString()}
                        room={room}
                        index={i}
                        now={now}
                        address={address}
                        myActiveRoom={myActiveRoom}
                        joiningId={joiningId}
                        endingRoomId={endingRoomId}
                        onJoin={handleJoin}
                        onEnd={handleEndRoom}
                      />
                    ))}
                </AnimatePresence>
              </ul>
            </article>
          </div>
        </div>
      </div>
      </div>
    </main>
  )
}

