/**
 * presence.ts — "who is at the table right now" signals for the Discussion phase.
 *
 * WHY
 * Discussion is 180 seconds long and, until now, contained chat and nothing
 * else. Between messages the room looked identical to an empty one: no way to
 * tell a table thinking hard from a table that had wandered off. This carries
 * the two liveness signals that cost nothing and mean something — who is
 * composing a message, and who is actually still on the screen.
 *
 * Both are legitimate deduction material (a player who starts typing, stops,
 * and starts again is *information*), and neither touches anything secret:
 * infection status never passes through this module.
 *
 * 🚨 EGRESS DISCIPLINE — the reason this file exists instead of a two-line
 * handler. The VPS has a 512 GB/month outbound cap and the whole stack
 * currently burns ~0.75 GB/day, so a naive typing indicator — broadcast per
 * keystroke, to every member of the room — is exactly the shape of thing that
 * eats a cap. Two rules, both enforced here rather than trusted to the client:
 *   1. Coalesced: at most one frame per room per FLUSH_INTERVAL_MS.
 *   2. Change-only: identical consecutive states are never re-sent.
 *
 * 🚨 NO CHAIN CALLS ON THE HOT PATH. The chat handler does getRoom + getPlayer
 * per message, which is fine at one message per player per few seconds and
 * ruinous at typing frequency — Alchemy is metered and the agent runner is
 * single-homed on it. Eligibility is therefore read from a short-TTL gate that
 * the room-snapshot path refreshes for free (it already holds the room), and it
 * fails CLOSED so a room we know nothing about broadcasts nothing.
 */

/** How long a typing signal stays live without a refresh from the client. */
const TYPING_TTL_MS = 4_000
/** Ceiling on broadcast rate, per room. */
const FLUSH_INTERVAL_MS = 1_000
/** How long a cached eligibility gate is trusted before a refresh is kicked off. */
const GATE_TTL_MS = 5_000

export interface PresenceFrame {
  readonly roomId: string
  /** Addresses currently composing a message. Lowercased. */
  readonly typing: readonly string[]
  readonly at: number
}

type Emit = (roomId: string, frame: PresenceFrame) => void

/** roomId → (lowercased address → expiry ms) */
const typing = new Map<string, Map<string, number>>()
/** roomId → serialised last-sent state, for change detection. */
const lastSent = new Map<string, string>()
/** roomId → pending flush timer. */
const timers = new Map<string, NodeJS.Timeout>()
/** roomId → { open, at } — may chat right now? */
const gates = new Map<string, { open: boolean; at: number }>()

/**
 * Records whether a room currently permits chat, from data the caller already
 * holds. Free to call — it performs no I/O.
 *
 * `status`/`phase`/`round` are the raw on-chain numbers, matching the checks in
 * the chat handler: status 2 = active, phase 2 = voting, status 3 = ended.
 */
export function noteRoomGate(
  roomId: string,
  opts: { status: number; phase: number; silenced: boolean },
): void {
  const open =
    opts.status !== 3 &&                                  // not ended
    !(opts.status === 2 && opts.phase === 2) &&           // not voting
    !(opts.status === 2 && opts.silenced)                 // not a Silent Round
  gates.set(roomId, { open, at: Date.now() })
}

/**
 * Fails closed on purpose. An unknown or stale room broadcasts nothing rather
 * than guessing — guessing wrong during a Silent Round would leak "who would
 * have spoken", which is precisely the information that modifier removes.
 */
export function gateOpen(roomId: string): boolean {
  const g = gates.get(roomId)
  if (!g) return false
  if (Date.now() - g.at > GATE_TTL_MS) return false
  return g.open
}

function liveTyping(roomId: string): string[] {
  const m = typing.get(roomId)
  if (!m) return []
  const now = Date.now()
  const out: string[] = []
  for (const [addr, expires] of m) {
    if (expires > now) out.push(addr)
    else m.delete(addr)
  }
  if (m.size === 0) typing.delete(roomId)
  return out.sort()
}

function flush(roomId: string, emit: Emit): void {
  timers.delete(roomId)
  const list = liveTyping(roomId)
  const key = list.join(',')

  // Keep the chain alive while anyone is still typing — BEFORE the change check,
  // not after it. A client that dies mid-sentence never sends `typing: false`,
  // so the only thing that will ever clear it is a later flush noticing the
  // entry has aged out. Rescheduling after the early return meant an unchanged
  // tick silently ended the chain, and the dot then pulsed next to that name
  // until some unrelated event happened to flush the room.
  //
  // Ticking without emitting is cheap: it is a timer, not a packet.
  if (list.length > 0) schedule(roomId, emit)

  // Change-only. An empty state IS sent once, to clear the indicator — it is
  // only the *repeat* of an identical state that is suppressed.
  if (lastSent.get(roomId) === key) return
  lastSent.set(roomId, key)
  emit(roomId, { roomId, typing: list, at: Date.now() })
}

function schedule(roomId: string, emit: Emit): void {
  if (timers.has(roomId)) return
  timers.set(roomId, setTimeout(() => flush(roomId, emit), FLUSH_INTERVAL_MS))
}

/**
 * Marks a player as typing (or no longer typing) and queues a coalesced
 * broadcast. Safe to call at any frequency: the work is a map write plus, at
 * most, one timer per room.
 */
export function setTyping(roomId: string, address: string, isTyping: boolean, emit: Emit): void {
  if (!roomId || !address) return
  if (!gateOpen(roomId)) return
  const addr = address.toLowerCase()
  let m = typing.get(roomId)
  if (isTyping) {
    if (!m) { m = new Map(); typing.set(roomId, m) }
    m.set(addr, Date.now() + TYPING_TTL_MS)
  } else if (m) {
    m.delete(addr)
    if (m.size === 0) typing.delete(roomId)
  }
  schedule(roomId, emit)
}

/** Drops a player from every room's typing set (disconnect / leave). */
export function clearPlayer(address: string, emit: Emit): void {
  if (!address) return
  const addr = address.toLowerCase()
  for (const [roomId, m] of typing) {
    if (m.delete(addr)) schedule(roomId, emit)
  }
}

/** Releases all state for a room (game ended, room emptied). */
export function clearRoom(roomId: string): void {
  typing.delete(roomId)
  lastSent.delete(roomId)
  gates.delete(roomId)
  const t = timers.get(roomId)
  if (t) { clearTimeout(t); timers.delete(roomId) }
}

/** Test/shutdown helper — cancels every pending flush. */
export function stopAll(): void {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  typing.clear()
  lastSent.clear()
  gates.clear()
}
