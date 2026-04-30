type SceneChip = {
  label: string
  value: string
  tone: 'yellow' | 'red' | 'white'
}

const sceneChips: SceneChip[] = [
  { label: 'Players', value: '08', tone: 'yellow' },
  { label: 'Stake', value: '84', tone: 'red' },
  { label: 'Proofs', value: '12', tone: 'white' },
]

function chipClasses(tone: SceneChip['tone']) {
  if (tone === 'red') {
    return 'bg-plague-red text-plague-white shadow-[5px_5px_0px_#f5c518]'
  }

  if (tone === 'yellow') {
    return 'bg-plague-yellow text-plague-black shadow-[5px_5px_0px_#0a0a0a]'
  }

  return 'bg-plague-white text-plague-black shadow-[5px_5px_0px_#e63329]'
}

export function HeroScene() {
  return (
    <div className="relative overflow-hidden rounded-[28px] border-2 border-plague-black bg-[#171310] p-5 shadow-[4px_4px_0px_#e63329] sm:p-7">
      <div className="absolute -left-10 top-10 h-14 w-14 rounded-full bg-plague-yellow/30 blur-2xl" />
      <div className="absolute -right-8 bottom-8 h-16 w-16 rounded-full bg-plague-red/40 blur-2xl" />

      <div className="relative z-10 grid gap-5">
        <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-plague-white/80">
          <span>Containment Chamber</span>
          <span>Live Preview</span>
        </div>

        <div className="rounded-[26px] border-2 border-plague-white bg-[#211c18] p-4">
          <svg viewBox="0 0 640 420" className="h-auto w-full" role="img" aria-label="Stylized plague protocol game board illustration">
            <defs>
              <linearGradient id="boardGlow" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f5c518" />
                <stop offset="100%" stopColor="#e63329" />
              </linearGradient>
              <linearGradient id="nodeGlow" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f5f0e8" />
                <stop offset="100%" stopColor="#f5c518" />
              </linearGradient>
            </defs>

            <rect x="40" y="28" width="560" height="360" rx="28" fill="#15110f" stroke="#f5f0e8" strokeWidth="6" />
            <rect x="76" y="62" width="488" height="292" rx="24" fill="#211c18" stroke="#3d332d" strokeWidth="4" />

            <path d="M320 126 L435 192 L390 304 L250 304 L205 192 Z" fill="none" stroke="url(#boardGlow)" strokeWidth="10" strokeLinejoin="round" />
            <circle cx="320" cy="218" r="56" fill="#e63329" stroke="#f5f0e8" strokeWidth="8" />
            <circle cx="320" cy="218" r="26" fill="#0a0a0a" stroke="#f5c518" strokeWidth="8" />

            <line x1="320" y1="162" x2="320" y2="92" stroke="#f5f0e8" strokeWidth="5" />
            <line x1="375" y1="182" x2="462" y2="132" stroke="#f5f0e8" strokeWidth="5" />
            <line x1="380" y1="248" x2="472" y2="286" stroke="#f5f0e8" strokeWidth="5" />
            <line x1="260" y1="248" x2="170" y2="292" stroke="#f5f0e8" strokeWidth="5" />
            <line x1="262" y1="182" x2="174" y2="130" stroke="#f5f0e8" strokeWidth="5" />

            {[
              { x: 320, y: 82, fill: '#f5c518', label: 'A1' },
              { x: 482, y: 120, fill: '#f5f0e8', label: 'B2' },
              { x: 494, y: 294, fill: '#e63329', label: 'C3' },
              { x: 150, y: 298, fill: '#f5f0e8', label: 'D4' },
              { x: 156, y: 118, fill: '#f5c518', label: 'E5' },
            ].map((node) => (
              <g key={node.label}>
                <circle cx={node.x} cy={node.y} r="28" fill={node.fill} stroke="#0a0a0a" strokeWidth="6" />
                <circle cx={node.x} cy={node.y} r="12" fill="#0a0a0a" opacity="0.16" />
                <text
                  x={node.x}
                  y={node.y + 8}
                  textAnchor="middle"
                  fontFamily="var(--font-mono)"
                  fontSize="20"
                  fontWeight="700"
                  fill={node.fill === '#e63329' ? '#f5f0e8' : '#0a0a0a'}
                >
                  {node.label}
                </text>
              </g>
            ))}

            <rect x="88" y="308" width="128" height="34" rx="10" fill="#f5c518" stroke="#0a0a0a" strokeWidth="4" />
            <text x="152" y="330" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="16" fontWeight="700" fill="#0a0a0a">
              84 XLM POOL
            </text>

            <rect x="436" y="78" width="126" height="34" rx="10" fill="#f5f0e8" stroke="#0a0a0a" strokeWidth="4" />
            <text x="499" y="100" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="16" fontWeight="700" fill="#0a0a0a">
              PROOF READY
            </text>
          </svg>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {sceneChips.map((chip) => (
            <div key={chip.label} className={["rounded-[18px] border-2 border-plague-black p-3", chipClasses(chip.tone)].join(' ')}>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em]">{chip.label}</p>
              <p className="mt-2 font-display text-2xl leading-none">{chip.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

type ModeCardProps = {
  title: string
  eyebrow: string
  tone: 'yellow' | 'red' | 'black'
}

export function ModeCard({ title, eyebrow, tone }: ModeCardProps) {
  const toneClass = {
    yellow: 'bg-plague-yellow text-plague-black',
    red: 'bg-plague-red text-plague-white',
    black: 'bg-plague-black text-plague-white',
  }[tone]

  return (
    <article className={["relative overflow-hidden rounded-[26px] border-2 border-plague-black p-5 shadow-brutal", toneClass].join(' ')}>
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full border-2 border-current opacity-30" />
      <div className="absolute -left-5 bottom-3 h-16 w-16 rotate-12 border-2 border-current opacity-25" />
      <div className="relative z-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-80">{eyebrow}</p>
        <h3 className="mt-3 font-display text-2xl leading-none">{title}</h3>
        <div className="mt-5 h-32 rounded-[20px] border-2 border-current/90 bg-white/10 p-3">
          <svg viewBox="0 0 240 120" className="h-full w-full" aria-hidden="true">
            <rect x="8" y="8" width="224" height="104" rx="18" fill="none" stroke="currentColor" strokeWidth="4" opacity="0.5" />
            <path d="M36 82 C68 24, 120 24, 152 82" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
            <circle cx="64" cy="68" r="16" fill="currentColor" opacity="0.8" />
            <circle cx="120" cy="44" r="16" fill="currentColor" opacity="0.5" />
            <circle cx="178" cy="74" r="16" fill="currentColor" opacity="0.9" />
          </svg>
        </div>
      </div>
    </article>
  )
}

export function FactionBanner() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
      <div className="rounded-[28px] border-2 border-plague-black bg-plague-black p-5 text-plague-white shadow-brutal">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-plague-white/70">Faction graphics</p>
          <span className="badge-chip border-plague-white bg-plague-yellow text-plague-black shadow-none">Role Deck</span>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {[
            ['Citizen', '#f5c518', '#0a0a0a'],
            ['Patient Zero', '#e63329', '#f5f0e8'],
            ['Verifier', '#f5f0e8', '#0a0a0a'],
          ].map(([label, fill, text]) => (
            <div key={label} className="rounded-[22px] border-2 border-plague-white bg-[#201b17] p-4">
              <svg viewBox="0 0 160 180" className="h-auto w-full" aria-hidden="true">
                <rect x="12" y="12" width="136" height="156" rx="18" fill={fill} stroke="#0a0a0a" strokeWidth="6" />
                <circle cx="80" cy="66" r="28" fill="#0a0a0a" opacity="0.15" />
                <path d="M54 122 L80 44 L106 122" fill="none" stroke="#0a0a0a" strokeWidth="8" strokeLinecap="round" />
                <path d="M48 134 H112" fill="none" stroke="#0a0a0a" strokeWidth="8" strokeLinecap="round" />
                <text x="80" y="154" textAnchor="middle" fontFamily="var(--font-display)" fontSize="26" fill={text}>
                  {label}
                </text>
              </svg>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[28px] border-2 border-plague-black bg-plague-yellow p-5 shadow-brutal">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-plague-black/70">Animated arena feel</p>
        <div className="mt-5 rounded-[24px] border-2 border-plague-black bg-plague-white p-4">
          <svg viewBox="0 0 320 220" className="h-auto w-full" role="img" aria-label="Stylized arena poster for plague protocol">
            <rect x="12" y="12" width="296" height="196" rx="24" fill="#f5f0e8" stroke="#0a0a0a" strokeWidth="6" />
            <circle cx="160" cy="110" r="56" fill="#f5c518" stroke="#0a0a0a" strokeWidth="8" />
            <circle cx="160" cy="110" r="24" fill="#e63329" stroke="#0a0a0a" strokeWidth="8" />
            <path d="M68 176 L112 132 L156 176" fill="none" stroke="#0a0a0a" strokeWidth="8" strokeLinecap="round" />
            <path d="M164 176 L208 132 L252 176" fill="none" stroke="#0a0a0a" strokeWidth="8" strokeLinecap="round" />
            <rect x="44" y="38" width="74" height="24" rx="10" fill="#e63329" stroke="#0a0a0a" strokeWidth="4" />
            <rect x="204" y="38" width="76" height="24" rx="10" fill="#f5c518" stroke="#0a0a0a" strokeWidth="4" />
          </svg>
        </div>
      </div>
    </div>
  )
}

type RoomPoster = {
  name: string
  status: 'open' | 'filling' | 'full'
  accent: 'yellow' | 'red' | 'black'
}

const roomPosters: RoomPoster[] = [
  { name: 'Genesis Lobby', status: 'open', accent: 'yellow' },
  { name: 'Infection Testnet', status: 'filling', accent: 'black' },
  { name: 'Zero Proof Squad', status: 'full', accent: 'red' },
]

function posterClass(accent: RoomPoster['accent']) {
  if (accent === 'red') {
    return 'bg-plague-red text-plague-white'
  }

  if (accent === 'black') {
    return 'bg-plague-black text-plague-white'
  }

  return 'bg-plague-yellow text-plague-black'
}

export function LobbyPosters() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {roomPosters.map((room) => (
        <article key={room.name} className={["rounded-[24px] border-2 border-plague-black p-4 shadow-brutal", posterClass(room.accent)].join(' ')}>
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em]">{room.status}</p>
            <span className="status-dot online" />
          </div>
          <h3 className="mt-3 font-display text-3xl leading-none">{room.name}</h3>
          <div className="mt-4 rounded-[18px] border-2 border-current/90 bg-white/10 p-2">
            <svg viewBox="0 0 260 160" className="h-auto w-full" aria-hidden="true">
              <rect x="10" y="10" width="240" height="140" rx="18" fill="none" stroke="currentColor" strokeWidth="4" opacity="0.7" />
              <path d="M28 128 L76 68 L124 128" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
              <path d="M132 128 L180 82 L228 128" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
              <circle cx="80" cy="58" r="14" fill="currentColor" opacity="0.85" />
              <circle cx="152" cy="54" r="14" fill="currentColor" opacity="0.65" />
              <circle cx="206" cy="70" r="14" fill="currentColor" opacity="0.95" />
            </svg>
          </div>
        </article>
      ))}
    </div>
  )
}

export function MatchArenaGraphic() {
  return (
    <div className="rounded-[28px] border-2 border-plague-white bg-[#1c1714] p-4 sm:p-6">
      <svg viewBox="0 0 700 420" className="h-auto w-full" role="img" aria-label="Stylized tactical arena for plague match">
        <rect x="22" y="24" width="656" height="372" rx="34" fill="#171310" stroke="#f5f0e8" strokeWidth="8" />
        <circle cx="350" cy="210" r="78" fill="#f5c518" stroke="#f5f0e8" strokeWidth="8" />
        <circle cx="350" cy="210" r="34" fill="#e63329" stroke="#0a0a0a" strokeWidth="8" />

        <path d="M350 132 L486 196 L434 324 L266 324 L214 196 Z" fill="none" stroke="#e63329" strokeWidth="10" strokeLinejoin="round" />

        {[
          [350, 96, '#f5c518', 'A1'],
          [520, 166, '#f5f0e8', 'B2'],
          [508, 304, '#e63329', 'C3'],
          [192, 304, '#f5f0e8', 'D4'],
          [184, 166, '#f5c518', 'E5'],
          [350, 350, '#f5f0e8', 'F6'],
        ].map(([x, y, color, label]) => (
          <g key={String(label)}>
            <circle cx={Number(x)} cy={Number(y)} r="30" fill={String(color)} stroke="#0a0a0a" strokeWidth="6" />
            <text
              x={Number(x)}
              y={Number(y) + 8}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize="20"
              fontWeight="700"
              fill={String(color) === '#e63329' ? '#f5f0e8' : '#0a0a0a'}
            >
              {String(label)}
            </text>
          </g>
        ))}

        <rect x="58" y="58" width="156" height="38" rx="12" fill="#f5f0e8" stroke="#0a0a0a" strokeWidth="5" />
        <text x="136" y="82" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="16" fontWeight="700" fill="#0a0a0a">
          TIMER 00:48
        </text>

        <rect x="480" y="58" width="164" height="38" rx="12" fill="#e63329" stroke="#0a0a0a" strokeWidth="5" />
        <text x="562" y="82" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="16" fontWeight="700" fill="#f5f0e8">
          PROOF WINDOW
        </text>
      </svg>
    </div>
  )
}
