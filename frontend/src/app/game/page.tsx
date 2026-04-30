import { SiteNav } from '@/components/ui/site-nav'

const players = [
  { id: 'A1', status: 'clean' },
  { id: 'B2', status: 'clean' },
  { id: 'C3', status: 'infected' },
  { id: 'D4', status: 'clean' },
  { id: 'E5', status: 'clean' },
  { id: 'F6', status: 'clean' },
  { id: 'G7', status: 'eliminated' },
  { id: 'H8', status: 'clean' },
]

function playerStyle(status: string): { border: string; backgroundColor: string; color: string } {
  if (status === 'infected') return { border: '2px solid #e63329', backgroundColor: 'rgba(230,51,41,0.15)', color: '#ff6b6b' }
  if (status === 'eliminated') return { border: '2px solid #7a8592', backgroundColor: 'rgba(122,133,146,0.12)', color: '#7a8592' }
  return { border: '2px solid #06b6d4', backgroundColor: 'rgba(6,182,212,0.1)', color: '#06b6d4' }
}

export default function GamePage() {
  return (
    <main className="min-h-screen" style={{ backgroundColor: '#0a0e27', color: '#f0f4f8' }}>
      {/* Nav */}
      <div className="px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="mx-auto w-full max-w-6xl">
          <SiteNav currentPath="/game" />
        </div>
      </div>

      {/* Game Header */}
      <header
        className="relative overflow-hidden px-6 py-16"
        style={{ borderBottom: '1px solid rgba(168,85,247,0.2)' }}
      >
        {/* Blobs */}
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
        >
          <div className="absolute left-1/4 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full opacity-20 blur-3xl"
            style={{ backgroundColor: '#a855f7' }} />
          <div className="absolute right-1/3 top-1/2 h-48 w-48 -translate-y-1/2 rounded-full opacity-15 blur-3xl"
            style={{ backgroundColor: '#06b6d4' }} />
        </div>

        <div className="relative mx-auto w-full max-w-6xl">
          {/* Top meta row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span
              className="rounded border px-3 py-1 font-mono text-xs uppercase tracking-[0.25em]"
              style={{ borderColor: 'rgba(230,51,41,0.5)', backgroundColor: 'rgba(230,51,41,0.12)', color: '#e63329' }}
            >
              Match Preview · Room alpha-7
            </span>
            <span
              className="rounded border px-3 py-1 font-mono text-xs uppercase tracking-[0.2em]"
              style={{ borderColor: 'rgba(168,85,247,0.4)', backgroundColor: 'rgba(168,85,247,0.1)', color: '#a855f7' }}
            >
              DISCUSS phase
            </span>
          </div>

          {/* Heading + timer row */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-6">
            <h1 className="font-display text-7xl font-bold leading-none sm:text-8xl lg:text-9xl" style={{ color: '#f0f4f8' }}>
              ROUND 1
            </h1>
            <div
              className="flex flex-col items-center rounded-xl border px-10 py-4"
              style={{ borderColor: 'rgba(6,182,212,0.45)', backgroundColor: 'rgba(6,182,212,0.08)' }}
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: '#7a8592' }}>Time Left</p>
              <p className="mt-1 font-display text-6xl font-bold leading-none tabular-nums" style={{ color: '#06b6d4', textShadow: '0 0 20px rgba(6,182,212,0.5)' }}>00:48</p>
            </div>
          </div>
        </div>
      </header>

      {/* Telemetry Strip */}
      <div className="px-6 pt-8">
        <div className="mx-auto w-full max-w-6xl">
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'POT', value: '84 XLM', accent: '#f5c518' },
              { label: 'INFECTED', value: '2 / 8', accent: '#e63329' },
              { label: 'PROOF WINDOW', value: '18s', accent: '#a855f7' },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rise-in rounded-lg border p-4 text-center"
                style={{ backgroundColor: '#161b35', borderColor: `${stat.accent}33` }}
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#7a8592' }}>{stat.label}</p>
                <p className="mt-2 font-display text-3xl leading-none" style={{ color: stat.accent }}>{stat.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Board + Right Sidebar */}
      <div className="px-6 py-8">
        <div className="mx-auto w-full max-w-6xl">
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">

            {/* Containment Board */}
            <div className="flex flex-col gap-6">
              <article
                className="rise-in rounded-lg border p-6"
                style={{ backgroundColor: '#161b35', borderColor: 'rgba(168,85,247,0.2)' }}
              >
                <div className="flex items-center justify-between gap-4">
                  <h2 className="font-display text-2xl leading-none" style={{ color: '#f0f4f8' }}>Containment Board</h2>
                  <span
                    className="rounded border px-3 py-1 font-mono text-xs uppercase tracking-[0.18em]"
                    style={{ borderColor: 'rgba(168,85,247,0.35)', color: '#a855f7', backgroundColor: 'rgba(168,85,247,0.1)' }}
                  >
                    Zone Delta
                  </span>
                </div>

                {/* Player Grid */}
                <div
                  className="mt-6 rounded-lg border p-5"
                  style={{ backgroundColor: '#12172c', borderColor: 'rgba(168,85,247,0.15)' }}
                >
                  <div className="grid grid-cols-4 gap-3">
                    {players.map((p) => (
                      <button
                        key={p.id}
                        className="rounded-lg py-3 font-mono text-sm font-bold uppercase tracking-widest transition-all hover:opacity-80"
                        style={playerStyle(p.status)}
                      >
                        {p.id}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Evidence + Phase */}
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div
                    className="rounded-lg border p-5"
                    style={{ backgroundColor: '#1a1f3a', borderColor: 'rgba(168,85,247,0.18)' }}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#7a8592' }}>Evidence Log</p>
                    <ul className="mt-3 space-y-2 font-mono text-sm" style={{ color: '#b4c1d1' }}>
                      <li className="flex gap-2">
                        <span style={{ color: '#7a8592' }}>→</span> C3 flagged by consensus heatmap.
                      </li>
                      <li className="flex gap-2">
                        <span style={{ color: '#7a8592' }}>→</span> E5 submitted innocence proof.
                      </li>
                      <li className="flex gap-2">
                        <span style={{ color: '#7a8592' }}>→</span> Drain trigger pending vote finality.
                      </li>
                    </ul>
                  </div>
                  <div
                    className="rounded-lg border p-5"
                    style={{ backgroundColor: 'rgba(230,51,41,0.1)', borderColor: 'rgba(230,51,41,0.3)' }}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#7a8592' }}>Phase</p>
                    <p className="mt-2 font-display text-3xl leading-none" style={{ color: '#e63329' }}>DISCUSS</p>
                    <p className="mt-3 font-mono text-xs leading-relaxed" style={{ color: '#b4c1d1' }}>
                      Players coordinate off-chain, settle on-chain.
                    </p>
                  </div>
                </div>
              </article>

              {/* Round Feed */}
              <article
                className="rise-in rounded-lg border p-6"
                style={{ backgroundColor: '#161b35', borderColor: 'rgba(132,204,22,0.2)', animationDelay: '120ms' }}
              >
                <h4 className="font-display text-xl leading-none" style={{ color: '#84cc16' }}>Round Feed</h4>
                <ul className="mt-4 space-y-2 font-mono text-sm">
                  {[
                    { time: '00:12', msg: 'Discussion opened for 60 seconds.' },
                    { time: '00:29', msg: 'Player D4 cast a vote.' },
                    { time: '00:44', msg: 'Infection phase locked for proof submission.' },
                  ].map((event) => (
                    <li
                      key={event.time}
                      className="flex gap-3 rounded border px-4 py-3"
                      style={{ borderColor: 'rgba(132,204,22,0.18)', backgroundColor: '#1a1f3a' }}
                    >
                      <span style={{ color: '#84cc16' }}>[{event.time}]</span>
                      <span style={{ color: '#b4c1d1' }}>{event.msg}</span>
                    </li>
                  ))}
                </ul>
              </article>
            </div>

            {/* Right Sidebar */}
            <aside className="flex flex-col gap-6">
              {/* Vote Panel */}
              <div
                className="rise-in rounded-lg border p-6"
                style={{ backgroundColor: '#161b35', borderColor: 'rgba(230,51,41,0.25)', animationDelay: '80ms' }}
              >
                <h3 className="font-display text-xl leading-none" style={{ color: '#f0f4f8' }}>Vote Panel</h3>
                <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em]" style={{ color: '#7a8592' }}>
                  Select suspected Patient Zero
                </p>
                <div className="mt-4 space-y-2">
                  {[
                    { label: 'Vote A1', count: 2 },
                    { label: 'Vote C3', count: 5 },
                    { label: 'Vote F6', count: 1 },
                  ].map((v) => (
                    <button
                      key={v.label}
                      className="flex w-full items-center justify-between rounded-lg border px-4 py-3 font-mono text-sm uppercase tracking-[0.12em] transition-all hover:opacity-90"
                      style={{
                        borderColor: 'rgba(230,51,41,0.35)',
                        backgroundColor: 'rgba(230,51,41,0.1)',
                        color: '#f0f4f8',
                      }}
                    >
                      <span>{v.label}</span>
                      <span
                        className="rounded-full px-2 py-0.5 text-xs"
                        style={{ backgroundColor: 'rgba(230,51,41,0.25)', color: '#ff6b6b' }}
                      >
                        {v.count}
                      </span>
                    </button>
                  ))}
                </div>
                <p
                  className="mt-4 rounded border p-3 font-mono text-xs leading-relaxed"
                  style={{ borderColor: 'rgba(168,85,247,0.25)', backgroundColor: 'rgba(168,85,247,0.08)', color: '#7a8592' }}
                >
                  Contract integration pending: vote submission, tally, and elimination settlement.
                </p>
              </div>

              {/* Player Chat */}
              <div
                className="rise-in rounded-lg border p-6"
                style={{ backgroundColor: '#161b35', borderColor: 'rgba(6,182,212,0.2)', animationDelay: '160ms' }}
              >
                <h4 className="font-display text-lg leading-none" style={{ color: '#06b6d4' }}>Comms</h4>
                <div className="mt-4 space-y-3">
                  {[
                    { from: 'B2', msg: 'C3 has been suspiciously quiet.' },
                    { from: 'E5', msg: 'I submitted my proof, check it.' },
                    { from: 'A1', msg: 'Let\'s vote before time runs out.' },
                  ].map((m) => (
                    <div
                      key={m.from + m.msg}
                      className="border-l-2 pl-3 font-mono text-xs"
                      style={{ borderColor: '#06b6d4' }}
                    >
                      <span style={{ color: '#06b6d4' }}>{m.from}</span>
                      <span style={{ color: '#7a8592' }}>: </span>
                      <span style={{ color: '#b4c1d1' }}>{m.msg}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Team Roster */}
              <div
                className="rise-in rounded-lg border p-6"
                style={{ backgroundColor: '#161b35', borderColor: 'rgba(132,204,22,0.2)', animationDelay: '240ms' }}
              >
                <p className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color: '#84cc16' }}>Team Roster</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {['AM', 'ZR', 'NX', 'KQ', 'VT', 'RA'].map((player) => (
                    <div
                      key={player}
                      className="flex h-10 w-10 items-center justify-center rounded-full font-mono text-xs font-bold uppercase"
                      style={{ backgroundColor: 'rgba(132,204,22,0.15)', border: '2px solid rgba(132,204,22,0.4)', color: '#84cc16' }}
                    >
                      {player}
                    </div>
                  ))}
                </div>
                <p className="mt-4 font-mono text-xs leading-relaxed" style={{ color: '#7a8592' }}>
                  Vote state and proof readiness will be reflected here when contract is live.
                </p>
              </div>

              {/* Back to Lobby */}
              <a
                href="/lobby"
                className="rise-in rounded-lg border py-4 text-center font-mono text-sm uppercase tracking-[0.18em] transition-all hover:opacity-90"
                style={{
                  borderColor: 'rgba(168,85,247,0.35)',
                  backgroundColor: 'rgba(168,85,247,0.08)',
                  color: '#a855f7',
                  animationDelay: '300ms',
                  display: 'block',
                }}
              >
                ← Back to Lobby
              </a>
            </aside>
          </div>
        </div>
      </div>
    </main>
  )
}

