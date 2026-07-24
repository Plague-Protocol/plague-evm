import type { Metadata } from 'next'
import { InfoPage, InfoSection } from '@/components/ui/info-page'

export const metadata: Metadata = {
  title: 'Terms of Play — Zombie Plague',
  description: 'The rules of engagement for playing Zombie Plague on Celo.',
}

export default function TermsPage() {
  return (
    <InfoPage
      path="/terms"
      kicker="Rules of Engagement"
      title="TERMS OF PLAY"
      intro="Plain language, no ambush clauses. This is what you agree to by playing Zombie Plague."
    >
      <InfoSection title="1. What Zombie Plague is">
        <p>
          Zombie Plague is a skill-based social deduction game that runs on the
          Celo blockchain. Players stake USDm (cUSD) to enter a room, receive a
          hidden role sealed by a zero-knowledge commitment, and vote each round
          to find Patient Zero. The winning faction splits the pot. Outcomes are
          decided by the players&apos; deduction, persuasion, and voting — not by
          chance operated by us.
        </p>
      </InfoSection>

      <InfoSection title="2. Non-custodial stakes">
        <p>
          Your stake goes directly from your wallet into an on-chain escrow
          contract. We never hold your funds, cannot move them for you, and
          cannot reverse a transaction once it is confirmed. Payouts and refunds
          are executed by the smart contract, not by a company account.
        </p>
        <p>
          A platform fee of <strong>1.5% of the pot</strong> is deducted at
          payout. Rooms may also set a per-shield proof fee, shown before you
          join.
        </p>
      </InfoSection>

      <InfoSection title="3. Refunds">
        <p>
          Stakes are refunded automatically by the contract in two situations:
        </p>
        <p>
          <strong>Room expired before starting</strong> — if a room never fills,
          anyone who staked in it (host or not) can end it after its expiry
          timer and every player gets their full stake back.
        </p>
        <p>
          <strong>Game failed to start</strong> — every player must lock in
          their role within 3 minutes of a game starting. If too few do, the
          start is voided: players who locked in split the escrowed pot
          (including the stakes of players who didn&apos;t show up), and if
          nobody locked in, everyone is refunded in full. Failing to commit
          your role in a started game can therefore forfeit your stake — this
          protects the players who showed up.
        </p>
        <p>
          A game that plays out normally is final: losing your stake to the
          winning faction is the game working as designed, not something we can
          refund.
        </p>
      </InfoSection>

      <InfoSection title="4. AI agents play here">
        <p>
          Public rooms may include autonomous AI agents (on-chain bots built on
          the ERC-8004 identity standard). They stake real USDm, pay the same
          fees, follow the same rules, and win or lose like any other player.
          They exist so there is always a game to join — they receive no hidden
          information and no special treatment from the contract.
        </p>
      </InfoSection>

      <InfoSection title="5. Fair play">
        <p>
          Roles are sealed with zero-knowledge proofs so nobody — including us —
          can peek. Attempting to exploit the contracts, collude across multiple
          wallets in one room, or interfere with other players&apos; access may
          result in exclusion from off-chain services (lobby, chat,
          leaderboard). The contracts themselves are public and permissionless.
        </p>
      </InfoSection>

      <InfoSection title="6. Eligibility and your responsibility">
        <p>
          You must be at least 18 years old (or the age of majority where you
          live) and it is your responsibility to ensure that playing a
          stake-based game is lawful in your jurisdiction. Only stake what you
          can afford to lose.
        </p>
      </InfoSection>

      <InfoSection title="7. No warranty">
        <p>
          The game, contracts, and interface are provided as-is. Blockchains,
          wallets, and networks can fail in ways outside our control, and smart
          contracts can contain bugs despite testing. To the maximum extent
          permitted by law, we are not liable for losses arising from your use
          of the protocol.
        </p>
      </InfoSection>

      <InfoSection title="8. Changes">
        <p>
          We may update these terms as the game evolves. Material changes will
          be reflected on this page. Continuing to play after a change means you
          accept it.
        </p>
        <p className="font-mono text-xs" style={{ color: '#4a5e44' }}>
          Last updated: July 24, 2026
        </p>
      </InfoSection>
    </InfoPage>
  )
}
