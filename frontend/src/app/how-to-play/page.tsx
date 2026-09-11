'use client'

import { useState } from 'react'
import Link from 'next/link'
import { SiteNav } from '@/components/ui/site-nav'
import { SiteFooter } from '@/components/ui/site-footer'
import { GameWalkthrough } from '@/components/how-to-play/GameWalkthrough'

// ─── Section data ──────────────────────────────────────────────────────────

const quickStart = [
  { icon: '🚪', text: 'Join a room in the Lobby by staking USDm.' },
  { icon: '🔑', text: 'Game starts → set a secret Shield Password.' },
  { icon: '🦠', text: 'Each round someone is secretly infected — starting with a random Patient Zero.' },
  { icon: '🧱', text: 'While you argue, the horde hits a wall. Tap one to defend it — two bodies hold, and four walls cannot all be covered.' },
  { icon: '🛡️', text: "Being framed? Activate your Shield to prove you're clean. Infected players can't." },
  { icon: '🗳️', text: 'Vote out a suspect every round. No vote = a self-vote against you.' },
  { icon: '💰', text: 'Eliminate all infected to split the pot — get outnumbered and you lose your stake.' },
]

/**
 * The Barricade, as rules rather than as an interface.
 *
 * 🚨 THE GEAR CARD IS NOT PADDING. Every survivor on the cam is drawn holding a
 * plank, a pipe or a torch, and a reasonable player will assume that means
 * something — look for a way to pick one, wonder whether a torch beats a plank,
 * and read a wall's outcome as evidence about who was carrying what. It is
 * assigned to the FIGURE, not to the player, and it changes nothing at all.
 * Saying so plainly costs one card; leaving it unsaid costs somebody a round of
 * wrong reasoning with real money on the table.
 */
const barricadeRules = [
  {
    icon: '🧱',
    title: 'You start on a wall',
    desc: 'Every round assigns you one of the four walls. Sending nothing means you held your post — a normal, common play, not a forfeit. Nobody can tell the difference between holding on purpose and never touching the board, which is exactly the point: a slow connection must never look like a tell.',
  },
  {
    icon: '🏃',
    title: 'Tap a wall to move',
    desc: 'Your figure runs there, braces against the boards for a few seconds, then drifts back into the yard. You can change your mind at any point in the phase — not just while a warning is up.',
  },
  {
    icon: '⚠️',
    title: 'A push needs two bodies',
    desc: 'You get eight seconds of warning before the horde hits a named wall. Two defenders hold it. There are four walls and at most a handful of you, so something is always left open — and which something is the argument.',
  },
  {
    icon: '🤐',
    title: 'Holding names nobody',
    desc: 'A wall that holds reports a count and nothing else. A wall that BUCKLES names everyone who was standing there — saboteur and innocent alike. That asymmetry is the whole engine.',
  },
  {
    icon: '☣️',
    title: 'The infected can sabotage',
    desc: 'Instead of defending, an infected player can subtract from their wall. It is never announced and never visible. Sabotage that fails to break a wall leaves no trace at all — but if the wall buckles, you are on the list with everyone else who was there.',
  },
  {
    icon: '🛡️',
    title: 'It cannot kill you',
    desc: 'No wall ever eliminates a player and no wall ever moves a coin. The barricade produces evidence; the vote is still the only thing that costs money. A buckled wall is damage that held — it does not let anything in.',
  },
] as const

/** Reading the quarantine cam. Everything here is about what is TRUE on screen
 *  and what is decoration, which is the distinction players get wrong. */
const camRules = [
  {
    title: 'Only your own figure is you',
    desc: 'Which body is which player is invented separately on every screen. Yours is truthful and labelled YOU; everyone else is anonymous, and no two players see the same arrangement.',
  },
  {
    title: 'The headcounts are real',
    desc: 'The number of figures at each wall matches the number of players actually posted there. The names attached to them do not exist. Count bodies, never faces.',
  },
  {
    title: 'Gear is cosmetic — all of it',
    desc: 'Every survivor carries a plank, a length of pipe or a torch. It belongs to the figure on screen, not to the player behind it, and it does nothing: no damage, no bonus, no way to choose or change one. It is there so that a figure braced against the boards visibly reads as bracing.',
  },
  {
    title: 'Arms out means holding',
    desc: 'A figure turned to a wall with both arms against it is defending that wall. One wandering the middle of the compound is not posted anywhere right now.',
  },
  {
    title: 'Zombies are only ever outside',
    desc: 'Anything hunched over with red eyes is the horde, and the horde is never inside the walls until the game is already lost. Nobody inside the compound is ever drawn as infected — there are no visual tells on players, by design.',
  },
  {
    title: 'What the colours mean',
    desc: 'Amber along a wall: the horde is on it right now. Gouges torn out of the timber: it took a push and held. Red, with the boarding open: the infected reached parity, the walls are down, and the game is over.',
  },
] as const

