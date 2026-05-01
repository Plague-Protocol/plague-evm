import Link from 'next/link'
import { SiteNav } from '@/components/ui/site-nav'

// ─── Section data ──────────────────────────────────────────────────────────

const phases = [
  {
    number: '01',
    name: 'Infection',
    icon: '🦠',
    color: '#e63329',
    duration: 'Auto',
    desc: 'The backend deterministically selects one Clean player to become infected. Only that player receives a private notification — everyone else sees nothing. The infected player must act natural throughout the round.',
  },
  {
    number: '02',
    name: 'Discussion',
    icon: '💬',
    color: '#f5c518',
    duration: '60 s',
    desc: 'Players discuss and debate who might be infected. Clean players may optionally submit a Zero-Knowledge innocence proof to protect themselves. Proof submissions are limited to 1 per player per round and close the moment voting begins.',
  },
  {
    number: '03',
    name: 'Voting',
    icon: '🗳️',
    color: '#39ff14',
    duration: '60 s',
    desc: 'Every alive player casts an on-chain vote for the player they believe is infected. Any player who fails to vote before the timer expires automatically receives a self-vote — their vote is cast against themselves. Silence equals guilt; abstention is never safe.',
  },
  {
    number: '04',
    name: 'Reveal',
    icon: '⚡',
    color: '#8fa882',
    duration: 'Auto',
    desc: 'The smart contract resolves votes, applies the vote-protection rules, eliminates (or saves) a player, checks endgame conditions, and either starts the next round or triggers the final payout.',
  },
]

const voteRules = [
  {
    case: 'A',
    title: 'Single top candidate — no proof',
    color: '#e63329',
    outcome: 'Eliminated',
    desc: 'One player received the most votes and submitted no innocence proof. They are eliminated from the game.',
  },
  {
    case: 'B',
    title: 'Single top candidate — has valid proof',
    color: '#84cc16',
    outcome: 'Saved',
    desc: 'One player received the most votes but proved their innocence during Discussion. They are saved; the game continues with normal infection next round.',
  },
  {
    case: 'C',
    title: 'Tie — at least one infected or unprotected',
    color: '#f5c518',
    outcome: 'Vulnerable player eliminated',
    desc: 'Multiple players share the top vote count. If any tied player is infected, the infected candidate with the lowest keccak256(address) is eliminated. If no infected players are tied, the unprotected clean candidate with the lowest keccak256(address) is eliminated. Protected clean players always survive.',
  },
  {
    case: 'D',
    title: 'Tie — all have valid proofs',
    color: '#8fa882',
    outcome: 'No elimination',
    desc: 'All tied top-voted players proved their innocence during Discussion. Nobody is eliminated and no extra infection is forced — only the Patient Zero drives infection through the normal next-round assignment. A generic message is broadcast; no proof hints are revealed.',
  },
]

const proofRules = [
  {
    icon: '🆓',
    title: 'First proof is free',
    desc: 'Every player gets exactly one free innocence proof per game. No cUSD required.',
  },
  {
    icon: '💸',
    title: 'Additional proofs cost a fee',
    desc: 'After the free proof is used, each subsequent proof requires a fee equal to the room\'s configured proofFee. This fee goes directly to the platform.',
  },
  {
    icon: '1️⃣',
    title: 'One proof per round',
    desc: 'Maximum one proof per player per round, enforced by a nullifier. You cannot spam proofs.',
  },
  {
    icon: '🔐',
    title: 'Only Clean players can prove innocence',
    desc: 'The ZK circuit enforces role == CLEAN. Infected players fail the circuit constraint and cannot produce a valid proof — the chain rejects their submission.',
  },
  {
    icon: '⏰',
    title: 'Submit during Discussion only',
    desc: 'The proof window is open from the start of Discussion and closes the instant voting begins. Proofs submitted outside this window are rejected.',
  },
  {
    icon: '🎲',
    title: 'Strategic gamble',
    desc: 'You must decide whether to use your proof before knowing if you\'ll be the top-voted target. Spending it when you\'re safe wastes a resource; not spending it when targeted costs you the game.',
  },
]

