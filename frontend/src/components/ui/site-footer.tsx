import Link from 'next/link'
import type { Route } from 'next'

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? ''
const IS_TESTNET = process.env.NEXT_PUBLIC_NETWORK === 'testnet'
const EXPLORER_BASE = IS_TESTNET
  ? 'https://celo-sepolia.blockscout.com'
  : 'https://celo.blockscout.com'

type FooterLink =
  | { href: Route; label: string; external?: false }
  | { href: string; label: string; external: true }

const columns: { heading: string; links: FooterLink[] }[] = [
  {
    heading: 'The Outbreak',
    links: [
      { href: '/lobby',       label: 'Lobby' },
      { href: '/game',        label: 'Match' },
      { href: '/leaderboard', label: 'Leaderboard' },
      { href: '/how-to-play', label: 'How to Play' },
    ],
  },
  {
    heading: 'Command Post',
    links: [
      { href: '/support', label: 'FAQ & Support' },
      { href: '/terms',   label: 'Terms of Play' },
      { href: '/privacy', label: 'Privacy' },
    ],
  },
  {
    heading: 'On-Chain',
    links: [
      ...(CONTRACT_ADDRESS
        ? [{ href: `${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`, label: 'Game Contract', external: true as const }]
        : []),
      { href: 'https://celo.org', label: 'Built on Celo', external: true as const },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer
      className="border-t px-6 py-12"
      style={{ borderColor: 'rgba(107,142,35,0.15)', backgroundColor: '#060b06' }}
    >
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          {/* Lore blurb */}
          <div className="max-w-sm">
            <p className="font-display text-xl leading-none" style={{ color: '#d4c9b2' }}>Zombie Plague</p>
            <p className="mt-3 font-mono text-xs leading-relaxed" style={{ color: '#4a5e44' }}>
              One of you is Patient Zero. Stakes on-chain, roles sealed by
              zero-knowledge proofs, no take-backs. Trust no one — verify
              everything.
            </p>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {columns.map(col => (
              <div key={col.heading}>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: '#6b8e23' }}>
                  {col.heading}
                </p>
                <ul className="mt-3 space-y-2">
                  {col.links.map(link => (
                    <li key={link.href}>
                      {link.external ? (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs transition-colors hover:opacity-80"
                          style={{ color: '#8fa882' }}
                        >
                          {link.label} ↗
                        </a>
                      ) : (
                        <Link
                          href={link.href}
                          className="font-mono text-xs transition-colors hover:opacity-80"
                          style={{ color: '#8fa882' }}
                        >
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div
          className="mt-10 flex flex-col gap-2 border-t pt-6 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: 'rgba(107,142,35,0.1)' }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: '#4a5e44' }}>
            © {new Date().getFullYear()} Zombie Plague — survive the vote.
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: '#4a5e44' }}>
            Non-custodial · Stakes settle on Celo mainnet
          </p>
        </div>
      </div>
    </footer>
  )
}
