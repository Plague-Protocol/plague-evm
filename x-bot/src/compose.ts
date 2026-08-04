/**
 * Writes the day's draft.
 *
 * The account posts about once a day and the job is to get people to play, so
 * these are invitations and updates rather than match reports. An earlier
 * version drafted a post per settled game; that was wrong for a young account.
 * Reporting every result daily gets tiresome fast, and it makes the timeline a
 * log rather than a reason to click.
 *
 * Nothing here identifies who played. Drafts speak about the game, never about
 * a roster, so no post can claim anything about whether a given game was people
 * or agents. That ambiguity is deliberate.
 *
 * No language model. The lines are written once, by a person, and rotate. What
 * automation contributes is remembering to post and filling in a real number
 * when there is one worth using.
 */

import { enforce, fit, TWEET_MAX } from './style.js'
import type { Pulse } from './stats.js'

const SITE = 'https://zplague.xyz'
const TOKEN = 'USDm'

/** Angle of a draft. Rotation works across these first, then within one. */
export type DraftKind = 'invite' | 'mechanic' | 'pulse' | 'atmosphere'

export interface Draft {
  kind: DraftKind
  /** Which line was used, so the same one does not come back too soon. */
  templateId: string
  /** Stable key. One draft per day, so this is the date. */
  dedupeKey: string
  text: string
  /** Style rewrites applied, shown to the approver. */
  fixes: string[]
}

/** 18-decimal wei to a short human string: 12.5, 3, 0.25. */
export function formatToken(wei: string): string {
  let v: bigint
  try {
    v = BigInt(wei)
  } catch {
    return '0'
  }
  const whole = v / 10n ** 18n
  const frac = (v % 10n ** 18n) / 10n ** 16n // two decimal places
  if (frac === 0n) return whole.toString()
  return `${whole}.${frac.toString().padStart(2, '0').replace(/0$/, '')}`
}

interface Template {
  id: string
  kind: DraftKind
  /** Returns null when this line has nothing true to say today. */
  render: (p: Pulse) => string | null
}

/**
 * The pool.
 *
 * Kept as plain lines rather than assembled from fragments: a sentence written
 * whole reads better than one composed at runtime, and the whole point of
 * approving these by hand is that a person can tell the difference.
 */
const TEMPLATES: Template[] = [
  // ── Invitation. The default angle, and the one that should appear most. ────
  {
    id: 'invite-what',
    kind: 'invite',
    render: () => `Zombie Plague is a social deduction game that settles on chain. Stake USDm, find out who is infected before they take the pot, or be the one who gets away with it. Play free against bots first. ${SITE}`,
  },
  {
    id: 'invite-solo',
    kind: 'invite',
    render: () => `You do not need to round up friends to try this. Open a room, fill the empty seats with bots, and play a full game in about ten minutes. ${SITE}`,
  },
  {
    id: 'invite-stakes',
    kind: 'invite',
    render: () => `Most games ask you to trust the lobby. This one asks you to trust nobody, and the contract holds the pot either way. Zombie Plague, live on Celo. ${SITE}`,
  },
  {
    id: 'invite-quick',
    kind: 'invite',
    render: () => `One round of Zombie Plague takes minutes. One player is Patient Zero. Everyone else is trying to work out who, before there is nobody left to ask. ${SITE}`,
  },

  // ── Mechanic. Teaches one idea. These are the posts that get saved. ────────
  {
    id: 'mechanic-shield',
    kind: 'mechanic',
    render: () => `In Zombie Plague you cannot just say you are clean, you prove it. A Shield is a zero knowledge proof that you are uninfected, and it reveals nothing else about your hand. Lying is free. Innocence is cryptographic. ${SITE}`,
  },
  {
    id: 'mechanic-phases',
    kind: 'mechanic',
    render: () => `Every round: the infection spreads, everyone argues, everyone votes, and one player is revealed. Four phases, no take backs, and the contract settles the pot at the end. ${SITE}`,
  },
  {
    id: 'mechanic-patient-zero',
    kind: 'mechanic',
    render: () => `Being Patient Zero is the hardest seat in Zombie Plague. You have to sound like someone with nothing to hide, in a room where everyone else can prove they have nothing to hide. ${SITE}`,
  },
  {
    id: 'mechanic-pot',
    kind: 'mechanic',
    render: () => `Nobody holds your stake in Zombie Plague, including us. It goes to the contract when you join and the contract pays the survivors when the game ends. Verifiable on Celo, start to finish. ${SITE}`,
  },
  {
    id: 'mechanic-vote',
    kind: 'mechanic',
    render: () => `The vote in Zombie Plague is silent. No chat, no last minute pleading, just the tally when it opens. Whatever you were going to say, you needed to say it in Discussion. ${SITE}`,
  },

  // ── Pulse. A real number, aggregate only, skipped when it is unflattering. ─
  {
    id: 'pulse-week',
    kind: 'pulse',
    // Below five games a week the number argues against the game rather than
    // for it, so the line simply does not render and rotation moves on.
    render: p => p.gamesThisWeek < 5
      ? null
      : `${p.gamesThisWeek} games of Zombie Plague settled this week, every one of them on chain. Room is open if you want the next one. ${SITE}`,
  },
  {
    id: 'pulse-biggest',
    kind: 'pulse',
    render: p => {
      const pot = formatToken(p.biggestPotWei)
      if (p.gamesThisWeek < 3 || BigInt(p.biggestPotWei || '0') === 0n) return null
      return `Biggest pot this week: ${pot} ${TOKEN}, settled by the contract the moment the last vote landed. ${SITE}`
    },
  },
  {
    id: 'pulse-alltime',
    kind: 'pulse',
    render: p => p.gamesAllTime < 25
      ? null
      : `${p.gamesAllTime} games of Zombie Plague have now been played on Celo mainnet, with real stakes and real payouts. Still the strangest ten minutes on this chain. ${SITE}`,
  },
  {
    id: 'pulse-longest',
    kind: 'pulse',
    render: p => p.longestRounds < 4
      ? null
      : `Longest game this week ran ${p.longestRounds} rounds before anyone was sure. That is a long time to sit in a room with someone who is lying to you. ${SITE}`,
  },

  // ── Atmosphere. Sells the feeling, not the feature. ───────────────────────
  {
    id: 'atmosphere-trust',
    kind: 'atmosphere',
    render: () => `The worst part of Zombie Plague is not being infected. It is being clean, having the proof, and watching the room vote you out anyway. ${SITE}`,
  },
  {
    id: 'atmosphere-quiet',
    kind: 'atmosphere',
    render: () => `There is a moment in every game of Zombie Plague where the chat goes quiet and everyone realises they have been agreeing with the same person all round. ${SITE}`,
  },
  {
    id: 'atmosphere-tell',
    kind: 'atmosphere',
    render: () => `Everyone thinks they have a tell for who is infected. Nobody has a tell. That is what makes it worth the stake. ${SITE}`,
  },
  {
    id: 'atmosphere-nobody',
    kind: 'atmosphere',
    render: () => `Trust nobody. Prove everything. Zombie Plague is live on Celo mainnet. ${SITE}`,
  },
]