const roles = [
  {
    name: 'Patient Zero',
    icon: '☣️',
    color: '#e63329',
    bgColor: 'rgba(230,51,41,0.1)',
    borderColor: 'rgba(230,51,41,0.4)',
    desc: 'The original source of infection. Has the power to spread the plague each round. If eliminated, the next player in the infection chain is promoted to Patient Zero.',
    winCondition: 'Survive until infected players outnumber or equal clean players alive.',
  },
  {
    name: 'Infected',
    icon: '🦠',
    color: '#f5c518',
    bgColor: 'rgba(245,197,24,0.08)',
    borderColor: 'rgba(245,197,24,0.35)',
    desc: 'Secretly infected by the current Patient Zero. Acts as a normal Clean player to the public while secretly working to let the infection spread. Waiting in succession to become Patient Zero.',
    winCondition: 'Survive until infected players outnumber or equal clean players alive.',
  },
  {
    name: 'Clean',
    icon: '🏃',
    color: '#84cc16',
    bgColor: 'rgba(132,204,22,0.08)',
    borderColor: 'rgba(132,204,22,0.35)',
    desc: 'Knows their role is clean. Must use social deduction and ZK proofs to identify and eliminate infected players before it\'s too late.',
    winCondition: 'Eliminate all infected players before rounds run out.',
  },
]

const endgame = [
  {
    title: 'Clean Win',
    icon: '✅',
    color: '#84cc16',
    condition: 'All infected players are eliminated.',
    payout: 'The entire pot (minus 0.3% platform fee) is split equally among surviving Clean players.',
  },
  {
    title: 'Infected Win',
    icon: '☣️',
    color: '#e63329',
    condition: 'Infected players alive ≥ Clean players alive (including 1 vs 1 parity).',
    payout: 'The pot is split equally among surviving Infected players.',
  },
  {
    title: 'Max Rounds Draw',
    icon: '⏱️',
    color: '#f5c518',
    condition: 'The game reaches the maximum round limit without a decisive win.',
    payout: 'Counts as an Infected win. The pot goes to surviving Infected players.',
  },
]

const patientZeroSuccession = [
  'Initial Patient Zero is set when the first player is ever infected.',
  'Each newly infected player is appended to the infection chain in order.',
  'When the current Patient Zero is eliminated, the next alive player in the chain is promoted.',
  'Example: A infects B, B infects E, E infects C, C infects G. If A is eliminated → B becomes PZ. If B is eliminated → E becomes PZ. And so on.',
  'The current Patient Zero address is public on-chain — players can verify it.',
]

