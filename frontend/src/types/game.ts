// ─── Player ────────────────────────────────────────────────────────────────

export type PlayerStatus = 'clean' | 'infected' | 'eliminated'
export type PlayerRole = 'patient_zero' | 'infected' | 'clean' | 'unknown'

export interface Player {
  id: string
  walletAddress: string
  displayName: string
  status: PlayerStatus
  /** Only revealed at game end; clients only ever receive their own role */
  role: PlayerRole
  isEliminated: boolean
  stakedAmount: bigint
  joinedAt: number
  /**
   * Proof economy:
   * - Each player gets exactly 1 free proof per game.
   * - Additional proofs require a fee (proofFee from RoomConfig) — added to pot.
   * - Max 1 proof submitted per player per round (enforced by nullifier).
   * - Proofs are submitted during the DISCUSSION phase ONLY.
   *   Submission closes when voting opens — no proofs accepted during voting.
   * - Only CLEAN players can produce a valid proof.
   *   Infected players fail the circuit's role == ROLE_CLEAN assertion.
   * - Strategic choice: you don't know yet if you'll be the top-voted target.
   */
  freeProofUsed: boolean
  proofsSubmittedTotal: number
}

// ─── Room ──────────────────────────────────────────────────────────────────

/**
 * Join window: players may only call join_room while status === 'waiting'.
 * Once the host calls start_game the window closes permanently:
 *   - Roles are assigned (VRF) — late joiners have no role
 *   - Pot is fixed — adding a stake mid-game breaks payout math
 *   - ZK commitments are registered — a missing commitment means no valid proofs
 * Players who are NOT in the room when the game starts may spectate (socket
 * subscription) but cannot participate or receive winnings.
 */
export type RoomStatus = 'waiting' | 'starting' | 'active' | 'ended'

export interface Room {
  id: string
  contractAddress: string
  hostAddress: string
  players: Player[]
  maxPlayers: number
  minPlayers: number
  stakeAmount: bigint
  /** Fee per paid proof (after the free one); added to pot when paid */
  proofFee: bigint
  status: RoomStatus
  currentRound: number
  maxRounds: number
  createdAt: number
  /**
   * Unix ms timestamp after which a waiting room auto-expires.
   * Set at creation time: createdAt + (expiry_secs * 1000).
   * If the room has not reached min_players by this time, status → 'ended'
   * and all stakes are refunded. Only relevant while status === 'waiting'.
   */
  expiresAt: number
  startedAt?: number
  endedAt?: number
}

// ─── Round ─────────────────────────────────────────────────────────────────

export type RoundPhase = 'infection' | 'discussion' | 'voting' | 'reveal' | 'ended'

export interface Round {
  number: number
  phase: RoundPhase
  /**
   * Address of player newly infected this round.
   * Assigned deterministically by backend:
   *   target = eligible_clean_players[ hash(roomId, round, prevTxHash) % count ]
   * Special case: if previous round ended in an all-proofs-tie, one of the
   * tied survivors is infected immediately (not next round — see VotingResolution).
   * Players are notified of their OWN infection status only (not the source).
   */
  infectedThisRound: string[]
  eliminatedThisRound: string[]
  votes: Vote[]
  /**
   * Proof submissions this round.
   * Accepted ONLY during Discussion phase — window closes when voting opens.
   * Max 1 per player per round (nullifier-enforced).
   * Strategic gamble: player decides before seeing who gets the most votes.
   */
  proofSubmissions: ProofSubmission[]
  /** Voting resolution outcome — always set after Reveal phase. */
  votingResolution?: VotingResolution
  drainAmount: bigint
  startedAt: number
  phaseEndsAt: number
}

// ─── Voting Resolution ─────────────────────────────────────────────────────

/**
 * Outcome of vote tallying + proof resolution after each round.
 *
 * Proof submission window: Discussion phase only (closes when voting opens).
 * A player's submitted proof is active for that round's resolution.
 *
 * Resolution cases:
 *
 *   eliminated
 *     Single top-voted player, no proof → eliminated.
 *
 *   saved_by_proof
 *     Single top-voted player submitted a valid proof → NOT eliminated.
 *     Game continues; normal system infection happens next round.
 *
 *   tie_unprotected_eliminated
 *     Tied top-vote candidates; at least one has no proof.
 *     Unprotected candidate(s) eliminated (deterministic if multiple:
 *     lowest hash(address)). Protected candidates survive.
 *
 *   tie_all_proofs_infected
 *     Tied top-vote candidates; ALL submitted valid proofs.
 *     Nobody eliminated. System immediately infects one of the tied
 *     players at random: hash(roomId, round, prevTxHash) % len(tied).
 *     Public event carries only a generic message — no proof hints.
 */
