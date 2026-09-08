'use client'

/**
 * PlayerCard + PlayersGrid — the Area 51 containment board, animated.
 *
 * PlayerCard is purely presentational and shared by the real game page and
 * the demo. PlayersGrid adapts the on-chain Player shape and adds:
 *  - staggered entrance
 *  - layout animation on reflow
 *  - a one-shot "elimination" shake + persistent ☠ stamp when a player's
 *    isEliminated flips to true mid-game (public info only — infection
 *    status is never animated for other players; `visibleStatus` hides it).
 *  - the round-opening containment sweep: a seat-by-seat "contact trace" that
 *    every client plays in the same order at the same moment.
 *
 * 🚨 The sweep is driven by SEAT INDEX and a (roomId, round) seed — never by
 * player status. See lib/containment-sweep.ts for why that matters: this file
 * receives real infection status and redacts it in `visibleStatus`, so an
 * animation keyed to the truth would route straight around that redaction and
 * show the whole table who is infected. The sweep is theatre; the only honest
 * infection signal is the private MomentOverlay on the game page.
 */

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useAgentAddresses } from '@/hooks/useAgentIds'
import { seatStatesAt, stepMs, sweepDurationMs, type SeatScanState } from '@/lib/containment-sweep'

// ── Presentational card ───────────────────────────────────────────────────────

export interface PlayerCardProps {
  readonly name: string
  readonly style: { border: string; backgroundColor: string; color: string }
  readonly isMe?: boolean
  readonly selected?: boolean
  readonly eliminated?: boolean
  /** Fires the one-shot elimination animation. */
  readonly justEliminated?: boolean
  /** Shows the "my vote" ⚖ stamp (local player's own vote — public once cast). */
  readonly votedByMe?: boolean
  readonly clickable?: boolean
  readonly onClick?: () => void
  readonly title?: string
  readonly index?: number
  /** True when this player holds an ERC-8004 on-chain agent identity. */
  readonly isAgent?: boolean
  /** Containment-sweep state for this SEAT. Carries no player information —
   *  see the safety note at the top of this file. */
  readonly scanState?: SeatScanState
  readonly children?: React.ReactNode
}

