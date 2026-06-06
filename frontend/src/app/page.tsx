import Link from 'next/link'
import { SiteNav } from '@/components/ui/site-nav'
import { HeroStats, CtaStats } from '@/components/ui/home-stats'

const features = [
  {
    icon: '☣️',
    phase: '01',
    title: 'One of You Is Infected',
    description:
      'Patient Zero is hiding in the room. Each round they turn another player — in total secret. Lie, scheme, and frame the innocent to stay alive.',
  },
  {
    icon: '🗳️',
    phase: '02',
    title: 'Vote Out the Zombie',
    description:
      'Every round, everyone votes who to throw out. Pick wrong and the infection spreads. Stay quiet and the vote goes against you.',
  },
  {
    icon: '🛡️',
    phase: '03',
    title: 'Shield Yourself',
    description:
      "If you're being framed, activate your Shield to prove you're clean — without revealing anything else. You only get one free, so use it when it counts.",
  },
]

const mechanics = [
  {
    icon: '💰',
    title: 'Real Cash Stakes',
    desc: "Everyone pitches in USDm before the match. Winners split the pot automatically when the game ends. No middlemen, no chasing payouts.",
  },
  {
    icon: '⚡',
    title: 'Fast Rounds',
    desc: 'Every move confirms in under 5 seconds. No waiting, no awkward lulls — the tension never drops.',
  },
  {
    icon: '🔒',
    title: 'Secret Roles',
    desc: "Your role is locked behind cryptography. Nobody — not other players, not even us — can see who's infected until reveal.",
  },
  {
    icon: '📊',
    title: 'Track Your Glory',
    desc: 'Climb the leaderboard. Brag about your win streaks. Bring receipts.',
  },
]

