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
 */

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

// ── Presentational card ───────────────────────────────────────────────────────

export interface PlayerCardProps {
  readonly name: string
  readonly style: { border: string; backgroundColor: string; color: string }
  readonly isMe?: boolean
  readonly selected?: boolean
  readonly eliminated?: boolean
  /** Fires the one-shot elimination animation. */
  readonly justEliminated?: boolean
  readonly clickable?: boolean
  readonly onClick?: () => void
  readonly title?: string
  readonly index?: number
  readonly children?: React.ReactNode
}

export function PlayerCard({
  name, style, isMe = false, selected = false, eliminated = false,
  justEliminated = false, clickable = false, onClick, title, index = 0, children,
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
      <span className="block truncate font-display text-base font-normal tracking-wide">{name}</span>
      {children}
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
  if (status === 'eliminated') return { border: '2px solid #4a5e44', backgroundColor: 'rgba(74,94,68,0.12)', color: '#4a5e44' }
  return { border: '2px solid #6b8e23', backgroundColor: 'rgba(107,142,35,0.08)', color: '#6b8e23' }
}

/** Only reveal 'infected' styling to the player themselves — hide it from others. */
function visibleStatus(p: GridPlayer, localAddress: string | null | undefined): string {
  if (p.status === 'infected' && p.walletAddress.toLowerCase() !== (localAddress ?? '').toLowerCase()) {
    return 'clean'
  }
  return p.status
}

export interface PlayersGridProps {
  readonly players: readonly GridPlayer[]
  readonly localAddress: string | null | undefined
  readonly canVote: boolean
  readonly selectedVote: string | null
  readonly onToggleVote: (walletAddress: string) => void
}

export function PlayersGrid({ players, localAddress, canVote, selectedVote, onToggleVote }: PlayersGridProps) {
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
            clickable={canVote && !p.isEliminated}
            onClick={() => canVote && onToggleVote(p.walletAddress)}
          />
        )
      })}
    </div>
  )
}
