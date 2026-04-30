import Link from 'next/link'

const navItems = [
  { href: '/', label: 'Home' },
  { href: '/lobby', label: 'Lobby' },
  { href: '/game', label: 'Match' },
  { href: '/leaderboard', label: 'Leaderboard' },
] as const

type SiteNavProps = {
  currentPath: string
}

export function SiteNav({ currentPath }: SiteNavProps) {
  return (
    <header
      className="rise-in flex items-center justify-between gap-4 rounded-xl border px-5 py-3 backdrop-blur"
      style={{ borderColor: 'rgba(168,85,247,0.25)', backgroundColor: 'rgba(22,27,53,0.85)' }}
    >
      {/* Logo */}
      <Link href="/" className="flex flex-shrink-0 items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg font-display text-xl"
          style={{ background: 'linear-gradient(135deg, #a855f7, #e63329)', color: '#f0f4f8' }}
        >
          P
        </div>
        <div className="hidden sm:block">
          <p className="font-display text-xl leading-none" style={{ color: '#f0f4f8' }}>PlagueProtocol</p>
          <p className="font-mono text-[9px] uppercase tracking-[0.22em]" style={{ color: '#7a8592' }}>
            social deduction on stellar
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
                  ? { backgroundColor: 'rgba(168,85,247,0.2)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.5)' }
                  : { backgroundColor: 'transparent', color: '#7a8592', border: '1px solid transparent' }
              }
            >
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Wallet button */}
      <button
        className="flex-shrink-0 whitespace-nowrap rounded-lg px-4 py-1.5 font-mono text-xs font-bold uppercase tracking-wider transition-all duration-150 hover:opacity-90"
        style={{
          background: 'linear-gradient(135deg, #a855f7, #06b6d4)',
          color: '#f0f4f8',
          boxShadow: '0 0 12px rgba(168,85,247,0.4)',
        }}
      >
        Connect Wallet
      </button>
    </header>
  )
}

