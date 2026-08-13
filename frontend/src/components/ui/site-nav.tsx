'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { ConnectButton } from './connect-button'
import { MuteButton } from './mute-button'
import { OnlineCount } from './online-count'
import { PlayerNameChip } from './player-name-chip'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import { useLiveMatches } from '@/hooks/useLiveMatches'

const navItems = [
  { href: '/', label: 'Home' },
  { href: '/lobby', label: 'Lobby' },
  { href: '/game', label: 'Arena' },
  { href: '/how-to-play', label: 'Rules' },
  { href: '/leaderboard', label: 'Leaderboard' },
] as const

type SiteNavProps = {
  currentPath: string
}

/**
 * Pulse on the Arena tab while a game is being played.
 *
 * Without it there is no way to tell from any other page that something is
 * happening — a visitor has to open the lobby and look.
 *
 * Two strengths, because they mean different things. Amber: somebody is
 * playing, come and watch. Red: *your* room is live and you are not in it,
 * which is the one that actually costs the player something — a host who
 * created a room and wandered off has nothing else telling them it started.
 */
function LiveDot({ mine }: { readonly mine: boolean }) {
  const color = mine ? '#e63329' : '#f5c518'
  return (
    <span className="relative ml-1.5 inline-flex h-1.5 w-1.5 align-middle" aria-hidden>
      <span
        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
        style={{ backgroundColor: color, animationDuration: mine ? '1.1s' : '2s' }}
      />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
    </span>
  )
}

export function SiteNav({ currentPath }: SiteNavProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const isAdmin = useIsAdmin()
  const { count: liveMatches, mine: myLiveRoom } = useLiveMatches()

  // Suppressed on /game itself: you are already looking at the arena, and a
  // "your match is live" nudge pointing at the page you are on is noise.
  const showLive = liveMatches > 0 && currentPath !== '/game'
  const liveTitle = myLiveRoom
    ? 'Your match is live — jump back in'
    : `${liveMatches} match${liveMatches === 1 ? '' : 'es'} in progress`
  // The Ops console only appears for the contract admin's wallet.
  const items = [
    ...navItems,
    ...(isAdmin ? ([{ href: '/admin', label: 'Ops' }] as const) : []),
  ]

  return (
    <div className="rise-in relative" style={{ isolation: 'isolate', zIndex: 50 }}>
      <header
        className="flex items-center justify-between gap-4 rounded-xl border px-5 py-3 backdrop-blur"
        style={{ borderColor: 'rgba(107,142,35,0.15)', backgroundColor: 'rgba(6,11,6,0.92)' }}
      >
        {/* Logo */}
        <Link href="/" className="flex flex-shrink-0 items-center gap-3" onClick={() => setMenuOpen(false)}>
          <Image
            src="/z-plague-image.png"
            alt="Zombie Plague"
            width={36}
            height={36}
            className="rounded-lg"
          />
          <div>
            <p className="font-display text-base sm:text-xl leading-none" style={{ color: '#d4c9b2' }}>Zombie Plague</p>
            <p className="hidden sm:block font-mono text-[9px] uppercase tracking-[0.22em]" style={{ color: '#7d9a72' }}>
              social deduction on celo
            </p>
          </div>
        </Link>

        {/* Nav links — desktop only */}
        <nav className="hidden items-center gap-1 md:flex">
          {items.map((item) => {
            const isActive = currentPath === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-lg px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider transition-all duration-150"
                style={
                  isActive
                    ? { backgroundColor: 'rgba(107,142,35,0.1)', color: '#6b8e23', border: '1px solid rgba(107,142,35,0.35)' }
                    : { backgroundColor: 'transparent', color: '#7d9a72', border: '1px solid transparent' }
                }
                title={item.href === '/game' && showLive ? liveTitle : undefined}
              >
                {item.label}
                {item.href === '/game' && showLive && <LiveDot mine={!!myLiveRoom} />}
              </Link>
            )
          })}
        </nav>

        {/* Right: Presence + Sound + Wallet (desktop) + Hamburger (mobile) */}
        <div className="flex items-center gap-2">
          <span className="hidden sm:block"><OnlineCount /></span>
          <MuteButton />
          <div className="hidden md:block" style={{ position: 'relative', zIndex: 110 }}>
            <PlayerNameChip />
          </div>
          <div className="hidden md:block" style={{ position: 'relative', zIndex: 100 }}>
            <ConnectButton />
          </div>
          {/* Hamburger button — mobile only */}
          <button
            className="flex h-9 w-9 flex-col items-center justify-center gap-1.5 rounded-lg border md:hidden"
            style={{ borderColor: 'rgba(107,142,35,0.25)', backgroundColor: menuOpen ? 'rgba(107,142,35,0.08)' : 'transparent' }}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            <span
              className="h-0.5 w-5 rounded-full transition-all"
              style={{
                backgroundColor: '#6b8e23',
                transform: menuOpen ? 'translateY(8px) rotate(45deg)' : 'none',
              }}
            />
            <span
              className="h-0.5 w-5 rounded-full transition-all"
              style={{
                backgroundColor: '#6b8e23',
                opacity: menuOpen ? 0 : 1,
              }}
            />
            <span
              className="h-0.5 w-5 rounded-full transition-all"
              style={{
                backgroundColor: '#6b8e23',
                transform: menuOpen ? 'translateY(-8px) rotate(-45deg)' : 'none',
              }}
            />
          </button>
        </div>
      </header>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border p-4 backdrop-blur md:hidden"
          style={{ borderColor: 'rgba(107,142,35,0.2)', backgroundColor: 'rgba(6,11,6,0.97)' }}
        >
          <nav className="flex flex-col gap-1">
            {items.map((item) => {
              const isActive = currentPath === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-4 py-3 font-mono text-sm font-bold uppercase tracking-wider transition-all"
                  style={
                    isActive
                      ? { backgroundColor: 'rgba(107,142,35,0.1)', color: '#6b8e23', border: '1px solid rgba(107,142,35,0.35)' }
                      : { color: '#8fa882', border: '1px solid transparent' }
                  }
                >
                  {item.label}
                  {item.href === '/game' && showLive && <LiveDot mine={!!myLiveRoom} />}
                </Link>
              )
            })}
          </nav>
          <div className="mt-3 border-t pt-3" style={{ borderColor: 'rgba(107,142,35,0.15)' }}>
            <PlayerNameChip inline />
            <div className="mt-3 flex items-center justify-between gap-3">
              {/* Left-most item in the panel → the dropdown must open rightward. */}
              <ConnectButton align="left" />
              <OnlineCount />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

