import type { Metadata } from 'next'
import { InfoPage, InfoSection } from '@/components/ui/info-page'

export const metadata: Metadata = {
  title: 'Privacy — Zombie Plague',
  description: 'What Zombie Plague stores about you (very little) and what lives on-chain.',
}

export default function PrivacyPage() {
  return (
    <InfoPage
      path="/privacy"
      kicker="Containment Protocol"
      title="PRIVACY"
      intro="Short version: no accounts, no emails, no tracking profiles. Your wallet is your identity."
    >
      <InfoSection title="What we store">
        <p>
          Our backend keeps three kinds of data, all tied to your wallet
          address rather than to a real-world identity:
        </p>
        <p>
          <strong>Wallet address</strong> — needed to run rooms, chat, and the
          leaderboard. <strong>Display name</strong> — the nickname you choose;
          pick anything, it doesn&apos;t have to identify you.{' '}
          <strong>Game history</strong> — results, shields used, and room
          activity, which power the leaderboard and stats.
        </p>
        <p>
          We do not collect names, emails, phone numbers, or government IDs,
          and there is no KYC.
        </p>
      </InfoSection>

      <InfoSection title="What lives on-chain (and is public forever)">
        <p>
          Your stakes, joins, votes, shield proofs, and payouts are
          transactions on the Celo blockchain. They are public, permanent, and
          outside anyone&apos;s ability to delete — that is a property of the
          blockchain, not a choice we made. Your hidden role, however, is
          sealed by a zero-knowledge commitment: the chain proves your moves
          were legal without revealing what your role was.
        </p>
      </InfoSection>

      <InfoSection title="Cookies and local storage">
        <p>
          We use your browser&apos;s local storage for game session state
          (wallet connection, sound preference, display name). There are no
          advertising cookies and no cross-site trackers.
        </p>
      </InfoSection>

      <InfoSection title="Third parties">
        <p>
          Requests pass through infrastructure providers we use to run the
          game: blockchain RPC providers, our hosting providers, and your
          wallet software. Each sees the technical data any website&apos;s
          infrastructure sees (such as IP addresses); none of them receive
          personal profiles from us, because we don&apos;t have any.
        </p>
      </InfoSection>

      <InfoSection title="Deletion">
        <p>
          Ask us via the <a href="/support" style={{ color: '#6b8e23' }}>support page</a> and
          we will delete your display name and off-chain game history. On-chain
          records cannot be deleted by anyone.
        </p>
        <p className="font-mono text-xs" style={{ color: '#4a5e44' }}>
          Last updated: July 24, 2026
        </p>
      </InfoSection>
    </InfoPage>
  )
}