export type VotingOutcome =
  | 'eliminated'
  | 'saved_by_proof'
  | 'tie_unprotected_eliminated'
  | 'tie_all_proofs_infected'

export interface VotingResolution {
  outcome: VotingOutcome
  /** All candidates that reached the top vote count */
  topCandidates: string[]
  /** Player eliminated (set for eliminated / tie_unprotected_eliminated) */
  eliminated?: string
  /** Player whose proof saved them from elimination (set for saved_by_proof) */
  savedPlayer?: string
  /** Player randomly infected from tied group (set for tie_all_proofs_infected) */
  infectedFromTie?: string
  /** Generic message broadcast to room — never names proof holders */
  publicMessage: string
}

// ─── Vote ──────────────────────────────────────────────────────────────────

export interface Vote {
  voterAddress: string
  targetAddress: string
  timestamp: number
}

// ─── ZK Proof ──────────────────────────────────────────────────────────────

export interface ZKProof {
  proof: {
    pi_a: string[]
    pi_b: string[][]
    pi_c: string[]
  }
  publicSignals: string[]
}

export interface RoleCommitment {
  commitment: string
  nullifier: string
}

/**
 * Innocence proof submission.
 * Circuit: innocence_proof.nr
 * Public:  commitment, nullifier
 * Private: role (must equal ROLE_CLEAN = 0), secret, round_number
 * Nullifier = Poseidon(secret, roomId, round) — prevents cross-round replay.
 * Infected players CANNOT produce a valid proof (circuit rejects role != 0).
 */
export interface ProofSubmission {
  playerAddress: string
  commitment: string
  /** H(secret, roomId, round) — unique per player per round */
  nullifier: string
  zkProof: ZKProof
  /** true = free proof slot used; false = paid proof (fee charged) */
  isFreeProof: boolean
  submittedAt: number
}

// ─── Endgame ───────────────────────────────────────────────────────────────

/**
 * Win conditions (checked after every Reveal phase):
 *   CLEAN_WIN  : infected_alive === 0
 *   INFECTED_WIN: infected_alive >= clean_alive (parity = inevitable spread)
 *   INFECTED_WIN: 1 infected vs 1 clean alive (parity rule, game over)
 * alive counts = ONLY currently alive players (eliminated don't count).
 */
export type GameOutcome = 'clean_win' | 'infected_win' | 'max_rounds_draw'

export interface GameResult {
  outcome: GameOutcome
  winners: string[]   // wallet addresses of winning faction alive players
  losers: string[]    // all other players
  potPerWinner: bigint
  totalPot: bigint
  rounds: number
}

// ─── Game State ────────────────────────────────────────────────────────────

export interface GameState {
  room: Room | null
  localPlayer: Player | null
  currentRound: Round | null
  result: GameResult | null
  isConnected: boolean
  isLoading: boolean
  error: string | null
}

// ─── Contract ──────────────────────────────────────────────────────────────

export interface ContractConfig {
  contractId: string
  network: 'testnet' | 'mainnet'
  rpcUrl: string
}

// ─── Events (Socket) ───────────────────────────────────────────────────────

export type GameEventType =
  | 'player_joined'
  | 'player_left'
  | 'game_started'
  | 'round_started'
  | 'phase_changed'
  | 'vote_cast'
  | 'proof_window_open'        // broadcast: discussion phase started, proofs now accepted
  | 'proof_window_closed'      // broadcast: voting about to open, no more proof submissions
  | 'proof_submitted'          // broadcast: a player submitted a proof (address known, outcome unknown)
  | 'player_eliminated'        // broadcast: player eliminated after vote resolution
  | 'player_saved_by_proof'    // broadcast: top-voted player was saved (proof existed)
  | 'vote_resolved'            // broadcast: generic resolution summary, no proof hints
  | 'infection_assigned'       // private: only sent to the newly infected player
  | 'game_ended'
  | 'pot_drained'
  | 'room_expired'             // broadcast: waiting room timed out without filling — stakes refunded

export interface GameEvent {
  type: GameEventType
  roomId: string
  payload: Record<string, unknown>
  timestamp: number
}
