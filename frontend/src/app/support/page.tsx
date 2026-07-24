import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { InfoPage } from '@/components/ui/info-page'

export const metadata: Metadata = {
  title: 'FAQ & Support — Zombie Plague',
  description: 'Answers about stakes, USDm, AI bots, refunds, points, and what to do when something looks stuck.',
}

/**
 * Each entry carries a plain-text `answer` (used verbatim in the FAQPage
 * JSON-LD, which search engines read) and an optional richer `body` with
 * links for the visible accordion. Keep the two saying the same thing.
 */
type Faq = { question: string; answer: string; body?: ReactNode }

const link = { color: '#6b8e23' }

const FAQS: Faq[] = [
  {
    question: 'What is Zombie Plague?',
    answer:
      'A social deduction game on the Celo blockchain. Players stake USDm to enter a room, one of them is secretly Patient Zero, and each round everyone votes on who to eliminate. The winning faction splits the pot. Roles are sealed with zero-knowledge proofs, and every stake, vote, and payout is an on-chain transaction.',
  },
  {
    question: 'What is USDm, and why not USDC or USDT?',
    answer:
      'USDm (also called cUSD) is Celo’s native Mento stable dollar. The game contract escrows and pays out in USDm only. If you hold USDC or USDT — common on MiniPay — the lobby shows a banner that takes you to MiniPay’s balance screen, where converting takes a couple of taps.',
  },
  {
    question: 'What is the minimum stake?',
    answer:
      'Whatever the room sets — there is no meaningful floor, and micro-stake rooms of a fraction of a cent are fine. Stake small while you learn; the game plays exactly the same.',
  },
  {
    question: 'Are the AI bots fair? Do they see my role?',
    answer:
      'No. The bots are autonomous on-chain agents (built on the ERC-8004 identity standard) that stake real USDm, pay the same fees, and follow the same rules as everyone else. Roles are sealed cryptographically, so bots — and we ourselves — cannot see them. Bots exist so there is always a game to join.',
  },
  {
    question: 'How are roles kept secret?',
    answer:
      'When a game starts, each player locks in a hidden role commitment using zero-knowledge proofs. The chain can verify every later move was legal without ever revealing who Patient Zero is. Nobody — not other players, not the bots, not us — can peek.',
  },
  {
    question: 'How do leaderboard points work?',
    answer:
      'Every game earns points: 10 for a win, 4 for a draw, 1 just for playing, 3 per shield used, and 2 for surviving to the end. Points build slowly by design — a high rank means sustained play, not one lucky night. The monthly board starts fresh on the 1st of each month, so everyone gets a clean shot at the top; the Global board keeps the all-time record.',
    body: (
      <p>
        Every game earns points: <strong>10</strong> for a win,{' '}
        <strong>4</strong> for a draw, <strong>1</strong> just for playing,{' '}
        <strong>3</strong> per shield used, and <strong>2</strong> for
        surviving to the end. Points build slowly by design — a high rank
        means sustained play, not one lucky night. The monthly board starts
        fresh on the 1st, so everyone gets a clean shot at the top; the
        Global board keeps the all-time record. See the{' '}
        <Link href="/leaderboard" style={link}>leaderboard</Link>.
      </p>
    ),
  },
  {
    question: 'My room expired and my stake is locked',
    answer:
      'Any player who staked in the room — not just the host — can free it. Open the lobby, find your expired room card, and tap End & Refund. The contract refunds every player’s full stake in one transaction. You never need to wait for the host.',
    body: (
      <p>
        Any player who staked in the room — not just the host — can free it.
        Open the <Link href="/lobby" style={link}>lobby</Link>, find your
        expired room card, and tap <strong>End &amp; Refund</strong>. The
        contract refunds every player&apos;s full stake in one transaction.
        You never need to wait for the host.
      </p>
    ),
  },
  {
    question: 'Two of us pressed End & Refund at the same time — did something break?',
    answer:
      'No. Whichever transaction lands first refunds the entire room; the second one simply fails because the room is already ended. If you were second, you may see an error message, but check your balance — your refund already arrived from the first transaction. A double refund is impossible.',
  },
  {
    question: 'The game froze at the start',
    answer:
      'Every player has 3 minutes after a game starts to lock in their role. If too few make it in time, the start is voided automatically: players who locked in split the escrowed pot (including the stakes of the no-shows), and if nobody locked in, everyone is refunded in full. Refresh after a few minutes — payouts are visible on-chain immediately.',
  },
  {
    question: 'What happens if I close the app or lose connection mid-game?',
    answer:
      'The game lives on-chain, not in your browser — reopen the app and the match screen picks up right where the game actually is. Round timers do not pause for you, though: miss a vote and that round resolves without your voice, so get back in quickly.',
  },
  {
    question: 'My transaction failed',
    answer:
      'The two usual causes: your USDm balance is lower than the room’s stake plus proof fee, or (outside MiniPay) your wallet has no CELO for gas — a few cents’ worth is plenty. MiniPay users don’t need to think about gas; MiniPay handles fees from your stable balance.',
  },
  {
    question: 'Where did part of the pot go?',
    answer:
      'The winning faction splits the pot minus a 1.5% platform fee. Shield proof fees are set per-room and shown before you join. There are no other charges.',
  },
  {
    question: 'Can I verify any of this?',
    answer:
      'Yes. The game contract is verified on Blockscout — every stake, vote, shield, payout, and refund is a public transaction you can inspect. The link is in the footer of every page.',
  },
]