export function PlayerCard({
  name, style, isMe = false, selected = false, eliminated = false,
  justEliminated = false, votedByMe = false, clickable = false, onClick, title, index = 0,
  isAgent = false, scanState = 'idle', children,
}: PlayerCardProps) {
  const reduced = useReducedMotion()

  let boxShadow: string | undefined
  if (isMe) boxShadow = '0 0 0 2px #6b8e23, 0 0 12px rgba(107,142,35,0.35)'
  else if (selected) boxShadow = '0 0 0 2px #f5c518'

  return (
    <motion.button
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: 14 }}
      animate={
        justEliminated && !reduced
          ? { opacity: 1, y: 0, x: [0, -6, 6, -4, 4, 0], scale: [1, 1.06, 0.97, 1] }
          : { opacity: eliminated ? 0.75 : 1, y: 0, x: 0, scale: 1 }
      }
      transition={
        justEliminated && !reduced
          ? { duration: 0.55, ease: 'easeOut' }
          : { duration: 0.35, delay: reduced ? 0 : Math.min(index * 0.05, 0.4), ease: 'easeOut' }
      }
      whileHover={clickable && !reduced ? { scale: 1.04 } : undefined}
      whileTap={clickable && !reduced ? { scale: 0.96 } : undefined}
      onClick={onClick}
      title={title ?? name}
      className="relative rounded-lg px-2 py-3 font-mono text-sm font-bold uppercase tracking-widest"
      style={{
        ...style,
        boxShadow,
        cursor: clickable ? 'pointer' : 'default',
        filter: eliminated ? 'saturate(0.4)' : undefined,
      }}
    >
      <span className="block truncate font-heading text-base">{name}</span>
      {/* Registered on-chain agent. A span rather than a link because this card
          is already a button and nesting interactive elements is invalid — the
          id is shown in full so it can be looked up on 8004scan directly. */}
      {isAgent && (
        <span
          className="mt-0.5 block truncate font-mono text-[9px] normal-case tracking-normal"
          style={{ color: 'var(--accent-toxic)' }}
          title="Autonomous agent — holds an ERC-8004 identity on Celo"
        >
          ⬡ agent
        </span>
      )}
      {children}
      {/* "My vote" stamp — slams in when the local player's cast vote lands */}
      <AnimatePresence>
        {votedByMe && !eliminated && (
          <motion.span
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 2.8, rotate: 16 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: 8 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 17 }}
            className="pointer-events-none absolute -left-1.5 -top-2 text-lg leading-none"
            style={{ color: '#f5c518', textShadow: '0 0 10px rgba(245,197,24,0.8)' }}
            aria-label="your vote"
          >
            ⚖
          </motion.span>
        )}
      </AnimatePresence>
      {/* Containment sweep — a scan bar wipes the seat, then the seat settles
          to a brief "traced" tint. Index-driven theatre: see the file header.
          Transform/opacity only, so it stays on the compositor thread. */}
      <AnimatePresence>
        {scanState === 'scanning' && !reduced && (
          <motion.span
            key="scan"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.18 } }}
          >
            <motion.span
              className="absolute inset-x-0 h-1/2"
              style={{
                background: 'linear-gradient(180deg, transparent, rgba(107,142,35,0.55), transparent)',
                boxShadow: '0 0 18px rgba(107,142,35,0.8)',
              }}
              initial={{ y: '-100%' }}
              animate={{ y: '200%' }}
              transition={{ duration: 0.34, ease: 'linear' }}
            />
          </motion.span>
        )}
      </AnimatePresence>
      {/* Post-scan tint — fades on its own so the board returns to normal. */}
      <AnimatePresence>
        {scanState === 'cleared' && !reduced && (
          <motion.span
            key="traced"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-lg"
            style={{ boxShadow: 'inset 0 0 0 1px rgba(107,142,35,0.5)' }}
            initial={{ opacity: 0.9 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
      {/* Persistent skull stamp on eliminated cards */}
      <AnimatePresence>
        {eliminated && (
          <motion.span
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 2.6, rotate: -20 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: -12 }}
            transition={{ type: 'spring', stiffness: 380, damping: 16, delay: justEliminated ? 0.3 : 0 }}
            className="pointer-events-none absolute -right-1.5 -top-2 text-lg leading-none"
            style={{ color: '#e63329', textShadow: '0 0 10px rgba(230,51,41,0.8)' }}
            aria-label="eliminated"
          >
            ☠
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  )
}

// ── Game-page grid adapter ────────────────────────────────────────────────────

interface GridPlayer {
  walletAddress: string
  displayName: string
  status: string
  isEliminated: boolean
}

function playerStyle(status: string): { border: string; backgroundColor: string; color: string } {
  if (status === 'infected')   return { border: '2px solid #e63329', backgroundColor: 'rgba(230,51,41,0.15)', color: '#ff6b6b' }
  if (status === 'eliminated') return { border: '2px solid #7d9a72', backgroundColor: 'rgba(74,94,68,0.12)', color: '#7d9a72' }
  return { border: '2px solid #6b8e23', backgroundColor: 'rgba(107,142,35,0.08)', color: '#6b8e23' }
}

/** Only reveal 'infected' styling to the player themselves — hide it from others. */
function visibleStatus(p: GridPlayer, localAddress: string | null | undefined): string {
  if (p.status === 'infected' && p.walletAddress.toLowerCase() !== (localAddress ?? '').toLowerCase()) {
    return 'clean'
  }
  return p.status
}

/**
 * Drives the containment sweep off a shared wall-clock anchor.
 *
 * Ticks on an interval of one seat-step (never rAF): the visual only changes
 * when the cursor moves to the next seat, so a 60 fps loop would re-render the
 * whole board ~10x per useful frame for nothing. The moving scan bar inside
 * each card is a CSS/compositor animation, so it stays smooth regardless.
 *
 * `anchor` is the chain's phaseStartedAt, identical on every client — which is
 * what makes the beat land together on every screen with zero extra socket
 * traffic.
 *
 * Exported because /demo renders PlayerCard directly rather than through this
 * grid, and a second copy of the timing rules is a second place for them to be
 * wrong.
 */
export function useContainmentSweep(seatCount: number, seed: string | null, anchor: number): SeatScanState[] {
  const reduced = useReducedMotion()
  const [states, setStates] = useState<SeatScanState[]>([])

  useEffect(() => {
    if (reduced || !seed || seatCount <= 0 || anchor <= 0) { setStates([]); return }
    const total = sweepDurationMs(seatCount)
    // A late joiner (or a refresh) mid-beat picks the sweep up where the rest of
    // the table already is rather than restarting it, and someone arriving after
    // it finished sees nothing at all.
    if (Date.now() - anchor > total) { setStates([]); return }

    let cancelled = false
    let id: ReturnType<typeof setInterval> | null = null
    // Last state we pushed, as a comparable key. Without this the interval hands
    // React a freshly-allocated array on every tick — a new reference, so the
    // whole board re-renders even when not a single seat changed.
    let lastKey = ''

    const push = (next: SeatScanState[]) => {
      const key = next.join(',')
      if (key === lastKey) return
      lastKey = key
      setStates(next)
    }

    const apply = () => {
      if (cancelled) return
      const elapsed = Date.now() - anchor
      if (elapsed > total) {
        // Beat over — release the board AND stop the timer. Leaving it running
        // meant that once a sweep finished, this kept ticking for as long as the
        // seed stayed set, re-rendering the grid forever at interval rate. The
        // live game hid it (the seed is latched, then nulled); /demo did not.
        if (id) { clearInterval(id); id = null }
        push([])
        return
      }
      push(seatStatesAt(seatCount, seed, elapsed))
    }

    apply()
    id = setInterval(apply, Math.max(60, Math.floor(stepMs(seatCount) / 2)))
    return () => { cancelled = true; if (id) clearInterval(id) }
  }, [seatCount, seed, anchor, reduced])

  return states
}

export interface PlayersGridProps {
  readonly players: readonly GridPlayer[]
  readonly localAddress: string | null | undefined
  readonly canVote: boolean
  readonly selectedVote: string | null
  /** Address the local player has already voted for this round (shows ⚖ stamp). */
  readonly myVotedTarget?: string | null
  /** `${roomId}:${round}` while the round-opening sweep should run; null otherwise.
   *  Never pass anything derived from player status. */
  readonly sweepSeed?: string | null
  /** Chain phaseStartedAt (ms) the sweep is anchored to — shared by all clients. */
  readonly sweepAnchor?: number
  readonly onToggleVote: (walletAddress: string) => void
}

export function PlayersGrid({
  players, localAddress, canVote, selectedVote, myVotedTarget,
  sweepSeed = null, sweepAnchor = 0, onToggleVote,
}: PlayersGridProps) {
  // Track eliminations that happen while mounted so we can fire the one-shot
  // animation only for NEW eliminations (not players already dead on load).
  const prevEliminatedRef = useRef<Set<string> | null>(null)
  const [justEliminated, setJustEliminated] = useState<Set<string>>(new Set())

  useEffect(() => {
    const nowEliminated = new Set(players.filter(p => p.isEliminated).map(p => p.walletAddress.toLowerCase()))
    if (prevEliminatedRef.current === null) {
      prevEliminatedRef.current = nowEliminated // baseline on first render
      return
    }
    const fresh = [...nowEliminated].filter(a => !prevEliminatedRef.current!.has(a))
    prevEliminatedRef.current = nowEliminated
    if (fresh.length === 0) return
    setJustEliminated(prev => new Set([...prev, ...fresh]))
    const t = setTimeout(() => {
      setJustEliminated(prev => {
        const next = new Set(prev)
        for (const a of fresh) next.delete(a)
        return next
      })
    }, 1_600)
    return () => clearTimeout(t)
  }, [players])

  // Resolved from the ERC-8004 registry, so the badge below is a claim anyone
  // can check on 8004scan rather than one this app is asserting.
  const agentAddrs = useAgentAddresses(players.map(p => p.walletAddress))

  // Seat-index-keyed, status-blind. See the safety note at the top of the file.
  const scanStates = useContainmentSweep(players.length, sweepSeed, sweepAnchor)

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {players.map((p, i) => {
        const isMe = p.walletAddress.toLowerCase() === (localAddress ?? '').toLowerCase()
        const addrLower = p.walletAddress.toLowerCase()
        return (
          <PlayerCard
            key={p.walletAddress}
            index={i}
            name={p.displayName}
            title={isMe ? `${p.displayName} (You)` : p.displayName}
            style={playerStyle(visibleStatus(p, localAddress))}
            isMe={isMe}
            selected={selectedVote === p.walletAddress}
            eliminated={p.isEliminated}
            justEliminated={justEliminated.has(addrLower)}
            votedByMe={(myVotedTarget ?? '').toLowerCase() === addrLower}
            clickable={canVote && !p.isEliminated}
            isAgent={agentAddrs.has(addrLower)}
            scanState={scanStates[i] ?? 'idle'}
            onClick={() => canVote && onToggleVote(p.walletAddress)}
          />
        )
      })}
    </div>
  )
}
