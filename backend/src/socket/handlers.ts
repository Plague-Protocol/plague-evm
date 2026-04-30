import { Server, Socket } from 'socket.io'
import { logger } from '../lib/logger'
import type { GameEvent } from '../types/game'

// TODO: Issue #20 - Implement full socket event handlers
// TODO: Issue #21 - Implement room state sync via Redis

/**
 * Room expiry monitor — runs on a fixed interval server-side.
 *
 * Checks all rooms with status === 'waiting' whose expires_at has passed.
 * For each expired room:
 *   1. Calls contract.expire_room(room_id) — refunds all staked players.
 *   2. Broadcasts a room_expired event to all room subscribers.
 *   3. Removes the room from the active room registry.
 *
 * This runs independently of any client socket connection, so expiry is
 * enforced even if no player is watching the room at that moment.
 *
 * Default check interval: 15 seconds.
 * TODO: Issue #47 — implement DB/Redis room registry and contract call
 */
export function startRoomExpiryMonitor(io: Server, intervalMs = 15_000): NodeJS.Timeout {
  return setInterval(async () => {
    // TODO: Issue #47
    // 1. Load all rooms with status === 'waiting' from DB/Redis
    // 2. Filter: room.expires_at <= Date.now()
    // 3. For each expired room:
    //    a. Call contract.expire_room(room_id) — this refunds stakes on-chain
    //    b. Broadcast room_expired to all subscribers: io.to(roomId).emit('game_event', {...})
    //    c. Remove room from DB/Redis registry
    //    d. Log expiry
    logger.info('[expiry-monitor] tick — TODO: check expired waiting rooms')
  }, intervalMs)
}