const phases = [
  {
    number: '01',
    name: 'Infection',
    icon: '🦠',
    color: '#e63329',
    duration: 'Auto',
    desc: 'Round 1: the system selects a Clean player to infect using a deterministic hash. Round 2+: the player Patient Zero voted for in the previous round becomes the infection target (if still eligible). Only the newly infected player receives a private notification — everyone else sees nothing. This makes Patient Zero\'s vote a hidden strategic weapon: it openly nominates a suspect for elimination and secretly queues that same player as the next infection target.',
  },
  {
    number: '02',
    name: 'Discussion',
    icon: '💬',
    color: '#f5c518',
    duration: '180 s',
    desc: "Players discuss and debate who might be infected. Clean players can activate a Shield to prove they're not the zombie without revealing anything else. One Shield per player per round, and the window closes the moment voting begins. This is also when the horde comes for the walls — see The Barricade below.",
  },
  {
    number: '03',
    name: 'Voting',
    icon: '🗳️',
    color: '#6b8e23',
    duration: '120 s',
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
    title: 'Single top candidate — no Shield',
    color: '#e63329',
    outcome: 'Eliminated',
    desc: 'One player got the most votes and never activated a Shield. They get kicked out of the game.',
  },
  {
    case: 'B',
    title: 'Single top candidate — Shield activated',
    color: '#84cc16',
    outcome: 'Saved',
    desc: 'One player got the most votes but activated their Shield during Discussion. They survive; the game continues normally next round.',
  },
  {
    case: 'C',
    title: 'Tie — at least one infected or unprotected',
    color: '#f5c518',
    outcome: 'All vulnerable tied players eliminated',
    desc: 'Multiple players share the top vote count. If any tied player is infected, all tied infected players are kicked out. If none are infected, all tied clean players without a Shield go down. Anyone with an active Shield is safe.',
  },
  {
    case: 'D',
    title: 'Tie — everyone Shielded',
    color: '#8fa882',
    outcome: 'No elimination',
    desc: "Every tied top-voted player activated their Shield. Nobody goes home, and no extra infection is forced — only Patient Zero infects normally next round. The room sees a generic message; nobody learns who Shielded.",
  },
]

const proofRules = [
  {
    icon: '🆓',
    title: 'First Shield is free',
    desc: 'Every player gets one free Shield per game. No USDm needed.',
  },
  {
    icon: '💸',
    title: 'Extra Shields cost a fee',
    desc: "After your free one, each extra Shield costs the room's fee. The fee goes to the platform.",
  },
  {
    icon: '1️⃣',
    title: 'One Shield per round',
    desc: "Max one Shield per player per round. You can't spam them.",
  },
  {
    icon: '🔐',
    title: 'Only Clean players can Shield',
    desc: "Infected players can't fake a Shield — the math literally won't let them. If you're infected, don't try; it will fail and reveal you.",
  },
  {
    icon: '⏰',
    title: 'Discussion phase only',
    desc: "The Shield window opens when Discussion starts and slams shut the moment voting begins. Miss it and you're on your own.",
  },
  {
    icon: '🎲',
    title: 'Strategic gamble',
    desc: "You have to decide whether to Shield before you know who'll be the top vote target. Use it when safe and you waste it; don't use it when targeted and you lose the game.",
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
    winCondition: 'Survive until infected players strictly outnumber clean players alive.',
  },
  {
    name: 'Infected',
    icon: '🦠',
    color: '#f5c518',
    bgColor: 'rgba(245,197,24,0.08)',
    borderColor: 'rgba(245,197,24,0.35)',
    desc: 'Secretly infected by the current Patient Zero. Acts as a normal Clean player to the public while secretly working to let the infection spread. Waiting in succession to become Patient Zero.',
    winCondition: 'Survive until infected players strictly outnumber clean players alive.',
  },
  {
    name: 'Clean',
    icon: '🏃',
    color: '#84cc16',
    bgColor: 'rgba(132,204,22,0.08)',
    borderColor: 'rgba(132,204,22,0.35)',
    desc: "You know you're clean. Use deduction and your Shield to find the infected before they take everyone down.",
    winCondition: 'Eliminate all infected players before rounds run out.',
  },
]

