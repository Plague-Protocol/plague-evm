/**
 * barricadeRunner.ts — per-room runtime for the Discussion-phase barricade.
 *
 * Owns the push schedule, collects actions, resolves each push against
 * lib/barricade.ts, and broadcasts the result. The RULES live in that lib and
 * are tested there; this file is only the clock and the wire.
 *
 * 🚨 ROSTER IS FETCHED ONCE PER ROUND, NOT PER PUSH OR PER ACTION.
 * Resolution needs to know who is alive, where they sit, and who is infected.
 * The naive shape — read the chain when an action arrives — would put an RPC
 * call on a player-triggered path, and the agent runner is single-homed on
 * Alchemy. It is also unnecessary: eliminations happen in Reveal and infections
 * in Infection, so across a single Discussion phase the roster cannot change.
 * One snapshot at the top of the round is therefore both cheaper AND correct,
 * and it makes action submission pure in-memory work.
 *
 * 🚨 EGRESS. A round broadcasts about seven frames total (open, then a warning
 * and a result per push). There is no per-action echo and no ticking — the
 * countdown is a timestamp the client animates locally. Same discipline as
 * lib/presence.ts, for the same 512 GB/month reason.
 */

import type { Server } from 'socket.io'
import { chainAdapter } from './chainAdapter'
import { logger } from '../lib/logger'
import {
  WARN_LEAD_MS, STATIONS,
  pushAtMs, targetStation, resolvePush, levelForRound, occupancy,
  type BarricadeAction, type PushOutcome, type StationId,
} from '../lib/barricade.js'

interface RosterEntry {
  address: string
  seatIndex: number
  infected: boolean
}

interface RoomRun {
  round: number
  roster: RosterEntry[]
  /** Lowercased address → action for the push currently being collected. */
  actions: Map<string, BarricadeAction>
  outcomes: PushOutcome[]
  timers: NodeJS.Timeout[]
  next: { push: number; station: StationId; at: number } | null
}

const runs = new Map<string, RoomRun>()

export interface BarricadeState {
  roomId: string
  round: number
  stations: readonly string[]
  /** Defenders needed to hold, at THIS round's level. */
  threshold: number
  /** Pushes coming this round — the client shows progress against it. */
  pushes: number
  /** The night's condition, e.g. "Spreading". Player-facing. */
  level: string
  /**
   * Bodies at each station, by station index. Counts only, never identities —
   * this is what the quarantine cam draws, so the scene can be truthful about
   * where the room is standing without ever saying who is who.
   */
  occupancy: readonly number[]
  next: { push: number; station: StationId; at: number } | null
  outcomes: readonly PushOutcome[]
}

function stateOf(roomId: string, run: RoomRun): BarricadeState {
  const level = levelForRound(run.round)
  return {
    roomId,
    round: run.round,
    stations: STATIONS,
    threshold: level.threshold,
    pushes: level.pushes,
    level: level.label,
    occupancy: occupancy(roomId, run.round, run.roster, run.actions),
    next: run.next,
    outcomes: run.outcomes,
  }
}

function broadcast(io: Server, roomId: string): void {
  const run = runs.get(roomId)
  if (!run) return
  io.to(roomId).emit('barricade', stateOf(roomId, run))
}

/** Current state for a client that just joined, or null if nothing is running. */
export function snapshot(roomId: string): BarricadeState | null {
  const run = runs.get(roomId)
  return run ? stateOf(roomId, run) : null
}

export function stopRoom(roomId: string): void {
  const run = runs.get(roomId)
  if (!run) return
  for (const t of run.timers) clearTimeout(t)
  runs.delete(roomId)
}

/**
 * Records a player's intent for the push being collected.
 *
 * Pure in-memory, and safe to call from an untrusted client: an address outside
 * the captured roster is ignored, and a `sabotage` from a clean player is
 * downgraded during resolution rather than rejected here (rejecting it would
 * leak whether the sender is infected).
 */
export function submitAction(roomId: string, address: string, action: BarricadeAction): boolean {
  const run = runs.get(roomId)
  if (!run || !run.next) return false
  const addr = address.toLowerCase()
  if (!run.roster.some(r => r.address.toLowerCase() === addr)) return false
  if (action.kind === 'move' && !(action.station >= 0 && action.station < STATIONS.length)) return false
  run.actions.set(addr, action)
  return true
}

async function loadRoster(roomId: string): Promise<RosterEntry[]> {
  const id = BigInt(roomId)
  const room = await chainAdapter.getRoom(id)
  const entries: RosterEntry[] = []
  for (let i = 0; i < room.players.length; i++) {
    const addr = room.players[i]
    const p = await chainAdapter.getPlayer(id, addr as `0x${string}`)
    const status = Number(p.status)
    if (status === 2) continue // eliminated — not on the board
    entries.push({ address: addr, seatIndex: i, infected: status === 1 })
  }
  return entries
}

function resolveNow(io: Server, roomId: string, push: number): void {
  const run = runs.get(roomId)
  if (!run) return
  const outcome = resolvePush({
    roomId,
    round: run.round,
    push,
    players: run.roster,
    actions: run.actions,
  })
  run.outcomes.push(outcome)
  // Each push collects its own intents: standing somewhere last time should not
  // silently commit you to standing there again.
  run.actions.clear()
  // Cleared, not pre-filled with the next push. The upcoming push only becomes
  // visible when ITS warning timer fires and stamps a real deadline — announcing
  // it here with a placeholder time would have clients counting down to 1970,
  // and would also rob the warning of being an event.
  run.next = null
  broadcast(io, roomId)
}

/**
 * Opens the barricade for a Discussion phase. Idempotent per (room, round):
 * a duplicate PhaseChanged will not double-schedule.
 */
export function startRound(io: Server, roomId: string, round: number, discussionMs: number): void {
  const existing = runs.get(roomId)
  if (existing && existing.round === round) return
  stopRoom(roomId)

  if (!Number.isFinite(discussionMs) || discussionMs < 20_000) {
    // Too short to fit three pushes and still leave room to argue about them.
    return
  }

  const run: RoomRun = {
    round,
    roster: [],
    actions: new Map(),
    outcomes: [],
    timers: [],
    next: null,
  }
  runs.set(roomId, run)

  void (async () => {
    try {
      run.roster = await loadRoster(roomId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn(`[barricade] roster load failed for room ${roomId}: ${message}`)
      stopRoom(roomId)
      return
    }
    // Still here? The round may have been torn down while we were awaiting.
    if (runs.get(roomId) !== run) return

    const now = Date.now()
    for (let push = 0; push < levelForRound(round).pushes; push++) {
      const at = now + pushAtMs(discussionMs, push, round)
      const station = targetStation(roomId, round, push)

      const warnAt = at - WARN_LEAD_MS
      run.timers.push(setTimeout(() => {
        const r = runs.get(roomId)
        if (r !== run) return
        r.next = { push, station, at }
        broadcast(io, roomId)
      }, Math.max(0, warnAt - Date.now())))

      run.timers.push(setTimeout(() => {
        if (runs.get(roomId) !== run) return
        resolveNow(io, roomId, push)
      }, Math.max(0, at - Date.now())))
    }

    broadcast(io, roomId)
  })()
}
