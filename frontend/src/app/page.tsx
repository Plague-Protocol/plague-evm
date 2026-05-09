import Link from 'next/link'
import { SiteNav } from '@/components/ui/site-nav'

const stats = [
  { icon: '🧟', number: '146', label: 'Active Matches' },
  { icon: '🔐', number: '824', label: 'ZK Proofs Submitted' },
  { icon: '💀', number: '311', label: 'Wallets Onboarded' },
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
      'The town votes to eliminate suspected carriers. Submit on-chain votes that are transparent, final, and secured by Celo smart contracts.',
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
    desc: 'Stakes locked in Solidity contracts on Celo. Players stake in cUSD. Winners auto-claim, losers auto-drain. Platform takes 0.3% fee.',
  },
  {
    icon: '🌐',
    title: 'Celo Speed',
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
    <main className="min-h-screen" style={{ backgroundColor: '#060b06', color: '#d4c9b2' }}>
      {/* Nav */}
      <div className="px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="mx-auto w-full max-w-6xl">
          <SiteNav currentPath="/" />
        </div>
      </div>

      {/* Hero */}
      <section
        className="relative flex min-h-[88vh] w-full flex-col items-center justify-center overflow-hidden px-6 py-20"
        style={{
          backgroundImage: 'url(/images/bg-home.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
        }}
      >
        {/* Dark overlay */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(6,11,6,0.80) 0%, rgba(6,11,6,0.65) 50%, rgba(6,11,6,0.94) 100%)' }}
        />
        {/* Animated glow blobs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="rise-in absolute left-[8%] top-[12%] h-96 w-96 rounded-full opacity-12 blur-3xl"
            style={{ background: 'radial-gradient(circle, #39ff14, transparent)', animationDelay: '0ms' }}
          />
          <div
            className="rise-in absolute right-[8%] top-[20%] h-80 w-80 rounded-full opacity-10 blur-3xl"
            style={{ background: 'radial-gradient(circle, #cc1414, transparent)', animationDelay: '200ms' }}
          />
          <div
            className="rise-in absolute bottom-[15%] left-[38%] h-72 w-72 rounded-full opacity-08 blur-3xl"
            style={{ background: 'radial-gradient(circle, #c97a12, transparent)', animationDelay: '400ms' }}
          />
        </div>

        <div className="relative z-10 flex w-full max-w-6xl flex-col items-center gap-16 text-center">
          {/* Badge + Heading + CTA */}
          <div className="rise-in flex flex-col items-center gap-8">
            <span
              className="rounded-full border px-3 py-1 sm:px-4 sm:py-1.5 font-mono text-[10px] sm:text-xs uppercase tracking-[0.22em]"
              style={{ borderColor: 'rgba(204,20,20,0.5)', backgroundColor: 'rgba(204,20,20,0.1)', color: '#cc1414' }}
            >
              PlagueProtocol · Celo × EVM × Noir ZK
            </span>

            <h1 className="max-w-5xl font-display leading-[0.88]">
              <span className="block text-4xl sm:text-7xl lg:text-9xl" style={{ color: '#d4c9b2' }}>
                INFECT THE
              </span>
              <span
                className="block text-4xl sm:text-7xl lg:text-9xl"
                style={{
                  background: 'linear-gradient(135deg, #39ff14, #cc1414)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                ROOM.
              </span>
            </h1>

            <p className="max-w-2xl font-body text-sm sm:text-lg leading-relaxed" style={{ color: '#8fa882' }}>
              A zero-knowledge social deduction game on Celo. Deceive, vote, prove — every action
              is on-chain and verifiable.
            </p>

            <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
              <Link
                href="/lobby"
                className="rounded-lg px-5 py-3 sm:px-8 sm:py-4 font-mono text-sm sm:text-base font-bold uppercase tracking-wider transition-all hover:opacity-90"
                style={{ backgroundColor: '#39ff14', color: '#060b06', boxShadow: '4px 4px 0px #cc1414' }}
              >
                Enter Lobby
              </Link>
              <Link
                href="/game"
                className="rounded-lg border px-5 py-3 sm:px-8 sm:py-4 font-mono text-sm sm:text-base font-bold uppercase tracking-wider transition-all hover:opacity-90"
                style={{ borderColor: 'rgba(57,255,20,0.4)', color: '#39ff14', boxShadow: '4px 4px 0px rgba(57,255,20,0.2)' }}
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
                className="flex flex-col items-center gap-2 sm:gap-3 rounded-2xl border p-4 sm:p-8 text-center transition-all hover:scale-[1.02]"
                style={{ borderColor: 'rgba(57,255,20,0.15)', backgroundColor: 'rgba(12,19,9,0.85)' }}
              >
                <span className="text-3xl sm:text-5xl">{stat.icon}</span>
                <span className="font-display text-3xl sm:text-5xl font-bold leading-none" style={{ color: '#d4c9b2' }}>
                  {stat.number}
                </span>
                <span className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Ticker */}
      <div className="border-y py-3" style={{ borderColor: 'rgba(57,255,20,0.12)', backgroundColor: '#0a100a' }}>
        <div className="overflow-hidden">
          <div className="ticker" style={{ color: '#39ff14' }}>
            OPEN SOURCE MULTIPLAYER PROTOCOL&nbsp;&nbsp;|&nbsp;&nbsp;ROOM ESCROW&nbsp;&nbsp;|&nbsp;&nbsp;VOTE
            RESOLUTION&nbsp;&nbsp;|&nbsp;&nbsp;ZK COMMITMENTS&nbsp;&nbsp;|&nbsp;&nbsp;CELO
            NETWORK&nbsp;&nbsp;|&nbsp;&nbsp;SOLIDITY CONTRACTS&nbsp;&nbsp;|&nbsp;&nbsp;NOIR
            CIRCUITS&nbsp;&nbsp;|&nbsp;&nbsp;OPEN SOURCE MULTIPLAYER PROTOCOL&nbsp;&nbsp;|&nbsp;&nbsp;ROOM
            ESCROW&nbsp;&nbsp;|&nbsp;&nbsp;VOTE RESOLUTION&nbsp;&nbsp;|&nbsp;&nbsp;ZK COMMITMENTS&nbsp;&nbsp;|
          </div>
        </div>
      </div>

      {/* How It Works */}
      <section className="px-4 sm:px-6 py-12 sm:py-24" style={{ backgroundColor: '#060b06' }}>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-16">
          <div className="flex flex-col items-center gap-6">
            <span className="font-mono text-xs uppercase tracking-[0.3em]" style={{ color: '#39ff14' }}>
              How It Works
            </span>
            <h2
              className="max-w-4xl text-center font-display text-2xl leading-none sm:text-4xl md:text-6xl lg:text-7xl"
              style={{ color: '#d4c9b2' }}
            >
              THREE PHASES. ONE SURVIVOR.
            </h2>
            <p className="max-w-2xl text-center font-body" style={{ color: '#8fa882' }}>
              Each match runs through infection, deliberation, and proof — all governed by on-chain
              logic.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {features.map((f, i) => (
              <div
                key={f.title}
                className="rise-in flex flex-col gap-4 sm:gap-5 rounded-lg border p-5 sm:p-10 transition-all duration-300 hover:scale-[1.02]"
                style={{
                  backgroundColor: '#0c1309',
                  borderColor: 'rgba(57,255,20,0.12)',
                  animationDelay: `${i * 120}ms`,
                }}
              >
                <div className="flex items-start justify-between">
                  <span className="text-4xl">{f.icon}</span>
                  <span className="font-mono text-xs" style={{ color: '#4a5e44' }}>
                    {f.phase}
                  </span>
                </div>
                <div>
                  <h3 className="font-display text-2xl leading-none" style={{ color: '#d4c9b2' }}>
                    {f.title}
                  </h3>
                  <p className="mt-3 font-body text-sm leading-relaxed" style={{ color: '#8fa882' }}>
                    {f.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Game Mechanics */}
      <section className="px-4 sm:px-6 py-12 sm:py-24" style={{ backgroundColor: '#0a100a' }}>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-16">
          <div className="flex flex-col items-center gap-6">
            <span className="font-mono text-xs uppercase tracking-[0.3em]" style={{ color: '#c97a12' }}>
              Game Mechanics
            </span>
            <h2
              className="max-w-4xl text-center font-display text-2xl leading-none sm:text-4xl md:text-6xl lg:text-7xl"
              style={{ color: '#d4c9b2' }}
            >
              BUILT ON CHAIN. PLAYED OFF IT.
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {mechanics.map((m, i) => (
              <div
                key={m.title}
                className="rise-in flex gap-4 sm:gap-6 rounded-lg border p-5 sm:p-10 transition-all hover:scale-[1.01]"
                style={{
                  backgroundColor: '#0e180d',
                  borderColor: 'rgba(57,255,20,0.08)',
                  animationDelay: `${i * 100}ms`,
                }}
              >
                <div
                  className="flex h-10 w-10 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-xl text-xl sm:text-2xl"
                  style={{ background: 'linear-gradient(135deg, rgba(57,255,20,0.2), rgba(204,20,20,0.2))' }}
                >
                  {m.icon}
                </div>
                <div>
                  <h3 className="font-display text-xl leading-none" style={{ color: '#d4c9b2' }}>
                    {m.title}
                  </h3>
                  <p className="mt-2 font-body text-sm leading-relaxed" style={{ color: '#8fa882' }}>
                    {m.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section
        className="relative overflow-hidden px-4 sm:px-6 py-16 sm:py-32"
        style={{
          backgroundImage: 'url(/images/bg-zombie-portrait.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="pointer-events-none absolute inset-0" style={{ background: 'rgba(6,11,6,0.88)' }} />
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute left-1/4 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full opacity-15 blur-3xl"
            style={{ background: 'radial-gradient(circle, #39ff14, transparent)' }}
          />
          <div
            className="absolute right-1/4 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full opacity-10 blur-3xl"
            style={{ background: 'radial-gradient(circle, #cc1414, transparent)' }}
          />
        </div>
        <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center gap-12">
          <div className="flex flex-col items-center gap-6 text-center">
            <h2
              className="font-display text-3xl leading-none sm:text-5xl md:text-7xl lg:text-9xl"
              style={{
                background: 'linear-gradient(135deg, #39ff14, #cc1414, #c97a12)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              FIND PATIENT ZERO.
            </h2>
            <p className="max-w-xl font-body text-base sm:text-xl" style={{ color: '#8fa882' }}>
              Or become them. Every session is a new social experiment on Celo.
            </p>
          </div>

          <div className="grid w-full grid-cols-1 gap-6 sm:grid-cols-3">
            {[
              { n: '146', l: 'Matches Played' },
              { n: '311', l: 'Players Registered' },
              { n: '99.9%', l: 'Chain Uptime' },
            ].map((s) => (
              <div key={s.l} className="flex flex-col items-center gap-2 text-center">
                <span className="font-display text-2xl sm:text-4xl font-bold" style={{ color: '#d4c9b2' }}>
                  {s.n}
                </span>
                <span className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>
                  {s.l}
                </span>
              </div>
            ))}
          </div>

          <Link
            href="/lobby"
            className="rounded-lg px-6 py-3 sm:px-12 sm:py-6 font-mono text-sm sm:text-lg font-bold uppercase tracking-wider transition-all hover:opacity-90"
            style={{
              background: 'linear-gradient(135deg, #39ff14, #cc1414)',
              color: '#060b06',
              boxShadow: '0 0 30px rgba(57,255,20,0.4)',
            }}
          >
            Play Now — It&apos;s Free
          </Link>
        </div>
      </section>
    </main>
  )
}
