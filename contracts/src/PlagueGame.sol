// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ZKVerifier.sol";

/**
 * @title PlagueGame
 * @notice On-chain game room, escrow, voting, ZK proof verification, and payout
 *         for the Plague Protocol social deduction game on Celo.
 *
 * ── Room Lifecycle ─────────────────────────────────────────────────────────────
 *  Waiting → Starting → Active → Ended
 *
 *  createRoom    : host configures room; status = Waiting
 *  joinRoom      : players stake CELO; only while Waiting and before expiresAt
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
 *  resolveRound       : tallies votes (Cases A/B/C/D), checks endgame, pays out
 *
 * ── Vote Resolution Cases ──────────────────────────────────────────────────────
 *  A  Single top candidate, no valid proof    → eliminated
 *  B  Single top candidate, has valid proof   → saved (no elimination)
 *  C  Tie, some candidates unprotected        → lowest keccak256(addr) unprotected eliminated
 *  D  Tie, ALL candidates have proofs         → no elimination; one marked for next infection
 *
 * ── Endgame (checked after every Reveal) ──────────────────────────────────────
 *  1. infected_alive == 0             → Clean wins
 *  2. infected_alive >= clean_alive   → Infected wins
 *  3. currentRound >= maxRounds       → Infected wins (max rounds draw counts as infected win)
 *
 * ── Payout ─────────────────────────────────────────────────────────────────────
 *  pot = sum(stakes) + sum(paid proof fees)
 *  Alive players from the winning faction split equally; auto-paid by resolveRound.
 */
