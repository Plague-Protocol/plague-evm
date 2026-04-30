import { SiteNav } from '@/components/ui/site-nav'

const topPlayers = [
  { name: 'CipherCrow', wins: 28, proofs: 119, reputation: 'Verified tactician', delta: '+3', badge: 'Tournament MVP' },
  { name: 'NovaLatch', wins: 24, proofs: 102, reputation: 'Fastest innocence proofs', delta: '+1', badge: 'Proof Specialist' },
  { name: 'HexMorrow', wins: 21, proofs: 97, reputation: 'High-pressure closer', delta: '-1', badge: 'Late Game Closer' },
  { name: 'QuietOrbit', wins: 18, proofs: 83, reputation: 'Consensus builder', delta: '+2', badge: 'Town Anchor' },
]

const rankColors = ['#f5c518', '#b4c1d1', '#cd7f32', '#7a8592']
const tabs = ['Global', 'Season 0', 'Proof Leaders', 'This Week']

export default function LeaderboardPage() {
  return (
    <main className="min-h-screen" style={{ backgroundColor: '#0a0e27', color: '#f0f4f8' }}>
      {/* Nav */}
      <div className="px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="mx-auto w-full max-w-6xl">
          <SiteNav currentPath="/leaderboard" />
        </div>
      </div>

      {/* Header */}
      <header className="px-6 py-16">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 text-center">
          <span className="font-mono text-xs uppercase tracking-[0.3em]" style={{ color: '#a855f7' }}>
            Season Zero
          </span>
          <h1
            className="font-display text-6xl font-black leading-none sm:text-7xl lg:text-8xl"
            style={{
              background: 'linear-gradient(135deg, #f0f4f8, #a855f7)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            LEADERBOARD
          </h1>
          <p className="max-w-xl font-body text-lg" style={{ color: '#b4c1d1' }}>
            Global rankings of the deadliest operatives on Stellar.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {tabs.map((tab, i) => (
              <button
                key={tab}
                className="rounded-full border-2 px-8 py-3 font-mono text-sm font-bold uppercase tracking-wider transition-all hover:opacity-90"
                style={{
                  borderColor: i === 0 ? '#a855f7' : 'rgba(168,85,247,0.3)',
                  backgroundColor: i === 0 ? 'rgba(168,85,247,0.15)' : 'transparent',
                  color: i === 0 ? '#a855f7' : '#7a8592',
                }}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="px-6 pb-20">
        <div className="mx-auto w-full max-w-6xl">
          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">

            {/* Table */}
            <article
              className="rise-in rounded-lg border p-6"
              style={{ backgroundColor: '#161b35', borderColor: 'rgba(168,85,247,0.2)' }}
            >
              {/* Table header */}
              <div
                className="mb-4 grid gap-6 rounded-xl border-2 p-6"
                style={{ gridTemplateColumns: 'auto 1fr auto auto', borderColor: 'rgba(168,85,247,0.35)', backgroundColor: '#1a1f3a' }}
              >
                <span className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#7a8592' }}>#</span>
                <span className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#7a8592' }}>Operative</span>
                <span className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#7a8592' }}>Wins</span>
                <span className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#7a8592' }}>Proofs</span>
              </div>

              <div className="space-y-3">
                {topPlayers.map((player, index) => (
                  <div
                    key={player.name}
                    className="rise-in grid gap-6 rounded-xl border p-6 transition-all duration-200 hover:scale-[1.01]"
                    style={{
                      gridTemplateColumns: 'auto 1fr auto auto',
                      borderColor: 'rgba(168,85,247,0.18)',
                      backgroundColor: '#1a1f3a',
                      animationDelay: `${index * 80}ms`,
                    }}
                  >
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-xl font-display text-xl leading-none"
                      style={{ backgroundColor: `${rankColors[index]}22`, color: rankColors[index] }}
                    >
                      {index + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="font-display text-xl leading-none" style={{ color: '#f0f4f8' }}>
                        {player.name}
                      </p>
                      <p className="mt-1 font-mono text-xs uppercase tracking-[0.14em]" style={{ color: '#7a8592' }}>
                        {player.reputation}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span
                          className="rounded-full px-3 py-0.5 font-mono text-[10px] uppercase"
                          style={{ backgroundColor: 'rgba(245,197,24,0.12)', color: '#f5c518' }}
                        >
                          {player.badge}
                        </span>
                        <span
                          className="rounded-full px-3 py-0.5 font-mono text-[10px] uppercase"
                          style={{
                            backgroundColor: player.delta.startsWith('+')
                              ? 'rgba(26,122,74,0.2)'
                              : 'rgba(230,51,41,0.2)',
                            color: player.delta.startsWith('+') ? '#1a7a4a' : '#e63329',
                          }}
                        >
                          Rank {player.delta}
                        </span>
                      </div>
                    </div>
                    <div
                      className="flex flex-col items-center justify-center rounded-xl px-4 py-2 text-center"
                      style={{ backgroundColor: 'rgba(168,85,247,0.1)' }}
                    >
                      <p className="font-mono text-[10px] uppercase" style={{ color: '#7a8592' }}>Wins</p>
                      <p className="font-display text-2xl leading-none" style={{ color: '#f0f4f8' }}>{player.wins}</p>
                    </div>
                    <div
                      className="flex flex-col items-center justify-center rounded-xl px-4 py-2 text-center"
                      style={{ backgroundColor: 'rgba(230,51,41,0.1)' }}
                    >
                      <p className="font-mono text-[10px] uppercase" style={{ color: '#7a8592' }}>Proofs</p>
                      <p className="font-display text-2xl leading-none" style={{ color: '#e63329' }}>{player.proofs}</p>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            {/* Right sidebar */}
            <aside className="flex flex-col gap-6">
              {/* Your Stats */}
              <div
                className="rise-in rounded-lg border p-10"
                style={{ backgroundColor: '#161b35', borderColor: 'rgba(168,85,247,0.2)', animationDelay: '100ms' }}
              >
                <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#7a8592' }}>Your Stats</p>
                <p className="mt-3 font-display text-3xl leading-none" style={{ color: '#f0f4f8' }}>Season 0</p>
                <div className="mt-6 space-y-4">
                  {[
                    { label: 'Your Rank', value: '#47' },
                    { label: 'Wins', value: '12' },
                    { label: 'Proofs', value: '43' },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="flex items-center justify-between rounded-lg border px-4 py-3"
                      style={{ borderColor: 'rgba(168,85,247,0.2)', backgroundColor: '#1a1f3a' }}
                    >
                      <span className="font-mono text-xs uppercase tracking-[0.16em]" style={{ color: '#7a8592' }}>
                        {s.label}
                      </span>
                      <span className="font-display text-2xl leading-none" style={{ color: '#f0f4f8' }}>
                        {s.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Season Metrics */}
              <div
                className="rise-in rounded-lg border p-6"
                style={{ backgroundColor: '#161b35', borderColor: 'rgba(6,182,212,0.2)', animationDelay: '180ms' }}
              >
                <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#06b6d4' }}>
                  Season Metrics
                </p>
                <div className="mt-4 space-y-3">
                  {[
                    { label: 'Recorded matches', value: '146', color: '#a855f7' },
                    { label: 'Proof submissions', value: '824', color: '#06b6d4' },
                    { label: 'Wallets onboarded', value: '311', color: '#84cc16' },
                  ].map((m) => (
                    <div
                      key={m.label}
                      className="flex items-center justify-between rounded-lg border px-4 py-3"
                      style={{ borderColor: 'rgba(6,182,212,0.18)', backgroundColor: '#1a1f3a' }}
                    >
                      <span className="font-mono text-xs uppercase tracking-[0.14em]" style={{ color: '#7a8592' }}>
                        {m.label}
                      </span>
                      <span className="font-display text-2xl leading-none" style={{ color: m.color }}>
                        {m.value}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Season Progress */}
                <div
                  className="mt-5 rounded-lg border p-5"
                  style={{ borderColor: 'rgba(168,85,247,0.2)', backgroundColor: '#1a1f3a' }}
                >
                  <div className="flex justify-between">
                    <p className="font-mono text-xs uppercase tracking-[0.16em]" style={{ color: '#7a8592' }}>
                      Season progress
                    </p>
                    <p className="font-mono text-xs" style={{ color: '#a855f7' }}>68%</p>
                  </div>
                  <div className="mt-3 h-3 rounded-full" style={{ backgroundColor: 'rgba(168,85,247,0.12)' }}>
                    <div
                      className="h-3 w-[68%] rounded-full"
                      style={{ background: 'linear-gradient(90deg, #a855f7, #06b6d4)' }}
                    />
                  </div>
                </div>
              </div>

              {/* Weekly Highlight */}
              <div
                className="rise-in rounded-lg border p-6"
                style={{ backgroundColor: '#161b35', borderColor: 'rgba(132,204,22,0.2)', animationDelay: '260ms' }}
              >
                <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#84cc16' }}>
                  Weekly Highlight
                </p>
                <p className="mt-3 font-display text-2xl leading-none" style={{ color: '#f0f4f8' }}>NovaLatch</p>
                <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#b4c1d1' }}>
                  Best proof conversion rate this week with 14 validated innocence submissions.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </div>

      {/* Footer CTA */}
      <section className="px-6 py-24 text-center" style={{ backgroundColor: '#12172c' }}>
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-8">
          <h2
            className="font-display text-6xl font-black leading-none sm:text-7xl lg:text-8xl"
            style={{
              background: 'linear-gradient(135deg, #a855f7, #06b6d4)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            CLAIM YOUR RANK.
          </h2>
          <p className="font-body text-2xl" style={{ color: '#b4c1d1' }}>
            Join a match and prove your innocence — or conceal your guilt.
          </p>
          <a
            href="/lobby"
            className="rounded-lg border px-12 py-6 font-mono text-lg font-bold uppercase tracking-wider transition-all hover:opacity-90"
            style={{
              background: 'linear-gradient(135deg, #a855f7, #06b6d4)',
              borderColor: 'transparent',
              color: '#f0f4f8',
              boxShadow: '0 0 24px rgba(168,85,247,0.4)',
            }}
          >
            Enter the Lobby
          </a>
        </div>
      </section>
    </main>
  )
}