export default function HomePage() {
  return (
    <main className="min-h-screen" style={{ backgroundColor: '#060b06', color: '#d4c9b2' }}>
      {/* Nav */}
      <div className="sticky top-0 z-50 px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="mx-auto w-full max-w-6xl">
          <SiteNav currentPath="/" />
        </div>
      </div>

      {/* Hero */}
      <section
        className="relative flex min-h-[88vh] w-full flex-col items-center justify-center overflow-hidden px-6 py-20"
        style={{
          backgroundImage: 'url(/images/bg-home.webp)',
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
        }}
      >
        {/* Dark overlay */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(6,11,6,0.80) 0%, rgba(6,11,6,0.65) 50%, rgba(6,11,6,0.94) 100%)' }}
        />
        <div className="relative z-10 flex w-full max-w-6xl flex-col items-center gap-16 text-center">
          {/* Badge + Heading + CTA */}
          <div className="rise-in flex flex-col items-center gap-8">
            <span
              className="rounded-full border px-3 py-1 sm:px-4 sm:py-1.5 font-mono text-[10px] sm:text-xs uppercase tracking-[0.22em]"
              style={{ borderColor: 'rgba(204,20,20,0.5)', backgroundColor: 'rgba(204,20,20,0.1)', color: '#cc1414' }}
            >
              Zombie Plague · Social Deduction · Real Stakes
            </span>

            <h1 className="max-w-5xl font-display leading-[0.88]">
              <span className="block text-4xl sm:text-7xl lg:text-9xl" style={{ color: '#d4c9b2' }}>
                INFECT THE
              </span>
              <span
                className="block text-4xl sm:text-7xl lg:text-9xl"
                style={{
                  background: 'linear-gradient(135deg, #cc1414, #c97a12)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                ROOM.
              </span>
            </h1>

            <p className="max-w-2xl font-body text-sm sm:text-lg leading-relaxed" style={{ color: '#a0bb94' }}>
              One player is secretly infected. The rest have to find them before they turn
              everyone. Stake USDm, survive the rounds, take the pot.
            </p>

            <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
              <Link
                href="/lobby"
                className="rounded-lg px-5 py-3 sm:px-8 sm:py-4 font-mono text-sm sm:text-base font-bold uppercase tracking-wider transition-all hover:opacity-90"
                style={{ backgroundColor: '#6b8e23', color: '#060b06' }}
              >
                Play Now
              </Link>
              <Link
                href="/how-to-play"
                className="rounded-lg border px-5 py-3 sm:px-8 sm:py-4 font-mono text-sm sm:text-base font-bold uppercase tracking-wider transition-all hover:opacity-90"
                style={{ borderColor: 'rgba(107,142,35,0.4)', color: '#6b8e23', boxShadow: '4px 4px 0px rgba(107,142,35,0.2)' }}
              >
                How to Play
              </Link>
            </div>
          </div>

          {/* Stats grid */}
          <div
            className="rise-in grid w-full grid-cols-1 gap-6 sm:grid-cols-3"
            style={{ animationDelay: '200ms' }}
          >
            <HeroStats />
          </div>
        </div>
      </section>

      {/* Ticker */}
      <div className="border-y py-3" style={{ borderColor: 'rgba(107,142,35,0.12)', backgroundColor: '#0a100a' }}>
        <div className="overflow-hidden">
          <div className="ticker" style={{ color: '#6b8e23' }}>
            FIND PATIENT ZERO&nbsp;&nbsp;|&nbsp;&nbsp;TRUST NO ONE&nbsp;&nbsp;|&nbsp;&nbsp;STAKE
            USDm&nbsp;&nbsp;|&nbsp;&nbsp;WIN THE POT&nbsp;&nbsp;|&nbsp;&nbsp;ONE OF YOU IS
            INFECTED&nbsp;&nbsp;|&nbsp;&nbsp;SHIELD YOURSELF&nbsp;&nbsp;|&nbsp;&nbsp;VOTE BEFORE
            THE TIMER&nbsp;&nbsp;|&nbsp;&nbsp;FIND PATIENT ZERO&nbsp;&nbsp;|&nbsp;&nbsp;TRUST NO
            ONE&nbsp;&nbsp;|&nbsp;&nbsp;STAKE USDm&nbsp;&nbsp;|&nbsp;&nbsp;WIN THE POT&nbsp;&nbsp;|
          </div>
        </div>
      </div>

      {/* How It Works */}
      <section className="px-4 sm:px-6 py-12 sm:py-24" style={{ backgroundColor: '#060b06' }}>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-16">
          <div className="flex flex-col items-center gap-6">
            <span className="font-mono text-xs uppercase tracking-[0.3em]" style={{ color: '#6b8e23' }}>
              How It Works
            </span>
            <h2
              className="max-w-4xl text-center font-display text-2xl leading-none sm:text-4xl md:text-6xl lg:text-7xl"
              style={{ color: '#d4c9b2' }}
            >
              THREE PHASES. ONE SURVIVOR.
            </h2>
              <p className="max-w-2xl text-center font-body" style={{ color: '#a0bb94' }}>
              Every match: someone gets infected, the room argues, the room votes. Repeat until
              only one side is left standing.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {features.map((f, i) => (
              <div
                key={f.title}
                className="rise-in flex flex-col gap-4 sm:gap-5 rounded-lg border p-5 sm:p-10 transition-all duration-300 hover:scale-[1.02]"
                style={{
                  backgroundColor: '#0c1309',
                  borderColor: 'rgba(107,142,35,0.12)',
                  animationDelay: `${i * 120}ms`,
                }}
              >
                <div className="flex items-start justify-between">
                  <span className="text-4xl">{f.icon}</span>
                  <span className="font-mono text-xs" style={{ color: '#7fa06c' }}>
                    {f.phase}
                  </span>
                </div>
                <div>
                  <h3 className="font-display text-2xl leading-none" style={{ color: '#d4c9b2' }}>
                    {f.title}
                  </h3>
                  <p className="mt-3 font-body text-sm leading-relaxed" style={{ color: '#a0bb94' }}>
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
              Why Play
            </span>
            <h2
              className="max-w-4xl text-center font-display text-2xl leading-none sm:text-4xl md:text-6xl lg:text-7xl"
              style={{ color: '#d4c9b2' }}
            >
              PLAY WITH FRIENDS. WIN REAL MONEY.
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {mechanics.map((m, i) => (
              <div
                key={m.title}
                className="rise-in flex gap-4 sm:gap-6 rounded-lg border p-5 sm:p-10 transition-all hover:scale-[1.01]"
                style={{
                  backgroundColor: '#0e180d',
                  borderColor: 'rgba(107,142,35,0.08)',
                  animationDelay: `${i * 100}ms`,
                }}
              >
                <div
                  className="flex h-10 w-10 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-xl text-xl sm:text-2xl"
                  style={{ background: 'linear-gradient(135deg, rgba(107,142,35,0.2), rgba(204,20,20,0.2))' }}
                >
                  {m.icon}
                </div>
                <div>
                  <h3 className="font-display text-xl leading-none" style={{ color: '#d4c9b2' }}>
                    {m.title}
                  </h3>
                  <p className="mt-2 font-body text-sm leading-relaxed" style={{ color: '#a0bb94' }}>
                    {m.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Under the hood — small tech mention for crypto-natives */}
          <div
            className="mx-auto mt-12 max-w-3xl rounded-lg border px-5 py-4 text-center"
            style={{ borderColor: 'rgba(143,168,130,0.15)', backgroundColor: 'rgba(6,11,6,0.5)' }}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: '#7fa06c' }}>
              Under the Hood
            </p>
            <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#a0bb94' }}>
              Built on Celo · Smart contracts hold the stakes · Noir zero-knowledge proofs keep
              your role private · Open-source and verifiable
            </p>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section
        className="relative overflow-hidden px-4 sm:px-6 py-16 sm:py-32"
        style={{
          backgroundImage: 'url(/images/bg-cta.webp)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="pointer-events-none absolute inset-0" style={{ background: 'rgba(6,11,6,0.88)' }} />
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute left-1/4 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full opacity-15 blur-3xl"
            style={{ background: 'radial-gradient(circle, #6b8e23, transparent)' }}
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
                background: 'linear-gradient(135deg, #cc1414, #c97a12, #6b8e23)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              FIND PATIENT ZERO.
            </h2>
              <p className="max-w-xl font-body text-base sm:text-xl" style={{ color: '#a0bb94' }}>
              Or become them. Every match is a fresh hunt.
            </p>
          </div>

          <div className="grid w-full grid-cols-1 gap-6 sm:grid-cols-3">
            <CtaStats />
          </div>

          <Link
            href="/lobby"
            className="rounded-lg px-6 py-3 sm:px-12 sm:py-6 font-mono text-sm sm:text-lg font-bold uppercase tracking-wider transition-all hover:opacity-90"
            style={{
              background: 'linear-gradient(135deg, #cc1414, #c97a12)',
              color: '#060b06',
              boxShadow: '0 0 30px rgba(204,20,20,0.45)',
            }}
          >
            Find a Match
          </Link>
        </div>
      </section>
    </main>
  )
}