export function setupSocketHandlers(io: Server) {
  io.on('connection', (socket: Socket) => {
    logger.info(`Client connected: ${socket.id}`)

    /**
     * Subscribe to a room's real-time events (socket only — NOT game join).
     *
     * This handler lets any connected client receive events for a room.
     * It does NOT add the player to the game or grant participation rights.
     *
     * Game joining (staking, role commitment) is done via the contract:
     *   contract.join_room(room_id)  — only valid while room.status == 'waiting'
     *
     * Players who subscribe after status is 'active' can spectate (receive
     * events) but will never receive private infection_assigned events, cannot
     * vote, cannot submit proofs, and are not eligible for payouts.
     *
     * TODO: Issue #20
     */
    socket.on('join_room', async ({ roomId, playerAddress }: { roomId: string; playerAddress: string }) => {
      // TODO: Issue #20
      // 1. Validate roomId exists in DB/Redis
      // 2. socket.join(roomId) — unconditional (spectating is always allowed)
      // 3. If playerAddress is in the room's player list:
      //      send current full room state (role, status, round, etc.)
      // 4. Else (spectator):
      //      send public room state only (no private role/infection data)
      // 5. Broadcast player_joined only if playerAddress is a registered participant
      socket.join(roomId)
      logger.info(`${socket.id} subscribed to room ${roomId}`)
    })

    /**
     * Player leaves a room
     * TODO: Issue #20
     */
    socket.on('leave_room', ({ roomId }: { roomId: string }) => {
      socket.leave(roomId)
    })

    /**
     * Phase timer tick — backend manages phase transitions
     * TODO: Issue #23
     */
    socket.on('request_phase_advance', async ({ roomId }: { roomId: string }) => {
      // TODO: Issue #23
      // 1. Check if phase timer has expired
      // 2. Advance to next phase
      // 3. Broadcast phase_changed event
    })

    /**
     * Infection assignment — system assigns each round, NOT player-chosen.
     *
     * Normal case:
     *   target = eligible_clean_alive_players[
     *     hash(roomId, round, prevTxHash) % count
     *   ]
     *
     * All-protected-tie case:
     *   target is selected from among the previous round's tied protected
     *   survivors (stored in pending_infection_next_round flag on PlayerState).
     *
     * Only the infected player receives the private 'infection_assigned' event.
     * No event reveals who caused the infection.
     *
     * TODO: Issue #22
     */
    socket.on('assign_infection', async ({ roomId, round }: { roomId: string; round: number }) => {
      // TODO: Issue #22
      // 1. Load alive clean players for this room
      // 2. Check if any player has pending_infection_next_round = true
      //    a. If yes → infect that player (clear the flag)
      //    b. If no  → deterministic pick: hash(roomId, round, prevTxHash) % count
      // 3. Update player status to Infected in DB
      // 4. Emit private 'infection_assigned' only to that player's socket:
      //      socket.to(playerSocketId).emit('game_event', { type: 'infection_assigned', ... })
      // 5. Do NOT broadcast who was infected to the room
    })

    /**
     * Proof submission during the Discussion phase.
     *
     * The window opens at the start of discussion and closes the moment
     * voting begins. No proofs are accepted after that.
     *
     * This is a strategic bet: the player commits BEFORE knowing who
     * will be the top-voted target. Key rules:
     *   - 1 free proof per player per game (free_proof_used flag)
     *   - proof_fee charged for subsequent proofs (added to pot)
     *   - max 1 per player per round (nullifier-enforced)
     *   - only CLEAN players can produce a valid proof (infected fail circuit)
     *
     * What the proof does at resolve time:
     *   - Sole top-voted + has proof → saved, no elimination
     *   - Tied top-voted, some have proofs → unprotected eliminated
     *   - Tied top-voted, all have proofs → one randomly infected (not eliminated)
     *
     * TODO: Issue #45
     */
    socket.on('submit_proof', async (payload: {
      roomId: string
      playerAddress: string
      commitment: string
      nullifier: string
      zkProof: string
      isFreeProof: boolean
    }) => {
      // TODO: Issue #45
      // 1. Verify current phase is Discussion
      // 2. Verify player is alive
      // 3. Forward to contract: submitInnocenceProof(...)
      // 4. On success, broadcast proof_submitted event (address only, no outcome)
      // 5. Lock out further submissions from this player this round
    })

    /**
     * Round resolution — called after voting phase ends.
     *
     * Proof window was closed before voting began. Resolution uses
     * whatever proofs players chose to submit during discussion.
     *
     * Resolution cases (see contract spec for full algorithm):
     *   A: Single top candidate, no proof → eliminated
     *   B: Single top candidate, has proof → saved, no elimination
     *   C: Tied, some unprotected → unprotected candidate eliminated
     *   D: Tied, all have proofs → one randomly infected (not eliminated)
     *
     * Absent vote rule:
     *   Players who didn't vote get their vote cast for the current
     *   leading target (prevents mass-abstention collusion by infected).
     *
     * Endgame check after each resolve:
     *   infected_alive == 0            → clean_win
     *   infected_alive >= clean_alive  → infected_win  (includes 1 vs 1)
     *   round == max_rounds            → infected_win (time expired)
     *
     * TODO: Issue #46
     */
    socket.on('resolve_round', async ({ roomId }: { roomId: string }) => {
      // TODO: Issue #46
      // 1. Apply absent-vote rule before tallying
      // 2. Call contract resolveRound(roomId)
      // 3. Broadcast appropriate event:
      //    - Case A: player_eliminated
      //    - Case B: player_saved_by_proof (address known, no outcome reason)
      //    - Case C: player_eliminated + vote_resolved (generic)
      //    - Case D: infection_assigned (private to target) + vote_resolved (generic)
      // 4. If game over → broadcast game_ended with outcome + payout breakdown
      // 5. If continuing → start next round, assign_infection
    })

    socket.on('disconnect', () => {
      logger.info(`Client disconnected: ${socket.id}`)
    })
  })
}

/**
 * Broadcast a game event to all players in a room
 */
export function broadcastEvent(io: Server, roomId: string, event: GameEvent) {
  io.to(roomId).emit('game_event', event)
}
