// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IZKVerifier}  from "./interfaces/IZKVerifier.sol";
import {IERC20}       from "./interfaces/IERC20.sol";
import {IFeeManager}  from "./interfaces/IFeeManager.sol";
import {IPotEscrow}   from "./interfaces/IPotEscrow.sol";

/**
 * @title PlagueGame
 * @notice On-chain game room, escrow, voting, ZK proof verification, and payout
 *         for the Plague Protocol social deduction game on Celo.
 *         Accepts cUSD (0x765DE816845861e75A25fCA122bb6022DB77Eaca) as payment.
 *
 *         Platform fees:
 *           - Proof fees (first free, then charged per-proof) → platform wallet
 *           - 1.5% of pot at end of game → platform wallet
 *
 * ── Room Lifecycle ─────────────────────────────────────────────────────────────
 *  Waiting → Starting → Active → Ended
 *
 *  createRoom    : host configures room; status = Waiting
 *  joinRoom      : players stake cUSD; only while Waiting and before expiresAt
 *  startGame     : host closes join window; status = Starting
 *  submitRole*   : players commit to their role via ZK proof
 *  beginActive   : backend starts round 1; status = Active
 *
 * ── Round Structure (repeated each round) ──────────────────────────────────────
 *  Infection → Discussion → Voting → Reveal → (next Infection or Ended)
 *
 *  assignInfection    : backend assigns newly infected player (private off-chain)
 *  submitInnocence*   : clean players prove innocence during Discussion only
 *  openVoting         : backend closes Discussion, opens Voting
 *  castVote           : players vote to eliminate a suspect during Voting
 *  resolveRound       : tallies votes, resolves elimination/save rules, checks endgame, pays out
 *
 * ── Vote Resolution Rules ──────────────────────────────────────────────────────
 *  1. A candidate is protected only if they are CLEAN and submitted an innocence proof.
 *  2. Single top candidate:
 *       - protected clean candidate → saved
 *       - otherwise                 → eliminated
 *  3. Tie:
 *       - if any infected are tied → eliminate ALL tied infected candidates
 *       - else eliminate ALL tied unprotected clean candidates
 *       - tied clean candidates with valid proofs are always saved
 *
 * ── Endgame ───────────────────────────────────────────────────────────────────
 *  1. infected_alive > clean_alive    → Infected wins (checked after Infection)
 *  2. infected_alive == 0             → Clean wins (checked after Reveal)
 *  3. infected_alive == 1 && clean_alive == 1 → Draw (checked after Reveal)
 *  4. currentRound >= maxRounds       → Draw (checked after Reveal)
 *
 * ── Payout ─────────────────────────────────────────────────────────────────────
 *  pot = sum(stakes)
 *  Proof fees are collected separately and sent to platform (not included in pot).
 *  At game end: platform takes 1.5% of pot, remainder split among winners.
 */