contract PlagueGame {
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
    /// @dev Nullifier registry — scoped per room so a nullifier used in room A
    ///      cannot be replayed in room B even with the same round number.
    mapping(uint256 => mapping(bytes32 => bool))           public usedNullifiers;

    uint256 public roomCount;
    address public admin;
    /// @dev backendSigner is authorised to call assignInfection, beginActivePhase,
    ///      and openVoting. Set to your off-chain game-server address.
    address public backendSigner;
    IZKVerifier public zkVerifier;

    bool private _initialized;

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
    event GameEnded(uint256 indexed roomId, GameOutcome outcome);
    event PotDrained(uint256 indexed roomId, address winner, uint256 amount);
    event RoomExpired(uint256 indexed roomId);

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

    // ─── Modifiers ────────────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyBackend() {
        if (msg.sender != backendSigner && msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier roomExists(uint256 roomId) {
        if (roomId == 0 || roomId > roomCount) revert InvalidRoom();
        _;
    }

    // ─── Initialisation ───────────────────────────────────────────────────────────

    /**
     * @param _admin          Address that owns admin functions (setBackendSigner, setZKVerifier).
     * @param _backendSigner  Address authorised to drive phase transitions server-side.
     * @param _zkVerifier     Address of the IZKVerifier implementation (stub or Noir-generated).
     */
    function initialize(
        address _admin,
        address _backendSigner,
        address _zkVerifier
    ) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized    = true;
        admin           = _admin;
        backendSigner   = _backendSigner;
        zkVerifier      = IZKVerifier(_zkVerifier);
    }

    // ─── Room Management ──────────────────────────────────────────────────────────

    /**
     * @notice Create a new waiting room. The caller becomes the host.
     * @param maxPlayers  Maximum number of participants (4–20).
     * @param stakeAmount Amount of CELO (wei) each player must stake to join.
     * @param proofFee    Fee per additional innocence proof after the free one.
     * @param expirySecs  Seconds before an unfilled room auto-expires (min 60).
     * @return roomId     Incremented room counter — use as the room ID everywhere.
     */
    function createRoom(
        uint32  maxPlayers,
        uint256 stakeAmount,
        uint256 proofFee,
        uint64  expirySecs
    ) external returns (uint256 roomId) {
        require(maxPlayers >= 4 && maxPlayers <= 20, "maxPlayers must be 4–20");
        require(stakeAmount > 0, "stakeAmount must be > 0");
        require(expirySecs >= 60, "expirySecs must be >= 60");

        unchecked { roomId = ++roomCount; }

        uint64 ts = uint64(block.timestamp);

        Room storage r = rooms[roomId];
        r.id           = roomId;
        r.host         = msg.sender;
        r.status       = RoomStatus.Waiting;
        r.currentPhase = RoundPhase.Ended;
        r.createdAt    = ts;
        r.expiresAt    = ts + expirySecs;

        RoomConfig storage cfg = r.config;
        cfg.minPlayers            = 4;
        cfg.maxPlayers            = maxPlayers;
        cfg.stakeAmount           = stakeAmount;
        cfg.maxRounds             = 10;
        cfg.roundDurationSecs     = 120;
        cfg.discussionDurationSecs = 60;
        cfg.votingDurationSecs    = 60;
        cfg.expirySecs            = expirySecs;
        cfg.proofFee              = proofFee;
    }

    /**
     * @notice Join an open room by staking the required CELO amount.
     *         Only valid while the room is in Waiting status and before expiresAt.
     */
    function joinRoom(uint256 roomId) external payable roomExists(roomId) {
        Room storage r = rooms[roomId];

        if (r.status != RoomStatus.Waiting)                        revert RoomNotWaiting();
        if (block.timestamp >= r.expiresAt)                        revert RoomExpiredError();
        if (r.players.length >= r.config.maxPlayers)               revert RoomFull();
        if (players[roomId][msg.sender].addr != address(0))        revert AlreadyJoined();
        if (msg.value != r.config.stakeAmount)                     revert WrongStakeAmount();

        r.players.push(msg.sender);
        r.pot += msg.value;

        players[roomId][msg.sender] = PlayerState({
            addr:                    msg.sender,
            status:                  PlayerStatus.Clean,
            roleCommitment:          bytes32(0),
            staked:                  msg.value,
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

        if (address(zkVerifier) != address(0)) {
            if (!zkVerifier.verifyRoleCommitment(commitment, zkProof)) revert InvalidProof();
        }

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

        r.status         = RoomStatus.Active;
        r.currentRound   = 1;
        r.currentPhase   = RoundPhase.Infection;
        r.phaseStartedAt = uint64(block.timestamp);

        emit RoundStarted(roomId, 1);
        emit PhaseChanged(roomId, RoundPhase.Infection);
    }

    /**
     * @notice Backend assigns the infection for this round.
     *
     *         Normal selection:
     *           target = eligible_clean_alive[ hash(roomId, round, prevTxHash) % count ]
     *
     *         All-proofs-tie case:
     *           If a player has pendingInfectionNextRound set from the previous Case D,
     *           that player is passed as target instead of a random pick.
     *
     *         Only the newly infected player receives a private notification via the
     *         backend socket. The event is emitted on-chain but the backend is
     *         responsible for restricting delivery.
     *
     *         After assignment, phase automatically advances to Discussion.
     */
    function assignInfection(uint256 roomId, address target) external onlyBackend roomExists(roomId) {
        Room storage r        = rooms[roomId];
        PlayerState storage p = players[roomId][target];

        if (r.status != RoomStatus.Active)         revert NotActive();
        if (r.currentPhase != RoundPhase.Infection) revert WrongPhase();
        if (p.addr == address(0))                  revert NotParticipant();
        if (p.status == PlayerStatus.Eliminated)   revert NotAlive();

        p.status                    = PlayerStatus.Infected;
        p.pendingInfectionNextRound = false;

        emit InfectionAssigned(roomId, target);

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
     *           - Subsequent proofs require msg.value == proofFee (added to pot).
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
    ) external payable roomExists(roomId) {
        Room storage r        = rooms[roomId];
        PlayerState storage p = players[roomId][msg.sender];

        if (r.status != RoomStatus.Active)           revert NotActive();
        if (r.currentPhase != RoundPhase.Discussion) revert WrongPhase();
        if (p.addr == address(0))                    revert NotParticipant();
        if (p.status == PlayerStatus.Eliminated)     revert NotAlive();
        if (p.hasProofThisRound)                     revert AlreadyProvedThisRound();
        if (usedNullifiers[roomId][nullifier])        revert NullifierUsed();

        // Charge proof fee once the free proof has been used
        if (p.freeProofUsed) {
            if (msg.value != r.config.proofFee) revert WrongStakeAmount();
            r.pot += msg.value;
        } else {
            if (msg.value != 0) revert WrongStakeAmount();
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
     *         Absent vote rule is applied by resolveRound — self-votes are only
     *         emitted there, not here.
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
     *           3. Apply case A / B / C / D.
     *           4. Check endgame conditions.
     *           5a. If game over: distribute pot.
     *           5b. Otherwise: reset per-round state, advance to next round.
     */
    function resolveRound(uint256 roomId) external roomExists(roomId) {
        Room storage r = rooms[roomId];
        if (r.status != RoomStatus.Active)       revert NotActive();
        if (r.currentPhase != RoundPhase.Voting) revert WrongPhase();

        address[] memory alive = _getAlivePlayers(roomId);

        // 1. Absent-vote rule
        _applyAbsentVotes(roomId, alive);

        // 2. Tally
        (address[] memory topCandidates,) = _tallyVotes(roomId, alive);

        // 3. Vote resolution cases
        if (topCandidates.length == 1) {
            address top = topCandidates[0];
            if (players[roomId][top].hasProofThisRound) {
                // Case B — saved
                emit PlayerSavedByProof(roomId, top);
                emit VoteResolved(roomId, "Case B: top candidate saved by valid proof");
            } else {
                // Case A — eliminated
                players[roomId][top].status = PlayerStatus.Eliminated;
                emit PlayerEliminated(roomId, top);
                emit VoteResolved(roomId, "Case A: top candidate eliminated");
            }
        } else {
            bool allHaveProofs = true;
            for (uint256 i = 0; i < topCandidates.length; i++) {
                if (!players[roomId][topCandidates[i]].hasProofThisRound) {
                    allHaveProofs = false;
                    break;
                }
            }

            if (allHaveProofs) {
                // Case D — no elimination; mark one for next-round infection
                address pending = _selectPendingInfection(topCandidates);
                players[roomId][pending].pendingInfectionNextRound = true;
                emit VoteResolved(roomId, "Case D: all tied candidates proved; one flagged for next infection");
            } else {
                // Case C — eliminate lowest keccak256(addr) unprotected candidate
                address victim = _selectLowestHashUnprotected(roomId, topCandidates);
                players[roomId][victim].status = PlayerStatus.Eliminated;
                emit PlayerEliminated(roomId, victim);
                emit VoteResolved(roomId, "Case C: lowest-hash unprotected tied candidate eliminated");
            }
        }

        // Advance to Reveal
        r.currentPhase   = RoundPhase.Reveal;
        r.phaseStartedAt = uint64(block.timestamp);
        emit PhaseChanged(roomId, RoundPhase.Reveal);

        // 4. Endgame check (alive counts only)
        (uint256 infectedAlive, uint256 cleanAlive) = _countAliveByStatus(roomId);
        bool     gameOver = false;
        GameOutcome outcome;

        if (infectedAlive == 0) {
            outcome  = GameOutcome.CleanWin;
            gameOver = true;
        } else if (infectedAlive >= cleanAlive) {
            outcome  = GameOutcome.InfectedWin;
            gameOver = true;
        } else if (r.currentRound >= r.config.maxRounds) {
            outcome  = GameOutcome.MaxRoundsDraw;
            gameOver = true;
        }

        if (gameOver) {
            r.status       = RoomStatus.Ended;
            r.currentPhase = RoundPhase.Ended;
            emit GameEnded(roomId, outcome);
            _distributePot(roomId, outcome);
        } else {
            // 5b. Reset and start next round
            _resetRoundState(roomId);
            r.currentRound++;
            r.currentPhase   = RoundPhase.Infection;
            r.phaseStartedAt = uint64(block.timestamp);
            emit RoundStarted(roomId, r.currentRound);
            emit PhaseChanged(roomId, RoundPhase.Infection);
        }
    }

    // ─── Room Expiry ──────────────────────────────────────────────────────────────

    /**
     * @notice Anyone can call this once a waiting room has passed its expiry time.
     *         All stakes are refunded; room status set to Ended.
     */
    function expireRoom(uint256 roomId) external roomExists(roomId) {
        Room storage r = rooms[roomId];

        if (r.status != RoomStatus.Waiting)         revert RoomNotWaiting();
        require(block.timestamp >= r.expiresAt, "Room has not expired yet");

        r.status       = RoomStatus.Ended;
        r.currentPhase = RoundPhase.Ended;

        address[] memory playerList = r.players;
        for (uint256 i = 0; i < playerList.length; i++) {
            PlayerState storage p = players[roomId][playerList[i]];
            uint256 refund = p.staked;
            if (refund == 0) continue;
            p.staked = 0;
            r.pot   -= refund;
            (bool ok,) = payable(playerList[i]).call{value: refund}("");
            require(ok, "Refund transfer failed");
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

    function setBackendSigner(address signer) external onlyAdmin {
        backendSigner = signer;
    }

    function setZKVerifier(address verifier) external onlyAdmin {
        zkVerifier = IZKVerifier(verifier);
    }

    // ─── Internal Helpers ─────────────────────────────────────────────────────────

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
     *      a vote for the current leading target (or themselves if no leader yet).
     */
    function _applyAbsentVotes(uint256 roomId, address[] memory alive) internal {
        address leader = _findLeader(roomId, alive);
        for (uint256 i = 0; i < alive.length; i++) {
            PlayerState storage p = players[roomId][alive[i]];
            if (!p.hasVotedThisRound) {
                address voteFor = (leader != address(0)) ? leader : alive[i];
                p.voteTarget      = voteFor;
                p.hasVotedThisRound = true;
                emit VoteCast(roomId, alive[i], voteFor);
            }
        }
    }

    /**
     * @dev Find the current vote leader (most votes among already-submitted votes).
     *      Returns address(0) if no votes have been cast yet.
     */
    function _findLeader(uint256 roomId, address[] memory alive) internal view returns (address) {
        uint256 maxVotes = 0;
        address leader   = address(0);
        for (uint256 i = 0; i < alive.length; i++) {
            uint256 count = 0;
            for (uint256 j = 0; j < alive.length; j++) {
                PlayerState storage voter = players[roomId][alive[j]];
                if (voter.hasVotedThisRound && voter.voteTarget == alive[i]) count++;
            }
            if (count > maxVotes) {
                maxVotes = count;
                leader   = alive[i];
            }
        }
        return leader;
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

    /**
     * @dev Case D: deterministically pick one tied candidate for pending infection.
     *      Uses the previous block hash as entropy (acceptable for this non-critical pick).
     */
    function _selectPendingInfection(address[] memory candidates) internal view returns (address) {
        uint256 idx = uint256(blockhash(block.number - 1)) % candidates.length;
        return candidates[idx];
    }

    /**
     * @dev Case C: among unprotected tied candidates return the one with the
     *      lexicographically lowest keccak256(address).
     */
    function _selectLowestHashUnprotected(uint256 roomId, address[] memory candidates)
        internal view
        returns (address victim)
    {
        bytes32 lowestHash = type(bytes32).max;
        for (uint256 i = 0; i < candidates.length; i++) {
            if (players[roomId][candidates[i]].hasProofThisRound) continue;
            bytes32 h = keccak256(abi.encodePacked(candidates[i]));
            if (h < lowestHash) {
                lowestHash = h;
                victim     = candidates[i];
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

    /**
     * @dev Distribute pot to alive players of the winning faction.
     *      Called automatically by resolveRound — never called externally.
     */
    function _distributePot(uint256 roomId, GameOutcome outcome) internal {
        Room storage r          = rooms[roomId];
        address[] memory all    = r.players;
        uint256 total           = r.pot;
        if (total == 0) return;

        address[] memory winners = new address[](all.length);
        uint256 winnerCount = 0;

        for (uint256 i = 0; i < all.length; i++) {
            PlayerState storage p = players[roomId][all[i]];
            if (p.status == PlayerStatus.Eliminated) continue;
            bool wins =
                (outcome == GameOutcome.CleanWin    && p.status == PlayerStatus.Clean)   ||
                (outcome == GameOutcome.InfectedWin && p.status == PlayerStatus.Infected) ||
                (outcome == GameOutcome.MaxRoundsDraw && p.status == PlayerStatus.Infected);
            if (wins) winners[winnerCount++] = all[i];
        }

        if (winnerCount == 0) return;

        uint256 share = total / winnerCount;
        r.pot = 0;

        for (uint256 i = 0; i < winnerCount; i++) {
            (bool ok,) = payable(winners[i]).call{value: share}("");
            require(ok, "Payout transfer failed");
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

    receive() external payable {}
}