const endgame = [
  {
    title: 'Clean Win',
    icon: '✅',
    color: '#84cc16',
    condition: 'All infected players are eliminated.',
    payout: 'The entire pot (minus 1.5% platform fee) is split equally among surviving Clean players.',
  },
  {
    title: 'Infected Win',
    icon: '☣️',
    color: '#e63329',
    condition: 'Infected players alive > Clean players alive.',
    payout: 'The pot is split equally among surviving Infected players.',
  },
  {
    title: '1 vs 1 Draw',
    icon: '⚖️',
    color: '#d4c9b2',
    condition: 'Exactly 1 infected alive and 1 clean alive at Reveal finalization.',
    payout: 'Draw outcome. No faction win is declared.',
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
  // Which rule section is expanded on mobile — one at a time, so working down
  // the page does not leave a trail of open sections behind you. Desktop
  // ignores this entirely and shows every section.
  const [openSection, setOpenSection] = useState<string | null>(null)

  return (
    <main className="min-h-screen" style={{ backgroundColor: '#060b06', color: '#d4c9b2', backgroundImage: 'url(/images/bg-horror.webp)', backgroundSize: 'cover', backgroundPosition: 'center top', backgroundAttachment: 'fixed' }}>
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundColor: 'rgba(6,11,6,0.88)', zIndex: 0 }} />
      <div className="relative" style={{ zIndex: 1 }}>
      {/* Nav */}
      <div className="sticky top-0 z-50 px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="mx-auto w-full max-w-6xl">
          <SiteNav currentPath="/how-to-play" />
        </div>
      </div>

      {/* Hero */}
      <header
        className="relative overflow-hidden px-4 sm:px-6 py-8 sm:py-20"
        style={{ borderBottom: '1px solid rgba(107,142,35,0.2)' }}
      >
        <div className="relative mx-auto w-full max-w-6xl text-center">
          <span
            className="inline-block rounded-full border px-4 py-1.5 font-mono text-xs uppercase tracking-[0.22em]"
            style={{ borderColor: 'rgba(204,20,20,0.4)', backgroundColor: 'rgba(204,20,20,0.08)', color: '#cc1414' }}
          >
            Rules & Instructions
          </span>
          <h1 className="mt-4 sm:mt-6 font-display text-3xl font-bold leading-none sm:text-6xl lg:text-8xl" style={{ color: '#d4c9b2' }}>
            HOW TO PLAY
          </h1>
          <p className="mx-auto mt-4 sm:mt-6 max-w-2xl font-mono text-sm sm:text-base leading-relaxed" style={{ color: '#7d9a72' }}>
            Stake your USDm, find Patient Zero before they turn everyone, and walk away with the
            pot. Activate your Shield if you&apos;re being framed — but you only get one free, so
            spend it wisely.
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl space-y-6 sm:space-y-20 px-4 sm:px-6 py-8 sm:py-16">

        {/* ── Watch a round before reading about one ────────────────────────── */}
        <GameWalkthrough />

        {/* ── Quick Start — everything you need, in 6 lines ─────────────────── */}
        <section
          className="rounded-2xl border p-5 sm:p-8"
          style={{ borderColor: 'rgba(204,20,20,0.35)', backgroundColor: 'rgba(6,11,6,0.7)' }}
        >
          <div className="flex items-baseline gap-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: '#cc1414' }}>⚡</span>
            <h2 className="font-heading text-2xl font-bold sm:text-3xl md:text-4xl" style={{ color: '#d4c9b2' }}>Quick Start</h2>
          </div>
          <ol className="mt-5 space-y-3">
            {quickStart.map((step, i) => (
              <li key={step.text} className="flex items-start gap-3 font-mono text-sm leading-snug" style={{ color: '#8fa882' }}>
                <span
                  className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold"
                  style={{ backgroundColor: 'rgba(107,142,35,0.15)', color: '#6b8e23', border: '1px solid rgba(107,142,35,0.4)' }}
                >
                  {i + 1}
                </span>
                <span><span className="mr-1.5">{step.icon}</span>{step.text}</span>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/demo"
              className="flex-1 rounded-xl px-6 py-3 text-center font-mono text-sm font-bold uppercase tracking-wider transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #cc1414, #c97a12)', color: '#060b06' }}
            >
              Try the Free Demo →
            </Link>
            <Link
              href="/lobby"
              className="flex-1 rounded-xl border px-6 py-3 text-center font-mono text-sm font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
              style={{ borderColor: 'rgba(107,142,35,0.4)', color: '#6b8e23' }}
            >
              Play for Real
            </Link>
          </div>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] sm:hidden" style={{ color: '#7d9a72' }}>
            Tap any section below for the full rules ↓
          </p>
        </section>

        {/* ── Overview ────────────────────────────────────────────────────── */}
        <CollapsibleSection number="00" title="The Objective" openSection={openSection} setOpenSection={setOpenSection}>
          <div className="mt-6 sm:mt-8 grid gap-4 md:grid-cols-3">
            {roles.map((role) => (
              <div
                key={role.name}
                className="rounded-xl border p-4 sm:p-6"
                style={{ backgroundColor: role.bgColor, borderColor: role.borderColor }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{role.icon}</span>
                  <h3 className="font-heading text-2xl font-bold" style={{ color: role.color }}>{role.name}</h3>
                </div>
                <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#8fa882' }}>
                  {role.desc}
                </p>
                <div
                  className="mt-4 rounded-lg border px-3 py-2"
                  style={{ borderColor: `${role.color}33`, backgroundColor: `${role.color}0d` }}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#7d9a72' }}>Win Condition</p>
                  <p className="mt-1 font-mono text-xs" style={{ color: role.color }}>{role.winCondition}</p>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>

        {/* ── Room Lifecycle ───────────────────────────────────────────────── */}
        <CollapsibleSection number="01" title="Room Lifecycle" openSection={openSection} setOpenSection={setOpenSection}>
          <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#7d9a72' }}>
            Every game goes through four distinct statuses before it ends.
          </p>
          <div className="mt-8 flex flex-col gap-0">
            {[
              {
                status: 'Waiting',
                color: '#84cc16',
                desc: 'The room is open. Players can join by staking the required USDm amount. Once the room fills or the host closes it, no more entries are accepted. Rooms automatically expire if not started within the configured time — all stakes are fully refunded.',
                actions: ['Join by staking USDm', 'Wait for min players (4 minimum)', 'Room expires if unfilled → stakes refunded'],
              },
              {
                status: 'Starting',
                color: '#f5c518',
                desc: "The host started the game and the join window is closed. Every player has to lock in their secret role within a short window. If too few players lock in, the game ends early — the ones who locked in split the pot, the rest get refunded.",
                actions: ['Set your Shield Password to lock in your role', 'Lock in fast — missing the window can end the game early', 'No new players can join'],
              },
              {
                status: 'Active',
                color: '#6b8e23',
                desc: 'The game is live. Rounds of Infection → Discussion → Voting → Reveal repeat until one side wins. Every action is locked in on-chain — no take-backs.',
                actions: ['Infection, Discussion, Voting, Reveal phases cycle', 'Cast votes and activate Shields on-chain', 'Watch for phase-change events'],
              },
              {
                status: 'Ended',
                color: '#7d9a72',
                desc: 'The game is over. The smart contract has determined the winner faction and distributed the pot automatically. No admin action needed.',
                actions: ['Pot distributed automatically to winners', 'Platform takes 1.5% fee from pot', 'Results finalized on-chain'],
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
                    <div className="w-px flex-1" style={{ backgroundColor: 'rgba(107,142,35,0.2)', minHeight: '2rem' }} />
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
                      <li key={a} className="flex items-start gap-2 font-mono text-xs" style={{ color: '#7d9a72' }}>
                        <span style={{ color: item.color }}>→</span>
                        {a}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>

        {/* ── Round Structure ──────────────────────────────────────────────── */}
        <CollapsibleSection number="02" title="Round Structure" openSection={openSection} setOpenSection={setOpenSection}>
          <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#7d9a72' }}>
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
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: '#7d9a72' }}>{phase.number}</span>
                  <h3 className="font-heading text-xl font-bold" style={{ color: phase.color }}>{phase.name}</h3>
                </div>
                <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#7d9a72' }}>{phase.desc}</p>
              </div>
            ))}
          </div>
        </CollapsibleSection>

        {/* ── Patient Zero Succession ──────────────────────────────────────── */}
        <CollapsibleSection number="03" title="Patient Zero Succession" openSection={openSection} setOpenSection={setOpenSection}>
          <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#7d9a72' }}>
            The infection has a chain of command. Eliminating Patient Zero doesn&apos;t stop the plague — it just promotes the next infected player.
          </p>
          <div
            className="mt-8 rounded-xl border p-6"
            style={{ borderColor: 'rgba(230,51,41,0.3)', backgroundColor: 'rgba(230,51,41,0.06)' }}
          >
            <ul className="space-y-3">
              {patientZeroSuccession.map((rule, i) => (
                <li key={rule} className="flex items-start gap-3 font-mono text-sm" style={{ color: '#8fa882' }}>
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
              style={{ borderColor: 'rgba(107,142,35,0.3)', backgroundColor: 'rgba(107,142,35,0.08)' }}
            >
              <p className="font-mono text-xs uppercase tracking-[0.15em]" style={{ color: '#6b8e23' }}>On-Chain Verifiable</p>
              <p className="mt-1 font-mono text-xs" style={{ color: '#7d9a72' }}>
                The current Patient Zero address is stored publicly in the contract (<code className="font-mono" style={{ color: '#8fa882' }}>currentPatientZero[roomId]</code>). Any player can verify who holds the role at any time.
              </p>
            </div>
          </div>
        </CollapsibleSection>

        {/* ── Voting & Resolution ──────────────────────────────────────────── */}
        <CollapsibleSection number="04" title="Vote Resolution Rules" openSection={openSection} setOpenSection={setOpenSection}>
          <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#7d9a72' }}>
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
                <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#7d9a72' }}>{rule.desc}</p>
              </div>
            ))}
          </div>
          <div
            className="mt-4 rounded-lg border p-4"
            style={{ borderColor: 'rgba(245,197,24,0.3)', backgroundColor: 'rgba(245,197,24,0.06)' }}
          >
            <p className="font-mono text-xs font-bold" style={{ color: '#f5c518' }}>Absent Vote Rule</p>
            <p className="mt-1 font-mono text-xs" style={{ color: '#7d9a72' }}>
              Any player who does not cast a vote during the Voting phase automatically has a self-vote recorded against them. Silence equals guilt — abstaining is actively dangerous regardless of who else is leading. There is no safe way to skip your vote.
            </p>
          </div>
        </CollapsibleSection>

        {/* ── Innocence Proofs ─────────────────────────────────────────────── */}
        <CollapsibleSection number="05" title="Shields" openSection={openSection} setOpenSection={setOpenSection}>
          <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#7d9a72' }}>
            Shields are your insurance policy. Use them wisely — they are limited.
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
                <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#7d9a72' }}>{rule.desc}</p>
              </div>
            ))}
          </div>
          <div
            className="mt-6 rounded-xl border p-5"
            style={{ borderColor: 'rgba(107,142,35,0.3)', backgroundColor: 'rgba(6,11,6,0.6)' }}
          >
            <p className="font-mono text-xs font-bold uppercase tracking-[0.15em]" style={{ color: '#6b8e23' }}>Under the Hood (for the curious)</p>
            <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#7d9a72' }}>
              The Shield circuit (built in Noir) proves your role is <code style={{ color: '#84cc16' }}>CLEAN</code> without revealing your role or your secret to anyone.
              Your commitment <code style={{ color: '#8fa882' }}>Poseidon(role, secret)</code> was registered on-chain at game start.
              The nullifier <code style={{ color: '#8fa882' }}>Poseidon(secret, roomId, round)</code> stops the same Shield from being replayed across rounds.
              The Groth16 proof is verified on-chain before the Shield is accepted.
            </p>
          </div>
        </CollapsibleSection>

        {/* ── The Barricade ────────────────────────────────────────────────── */}
        <CollapsibleSection number="06" title="The Barricade" openSection={openSection} setOpenSection={setOpenSection}>
          <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#7d9a72' }}>
            Discussion is three minutes long, and for most of it the horde is working on the walls.
            You decide where to stand. What comes out of it is an argument, never a casualty.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {barricadeRules.map((rule) => (
              <div
                key={rule.title}
                className="rounded-xl border p-5"
                style={{ borderColor: 'rgba(245,197,24,0.25)', backgroundColor: 'rgba(245,197,24,0.05)' }}
              >
                <div className="text-2xl">{rule.icon}</div>
                <h3 className="mt-3 font-mono text-sm font-bold" style={{ color: '#f5c518' }}>{rule.title}</h3>
                <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#7d9a72' }}>{rule.desc}</p>
              </div>
            ))}
          </div>

          <div
            className="mt-6 rounded-xl border p-5"
            style={{ borderColor: 'rgba(107,142,35,0.3)', backgroundColor: 'rgba(6,11,6,0.6)' }}
          >
            <p className="font-mono text-xs font-bold uppercase tracking-[0.15em]" style={{ color: '#6b8e23' }}>Reading the Quarantine Cam</p>
            <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#7d9a72' }}>
              The cam is the barricade — the compound you are watching is the room you are in.
              Some of what it shows is true, some of it is scenery, and the difference matters.
            </p>
            <dl className="mt-4 space-y-3">
              {camRules.map((rule) => (
                <div key={rule.title}>
                  <dt className="font-mono text-xs font-bold" style={{ color: '#8fa882' }}>{rule.title}</dt>
                  <dd className="mt-1 font-mono text-xs leading-relaxed" style={{ color: '#7d9a72' }}>{rule.desc}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div
            className="mt-6 rounded-xl border p-5"
            style={{ borderColor: 'rgba(230,51,41,0.3)', backgroundColor: 'rgba(230,51,41,0.06)' }}
          >
            <p className="font-mono text-xs font-bold uppercase tracking-[0.15em]" style={{ color: '#e63329' }}>Why this is worth arguing about</p>
            <p className="mt-2 font-mono text-xs leading-relaxed" style={{ color: '#7d9a72' }}>
              A wall needs two defenders. So a wall that buckles with one name on it means either that
              person sabotaged it — or nobody came to help them and they were always going to fail alone.
              Both stories fit the same evidence, every time. The barricade is built to hand you that
              ambiguity rather than a confession: it starts the argument, and the vote is where you pay
              for getting it wrong.
            </p>
          </div>
        </CollapsibleSection>

        {/* ── Endgame & Payouts ────────────────────────────────────────────── */}
        <CollapsibleSection number="07" title="Endgame & Payouts" openSection={openSection} setOpenSection={setOpenSection}>
          <p className="mt-3 font-mono text-sm leading-relaxed" style={{ color: '#7d9a72' }}>
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
                  <h3 className="font-heading text-xl font-bold" style={{ color: e.color }}>{e.title}</h3>
                </div>
                <div
                  className="mt-3 rounded border px-3 py-2"
                  style={{ borderColor: `${e.color}30`, backgroundColor: `${e.color}0d` }}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#7d9a72' }}>Condition</p>
                  <p className="mt-1 font-mono text-xs" style={{ color: '#d4c9b2' }}>{e.condition}</p>
                </div>
                <div
                  className="mt-2 rounded border px-3 py-2"
                  style={{ borderColor: 'rgba(132,204,22,0.25)', backgroundColor: 'rgba(132,204,22,0.07)' }}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#7d9a72' }}>Payout</p>
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
            <p className="mt-1 font-mono text-xs" style={{ color: '#7d9a72' }}>
              A 1.5% platform fee is deducted from the pot at game end before distribution to winners. Proof fees (paid for proofs after your first free one) are collected separately and do not come from the pot.
            </p>
          </div>
        </CollapsibleSection>

        {/* ── Tips ────────────────────────────────────────────────────────── */}
        <CollapsibleSection number="08" title="Strategy Tips" openSection={openSection} setOpenSection={setOpenSection}>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {[
              {
                side: 'clean',
                color: '#84cc16',
                title: 'Playing Clean',
                tips: [
                  "Save your free Shield for when you're about to be voted out.",
                  'Watch for players who never vote against obvious suspects — they might be covering for their team.',
                  'Team up with trusted clean players and focus votes decisively.',
                  "Shielding too early tips your hand — only do it when you need to.",
                ],
              },
              {
                side: 'infected',
                color: '#e63329',
                title: 'Playing Infected',
                tips: [
                  'Never vote obviously against the clean side — it gives you away.',
                  'Vote early and convincingly against a clean player to build false trust.',
                  "If the current Patient Zero is under suspicion, push for their elimination — you might get promoted.",
                  "You can't fake a Shield — the math will reject you. Don't try; it will publicly out you.",
                ],
              },
            ].map((section) => (
              <div
                key={section.side}
                className="rounded-xl border p-5"
                style={{ borderColor: `${section.color}35`, backgroundColor: `${section.color}07` }}
              >
                <h3 className="font-heading text-xl font-bold" style={{ color: section.color }}>{section.title}</h3>
                <ul className="mt-4 space-y-2">
                  {section.tips.map((tip) => (
                    <li key={`${section.side}-${tip}`} className="flex items-start gap-2 font-mono text-xs" style={{ color: '#7d9a72' }}>
                      <span className="mt-0.5 flex-shrink-0" style={{ color: section.color }}>→</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CollapsibleSection>

        {/* ── CTA ────────────────────────────────────────────────────────── */}
        <section className="text-center">
          <div
            className="mx-auto max-w-xl rounded-2xl border p-6 sm:p-10"
            style={{ borderColor: 'rgba(204,20,20,0.35)', backgroundColor: 'rgba(6,11,6,0.7)' }}
          >
            <h2 className="font-heading text-2xl sm:text-4xl font-bold" style={{ color: '#d4c9b2' }}>Ready to Play?</h2>
            <p className="mt-3 font-mono text-sm" style={{ color: '#7d9a72' }}>
              Sign in, join a room in the lobby, and stake your USDm.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/lobby"
                className="rounded-xl px-8 py-3 font-mono text-sm font-bold uppercase tracking-wider transition-opacity hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #cc1414, #c97a12)', color: '#060b06' }}
              >
                Browse Lobby
              </Link>
              <Link
                href="/"
                className="rounded-xl border px-8 py-3 font-mono text-sm font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
                style={{ borderColor: 'rgba(107,142,35,0.4)', color: '#6b8e23' }}
              >
                Back to Home
              </Link>
            </div>
            <p className="mt-6 font-mono text-xs" style={{ color: '#7d9a72' }}>
              More questions?{' '}
              <Link href="/support" className="underline underline-offset-4" style={{ color: '#6b8e23' }}>
                FAQ &amp; Support
              </Link>
            </p>
          </div>
        </section>

      </div>
      </div>

      <SiteFooter />
    </main>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Detail section that stays fully expanded on desktop but collapses to a
 * tap-to-open header on mobile, so phone users aren't forced to scroll
 * through every rule before they can play.
 *
 * 🚨 ONE OPEN AT A TIME, and the state lives in the PARENT.
 * Nine sections each holding their own `open` meant a reader working down the
 * page left a trail of expanded rules behind them, and the scroll this exists
 * to prevent came back by the third tap. `openSection` is lifted to the page so
 * opening one closes the last — same behaviour as the homepage cards.
 *
 * Desktop is unaffected: `sm:block` keeps every section expanded and the header
 * non-interactive there, so this only governs the mobile accordion.
 */
function CollapsibleSection({
  number,
  title,
  openSection,
  setOpenSection,
  children,
}: Readonly<{
  number: string
  title: string
  openSection: string | null
  setOpenSection: (n: string | null) => void
  children: React.ReactNode
}>) {
  const open = openSection === number
  const setOpen = (next: boolean) => setOpenSection(next ? number : null)
  return (
    <section
      className="rounded-xl border px-4 py-4 sm:rounded-none sm:border-0 sm:p-0"
      style={{ borderColor: 'rgba(107,142,35,0.25)' }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 text-left sm:pointer-events-none sm:cursor-default"
      >
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: '#6b8e23' }}>{number}</span>
          <h2 className="font-heading text-xl font-bold sm:text-3xl md:text-4xl" style={{ color: '#d4c9b2' }}>{title}</h2>
        </div>
        <span className="sm:hidden font-mono text-xl leading-none flex-shrink-0" style={{ color: '#6b8e23' }} aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      <div className={`${open ? 'block' : 'hidden'} sm:block`}>
        {children}
      </div>
    </section>
  )
}