function FaqItem({ faq }: Readonly<{ faq: Faq }>) {
  return (
    <details
      className="group rounded-xl border"
      style={{ backgroundColor: '#0a100a', borderColor: 'rgba(107,142,35,0.18)' }}
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 [&::-webkit-details-marker]:hidden"
      >
        <h2 className="font-heading text-lg font-bold sm:text-xl" style={{ color: '#d4c9b2' }}>
          {faq.question}
        </h2>
        <span
          className="flex-shrink-0 font-mono text-xl leading-none transition-transform group-open:rotate-45"
          style={{ color: '#6b8e23' }}
          aria-hidden="true"
        >
          +
        </span>
      </summary>
      <div
        className="space-y-3 border-t px-6 py-4 font-body text-sm leading-relaxed"
        style={{ color: '#a0bb94', borderColor: 'rgba(107,142,35,0.12)' }}
      >
        {faq.body ?? <p>{faq.answer}</p>}
      </div>
    </details>
  )
}

export default function SupportPage() {
  // FAQPage structured data so search engines can surface these Q&As directly.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map(f => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  }

  return (
    <InfoPage
      path="/support"
      kicker="Field Medic Station"
      title="FAQ & SUPPORT"
      intro="Most problems have an on-chain answer you can trigger yourself. Check the field manual below first — then radio us."
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="flex flex-col gap-3">
        {FAQS.map(faq => (
          <FaqItem key={faq.question} faq={faq} />
        ))}
      </div>

      <section
        className="rounded-xl border p-6"
        style={{ backgroundColor: '#0a100a', borderColor: 'rgba(230,51,41,0.25)' }}
      >
        <h2 className="font-heading text-xl font-bold sm:text-2xl" style={{ color: '#d4c9b2' }}>
          Radio us
        </h2>
        <div className="mt-3 space-y-3 font-body text-sm leading-relaxed" style={{ color: '#a0bb94' }}>
          <p>
            Still stuck? Email{' '}
            <a href="mailto:support@zplague.xyz" style={link}>
              support@zplague.xyz
            </a>{' '}
            with your wallet address and the room number. Include a transaction
            hash if you have one — it&apos;s the fastest way for us to trace
            what happened.
          </p>
        </div>
      </section>
    </InfoPage>
  )
}
