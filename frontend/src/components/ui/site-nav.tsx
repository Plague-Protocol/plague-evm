'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ConnectButton } from './connect-button'
import { MuteButton } from './mute-button'

const navItems = [
  { href: '/', label: 'Home' },
  { href: '/lobby', label: 'Lobby' },
  { href: '/game', label: 'Match' },
  { href: '/how-to-play', label: 'Rules' },
  { href: '/leaderboard', label: 'Leaderboard' },
] as const

type SiteNavProps = {
  currentPath: string
}

export function SiteNav({ currentPath }: SiteNavProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="rise-in relative">
      <header
        className="flex items-center justify-between gap-4 rounded-xl border px-5 py-3 backdrop-blur"
        style={{ borderColor: 'rgba(57,255,20,0.15)', backgroundColor: 'rgba(6,11,6,0.92)' }}
      >
        {/* Logo */}
        <Link href="/" className="flex flex-shrink-0 items-center gap-3" onClick={() => setMenuOpen(false)}>
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg font-display text-xl"
            style={{ background: 'linear-gradient(135deg, #39ff14, #cc1414)', color: '#060b06' }}
          >
            P
          </div>
          <div className="hidden sm:block">
            <p className="font-display text-xl leading-none" style={{ color: '#d4c9b2' }}>PlagueProtocol</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.22em]" style={{ color: '#4a5e44' }}>
              social deduction on celo
            </p>
          </div>
        </Link>

        {/* Nav links — desktop only */}
        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => {
            const isActive = currentPath === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-lg px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider transition-all duration-150"
                style={
                  isActive
                    ? { backgroundColor: 'rgba(57,255,20,0.1)', color: '#39ff14', border: '1px solid rgba(57,255,20,0.35)' }
                    : { backgroundColor: 'transparent', color: '#4a5e44', border: '1px solid transparent' }
                }
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Right: Sound + Wallet (desktop) + Hamburger (mobile) */}
        <div className="flex items-center gap-2">
          <MuteButton />
          <div className="hidden md:block">
            <ConnectButton />
          </div>
          {/* Hamburger button — mobile only */}
          <button
            className="flex h-9 w-9 flex-col items-center justify-center gap-1.5 rounded-lg border md:hidden"
            style={{ borderColor: 'rgba(57,255,20,0.25)', backgroundColor: menuOpen ? 'rgba(57,255,20,0.08)' : 'transparent' }}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            <span
              className="h-0.5 w-5 rounded-full transition-all"
              style={{
                backgroundColor: '#39ff14',
                transform: menuOpen ? 'translateY(8px) rotate(45deg)' : 'none',
              }}
            />
            <span
              className="h-0.5 w-5 rounded-full transition-all"
              style={{
                backgroundColor: '#39ff14',
                opacity: menuOpen ? 0 : 1,
              }}
            />
            <span
              className="h-0.5 w-5 rounded-full transition-all"
              style={{
                backgroundColor: '#39ff14',
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
          style={{ borderColor: 'rgba(57,255,20,0.2)', backgroundColor: 'rgba(6,11,6,0.97)' }}
        >
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive = currentPath === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-4 py-3 font-mono text-sm font-bold uppercase tracking-wider transition-all"
                  style={
                    isActive
                      ? { backgroundColor: 'rgba(57,255,20,0.1)', color: '#39ff14', border: '1px solid rgba(57,255,20,0.35)' }
                      : { color: '#8fa882', border: '1px solid transparent' }
                  }
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
          <div className="mt-3 border-t pt-3" style={{ borderColor: 'rgba(57,255,20,0.15)' }}>
            <ConnectButton />
          </div>
        </div>
      )}
    </div>
  )
}

