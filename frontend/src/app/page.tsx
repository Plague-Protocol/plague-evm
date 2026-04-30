import Link from 'next/link'
import { SiteNav } from '@/components/ui/site-nav'

const stats = [
  { icon: '🎮', number: '146', label: 'Active Matches' },
  { icon: '🔐', number: '824', label: 'ZK Proofs Submitted' },
  { icon: '💎', number: '311', label: 'Wallets Onboarded' },
]

const features = [
  {
    icon: '☣️',
    phase: '01',
    title: 'Infect & Deceive',
    description:
      'Patient Zero secretly infects others through social interaction. Use deception, misdirection, and alliances to spread the plague undetected.',
  },
  {
    icon: '🗳️',
    phase: '02',
    title: 'Vote & Eliminate',
    description:
      'The town votes to eliminate suspected carriers. Submit on-chain votes that are transparent, final, and secured by Soroban smart contracts.',
  },
  {
    icon: '🔮',
    phase: '03',
    title: 'Prove Innocence',
    description:
      'Generate zero-knowledge proofs to claim innocence without revealing your role. Noir circuits verify your status trustlessly.',
  },
]

const mechanics = [
  {
    icon: '⛓️',
    title: 'On-Chain Escrow',
    desc: 'Stakes locked in Soroban contracts. Winners auto-claim, losers auto-drain. No trust required.',
  },
  {
    icon: '🌐',
    title: 'Stellar Speed',
    desc: 'Transactions finalize in under 5 seconds. Real-time game state without gas anxiety.',
  },
  {
    icon: '🔒',
    title: 'ZK Role Privacy',
    desc: "Your role commitment is sealed with Noir. Nobody knows you're infected until you choose to reveal.",
  },
  {
    icon: '📊',
    title: 'Proof Leaderboards',
    desc: 'Track submission counts, win rates, and proof efficiency across seasons on a transparent board.',
  },
]

