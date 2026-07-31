/**
 * Severity classification for inbound support messages.
 *
 * The point of this file is the MiniPay listing requirement: critical issues get
 * a fix or a workaround within 24 hours. That promise is only keepable if a
 * "my money is gone" message is separated from a "how do I play" message the
 * moment it arrives, rather than whenever someone next opens Telegram.
 *
 * Deliberately biased toward FALSE POSITIVES. Being paged for a non-issue costs
 * a glance; missing a real one costs the SLA and, on a game holding real stakes,
 * a user's money.
 */

export type Severity = 'P0' | 'P1' | 'P2'

// Nouns must tolerate plurals: an early version used `\bfund\b`, which cannot
// match "funds", so "someone stole my funds" — the single most important message
// this bot will ever see — classified as P2. Covered by the test script below.
const MONEY = '(?:funds?|money|usdm|cusd|stakes?|pots?|balances?|cash|payouts?|winnings?)'

/** Money is missing, stuck, or provably wrong. Page immediately. */
const P0_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b(lost|missing|gone|stolen|stole|took|taken)\b.{0,24}\b${MONEY}\b`, 'i'),
  new RegExp(String.raw`\b${MONEY}\b.{0,24}\b(lost|missing|gone|stolen|disappear\w*)\b`, 'i'),
  /\b(can'?t|cannot|unable to|won'?t let me)\b.{0,24}\b(withdraw|claim|cash ?out|payout)\b/i,
  /\bno(t)? (paid|payout|refund)\b/i,
  // Bare accusations, with no noun attached. Always worth a human's eyes.
  /\b(stolen|stole my|ripped me off|robbed)\b/i,
  /\b(double|twice)\b.{0,16}\b(charged|deducted|debited)\b/i,
  /\bscam(med)?\b/i,
  /\bdrain(ed)?\b/i,
]

/** Blocked from playing, or a game is wedged. Same-day, not same-minute. */
const P1_PATTERNS: RegExp[] = [
  /\b(stuck|frozen|hung|stalled|wedged)\b/i,
  /\b(can'?t|cannot|unable to|won'?t)\b.{0,24}\b(join|create|start|vote|connect|play|enter)\b/i,
  /\bnothing happens\b/i,
  /\b(error|failed|failing|reverted|rejected)\b/i,
  /\bgame (never|didn'?t|won'?t) (start|end|finish)\b/i,
  /\bwaiting (for )?(ages|hours|forever)\b/i,
]

export interface Triage {
  severity: Severity
  /** The pattern text that matched — shown in the alert so triage is auditable. */
  matched?: string
}

export function classify(text: string): Triage {
  for (const re of P0_PATTERNS) {
    const m = re.exec(text)
    if (m) return { severity: 'P0', matched: m[0] }
  }
  for (const re of P1_PATTERNS) {
    const m = re.exec(text)
    if (m) return { severity: 'P1', matched: m[0] }
  }
  return { severity: 'P2' }
}

/** A transaction hash or wallet address in the message makes triage far faster. */
export function extractEvidence(text: string): { txHash?: string; address?: string } {
  const tx = /\b0x[a-fA-F0-9]{64}\b/.exec(text)?.[0]
  const addr = /\b0x[a-fA-F0-9]{40}\b/.exec(text)?.[0]
  return { txHash: tx, address: addr }
}
