/**
 * Auto-answers, kept deliberately in sync with the wording on
 * frontend/src/app/support/page.tsx. If you change one, change the other —
 * a bot that contradicts the site is worse than no bot.
 *
 * Copy rules follow MiniPay's: no "gas", no "crypto", no CELO for MiniPay users.
 * Say "network fee" and "stablecoin".
 */

export interface FaqEntry {
  id: string
  /** Button label in the triage menu. Short — Telegram truncates. */
  label: string
  patterns: RegExp[]
  answer: string
}

export const FAQ: FaqEntry[] = [
  {
    id: 'stake-failed',
    label: '💸 Stake or payout issue',
    patterns: [/stake/i, /payout/i, /pot/i, /refund/i, /\bpay\b/i],
    answer:
      "*Stake or payout trouble*\n\n" +
      "Two usual causes:\n" +
      "1. Your USDm balance is below the room's stake plus the proof fee.\n" +
      "2. Outside MiniPay, your wallet has no CELO for the network fee — a few cents' worth is plenty. " +
      "In MiniPay you never need to think about this; it pays the fee from your stablecoin balance.\n\n" +
      "Payouts settle on-chain the moment a game ends, so they're visible immediately on the explorer.\n\n" +
      "Still stuck? Reply with your *wallet address* and the *room number* — and a *transaction hash* if you have one. That's the fastest route to an answer.",
  },
  {
    id: 'usdm',
    label: '🪙 I only have USDC / USDT',
    patterns: [/usdc/i, /usdt/i, /convert/i, /swap/i, /which (coin|token|stablecoin)/i],
    answer:
      "*Stakes are in USDm*\n\n" +
      "USDm (also called cUSD) is Celo's native stable dollar, and the game contract escrows and pays out in USDm only.\n\n" +
      "If you hold USDC or USDT — common on MiniPay — the lobby shows a banner that takes you to MiniPay's balance screen, where converting takes a couple of taps.",
  },
  {
    id: 'stuck-game',
    label: '⏳ Stuck in a game',
    patterns: [/stuck/i, /frozen/i, /not (start|end)/i, /timer/i, /waiting/i],
    answer:
      "*The game lives on-chain, not in your browser*\n\n" +
      "Reopen the app and the match screen picks up wherever the game actually is.\n\n" +
      "Round timers do not pause for you, though — miss a vote and that round resolves without your voice, so get back in quickly.\n\n" +
      "If a room genuinely never started, everyone who locked in splits the escrowed pot and no-shows are refunded automatically. Reply with the *room number* if it looks wrong.",
  },
  {
    id: 'wallet',
    label: '👛 Wallet won\'t connect',
    patterns: [/connect/i, /wallet/i, /metamask/i, /minipay/i, /sign ?in/i],
    answer:
      "*Connecting*\n\n" +
      "In MiniPay there is no connect step at all — the app picks up your account automatically. If you're seeing a connect prompt inside MiniPay, tell us, because that's a bug.\n\n" +
      "In a normal browser, tap *Play Now* and approve in your wallet. The game runs on Celo; your wallet needs to be on that network.",
  },
  {
    id: 'shield',
    label: '🛡️ What is the Shield?',
    patterns: [/shield/i, /innocen/i, /proof/i, /zk/i, /password/i],
    answer:
      "*Shield*\n\n" +
      "If you're being framed, the Shield proves you're clean without revealing anything else about your role. You get one free per game; extra ones cost a small fee.\n\n" +
      "Your Shield password must match the one you set when you locked in your role — if it doesn't, the contract rejects the submission.",
  },
  {
    id: 'how-to-play',
    label: '🎮 How do I play?',
    patterns: [/how (do|to) (i )?play/i, /rules/i, /new here/i, /getting started/i, /demo/i],
    answer:
      "*How it works*\n\n" +
      "One player is secretly infected. Everyone else has to find them before they turn the room. Each round you discuss, then vote someone out.\n\n" +
      "Try it free first — no wallet, no sign-in: https://zplague.xyz/demo\n" +
      "Full rules: https://zplague.xyz/how-to-play",
  },
]

export function matchFaq(text: string): FaqEntry | undefined {
  return FAQ.find(e => e.patterns.some(p => p.test(text)))
}