contract PlagueGame {
    uint64 public constant ROLE_COMMIT_TIMEOUT_SECS = 180;

    // ─── Enums ────────────────────────────────────────────────────────────────────

    enum RoomStatus   { Waiting, Starting, Active, Ended }
    enum RoundPhase   { Infection, Discussion, Voting, Reveal, Ended }
    enum PlayerStatus { Clean, Infected, Eliminated }
    enum GameOutcome  { CleanWin, InfectedWin, MaxRoundsDraw }

    // ─── Structs ──────────────────────────────────────────────────────────────────

    struct RoomConfig {
        uint32  minPlayers;
        uint32  maxPlayers;
        uint256 stakeAmount;
        uint32  maxRounds;
        uint64  roundDurationSecs;
        uint64  discussionDurationSecs;
        uint64  votingDurationSecs;
        uint64  expirySecs;
        uint256 proofFee;
    }

    struct Room {
        uint256    id;
        address    host;
        RoomStatus status;
        RoomConfig config;
        address[]  players;
        uint32     currentRound;
        RoundPhase currentPhase;
        uint256    pot;
        uint64     createdAt;
        uint64     expiresAt;
        uint64     startedAt;
        uint64     phaseStartedAt;
    }

    struct PlayerState {
        address      addr;
        PlayerStatus status;
        bytes32      roleCommitment;
        uint256      staked;
        address      voteTarget;
        uint64       joinedAt;
        bool         freeProofUsed;
        uint32       proofsSubmittedTotal;
        bool         pendingInfectionNextRound;
        bool         hasProofThisRound;
        bool         hasVotedThisRound;
        bool         roleCommitted;
    }

    // ─── Storage ──────────────────────────────────────────────────────────────────

    mapping(uint256 => Room)                               public rooms;
    mapping(uint256 => mapping(address => PlayerState))    public players;
    /// @dev Infection succession order for patient-zero promotion.
    mapping(uint256 => address[])                          private infectionChain;
    /// @dev Index pointer into infectionChain for current patient zero.
    mapping(uint256 => uint256)                            private patientZeroIndex;
    /// @dev Cached current patient zero address for quick reads.
    mapping(uint256 => address)                            public currentPatientZero;
    /// @dev Queued infection target for the next Infection phase (set from patient zero vote).
    mapping(uint256 => address)                            private pendingInfectionTarget;
    /// @dev Nullifier registry — scoped per room so a nullifier used in room A
    ///      cannot be replayed in room B even with the same round number.
    mapping(uint256 => mapping(bytes32 => bool))           public usedNullifiers;
    /// @dev Role-commitment registry — scoped per room. Prevents two players in
    ///      the same room committing the same hash (which would otherwise cause
    ///      a nullifier collision at Shield activation, letting only one of them
    ///      submit). Across rooms the same passphrase is fine since both the
    ///      commitment mapping and the nullifier already incorporate roomId.
    mapping(uint256 => mapping(bytes32 => bool))           public usedRoleCommitments;

    uint256 public roomCount;
    /// @dev Number of rooms currently in Waiting, Starting, or Active status.
    uint256 public activeRoomCount;
    /// @dev Maximum concurrent non-ended rooms. Admin-adjustable. Default 10.
    uint256 public maxActiveRooms = 10;
    address public admin;
    /// @dev backendSigner is authorised to call assignInfection, beginActivePhase,
    ///      and openVoting. Set to your off-chain game-server address.
    address public backendSigner;
    IZKVerifier public zkVerifier;

    uint256 public platformFees;
    address public platformReceiver;
    /// @dev cUSD token contract. Celo Sepolia: 0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1
    ///      Mainnet: 0x765DE816845861e75A25fCA122bb6022DB77Eaca
    IERC20  public cUsdToken;
    /// @dev Separate fee-manager contract. When set, proof fees and pot fees are
    ///      forwarded here instead of being accumulated in platformFees.
    IFeeManager public feeManager;
    /// @dev Separate pot-escrow contract. When set, player stakes are forwarded here
    ///      on deposit and released from here on payout/refund.
    IPotEscrow  public potEscrow;
    bool private _initialized;
    bool private _entered;

    // ─── Events ───────────────────────────────────────────────────────────────────

    event PlayerJoined(uint256 indexed roomId, address player);
    event GameStarted(uint256 indexed roomId);
    event RoundStarted(uint256 indexed roomId, uint32 round);
    event PhaseChanged(uint256 indexed roomId, RoundPhase phase);
    event VoteCast(uint256 indexed roomId, address voter, address target);
    /// @dev Address is public; proof outcome is deliberately NOT stated here
    event ProofSubmitted(uint256 indexed roomId, address player);
    event PlayerEliminated(uint256 indexed roomId, address player);
    /// @dev Address is public; reason is deliberately NOT stated here
    event PlayerSavedByProof(uint256 indexed roomId, address player);
    event VoteResolved(uint256 indexed roomId, string message);
    /// @dev InfectionAssigned is emitted on-chain but the backend only forwards
    ///      this privately to the affected player via socket.
    event InfectionAssigned(uint256 indexed roomId, address player);
    event PatientZeroUpdated(uint256 indexed roomId, address patientZero);
    event GameEnded(uint256 indexed roomId, GameOutcome outcome);
    event PotDrained(uint256 indexed roomId, address winner, uint256 amount);
    event RoomExpired(uint256 indexed roomId);
    event MaxActiveRoomsSet(uint256 newMax);
    event RoomCreated(uint256 indexed roomId, address indexed host);

    // ─── Custom Errors ────────────────────────────────────────────────────────────

    error Unauthorized();
    error AlreadyInitialized();
    error InvalidRoom();
    error RoomNotWaiting();
    error RoomFull();
    error RoomExpiredError();
    error AlreadyJoined();
    error WrongStakeAmount();
    error NotHost();
    error NotEnoughPlayers();
    error NotActive();
    error WrongPhase();
    error AlreadyVoted();
    error AlreadyCommitted();
    error AlreadyProvedThisRound();
    error NullifierUsed();
    error InvalidProof();
    error NotParticipant();
    error NotAlive();
    error InvalidInfectionTarget();
    error TooManyActiveRooms();
    error Reentrancy();
    error RoleCommitmentPending();
    error StartThresholdMet();
    error DuplicateRoleCommitment();

    // ─── Modifiers ────────────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        _onlyAdmin();
        _;
    }

    modifier onlyBackend() {
        _onlyBackend();
        _;
    }

    modifier roomExists(uint256 roomId) {
        _roomExists(roomId);
        _;
    }

    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _onlyAdmin() internal view {
        if (msg.sender != admin) revert Unauthorized();
    }

    function _onlyBackend() internal view {
        if (msg.sender != backendSigner && msg.sender != admin) revert Unauthorized();
    }

    function _roomExists(uint256 roomId) internal view {
        if (roomId == 0 || roomId > roomCount) revert InvalidRoom();
    }

    function _nonReentrantBefore() internal {
        if (_entered) revert Reentrancy();
        _entered = true;
    }

    function _nonReentrantAfter() internal {
        _entered = false;
    }

    // ─── Initialisation ───────────────────────────────────────────────────────────

    /**
     * @param _admin          Address that owns admin functions (setBackendSigner, setZkVerifier, setPlatformReceiver).
     * @param _backendSigner  Address authorised to drive phase transitions server-side.
     * @param _zkVerifier     Address of the IZKVerifier implementation (stub or Noir-generated).
     * @param _platformReceiver Address to receive platform fees (proof fees + 1.5% of pot).
     * @param _cUsdToken      cUSD ERC-20 token address for the target network.
     */
    function initialize(
        address _admin,
        address _backendSigner,
        address _zkVerifier,
        address _platformReceiver,
        address _cUsdToken
    ) external {
        if (_initialized) revert AlreadyInitialized();
        require(_admin != address(0), "admin address required");
        require(_backendSigner != address(0), "backendSigner address required");
        require(_zkVerifier != address(0), "zkVerifier address required");
        require(_platformReceiver != address(0), "platformReceiver address required");
        require(_cUsdToken != address(0), "cUSD token address required");
        _initialized      = true;
        admin             = _admin;
        backendSigner     = _backendSigner;
        zkVerifier        = IZKVerifier(_zkVerifier);
        platformReceiver  = _platformReceiver;
        cUsdToken         = IERC20(_cUsdToken);
    }

    // ─── Room Management ──────────────────────────────────────────────────────────

    /**
     * @notice Create a new waiting room. The caller becomes the host.
     * @param maxPlayers  Maximum number of participants (4–20).
     * @param stakeAmount Amount of cUSD (wei) each player must stake to join.
     * @param proofFee    Fee per additional innocence proof (goes to platform, not pot).
     * @param expirySecs  Seconds before an unfilled room auto-expires (min 60).
     * @return roomId     Incremented room counter — use as the room ID everywhere.
     */
    function createRoom(
        uint32  maxPlayers,
        uint256 stakeAmount,
        uint256 proofFee,
        uint64  expirySecs
    ) external returns (uint256 roomId) {
        require(maxPlayers >= 4 && maxPlayers <= 20, "maxPlayers must be 4-20");
        require(stakeAmount > 0, "stakeAmount must be > 0");
        require(expirySecs >= 60, "expirySecs must be >= 60");
        if (activeRoomCount >= maxActiveRooms) revert TooManyActiveRooms();

        unchecked { roomId = ++roomCount; }
        unchecked { activeRoomCount++; }

        uint64 ts = uint64(block.timestamp);

        Room storage r = rooms[roomId];
        r.id           = roomId;
        r.host         = msg.sender;
        r.status       = RoomStatus.Waiting;
        r.currentPhase = RoundPhase.Ended;
        r.createdAt    = ts;
        r.expiresAt    = ts + expirySecs;

        RoomConfig storage cfg = r.config;
        cfg.minPlayers            = 3;
        cfg.maxPlayers            = maxPlayers;
        cfg.stakeAmount           = stakeAmount;
        cfg.maxRounds             = 10;
        cfg.roundDurationSecs     = 180;
        cfg.discussionDurationSecs = 180;
        cfg.votingDurationSecs    = 120;
        cfg.expirySecs            = expirySecs;
        cfg.proofFee              = proofFee;

        // Auto-join: host is always the first player.
        // Caller must have approved this contract for at least stakeAmount cUSD.
        _safeTransferFrom(msg.sender, address(this), stakeAmount);
        _potDeposit(roomId, stakeAmount);

        r.players.push(msg.sender);
        r.pot += stakeAmount;

        players[roomId][msg.sender] = PlayerState({
            addr:                      msg.sender,
            status:                    PlayerStatus.Clean,
            roleCommitment:            bytes32(0),
            staked:                    stakeAmount,
            voteTarget:                address(0),
            joinedAt:                  ts,
            freeProofUsed:             false,
            proofsSubmittedTotal:      0,
            pendingInfectionNextRound: false,
            hasProofThisRound:         false,
            hasVotedThisRound:         false,
            roleCommitted:             false
        });

        emit RoomCreated(roomId, msg.sender);
        emit PlayerJoined(roomId, msg.sender);
    }

    /**
     * @notice Join an open room by transferring the required cUSD stake.
     *         Caller must have approved this contract for at least stakeAmount cUSD.
     *         Only valid while the room is in Waiting status and before expiresAt.
     */
    function joinRoom(uint256 roomId) external roomExists(roomId) nonReentrant {
        Room storage r = rooms[roomId];

        if (r.status != RoomStatus.Waiting)                        revert RoomNotWaiting();
        if (block.timestamp >= r.expiresAt)                        revert RoomExpiredError();
        if (r.players.length >= r.config.maxPlayers)               revert RoomFull();
        if (players[roomId][msg.sender].addr != address(0))        revert AlreadyJoined();

        uint256 stake = r.config.stakeAmount;
        _safeTransferFrom(msg.sender, address(this), stake);
        _potDeposit(roomId, stake);

        r.players.push(msg.sender);
        r.pot += stake;

        players[roomId][msg.sender] = PlayerState({
            addr:                    msg.sender,
            status:                  PlayerStatus.Clean,
            roleCommitment:          bytes32(0),
            staked:                  stake,
            voteTarget:              address(0),
            joinedAt:                uint64(block.timestamp),
            freeProofUsed:           false,
            proofsSubmittedTotal:    0,
            pendingInfectionNextRound: false,
            hasProofThisRound:       false,
            hasVotedThisRound:       false,
            roleCommitted:           false
        });

        emit PlayerJoined(roomId, msg.sender);
    }

    /**
     * @notice Host closes the join window and moves the room to Starting.
     *         Players must now submit role commitments before rounds begin.
     */
    function startGame(uint256 roomId) external roomExists(roomId) {
        Room storage r = rooms[roomId];

        if (msg.sender != r.host)                          revert NotHost();
        if (r.status != RoomStatus.Waiting)                revert RoomNotWaiting();
        if (r.players.length < r.config.minPlayers)        revert NotEnoughPlayers();

        r.status     = RoomStatus.Starting;
        r.startedAt  = uint64(block.timestamp);

        emit GameStarted(roomId);
    }

    /**
     * @notice Player commits their role (CLEAN or INFECTED) via a ZK proof.
     *         Called during Starting phase before round 1 begins.
     * @param commitment  Poseidon(role, secret) — binding commitment.
     * @param zkProof     Groth16 proof bytes (empty in bypass/test mode).
     */
    function submitRoleCommitment(
        uint256  roomId,
        bytes32  commitment,
        bytes calldata zkProof
    ) external roomExists(roomId) {
        Room storage r        = rooms[roomId];
        PlayerState storage p = players[roomId][msg.sender];

        if (r.status != RoomStatus.Starting)  revert WrongPhase();
        if (p.addr == address(0))             revert NotParticipant();
        if (p.roleCommitted)                  revert AlreadyCommitted();
        if (usedRoleCommitments[roomId][commitment]) revert DuplicateRoleCommitment();

        if (address(zkVerifier) != address(0)) {
            if (!zkVerifier.verifyRoleCommitment(commitment, zkProof)) revert InvalidProof();
        }

        usedRoleCommitments[roomId][commitment] = true;
        p.roleCommitment = commitment;
        p.roleCommitted  = true;
    }

    // ─── Backend-driven Phase Transitions ────────────────────────────────────────

    /**
     * @notice Backend calls this once all players have submitted role commitments.
     *         Transitions room to Active and starts round 1 in the Infection phase.
     */
    function beginActivePhase(uint256 roomId) external onlyBackend roomExists(roomId) {
        Room storage r = rooms[roomId];
        if (r.status != RoomStatus.Starting) revert WrongPhase();

        uint256 aliveCommitted = 0;
        for (uint256 i = 0; i < r.players.length; i++) {
            PlayerState storage p = players[roomId][r.players[i]];
            if (p.status == PlayerStatus.Eliminated) continue;
            if (!p.roleCommitted) revert RoleCommitmentPending();
            unchecked { aliveCommitted++; }
        }
        if (aliveCommitted < r.config.minPlayers) revert NotEnoughPlayers();

        r.status         = RoomStatus.Active;
        r.currentRound   = 1;
        r.currentPhase   = RoundPhase.Infection;
        r.phaseStartedAt = uint64(block.timestamp);

        emit RoundStarted(roomId, 1);
        emit PhaseChanged(roomId, RoundPhase.Infection);
    }

    /**
     * @notice Eliminate players who failed to submit role commitments before timeout.
     *         This prevents start-phase griefing/DoS by non-committing participants.
     */
    function eliminateUncommittedPlayers(uint256 roomId) external onlyBackend roomExists(roomId) {
        Room storage r = rooms[roomId];
        if (r.status != RoomStatus.Starting) revert WrongPhase();
        if (block.timestamp < uint256(r.startedAt) + ROLE_COMMIT_TIMEOUT_SECS) revert WrongPhase();

        address[] memory all = r.players;
        for (uint256 i = 0; i < all.length; i++) {
            PlayerState storage p = players[roomId][all[i]];
            if (p.status == PlayerStatus.Eliminated) continue;
            if (p.roleCommitted) continue;
            p.status = PlayerStatus.Eliminated;
            emit PlayerEliminated(roomId, all[i]);
        }
    }

    /**
     * @notice Finalize a timed-out Starting room when too few committed players remain.
     *         Uncommitted alive players are eliminated, and escrow is split among committed
     *         survivors. If nobody committed, everyone is refunded their original stake.
     *
     *         This prevents room deadlocks where beginActivePhase can never pass minPlayers.
     */
    function finalizeStartTimeout(uint256 roomId) external onlyBackend roomExists(roomId) nonReentrant {
        Room storage r = rooms[roomId];
        if (r.status != RoomStatus.Starting) revert WrongPhase();
        if (block.timestamp < uint256(r.startedAt) + ROLE_COMMIT_TIMEOUT_SECS) revert WrongPhase();

        address[] memory all = r.players;
        uint256 committedAlive = 0;
        for (uint256 i = 0; i < all.length; i++) {
            PlayerState storage p = players[roomId][all[i]];
            if (p.status == PlayerStatus.Eliminated) continue;
            if (!p.roleCommitted) {
                p.status = PlayerStatus.Eliminated;
                emit PlayerEliminated(roomId, all[i]);
                continue;
            }
            unchecked { committedAlive++; }
        }

        if (committedAlive >= r.config.minPlayers) revert StartThresholdMet();

        uint256 pot = r.pot;
        r.pot = 0;

        if (pot > 0) {
            if (committedAlive == 0) {
                // No one committed in time: return everyone their original stake.
                for (uint256 i = 0; i < all.length; i++) {
                    PlayerState storage p = players[roomId][all[i]];
                    uint256 refund = p.staked;
                    if (refund == 0) continue;
                    _potRelease(roomId, all[i], refund);
                    emit PotDrained(roomId, all[i], refund);
                }
            } else {
                uint256 share = pot / committedAlive;
                uint256 dust = pot - (share * committedAlive);
                bool dustPaid = false;
                for (uint256 i = 0; i < all.length; i++) {
                    PlayerState storage p = players[roomId][all[i]];
                    if (p.status == PlayerStatus.Eliminated || !p.roleCommitted) continue;
                    uint256 payout = share;
                    if (!dustPaid && dust > 0) {
                        payout += dust;
                        dustPaid = true;
                    }
                    _potRelease(roomId, all[i], payout);
                    emit PotDrained(roomId, all[i], payout);
                }
            }
        }

        r.status       = RoomStatus.Ended;
        r.currentPhase = RoundPhase.Ended;
        unchecked { activeRoomCount--; }
        emit GameEnded(roomId, GameOutcome.MaxRoundsDraw);
    }

    /**
     * @notice Backend assigns this round's newly infected target.
     *
     *         Patient-zero succession model:
     *           - First infection in a room establishes initial patient zero.
     *           - Every newly infected player is appended to infectionChain.
     *           - If current patient zero is eliminated, the next alive address in
     *             infectionChain is promoted as patient zero (B -> E -> C -> G ...).
     *
     *         Constraints:
     *           - target must be alive and CLEAN.
     *           - already infected players cannot be infected again.
     *
     *         After assignment, phase automatically advances to Discussion.
     */
    function assignInfection(uint256 roomId, address target) external onlyBackend roomExists(roomId) {
        Room storage r = rooms[roomId];

        if (r.status != RoomStatus.Active)         revert NotActive();
        if (r.currentPhase != RoundPhase.Infection) revert WrongPhase();

        // Round 1: backend-provided target establishes initial patient zero.
        // Round 2+: infection target is queued from patient zero's vote in resolveRound.
        bool firstInfection = currentPatientZero[roomId] == address(0);
        address infectionTarget = firstInfection ? target : pendingInfectionTarget[roomId];

        // If we already have a patient zero, keep it synced to the next alive
        // candidate in infection order before recording this new infection.
        _syncPatientZero(roomId);

        if (infectionTarget != address(0)) {
            PlayerState storage p = players[roomId][infectionTarget];
            if (firstInfection) {
                if (p.addr == address(0))                  revert NotParticipant();
                if (p.status == PlayerStatus.Eliminated)   revert NotAlive();
                if (p.status != PlayerStatus.Clean)        revert InvalidInfectionTarget();
            }

            // For subsequent rounds, skip infection if the queued target is no
            // longer a valid clean/alive participant by the time Infection opens.
            if (p.addr != address(0) && p.status == PlayerStatus.Clean) {
                p.status                    = PlayerStatus.Infected;
                p.pendingInfectionNextRound = false;

                infectionChain[roomId].push(infectionTarget);

                // First infection establishes patient zero.
                if (currentPatientZero[roomId] == address(0)) {
                    currentPatientZero[roomId] = infectionTarget;
                    patientZeroIndex[roomId] = 0;
                    emit PatientZeroUpdated(roomId, infectionTarget);
                }

                emit InfectionAssigned(roomId, infectionTarget);
            }
        }

        pendingInfectionTarget[roomId] = address(0);

        // Endgame parity check is evaluated after infection is applied so the
        // player-visible state and game outcome stay aligned.
        // The very first infection only initializes the game and should never
        // end it immediately.
        if (!firstInfection) {
            (uint256 infectedAlive, uint256 cleanAlive) = _countAliveByStatus(roomId);
            if (infectedAlive > cleanAlive) {
                r.status       = RoomStatus.Ended;
                r.currentPhase = RoundPhase.Ended;
                unchecked { activeRoomCount--; }
                emit GameEnded(roomId, GameOutcome.InfectedWin);
                _distributePot(roomId, GameOutcome.InfectedWin);
                return;
            }
        }

        r.currentPhase   = RoundPhase.Discussion;
        r.phaseStartedAt = uint64(block.timestamp);
        emit PhaseChanged(roomId, RoundPhase.Discussion);
    }

    /**
     * @notice Backend closes Discussion and opens Voting.
     *         Proof submissions are locked after this call.
     */
    function openVoting(uint256 roomId) external onlyBackend roomExists(roomId) {
        Room storage r = rooms[roomId];
        if (r.status != RoomStatus.Active)           revert NotActive();
        if (r.currentPhase != RoundPhase.Discussion) revert WrongPhase();

        r.currentPhase   = RoundPhase.Voting;
        r.phaseStartedAt = uint64(block.timestamp);
        emit PhaseChanged(roomId, RoundPhase.Voting);
    }

    // ─── Innocence Proof (Discussion phase only) ──────────────────────────────────

    /**
     * @notice Submit a ZK innocence proof during the Discussion phase.
     *
     *         Proof economy:
     *           - First proof per player per GAME is free (freeProofUsed flag).
     *           - Subsequent proofs require the caller to have approved this contract
     *             for at least proofFee cUSD (sent to platform, not added to pot).
     *           - Maximum 1 proof per player per ROUND (hasProofThisRound flag).
     *           - Nullifier = Poseidon(secret, roomId, round) prevents cross-round replay.
     *           - Only CLEAN players can produce a proof that satisfies the circuit.
     *
     * @param commitment  Same Poseidon(role, secret) as submitted at startGame.
     * @param nullifier   Poseidon(secret, roomId, round) — unique per round.
     * @param zkProof     Groth16 proof bytes.
     */
    function submitInnocenceProof(
        uint256  roomId,
        bytes32  commitment,
        bytes32  nullifier,
        bytes calldata zkProof
    ) external roomExists(roomId) nonReentrant {
        Room storage r        = rooms[roomId];
        PlayerState storage p = players[roomId][msg.sender];

        if (r.status != RoomStatus.Active)           revert NotActive();
        if (r.currentPhase != RoundPhase.Discussion) revert WrongPhase();
        if (p.addr == address(0))                    revert NotParticipant();
        if (p.status == PlayerStatus.Eliminated)     revert NotAlive();
        if (p.status == PlayerStatus.Infected)       revert NotAlive();
        if (p.hasProofThisRound)                     revert AlreadyProvedThisRound();
        if (usedNullifiers[roomId][nullifier])        revert NullifierUsed();

        // Charge proof fee once the free proof has been used — sent to platform, not pot
        if (p.freeProofUsed) {
            uint256 fee = r.config.proofFee;
            if (fee > 0) {
                _routeFee(msg.sender, fee);
            }
        } else {
            p.freeProofUsed = true;
        }

        if (address(zkVerifier) != address(0)) {
            if (!zkVerifier.verifyInnocenceProof(commitment, nullifier, zkProof)) revert InvalidProof();
        }

        usedNullifiers[roomId][nullifier] = true;
        p.hasProofThisRound    = true;
        p.proofsSubmittedTotal++;

        emit ProofSubmitted(roomId, msg.sender);
    }

    // ─── Voting ───────────────────────────────────────────────────────────────────

    /**
     * @notice Cast a vote to eliminate a suspect.
     *         Only alive players may vote; only alive, non-eliminated targets accepted.
     *         Absent vote rule is applied by resolveRound — abstainers receive a
     *         self-vote (their vote is recorded against themselves).
     */
    function castVote(uint256 roomId, address target) external roomExists(roomId) {
        Room storage r          = rooms[roomId];
        PlayerState storage voter  = players[roomId][msg.sender];
        PlayerState storage tgt    = players[roomId][target];

        if (r.status != RoomStatus.Active)       revert NotActive();
        if (r.currentPhase != RoundPhase.Voting) revert WrongPhase();
        if (voter.addr == address(0))            revert NotParticipant();
        if (voter.status == PlayerStatus.Eliminated) revert NotAlive();
        if (voter.hasVotedThisRound)             revert AlreadyVoted();
        if (tgt.addr == address(0))              revert NotParticipant();
        if (tgt.status == PlayerStatus.Eliminated)   revert NotAlive();

        voter.voteTarget      = target;
        voter.hasVotedThisRound = true;

        emit VoteCast(roomId, msg.sender, target);
    }

    // ─── Round Resolution ─────────────────────────────────────────────────────────

    /**
     * @notice Resolve the current voting phase.
     *
     *         Steps:
     *           1. Apply absent-vote rule to any player who didn't cast a vote.
     *           2. Tally votes; find top candidate(s).
    *           3. Apply elimination/protection rules.
     *           4. Check endgame conditions.
     *           5a. If game over: distribute pot.
     *           5b. Otherwise: reset per-round state, advance to next round.
     */
    function resolveRound(uint256 roomId) external roomExists(roomId) nonReentrant {
        Room storage r = rooms[roomId];
        if (r.status != RoomStatus.Active)       revert NotActive();
        if (r.currentPhase != RoundPhase.Voting) revert WrongPhase();

        address[] memory alive = _getAlivePlayers(roomId);

        // 1. Absent-vote rule
        _applyAbsentVotes(roomId, alive);

        // 2. Tally
        (address[] memory topCandidates,) = _tallyVotes(roomId, alive);

        // 3. Vote resolution rules
        if (topCandidates.length == 1) {
            address top = topCandidates[0];
            if (_isProtectedCleanCandidate(roomId, top)) {
                // Protected clean candidate — saved
                emit PlayerSavedByProof(roomId, top);
                emit VoteResolved(roomId, "Top-voted player proved innocence and was saved");
            } else {
                // Not protected — eliminated
                players[roomId][top].status = PlayerStatus.Eliminated;
                emit PlayerEliminated(roomId, top);
                emit VoteResolved(roomId, "Top-voted player eliminated");
            }
        } else {
            bool anyInfected = false;
            for (uint256 i = 0; i < topCandidates.length; i++) {
                if (players[roomId][topCandidates[i]].status == PlayerStatus.Infected) {
                    anyInfected = true;
                    break;
                }
            }

            if (anyInfected) {
                // If infected candidates are tied at top votes, eliminate all tied infected.
                _eliminateAllTiedInfected(roomId, topCandidates);
                _emitSavedProtectedTied(roomId, topCandidates);
                emit VoteResolved(roomId, "Tie resolved: tied infected players eliminated; proved clean players saved");
            } else {
                // No infected in tie: eliminate all tied unprotected clean candidates.
                uint256 eliminated = _eliminateAllTiedUnprotectedClean(roomId, topCandidates);
                uint256 saved = _emitSavedProtectedTied(roomId, topCandidates);

                if (eliminated == 0 && saved > 0) {
                    emit VoteResolved(roomId, "Tie resolved: all tied clean players proved innocence and were saved");
                } else {
                    emit VoteResolved(roomId, "Tie resolved: tied clean players without proof were eliminated; proved players were saved");
                }
            }
        }

        // Advance to Reveal
        r.currentPhase   = RoundPhase.Reveal;
        r.phaseStartedAt = uint64(block.timestamp);
        emit PhaseChanged(roomId, RoundPhase.Reveal);

        // Queue next-round infection target from the current patient zero's vote.
        // This decouples infection spread from public vote winner selection.
        // If the current patient zero is eliminated this round, their queued
        // infection is nullified so the voted target remains clean.
        address pzAtVote = currentPatientZero[roomId];
        address queuedTarget = address(0);
        if (pzAtVote != address(0)) {
            if (players[roomId][pzAtVote].status != PlayerStatus.Infected) {
                pendingInfectionTarget[roomId] = address(0);
                return;
            }

            address votedTarget = players[roomId][pzAtVote].voteTarget;
            PlayerState storage votedState = players[roomId][votedTarget];
            if (
                votedTarget != address(0) &&
                votedState.addr != address(0) &&
                votedState.status == PlayerStatus.Clean
            ) {
                queuedTarget = votedTarget;
            }
        }
        pendingInfectionTarget[roomId] = queuedTarget;

    }

    /**
     * @notice Finalize Elimination (Reveal) phase after vote effects have been applied.
     *         Infection parity win checks are handled after Infection assignment,
     *         while reveal finalization handles clean win / draw / max-rounds checks.
     */
    function finalizeElimination(uint256 roomId) external onlyBackend roomExists(roomId) nonReentrant {
        Room storage r = rooms[roomId];
        if (r.status != RoomStatus.Active)         revert NotActive();
        if (r.currentPhase != RoundPhase.Reveal)   revert WrongPhase();

        (uint256 infectedAlive, uint256 cleanAlive) = _countAliveByStatus(roomId);
        bool gameOver = false;
        GameOutcome outcome;

        if (infectedAlive == 0) {
            outcome = GameOutcome.CleanWin;
            gameOver = true;
        } else if (infectedAlive == 1 && cleanAlive == 1) {
            outcome = GameOutcome.MaxRoundsDraw;
            gameOver = true;
        } else if (r.currentRound >= r.config.maxRounds) {
            outcome = GameOutcome.MaxRoundsDraw;
            gameOver = true;
        }

        if (gameOver) {
            r.status       = RoomStatus.Ended;
            r.currentPhase = RoundPhase.Ended;
            unchecked { activeRoomCount--; }
            emit GameEnded(roomId, outcome);
            _distributePot(roomId, outcome);
            return;
        }

        // Keep patient-zero succession aligned after eliminations.
        _syncPatientZero(roomId);

        // Reset and start next round; infection assignment runs in Infection phase.
        _resetRoundState(roomId);
        r.currentRound++;
        r.currentPhase   = RoundPhase.Infection;
        r.phaseStartedAt = uint64(block.timestamp);
        emit RoundStarted(roomId, r.currentRound);
        emit PhaseChanged(roomId, RoundPhase.Infection);
    }

    // ─── Room Expiry ──────────────────────────────────────────────────────────────

    /**
     * @notice Anyone can call this once a waiting room has passed its expiry time.
     *         All stakes are refunded; room status set to Ended.
     */
    function expireRoom(uint256 roomId) external roomExists(roomId) nonReentrant {
        Room storage r = rooms[roomId];

        if (r.status != RoomStatus.Waiting)         revert RoomNotWaiting();
        require(block.timestamp >= r.expiresAt, "Room has not expired yet");

        r.status       = RoomStatus.Ended;
        r.currentPhase = RoundPhase.Ended;
        unchecked { activeRoomCount--; }

        address[] memory playerList = r.players;
        for (uint256 i = 0; i < playerList.length; i++) {
            PlayerState storage p = players[roomId][playerList[i]];
            uint256 refund = p.staked;
            if (refund == 0) continue;
            p.staked = 0;
            r.pot   -= refund;
            _potRelease(roomId, playerList[i], refund);
        }

        emit RoomExpired(roomId);
    }

    // ─── View Functions ───────────────────────────────────────────────────────────

    function getRoom(uint256 roomId)
        external view
        roomExists(roomId)
        returns (Room memory)
    {
        return rooms[roomId];
    }

    function getPlayer(uint256 roomId, address player)
        external view
        roomExists(roomId)
        returns (PlayerState memory)
    {
        return players[roomId][player];
    }

    // ─── Admin ────────────────────────────────────────────────────────────────────

    function setPlatformReceiver(address newReceiver) external onlyAdmin {
        require(newReceiver != address(0), "platformReceiver address required");
        platformReceiver = newReceiver;
    }

    /**
     * @notice Point to an external FeeManager contract for future fee routing.
     *         Once set, new proof fees and pot fees are forwarded there directly
     *         rather than accumulated in platformFees.
     *         Set to address(0) to revert to in-contract accumulation.
     */
    function setFeeManager(address _feeManager) external onlyAdmin {
        feeManager = IFeeManager(_feeManager);
    }

    /**
     * @notice Point to an external PotEscrow contract for player stake custody.
     *         Once set, stakes deposited during createRoom/joinRoom are forwarded
     *         there, and all pot payouts/refunds are released from there.
     *         Set to address(0) to revert to in-contract custody.
     */
    function setPotEscrow(address _potEscrow) external onlyAdmin {
        potEscrow = IPotEscrow(_potEscrow);
    }

    /**
     * @notice Withdraw accumulated platform fees (proof fees + 1.5% of pots).
     *         Only callable by admin. Sent to platformReceiver.
     *         Only applies to fees accumulated before a FeeManager was configured;
     *         fees routed to FeeManager are withdrawn via FeeManager.withdrawAll().
     */
    function withdrawPlatformFees() external onlyAdmin nonReentrant {
        require(platformReceiver != address(0), "platformReceiver not set");
        uint256 amount = platformFees;
        platformFees = 0;
        _safeTransfer(platformReceiver, amount);
    }

    function setBackendSigner(address signer) external onlyAdmin {
        require(signer != address(0), "backendSigner address required");
        backendSigner = signer;
    }

    function setZkVerifier(address verifier) external onlyAdmin {
        require(verifier != address(0), "zkVerifier address required");
        zkVerifier = IZKVerifier(verifier);
    }

    function setMaxActiveRooms(uint256 newMax) external onlyAdmin {
        require(newMax > 0, "maxActiveRooms must be > 0");
        maxActiveRooms = newMax;
        emit MaxActiveRoomsSet(newMax);
    }

    function getInfectionChain(uint256 roomId)
        external
        view
        roomExists(roomId)
        returns (address[] memory)
    {
        return infectionChain[roomId];
    }

    // ─── Internal Helpers ─────────────────────────────────────────────────────────

    function _syncPatientZero(uint256 roomId) internal {
        address[] storage chain = infectionChain[roomId];
        if (chain.length == 0) return;

        uint256 idx = patientZeroIndex[roomId];
        if (idx >= chain.length) idx = chain.length - 1;

        while (idx < chain.length) {
            address candidate = chain[idx];
            PlayerState storage s = players[roomId][candidate];
            if (s.addr != address(0) && s.status == PlayerStatus.Infected) {
                if (currentPatientZero[roomId] != candidate) {
                    currentPatientZero[roomId] = candidate;
                    patientZeroIndex[roomId] = idx;
                    emit PatientZeroUpdated(roomId, candidate);
                } else {
                    patientZeroIndex[roomId] = idx;
                }
                return;
            }
            unchecked { idx++; }
        }

        // No alive infected left; room endgame logic will resolve this to clean win.
        currentPatientZero[roomId] = address(0);
        patientZeroIndex[roomId] = chain.length;
    }

    function _getAlivePlayers(uint256 roomId) internal view returns (address[] memory) {
        address[] memory all = rooms[roomId].players;
        uint256 count = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (players[roomId][all[i]].status != PlayerStatus.Eliminated) count++;
        }
        address[] memory alive = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (players[roomId][all[i]].status != PlayerStatus.Eliminated) {
                alive[idx++] = all[i];
            }
        }
        return alive;
    }

    /**
     * @dev Apply absent-vote rule: any alive player who hasn't voted is auto-assigned
     *      a self-vote (their vote is cast against themselves). Silence = guilt.
     *      This prevents collusion by mass-abstention and is actively dangerous
     *      to the abstaining player.
     */
    function _applyAbsentVotes(uint256 roomId, address[] memory alive) internal {
        for (uint256 i = 0; i < alive.length; i++) {
            PlayerState storage p = players[roomId][alive[i]];
            if (!p.hasVotedThisRound) {
                p.voteTarget        = alive[i]; // self-vote
                p.hasVotedThisRound = true;
                emit VoteCast(roomId, alive[i], alive[i]);
            }
        }
    }

    function _tallyVotes(uint256 roomId, address[] memory alive)
        internal view
        returns (address[] memory topCandidates, uint256 maxVotes)
    {
        uint256[] memory counts = new uint256[](alive.length);
        maxVotes = 0;
        for (uint256 i = 0; i < alive.length; i++) {
            for (uint256 j = 0; j < alive.length; j++) {
                if (players[roomId][alive[j]].voteTarget == alive[i]) counts[i]++;
            }
            if (counts[i] > maxVotes) maxVotes = counts[i];
        }

        uint256 topCount = 0;
        for (uint256 i = 0; i < alive.length; i++) {
            if (counts[i] == maxVotes) topCount++;
        }

        topCandidates = new address[](topCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < alive.length; i++) {
            if (counts[i] == maxVotes) topCandidates[idx++] = alive[i];
        }
    }

    function _isProtectedCleanCandidate(uint256 roomId, address candidate)
        internal
        view
        returns (bool)
    {
        PlayerState storage p = players[roomId][candidate];
        return p.status == PlayerStatus.Clean && p.hasProofThisRound;
    }

    /**
     * @dev In infected ties, eliminate every tied infected candidate.
     */
    function _eliminateAllTiedInfected(uint256 roomId, address[] memory candidates)
        internal
    {
        for (uint256 i = 0; i < candidates.length; i++) {
            PlayerState storage p = players[roomId][candidates[i]];
            if (p.status != PlayerStatus.Infected) continue;
            p.status = PlayerStatus.Eliminated;
            emit PlayerEliminated(roomId, candidates[i]);
        }
    }

    /**
     * @dev In clean-only ties, eliminate every tied clean candidate without proof.
     */
    function _eliminateAllTiedUnprotectedClean(uint256 roomId, address[] memory candidates)
        internal
        returns (uint256 eliminated)
    {
        for (uint256 i = 0; i < candidates.length; i++) {
            PlayerState storage p = players[roomId][candidates[i]];
            if (p.status != PlayerStatus.Clean || p.hasProofThisRound) continue;
            p.status = PlayerStatus.Eliminated;
            emit PlayerEliminated(roomId, candidates[i]);
            unchecked { eliminated++; }
        }
    }

    /**
     * @dev Emit save events for tied clean candidates with valid proof.
     */
    function _emitSavedProtectedTied(uint256 roomId, address[] memory candidates)
        internal
        returns (uint256 saved)
    {
        for (uint256 i = 0; i < candidates.length; i++) {
            if (_isProtectedCleanCandidate(roomId, candidates[i])) {
                emit PlayerSavedByProof(roomId, candidates[i]);
                unchecked { saved++; }
            }
        }
    }

    function _countAliveByStatus(uint256 roomId)
        internal view
        returns (uint256 infectedAlive, uint256 cleanAlive)
    {
        address[] memory all = rooms[roomId].players;
        for (uint256 i = 0; i < all.length; i++) {
            PlayerState storage p = players[roomId][all[i]];
            if (p.status == PlayerStatus.Eliminated) continue;
            if (p.status == PlayerStatus.Infected)   infectedAlive++;
            else                                      cleanAlive++;
        }
    }

    function _safeTransfer(address to, uint256 amount) internal {
        _callOptionalReturn(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount),
            "cUSD transfer failed"
        );
    }

    function _safeTransferFrom(address from, address to, uint256 amount) internal {
        _callOptionalReturn(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount),
            "cUSD transferFrom failed"
        );
    }

    function _callOptionalReturn(bytes memory callData, string memory errorMessage) internal {
        (bool success, bytes memory returndata) = address(cUsdToken).call(callData);
        require(success, errorMessage);
        if (returndata.length > 0) {
            require(abi.decode(returndata, (bool)), errorMessage);
        }
    }

    /**
     * @dev Forward a stake deposit into PotEscrow if configured.
     *      Tokens are already held by this contract at the time of this call.
     */
    function _potDeposit(uint256 roomId, uint256 amount) internal {
        IPotEscrow pe = potEscrow;
        if (address(pe) != address(0)) {
            cUsdToken.approve(address(pe), amount);
            pe.deposit(roomId, amount);
        }
        // When no escrow is configured, tokens remain in PlagueGame as before.
    }

    /**
     * @dev Release pot funds to `to` — from PotEscrow if configured, else direct.
     */
    function _potRelease(uint256 roomId, address to, uint256 amount) internal {
        IPotEscrow pe = potEscrow;
        if (address(pe) != address(0)) {
            pe.release(roomId, to, amount);
        } else {
            _safeTransfer(to, amount);
        }
    }

    /**
     * @dev Pull a proof fee from `payer` and route it to the FeeManager (if set)
     *      or accumulate in platformFees otherwise.
     */
    function _routeFee(address payer, uint256 fee) internal {
        _safeTransferFrom(payer, address(this), fee);
        _accumulateFee(fee);
    }

    /**
     * @dev Add `amount` to the platform fee counter — or, when a FeeManager is
     *      configured, approve-and-deposit directly into it.
     *      Funds are already held by this contract at the time of this call.
     */
    function _accumulateFee(uint256 amount) internal {
        if (amount == 0) return;
        IFeeManager fm = feeManager;
        if (address(fm) != address(0)) {
            // Approve the FeeManager to pull the tokens, then trigger the deposit.
            cUsdToken.approve(address(fm), amount);
            fm.depositFee(amount);
        } else {
            platformFees += amount;
        }
    }

    /**
     * @dev Accumulate `amount` as a platform fee taken from a room's pot.
     *      When a PotEscrow is configured the tokens live there, not in this
     *      contract — pull them out first so _accumulateFee can forward them
     *      to the FeeManager via transferFrom.
     */
    function _accumulateFeeFromPot(uint256 roomId, uint256 amount) internal {
        if (amount == 0) return;
        IPotEscrow pe = potEscrow;
        if (address(pe) != address(0)) {
            pe.release(roomId, address(this), amount);
        }
        _accumulateFee(amount);
    }

    /**
     * @dev Distribute pot to alive players of the winning faction.
     *      Called automatically by resolveRound — never called externally.
     */
    function _distributePot(uint256 roomId, GameOutcome outcome) internal {
        Room storage r          = rooms[roomId];
        address[] memory all    = r.players;
        uint256 potBeforeFee    = r.pot;
        if (potBeforeFee == 0) return;

        // Deduct 1.5% platform fee.
        uint256 platformFee = (potBeforeFee * 15) / 1000;  // 1.5%
        uint256 potAfterFee = potBeforeFee - platformFee;

        address[] memory winners = new address[](all.length);
        uint256 winnerCount = 0;

        for (uint256 i = 0; i < all.length; i++) {
            PlayerState storage p = players[roomId][all[i]];
            if (p.status == PlayerStatus.Eliminated) continue;
            bool wins =
                (outcome == GameOutcome.CleanWin    && p.status == PlayerStatus.Clean)   ||
                (outcome == GameOutcome.InfectedWin && p.status == PlayerStatus.Infected) ||
                (outcome == GameOutcome.MaxRoundsDraw);
            if (wins) winners[winnerCount++] = all[i];
        }

        if (winnerCount == 0) {
            // Safety valve: if no winners can be resolved, route all escrow to fees
            // instead of leaving untracked funds in contract balance.
            _accumulateFeeFromPot(roomId, potBeforeFee);
            r.pot = 0;
            return;
        }

        uint256 share = potAfterFee / winnerCount;
        uint256 distributed = share * winnerCount;
        uint256 dust = potAfterFee - distributed;

        // Account for exact value conservation: platform fee + payout remainder dust.
        _accumulateFeeFromPot(roomId, platformFee + dust);
        r.pot = 0;

        for (uint256 i = 0; i < winnerCount; i++) {
            _potRelease(roomId, winners[i], share);
            emit PotDrained(roomId, winners[i], share);
        }
    }

    /**
     * @dev Reset per-round player fields before advancing to the next round.
     */
    function _resetRoundState(uint256 roomId) internal {
        address[] memory all = rooms[roomId].players;
        for (uint256 i = 0; i < all.length; i++) {
            PlayerState storage p = players[roomId][all[i]];
            p.voteTarget        = address(0);
            p.hasVotedThisRound = false;
            p.hasProofThisRound = false;
        }
    }
}