export default function HowToPlayPage() {
  return (
    <main className="min-h-screen" style={{ backgroundColor: '#060b06', color: '#d4c9b2', backgroundImage: 'url(/images/bg-horror.jpg)', backgroundSize: 'cover', backgroundPosition: 'center top', backgroundAttachment: 'fixed' }}>
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundColor: 'rgba(6,11,6,0.88)', zIndex: 0 }} />
      <div className="relative" style={{ zIndex: 1 }}>
      {/* Nav */}
      <div className="px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="mx-auto w-full max-w-6xl">
          <SiteNav currentPath="/how-to-play" />
        </div>
      </div>

      {/* Hero */}
      <header
        className="relative overflow-hidden px-6 py-20"
        style={{ borderBottom: '1px solid rgba(57,255,20,0.2)' }}
      >
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute left-1/4 top-1/2 h-80 w-80 -translate-y-1/2 rounded-full opacity-10 blur-3xl"
            style={{ backgroundColor: '#39ff14' }} />
          <div className="absolute right-1/4 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full opacity-8 blur-3xl"
            style={{ backgroundColor: '#cc1414' }} />
        </div>
        <div className="relative mx-auto w-full max-w-6xl text-center">
          <span
            className="inline-block rounded-full border px-4 py-1.5 font-mono text-xs uppercase tracking-[0.22em]"
            style={{ borderColor: 'rgba(204,20,20,0.4)', backgroundColor: 'rgba(204,20,20,0.08)', color: '#cc1414' }}
          >
            Rules & Instructions
          </span>
          <h1 className="mt-6 font-display text-4xl font-bold leading-none sm:text-6xl lg:text-8xl" style={{ color: '#d4c9b2' }}>
            HOW TO PLAY
          </h1>
          <p className="mx-auto mt-6 max-w-2xl font-mono text-base leading-relaxed" style={{ color: '#4a5e44' }}>
            Plague Protocol is a social deduction game built on Celo. Stake cUSD, earn your role in secret,
            use zero-knowledge proofs to survive, and outlast the infection — or spread it.
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl space-y-20 px-6 py-16">

        {/* ── Overview ────────────────────────────────────────────────────── */}
        <section>
          <SectionTitle number="00" title="The Objective" />
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {roles.map((role) => (
              <div
                key={role.name}
                className="rounded-xl border p-6"
                style={{ backgroundColor: role.bgColor, borderColor: role.borderColor }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{role.icon}</span>
                  <h3 className="font-display text-2xl font-bold" style={{ color: role.color }}>{role.name}</h3>
                </div>
                <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#8fa882' }}>
                  {role.desc}
                </p>
                <div
                  className="mt-4 rounded-lg border px-3 py-2"
                  style={{ borderColor: `${role.color}33`, backgroundColor: `${role.color}0d` }}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>Win Condition</p>
                  <p className="mt-1 font-mono text-xs" style={{ color: role.color }}>{role.winCondition}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Room Lifecycle ───────────────────────────────────────────────── */}
        <section>
          <SectionTitle number="01" title="Room Lifecycle" />
          <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#4a5e44' }}>
            Every game goes through four distinct statuses before it ends.
          </p>
          <div className="mt-8 flex flex-col gap-0">
            {[
              {
                status: 'Waiting',
                color: '#84cc16',
                desc: 'The room is open. Players can join by staking the required cUSD amount. Once the room fills or the host closes it, no more entries are accepted. Rooms automatically expire if not started within the configured time — all stakes are fully refunded.',
                actions: ['Join by staking cUSD', 'Wait for min players (4 minimum)', 'Room expires if unfilled → stakes refunded'],
              },
              {
                status: 'Starting',
                color: '#f5c518',
                desc: 'The host has called startGame. The join window is closed. Each player must now submit their ZK role commitment — a cryptographic binding of their role and secret that cannot be changed. Roles are never revealed on-chain.',
                actions: ['Submit role commitment: Poseidon(role, secret)', 'All players must commit before the game begins', 'No new players can join'],
              },
              {
                status: 'Active',
                color: '#39ff14',
                desc: 'The game is live. Rounds of Infection → Discussion → Voting → Reveal repeat until a win condition is met. All actions (votes, proofs) are on-chain and irreversible.',
                actions: ['Infection, Discussion, Voting, Reveal phases cycle', 'Submit votes and ZK proofs on-chain', 'Watch for phase-change events'],
              },
              {
                status: 'Ended',
                color: '#4a5e44',
                desc: 'The game is over. The smart contract has determined the winner faction and distributed the pot automatically. No admin action needed.',
                actions: ['Pot distributed automatically to winners', 'Platform takes 0.3% fee from pot', 'Results finalized on-chain'],
              },
            ].map((item, i, arr) => (
              <div key={item.status} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 font-mono text-xs font-bold"
                    style={{ borderColor: item.color, backgroundColor: `${item.color}15`, color: item.color }}
                  >
                    {i + 1}
                  </div>
                  {i < arr.length - 1 && (
                    <div className="w-px flex-1" style={{ backgroundColor: 'rgba(57,255,20,0.2)', minHeight: '2rem' }} />
                  )}
                </div>
                <div className="pb-8">
                  <div className="flex items-center gap-3">
                    <span
                      className="rounded border px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-wider"
                      style={{ borderColor: `${item.color}50`, color: item.color, backgroundColor: `${item.color}12` }}
                    >
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-sm leading-relaxed" style={{ color: '#8fa882' }}>{item.desc}</p>
                  <ul className="mt-3 space-y-1">
                    {item.actions.map((a) => (
                      <li key={a} className="flex items-start gap-2 font-mono text-xs" style={{ color: '#4a5e44' }}>
                        <span style={{ color: item.color }}>→</span>
                        {a}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Round Structure ──────────────────────────────────────────────── */}
        <section>
          <SectionTitle number="02" title="Round Structure" />
          <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#4a5e44' }}>
            Each round cycles through four phases. Understanding phase timing is critical to using proofs strategically.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {phases.map((phase) => (
              <div
                key={phase.name}
                className="rounded-xl border p-5"
                style={{ borderColor: `${phase.color}40`, backgroundColor: `${phase.color}0a` }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{phase.icon}</span>
                  <span
                    className="rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
                    style={{ borderColor: `${phase.color}40`, color: phase.color, backgroundColor: `${phase.color}15` }}
                  >
                    {phase.duration}
                  </span>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#4a5e44' }}>{phase.number}</span>
                  <h3 className="font-display text-xl font-bold" style={{ color: phase.color }}>{phase.name}</h3>
                </div>
                <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#4a5e44' }}>{phase.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Patient Zero Succession ──────────────────────────────────────── */}
        <section>
          <SectionTitle number="03" title="Patient Zero Succession" />
          <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#4a5e44' }}>
            The infection has a chain of command. Eliminating Patient Zero doesn&apos;t stop the plague — it just promotes the next infected player.
          </p>
          <div
            className="mt-8 rounded-xl border p-6"
            style={{ borderColor: 'rgba(230,51,41,0.3)', backgroundColor: 'rgba(230,51,41,0.06)' }}
          >
            <ul className="space-y-3">
              {patientZeroSuccession.map((rule, i) => (
                <li key={i} className="flex items-start gap-3 font-mono text-sm" style={{ color: '#8fa882' }}>
                  <span
                    className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                    style={{ backgroundColor: 'rgba(230,51,41,0.2)', color: '#e63329' }}
                  >
                    {i + 1}
                  </span>
                  {rule}
                </li>
              ))}
            </ul>
            <div
              className="mt-5 rounded-lg border p-4"
              style={{ borderColor: 'rgba(57,255,20,0.3)', backgroundColor: 'rgba(57,255,20,0.08)' }}
            >
              <p className="font-mono text-xs uppercase tracking-[0.15em]" style={{ color: '#39ff14' }}>On-Chain Verifiable</p>
              <p className="mt-1 font-mono text-xs" style={{ color: '#4a5e44' }}>
                The current Patient Zero address is stored publicly in the contract (<code className="font-mono" style={{ color: '#8fa882' }}>currentPatientZero[roomId]</code>). Any player can verify who holds the role at any time.
              </p>
            </div>
          </div>
        </section>

        {/* ── Voting & Resolution ──────────────────────────────────────────── */}
        <section>
          <SectionTitle number="04" title="Vote Resolution Rules" />
          <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#4a5e44' }}>
            The smart contract applies deterministic rules to resolve every vote. There is no ambiguity or moderator discretion.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {voteRules.map((rule) => (
              <div
                key={rule.case}
                className="rounded-xl border p-5"
                style={{ borderColor: `${rule.color}40`, backgroundColor: `${rule.color}08` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold"
                      style={{ backgroundColor: `${rule.color}20`, color: rule.color }}
                    >
                      {rule.case}
                    </span>
                    <h3 className="font-mono text-sm font-bold leading-snug" style={{ color: '#d4c9b2' }}>{rule.title}</h3>
                  </div>
                </div>
                <div
                  className="mt-3 inline-block rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
                  style={{ borderColor: `${rule.color}50`, color: rule.color, backgroundColor: `${rule.color}15` }}
                >
                  {rule.outcome}
                </div>
                <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#4a5e44' }}>{rule.desc}</p>
              </div>
            ))}
          </div>
          <div
            className="mt-4 rounded-lg border p-4"
            style={{ borderColor: 'rgba(245,197,24,0.3)', backgroundColor: 'rgba(245,197,24,0.06)' }}
          >
            <p className="font-mono text-xs font-bold" style={{ color: '#f5c518' }}>Absent Vote Rule</p>
            <p className="mt-1 font-mono text-xs" style={{ color: '#4a5e44' }}>
              Any player who does not cast a vote during the Voting phase automatically has a self-vote recorded against them. Silence equals guilt — abstaining is actively dangerous regardless of who else is leading. There is no safe way to skip your vote.
            </p>
          </div>
        </section>

        {/* ── Innocence Proofs ─────────────────────────────────────────────── */}
        <section>
          <SectionTitle number="05" title="Zero-Knowledge Innocence Proofs" />
          <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#4a5e44' }}>
            Proofs are your insurance policy. Use them wisely — they are limited.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {proofRules.map((rule) => (
              <div
                key={rule.title}
                className="rounded-xl border p-5"
                style={{ borderColor: 'rgba(143,168,130,0.25)', backgroundColor: 'rgba(143,168,130,0.05)' }}
              >
                <div className="text-2xl">{rule.icon}</div>
                <h3 className="mt-3 font-mono text-sm font-bold" style={{ color: '#8fa882' }}>{rule.title}</h3>
                <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#4a5e44' }}>{rule.desc}</p>
              </div>
            ))}
          </div>
          <div
            className="mt-6 rounded-xl border p-5"
            style={{ borderColor: 'rgba(57,255,20,0.3)', backgroundColor: 'rgba(6,11,6,0.6)' }}
          >
            <p className="font-mono text-xs font-bold uppercase tracking-[0.15em]" style={{ color: '#39ff14' }}>How the ZK Circuit Works</p>
            <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#4a5e44' }}>
              The innocence proof circuit (built in Noir) verifies that your role is <code style={{ color: '#84cc16' }}>CLEAN</code> without revealing your actual role or secret to anyone.
              Your commitment <code style={{ color: '#8fa882' }}>Poseidon(role, secret)</code> was registered on-chain at game start.
              The nullifier <code style={{ color: '#8fa882' }}>Poseidon(secret, roomId, round)</code> ensures the same proof cannot be replayed across rounds.
              The Groth16 proof is verified on-chain by the ZK verifier contract before the submission is accepted.
            </p>
          </div>
        </section>

        {/* ── Endgame & Payouts ────────────────────────────────────────────── */}
        <section>
          <SectionTitle number="06" title="Endgame & Payouts" />
          <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#4a5e44' }}>
            Win conditions are checked automatically by the contract after every Reveal phase. Payouts are instant and trustless.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {endgame.map((e) => (
              <div
                key={e.title}
                className="rounded-xl border p-5"
                style={{ borderColor: `${e.color}40`, backgroundColor: `${e.color}08` }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{e.icon}</span>
                  <h3 className="font-display text-xl font-bold" style={{ color: e.color }}>{e.title}</h3>
                </div>
                <div
                  className="mt-3 rounded border px-3 py-2"
                  style={{ borderColor: `${e.color}30`, backgroundColor: `${e.color}0d` }}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#4a5e44' }}>Condition</p>
                  <p className="mt-1 font-mono text-xs" style={{ color: '#d4c9b2' }}>{e.condition}</p>
                </div>
                <div
                  className="mt-2 rounded border px-3 py-2"
                  style={{ borderColor: 'rgba(132,204,22,0.25)', backgroundColor: 'rgba(132,204,22,0.07)' }}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#4a5e44' }}>Payout</p>
                  <p className="mt-1 font-mono text-xs" style={{ color: '#84cc16' }}>{e.payout}</p>
                </div>
              </div>
            ))}
          </div>
          <div
            className="mt-4 rounded-lg border p-4"
            style={{ borderColor: 'rgba(245,197,24,0.3)', backgroundColor: 'rgba(245,197,24,0.06)' }}
          >
            <p className="font-mono text-xs font-bold" style={{ color: '#f5c518' }}>Platform Fee</p>
            <p className="mt-1 font-mono text-xs" style={{ color: '#4a5e44' }}>
              A 0.3% platform fee is deducted from the pot at game end before distribution to winners. Proof fees (paid for proofs after your first free one) are collected separately and do not come from the pot.
            </p>
          </div>
        </section>

        {/* ── Tips ────────────────────────────────────────────────────────── */}
        <section>
          <SectionTitle number="07" title="Strategy Tips" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {[
              {
                side: 'clean',
                color: '#84cc16',
                title: 'Playing Clean',
                tips: [
                  'Save your free proof for when you\'re likely to be the top vote target.',
                  'Watch for players who never vote against obvious suspects — they may be protecting their team.',
                  'Coordinate with other trusted clean players to focus votes decisively.',
                  'Submitting a proof too early signals your position — use it only when needed.',
                ],
              },
              {
                side: 'infected',
                color: '#e63329',
                title: 'Playing Infected',
                tips: [
                  'Never vote obviously against the clean faction — it gives you away.',
                  'Cast your vote early and convincingly against a clean player to build false trust.',
                  'If the current Patient Zero is under suspicion, encourage their elimination — you may promote.',
                  'Remember: infected players cannot generate valid innocence proofs. Don\'t try to submit one — it will fail and reveal your status.',
                ],
              },
            ].map((section) => (
              <div
                key={section.side}
                className="rounded-xl border p-5"
                style={{ borderColor: `${section.color}35`, backgroundColor: `${section.color}07` }}
              >
                <h3 className="font-display text-xl font-bold" style={{ color: section.color }}>{section.title}</h3>
                <ul className="mt-4 space-y-2">
                  {section.tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 font-mono text-xs" style={{ color: '#4a5e44' }}>
                      <span className="mt-0.5 flex-shrink-0" style={{ color: section.color }}>→</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA ────────────────────────────────────────────────────────── */}
        <section className="text-center">
          <div
            className="mx-auto max-w-xl rounded-2xl border p-10"
            style={{ borderColor: 'rgba(204,20,20,0.35)', backgroundColor: 'rgba(6,11,6,0.7)' }}
          >
            <h2 className="font-display text-4xl font-bold" style={{ color: '#d4c9b2' }}>Ready to Play?</h2>
            <p className="mt-3 font-mono text-sm" style={{ color: '#4a5e44' }}>
              Connect your wallet, join a room in the lobby, and stake your cUSD.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/lobby"
                className="rounded-xl px-8 py-3 font-mono text-sm font-bold uppercase tracking-wider transition-opacity hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #cc1414, #39ff14)', color: '#060b06' }}
              >
                Browse Lobby
              </Link>
              <Link
                href="/"
                className="rounded-xl border px-8 py-3 font-mono text-sm font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
                style={{ borderColor: 'rgba(57,255,20,0.4)', color: '#39ff14' }}
              >
                Back to Home
              </Link>
            </div>
          </div>
        </section>

      </div>
      </div>
    </main>
  )
}

// ─── Helper ────────────────────────────────────────────────────────────────

function SectionTitle({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: '#39ff14' }}>{number}</span>
      <h2 className="font-display text-3xl font-bold sm:text-4xl" style={{ color: '#d4c9b2' }}>{title}</h2>
    </div>
  )
}