/** Rotation order for angles. Also the tie-break when nothing has been used yet. */
const KIND_ORDER: DraftKind[] = ['invite', 'mechanic', 'atmosphere', 'pulse']

/**
 * Pick today's line.
 *
 * Two levels, angle then line, because least-recently-used over template ids
 * alone is not enough. On a cold start every id is equally unused, so the sort
 * falls back to declaration order and the account opens with four invitations
 * in a row before it says anything else. Choosing the stalest *angle* first and
 * only then the stalest line within it keeps the timeline varied from day one,
 * and still degrades into plain LRU once there is history.
 *
 * Ties are broken on the day number rather than array position, so a fresh
 * install does not always open on the same line.
 */
export function draftForToday(pulse: Pulse, recentIds: string[], today = new Date()): Draft | null {
  const dayNumber = Math.floor(today.getTime() / 86_400_000)

  /** Higher means longer since it was used. Never used sorts highest. */
  const staleness = (id: string) => {
    const i = recentIds.lastIndexOf(id)
    return i === -1 ? Number.MAX_SAFE_INTEGER : recentIds.length - i
  }

  const candidates = TEMPLATES
    .map(t => ({ t, text: t.render(pulse) }))
    .filter((c): c is { t: Template; text: string } => c.text !== null)

  if (candidates.length === 0) return null

  const kindStaleness = (kind: DraftKind) =>
    Math.min(...candidates.filter(c => c.t.kind === kind).map(c => staleness(c.t.id)))

  const kindsPresent = KIND_ORDER.filter(k => candidates.some(c => c.t.kind === k))
  const bestKindStaleness = Math.max(...kindsPresent.map(kindStaleness))
  const contenders = kindsPresent.filter(k => kindStaleness(k) === bestKindStaleness)
  const kind = contenders[dayNumber % contenders.length]

  const inKind = candidates.filter(c => c.t.kind === kind)
  const bestStaleness = Math.max(...inKind.map(c => staleness(c.t.id)))
  const stalest = inKind.filter(c => staleness(c.t.id) === bestStaleness)
  const chosen = stalest[dayNumber % stalest.length]

  const { text, fixes } = enforce(chosen.text)
  return {
    kind: chosen.t.kind,
    templateId: chosen.t.id,
    dedupeKey: `daily:${today.toISOString().slice(0, 10)}`,
    text: fit(text, TWEET_MAX),
    fixes,
  }
}

/** Exposed for the tests, which assert every line is postable as written. */
export const ALL_TEMPLATES = TEMPLATES
