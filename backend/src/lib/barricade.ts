/**
 * barricade.ts — the Discussion-phase minigame: rules, resolution, evidence.
 *
 * WHAT IT IS
 * Discussion runs for 180 seconds and used to contain a chat box and nothing
 * else. The barricade fills that window with something physical whose output is
 * ARGUMENT, not elimination: three times per round the horde pushes one station,
 * and the room finds out whether it held.
 *
 * 🚨 THE RULE THAT KEEPS THIS A DEDUCTION GAME
 * The barricade NEVER eliminates anyone and never touches the pot. It produces
 * evidence, which players then argue about, and the vote — the thing that is
 * actually on-chain — stays the only way anybody dies. The moment a reflex
 * decides who loses money, the ZK/vote/payout machinery becomes decoration and
 * this stops being the game it claims to be. Nothing in this file may return an
 * elimination.
 *
 * 🚨 INACTION IS A MOVE, NOT AN ABSENCE
 * Every player starts each round assigned to a station. Sending nothing means
 * you HELD YOUR POST — a legitimate, common, unremarkable play, not a failure to
 * participate. This one decision carries most of the design:
 *
 *   - Bots need no exemption and no special-casing. A bot that does nothing is
 *     playing correctly, so it cannot be identified by its silence. Exempting
 *     bots explicitly would have built a bot-detector into the core loop:
 *     "whoever left no trace is a bot" would be the strongest read at the table.
 *   - Third-party ERC-8004 agents (which the backend cannot distinguish from
 *     humans anyway — there is no address→agent lookup) are covered by the same
 *     property, for free.
 *   - A MiniPay user on a slow link, someone who tabbed away, and someone
 *     concentrating on the chat argument all land in the same large, respectable
 *     bucket. With real USDm on the table, latency must never cost you a round.
 *
 * So holding is indistinguishable from choosing to hold BY CONSTRUCTION, rather
 * than because a server-side policy is impersonating someone.
 *
 * 🚨 SABOTAGE MUST STAY DENIABLE
 * Infected players can sabotage instead of defend. Sabotage is never announced.
 * The room learns identities ONLY at a station that BREAKS — and then it learns
 * everyone who was standing there, saboteur and innocent alike. That asymmetry
 * is the whole engine:
 *   - Sabotage carries risk: if the station breaks you are on the list.
 *   - Sabotage that fails to break a station is invisible.
 *   - Clean players at a breached station are wrongly implicated, which is the
 *     best social-deduction material there is.
 * A station that HOLDS reveals only a count, never a name.
 */

/** Stations are fixed and few: the whole thing has to stay glanceable, because
 *  the chat argument is the real game and this must not steal eyes from it. */
export const STATIONS = ['North Door', 'East Window', 'Roof Hatch'] as const
export type StationId = 0 | 1 | 2

/**
 * ── THE ARC ──────────────────────────────────────────────────────────────────
 *
 * Difficulty escalates with the round, and this is the part that makes the
 * barricade worth having. Fixed at three pushes and a threshold of two, players
 * learn by round three that it basically always holds and stop caring — the
 * minigame becomes wallpaper exactly when the game is supposed to be tightening.
 *
 * The horde gets worse as the night goes on, and it gets worse faster than the
 * room shrinks. Both curves stay SHALLOW on purpose: the escalation has to be
 * felt, not solved. Nothing here may require reflexes, and nothing here may
 * punish a slow connection — holding your post is still always a legal, common
 * play at every level.
 *
 * The names are player-facing (shown as the night's condition), so they should
 * read as weather, not as a difficulty setting.
 */
const LEVELS = [
  { from: 1, pushes: 3, threshold: 2, label: 'Contained' },
  { from: 3, pushes: 4, threshold: 2, label: 'Spreading' },
  { from: 5, pushes: 4, threshold: 3, label: 'Overrun' },
] as const

export interface BarricadeLevel {
  readonly pushes: number
  readonly threshold: number
  readonly label: string
}

/** The night's condition at a given round. Rounds below 1 are treated as 1. */
export function levelForRound(round: number): BarricadeLevel {
  let level: BarricadeLevel = LEVELS[0]
  for (const l of LEVELS) if (round >= l.from) level = l
  return level
}

/** Baseline shape, kept for callers that just want the starting numbers. */
export const PUSHES_PER_ROUND = LEVELS[0].pushes