export default function HomePage() {
  return (
    <main className="min-h-screen" style={{ backgroundColor: '#0a0e27', color: '#f0f4f8' }}>
      {/* Nav */}
      <div className="px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="mx-auto w-full max-w-6xl">
          <SiteNav currentPath="/" />
        </div>
      </div>

      {/* Hero */}
      <section className="relative flex min-h-[88vh] w-full flex-col items-center justify-center overflow-hidden px-6 py-20">
        {/* Animated background blobs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="rise-in absolute left-[8%] top-[12%] h-96 w-96 rounded-full opacity-20 blur-3xl"
            style={{ background: 'radial-gradient(circle, #a855f7, transparent)', animationDelay: '0ms' }}
          />
          <div
            className="rise-in absolute right-[8%] top-[20%] h-80 w-80 rounded-full opacity-15 blur-3xl"
            style={{ background: 'radial-gradient(circle, #06b6d4, transparent)', animationDelay: '200ms' }}
          />
          <div
            className="rise-in absolute bottom-[15%] left-[38%] h-72 w-72 rounded-full opacity-15 blur-3xl"
            style={{ background: 'radial-gradient(circle, #e63329, transparent)', animationDelay: '400ms' }}
          />
        </div>

        <div className="relative z-10 flex w-full max-w-6xl flex-col items-center gap-16 text-center">
          {/* Badge + Heading + CTA */}
          <div className="rise-in flex flex-col items-center gap-8">
            <span
              className="rounded-full border px-4 py-1.5 font-mono text-xs uppercase tracking-[0.22em]"
              style={{ borderColor: 'rgba(230,51,41,0.4)', backgroundColor: 'rgba(230,51,41,0.08)', color: '#e63329' }}
            >
              PlagueProtocol · Stellar × Soroban × Noir ZK
            </span>

            <h1 className="max-w-5xl font-display leading-[0.88]">
              <span className="block text-7xl sm:text-8xl lg:text-9xl" style={{ color: '#f0f4f8' }}>
                INFECT THE
              </span>
              <span
                className="block text-7xl sm:text-8xl lg:text-9xl"
                style={{
                  background: 'linear-gradient(135deg, #a855f7, #06b6d4)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                ROOM.
              </span>
            </h1>

            <p className="max-w-2xl font-body text-lg leading-relaxed" style={{ color: '#b4c1d1' }}>
              A zero-knowledge social deduction game on Stellar. Deceive, vote, prove — every action
              is on-chain and verifiable.
            </p>

            <div className="flex flex-wrap justify-center gap-4">
              <Link
                href="/lobby"
                className="rounded-lg px-8 py-4 font-mono text-base font-bold uppercase tracking-wider transition-all hover:opacity-90"
                style={{ backgroundColor: '#e63329', color: '#f0f4f8', boxShadow: '4px 4px 0px #a855f7' }}
              >
                Enter Lobby
              </Link>
              <Link
                href="/game"
                className="rounded-lg border px-8 py-4 font-mono text-base font-bold uppercase tracking-wider transition-all hover:opacity-90"
                style={{ borderColor: 'rgba(168,85,247,0.5)', color: '#a855f7', boxShadow: '4px 4px 0px rgba(168,85,247,0.3)' }}
              >
                Watch a Match
              </Link>
            </div>
          </div>

          {/* Stats grid */}
          <div
            className="rise-in grid w-full grid-cols-1 gap-6 sm:grid-cols-3"
            style={{ animationDelay: '200ms' }}
          >
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="flex flex-col items-center gap-3 rounded-2xl border p-8 text-center transition-all hover:scale-[1.02]"
                style={{ borderColor: 'rgba(168,85,247,0.25)', backgroundColor: '#161b35' }}
              >
                <span className="text-5xl">{stat.icon}</span>
                <span className="font-display text-5xl font-bold leading-none" style={{ color: '#f0f4f8' }}>
                  {stat.number}
                </span>
                <span className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#7a8592' }}>
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Ticker */}
      <div className="border-y py-3" style={{ borderColor: 'rgba(168,85,247,0.2)', backgroundColor: '#12172c' }}>
        <div className="overflow-hidden">
          <div className="ticker" style={{ color: '#a855f7' }}>
            OPEN SOURCE MULTIPLAYER PROTOCOL&nbsp;&nbsp;|&nbsp;&nbsp;ROOM ESCROW&nbsp;&nbsp;|&nbsp;&nbsp;VOTE
            RESOLUTION&nbsp;&nbsp;|&nbsp;&nbsp;ZK COMMITMENTS&nbsp;&nbsp;|&nbsp;&nbsp;STELLAR
            NETWORK&nbsp;&nbsp;|&nbsp;&nbsp;SOROBAN CONTRACTS&nbsp;&nbsp;|&nbsp;&nbsp;NOIR
            CIRCUITS&nbsp;&nbsp;|&nbsp;&nbsp;OPEN SOURCE MULTIPLAYER PROTOCOL&nbsp;&nbsp;|&nbsp;&nbsp;ROOM
            ESCROW&nbsp;&nbsp;|&nbsp;&nbsp;VOTE RESOLUTION&nbsp;&nbsp;|&nbsp;&nbsp;ZK COMMITMENTS&nbsp;&nbsp;|
          </div>
        </div>
      </div>

      {/* How It Works */}
      <section className="px-6 py-24" style={{ backgroundColor: '#0a0e27' }}>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-16">
          <div className="flex flex-col items-center gap-6">
            <span className="font-mono text-xs uppercase tracking-[0.3em]" style={{ color: '#a855f7' }}>
              How It Works
            </span>
            <h2
              className="max-w-4xl text-center font-display text-6xl leading-none sm:text-7xl"
              style={{ color: '#f0f4f8' }}
            >
              THREE PHASES. ONE SURVIVOR.
            </h2>
            <p className="max-w-2xl text-center font-body" style={{ color: '#b4c1d1' }}>
              Each match runs through infection, deliberation, and proof — all governed by on-chain
              logic.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {features.map((f, i) => (
              <div
                key={f.title}
                className="rise-in flex flex-col gap-5 rounded-lg border p-10 transition-all duration-300 hover:scale-[1.02]"
                style={{
                  backgroundColor: '#161b35',
                  borderColor: 'rgba(168,85,247,0.2)',
                  animationDelay: `${i * 120}ms`,
                }}
              >
                <div className="flex items-start justify-between">
                  <span className="text-4xl">{f.icon}</span>
                  <span className="font-mono text-xs" style={{ color: '#7a8592' }}>
                    {f.phase}
                  </span>
                </div>
                <div>
                  <h3 className="font-display text-2xl leading-none" style={{ color: '#f0f4f8' }}>
                    {f.title}
                  </h3>
                  <p className="mt-3 font-body text-sm leading-relaxed" style={{ color: '#b4c1d1' }}>
                    {f.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Game Mechanics */}
      <section className="px-6 py-24" style={{ backgroundColor: '#12172c' }}>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-16">
          <div className="flex flex-col items-center gap-6">
            <span className="font-mono text-xs uppercase tracking-[0.3em]" style={{ color: '#06b6d4' }}>
              Game Mechanics
            </span>
            <h2
              className="max-w-4xl text-center font-display text-6xl leading-none sm:text-7xl"
              style={{ color: '#f0f4f8' }}
            >
              BUILT ON CHAIN. PLAYED OFF IT.
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {mechanics.map((m, i) => (
              <div
                key={m.title}
                className="rise-in flex gap-6 rounded-lg border p-10 transition-all hover:scale-[1.01]"
                style={{
                  backgroundColor: '#1a1f3a',
                  borderColor: 'rgba(6,182,212,0.18)',
                  animationDelay: `${i * 100}ms`,
                }}
              >
                <div
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-2xl"
                  style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.3), rgba(6,182,212,0.3))' }}
                >
                  {m.icon}
                </div>
                <div>
                  <h3 className="font-display text-xl leading-none" style={{ color: '#f0f4f8' }}>
                    {m.title}
                  </h3>
                  <p className="mt-2 font-body text-sm leading-relaxed" style={{ color: '#b4c1d1' }}>
                    {m.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative overflow-hidden px-6 py-32" style={{ backgroundColor: '#0a0e27' }}>
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute left-1/4 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full opacity-20 blur-3xl"
            style={{ background: 'radial-gradient(circle, #a855f7, transparent)' }}
          />
          <div
            className="absolute right-1/4 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full opacity-20 blur-3xl"
            style={{ background: 'radial-gradient(circle, #06b6d4, transparent)' }}
          />
        </div>
        <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center gap-12">
          <div className="flex flex-col items-center gap-6 text-center">
            <h2
              className="font-display text-7xl leading-none sm:text-8xl lg:text-9xl"
              style={{
                background: 'linear-gradient(135deg, #a855f7, #06b6d4, #84cc16)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              FIND PATIENT ZERO.
            </h2>
            <p className="max-w-xl font-body text-xl" style={{ color: '#b4c1d1' }}>
              Or become them. Every session is a new social experiment on Stellar.
            </p>
          </div>

          <div className="grid w-full grid-cols-1 gap-6 sm:grid-cols-3">
            {[
              { n: '146', l: 'Matches Played' },
              { n: '311', l: 'Players Registered' },
              { n: '99.9%', l: 'Chain Uptime' },
            ].map((s) => (
              <div key={s.l} className="flex flex-col items-center gap-2 text-center">
                <span className="font-display text-4xl font-bold" style={{ color: '#f0f4f8' }}>
                  {s.n}
                </span>
                <span className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#7a8592' }}>
                  {s.l}
                </span>
              </div>
            ))}
          </div>

          <Link
            href="/lobby"
            className="rounded-lg px-12 py-6 font-mono text-lg font-bold uppercase tracking-wider transition-all hover:opacity-90"
            style={{
              background: 'linear-gradient(135deg, #a855f7, #06b6d4)',
              color: '#f0f4f8',
              boxShadow: '0 0 30px rgba(168,85,247,0.4)',
            }}
          >
            Play Now — It&apos;s Free
          </Link>
        </div>
      </section>
    </main>
  )
}

