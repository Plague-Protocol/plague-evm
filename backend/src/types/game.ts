export type PlayerStatus = 'clean' | 'infected' | 'eliminated'
export type RoomStatus = 'waiting' | 'starting' | 'active' | 'ended'
export type RoundPhase = 'infection' | 'discussion' | 'voting' | 'reveal' | 'ended'
export type GameOutcome = 'clean_win' | 'infected_win' | 'max_rounds_draw'

/**
 * Join window: contract join_room only accepted while status === 'waiting'.
 * start_game closes the window permanently. Late arrivals may subscribe to
 * socket events for spectating but cannot join the game or earn winnings.
 *
 * Room expiry: a waiting room that does not reach min_players before
 * expires_at is auto-closed by the backend expiry monitor. All staked
 * amounts are refunded via the contract. Subscribers receive room_expired.
 *
 * Win conditions (checked after every Reveal phase, alive counts only):
 *   clean_win    : infected_alive === 0
 *   infected_win : infected_alive >= clean_alive  (includes 1v1)
 *   max_rounds_draw: max_rounds reached without either above
 */

export type GameEventType =
  | 'player_joined'
  | 'player_left'
  | 'game_started'
  | 'round_started'
  | 'phase_changed'
  | 'vote_cast'
  | 'proof_window_open'        // broadcast: discussion phase, proofs now accepted
  | 'proof_window_closed'      // broadcast: voting opening, submissions now locked
  | 'proof_submitted'          // broadcast: address known, outcome not stated
  | 'player_eliminated'        // broadcast: eliminated after vote resolution
  | 'player_saved_by_proof'    // broadcast: top-voted player saved by proof
  | 'vote_resolved'            // broadcast: generic outcome, no proof hints
  | 'infection_assigned'       // private: only sent to the newly infected player
  | 'game_ended'
  | 'pot_drained'
  | 'room_expired'             // broadcast: waiting room timed out — stakes refunded

export interface GameEvent {
  type: GameEventType
  roomId: string
  payload: Record<string, unknown>
  timestamp: number
}
