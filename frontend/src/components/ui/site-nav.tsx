import Link from 'next/link'
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
  return (
    <header
      className="rise-in flex items-center justify-between gap-4 rounded-xl border px-5 py-3 backdrop-blur"
      style={{ borderColor: 'rgba(57,255,20,0.15)', backgroundColor: 'rgba(6,11,6,0.92)' }}
    >
      {/* Logo */}
      <Link href="/" className="flex flex-shrink-0 items-center gap-3">
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

      {/* Nav links — centered */}
      <nav className="flex items-center gap-1">
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

      {/* Sound + Wallet */}
      <div className="flex items-center gap-2">
        <MuteButton />
        <ConnectButton />
      </div>
    </header>
  )
}

