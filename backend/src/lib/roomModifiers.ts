/**
 * roomModifiers.ts — per-room rule variants ("what can you see this game?").
 *
 * Social deduction runs on information, so the cheapest real variety is
 * changing what players know rather than what they can do. These modifiers need
 * no contract change because the contract never sees chat or display names — it
 * only records votes.
 *
 * A modifier is DERIVED FROM THE ROOM ID, not stored. Every client and the
 * server compute the same answer from the same string, so there is no column to
 * migrate, no admin step, and no way for the two to disagree about which game
 * this is.
 *
 * ⚠ Mirrored in frontend/src/lib/roomModifiers.ts. Both copies must stay
 * byte-identical or a client will render a mode the server is not enforcing.
 * If you change the buckets, change them in both files in the same commit.
 *
 * Deliberately NOT here: hiding the vote tally. Votes live on-chain
 * (`voteTarget` on the player struct) and anyone can read them from any RPC, so
 * a "blind vote" mode would be theatre — visible to a player with devtools and
 * invisible to nobody else.
 */

export type ModifierKind = 'none' | 'silent' | 'anonymous'

export interface RoomModifier {
  kind: ModifierKind
  /** For 'silent': the single round that runs without chat. */
  round?: number
  /** Player-facing name; empty for 'none'. */
  label: string
  /** One line explaining the rule, shown when the room opens. */
  blurb: string
}

const NONE: RoomModifier = { kind: 'none', label: '', blurb: '' }

/** FNV-1a, 32-bit. Stable across runtimes; identical in the frontend copy. */
function hashRoomId(roomId: string): number {
  let h = 2166136261
  for (let i = 0; i < roomId.length; i++) {
    h ^= roomId.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * ~30% of rooms carry a modifier. Kept a minority on purpose: a variant is only
 * interesting against a baseline, and every room being strange is just a
 * different, noisier baseline.
 */
export function roomModifier(roomId: string): RoomModifier {
  if (!roomId) return NONE
  const h = hashRoomId(roomId)
  const bucket = h % 100

  if (bucket < 70) return NONE

  if (bucket < 85) {
    // Never round 1: players need one normal round to form the reads that the
    // silent round then takes away.
    const round = 2 + (h % 2)
    return {
      kind: 'silent',
      round,
      label: 'Silent Round',
      blurb: `Round ${round} runs with no chat. Read the votes, not the room.`,
    }
  }

  return {
    kind: 'anonymous',
    label: 'No Names',
    blurb: 'Seat numbers only. You cannot tell who you have played before.',
  }
}

/** True when chat must be refused for this room at this round. */
export function isChatSilenced(roomId: string, round: number): boolean {
  const m = roomModifier(roomId)
  return m.kind === 'silent' && m.round === round
}

/** True when display names must be replaced with seat numbers. */
export function isAnonymous(roomId: string): boolean {
  return roomModifier(roomId).kind === 'anonymous'
}