/** Effective defenders needed for a station to hold, at the opening level. */
export const HOLD_THRESHOLD = LEVELS[0].threshold

/** How long before a push the room is warned, so there is time to move. */
export const WARN_LEAD_MS = 8_000

export type BarricadeAction =
  | { kind: 'hold' }
  | { kind: 'move'; station: StationId }
  | { kind: 'sabotage' }

/** FNV-1a, 32-bit — the same hash the room modifiers and the containment sweep
 *  use, so all three derive from one well-understood primitive. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * A player's starting station for a round.
 *
 * Derived from (roomId, round, seat) rather than stored or broadcast, so every
 * client can render the board with no setup traffic at all and no state to
 * migrate — the same trick roomModifiers.ts uses.
 *
 * ⚠ MIRRORED in frontend/src/lib/barricade.ts. Both copies must agree or a
 * player will be shown defending a station the server has them nowhere near.
 */
export function assignedStation(roomId: string, round: number, seatIndex: number): StationId {
  return (hash(`${roomId}:${round}:${seatIndex}`) % STATIONS.length) as StationId
}

/**
 * Which station the horde hits on a given push. Also derived, so the schedule is
 * identical everywhere and a client can foreshadow the push without being told.
 */
export function targetStation(roomId: string, round: number, push: number): StationId {
  return (hash(`push:${roomId}:${round}:${push}`) % STATIONS.length) as StationId
}

/**
 * When each push lands, as a fraction of the Discussion window.
 *
 * Spread evenly between FIRST and LAST rather than from a fixed table, because
 * the number of pushes now varies by level. The window never starts at 0 (the
 * room needs a moment to read the board) and never reaches 1 (the last push has
 * to resolve and be ARGUED ABOUT before voting opens — a push that lands as the
 * vote begins produces evidence nobody can use).
 */
const FIRST_PUSH_AT = 0.25
const LAST_PUSH_AT  = 0.82

export function pushAtMs(discussionMs: number, push: number, round = 1): number {
  const count = levelForRound(round).pushes
  const span = LAST_PUSH_AT - FIRST_PUSH_AT
  const frac = count <= 1
    ? FIRST_PUSH_AT
    : FIRST_PUSH_AT + span * (Math.min(push, count - 1) / (count - 1))
  return Math.round(discussionMs * frac)
}

export interface PushOutcome {
  readonly push: number
  readonly station: StationId
  readonly held: boolean
  /** Bodies present, whatever they were doing. Always public. */
  readonly present: number
  /**
   * Who was standing there — populated ONLY on a breach. On a hold this is
   * empty, because a station that holds must never name anybody.
   */
  readonly exposed: readonly string[]
  readonly at: number
}

export interface ResolveInput {
  readonly roomId: string
  readonly round: number
  readonly push: number
  /** Alive players, in seat order. `infected` decides whether sabotage counts. */
  readonly players: readonly { address: string; seatIndex: number; infected: boolean }[]
  /** Address (lowercased) → action for this push. Absent = held their post. */
  readonly actions: ReadonlyMap<string, BarricadeAction>
}

/**
 * Resolves one push.
 *
 * Sabotage from a CLEAN player degrades silently to holding. That is deliberate:
 * validating it at submission time would need a per-action chain read, and
 * rejecting it would tell a client something about a status it should not be
 * probing. Here it costs nothing and reveals nothing.
 */
export function resolvePush(input: ResolveInput): PushOutcome {
  const { roomId, round, push, players, actions } = input
  const station = targetStation(roomId, round, push)

  let present = 0
  let effective = 0
  const exposed: string[] = []

  for (const p of players) {
    const action = actions.get(p.address.toLowerCase()) ?? { kind: 'hold' as const }
    const at = action.kind === 'move' ? action.station : assignedStation(roomId, round, p.seatIndex)
    if (at !== station) continue

    present++
    exposed.push(p.address)
    // Only a genuinely infected player can subtract. Everyone else defends,
    // including a clean player who tried to sabotage.
    if (action.kind === 'sabotage' && p.infected) effective--
    else effective++
  }

  const held = effective >= levelForRound(round).threshold
  return {
    push,
    station,
    held,
    present,
    // The asymmetry that makes sabotage a real decision: breaking exposes
    // everyone who was there; holding exposes nobody.
    exposed: held ? [] : exposed,
    at: Date.now(),
  }
}
