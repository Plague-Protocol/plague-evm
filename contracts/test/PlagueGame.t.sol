// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PlagueGame.sol";
import "../src/ZKVerifier.sol";

/// @dev Minimal ERC-20 mock used by tests in place of real cUSD.
contract MockERC20 {
    mapping(address => uint256)                     public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    string  public name     = "Mock cUSD";
    string  public symbol   = "mcUSD";
    uint8   public decimals = 18;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "ERC20: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount,              "ERC20: insufficient balance");
        require(allowance[from][msg.sender] >= amount,  "ERC20: insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from]             -= amount;
        balanceOf[to]               += amount;
        return true;
    }
}

contract PlagueGameTest is Test {
    PlagueGame  game;
    ZKVerifier  zkVerifier;
    MockERC20   token;

    address admin    = makeAddr("admin");
    address backend  = makeAddr("backend");
    address platform = makeAddr("platform");
    address host     = makeAddr("host");

    // Six players — enough for minPlayers (4) and a meaningful game
    address[] players;

    uint256 constant STAKE   = 10e18;   // 10 cUSD
    uint256 constant FEE     = 1e18;    // 1  cUSD (proof fee)
    uint256 constant MINT    = 1000e18; // token balance per participant

    function setUp() public {
        // Deploy mock cUSD token
        token = new MockERC20();

        // Fund all participants with mock cUSD
        token.mint(host, MINT);
        for (uint8 i = 0; i < 6; i++) {
            address p = makeAddr(string(abi.encodePacked("player", i)));
            players.push(p);
            token.mint(p, MINT);
        }

        // Deploy with bypass ZK verifier so tests don't need real Noir proofs
        vm.startPrank(admin);
        zkVerifier = new ZKVerifier(true);
        game       = new PlagueGame();
        game.initialize(admin, backend, address(zkVerifier), platform, address(token));
        vm.stopPrank();
    }

    // ── Initialization ───────────────────────────────────────────────────────────

    function test_InitializeOnce() public {
        vm.prank(admin);
        vm.expectRevert(PlagueGame.AlreadyInitialized.selector);
        game.initialize(admin, backend, address(zkVerifier), platform, address(token));
    }

    // ── createRoom ───────────────────────────────────────────────────────────────

    function test_CreateRoom() public {
        vm.prank(host);
        uint256 roomId = game.createRoom(6, STAKE, FEE, 600);

        assertEq(roomId, 1);
        assertEq(game.roomCount(), 1);

        PlagueGame.Room memory r = game.getRoom(1);
        assertEq(r.host, host);
        assertEq(uint(r.status), uint(PlagueGame.RoomStatus.Waiting));
        assertEq(r.config.stakeAmount, STAKE);
        assertEq(r.config.proofFee, FEE);
        assertEq(r.config.minPlayers, 4);
        assertEq(r.config.maxPlayers, 6);
        assertEq(r.expiresAt, r.createdAt + 600);
    }

    function test_CreateRoom_InvalidMaxPlayers_Reverts() public {
        vm.prank(host);
        vm.expectRevert();
        game.createRoom(3, STAKE, FEE, 600); // below min 4
    }

    // ── joinRoom ─────────────────────────────────────────────────────────────────

    function test_JoinRoom() public {
        _createRoom();

        vm.startPrank(players[0]);
        token.approve(address(game), STAKE);
        game.joinRoom(1);
        vm.stopPrank();

        PlagueGame.PlayerState memory p = game.getPlayer(1, players[0]);
        assertEq(p.staked, STAKE);
        assertEq(uint(p.status), uint(PlagueGame.PlayerStatus.Clean));
        assertEq(p.addr, players[0]);
    }

    function test_JoinRoom_NoApproval_Reverts() public {
        _createRoom();
        vm.prank(players[0]);
        vm.expectRevert(); // ERC-20 insufficient allowance
        game.joinRoom(1);
    }

    function test_JoinRoom_Duplicate_Reverts() public {
        _createRoom();
        vm.startPrank(players[0]);
        token.approve(address(game), STAKE * 2);
        game.joinRoom(1);
        vm.expectRevert(PlagueGame.AlreadyJoined.selector);
        game.joinRoom(1);
        vm.stopPrank();
    }

    function test_JoinRoom_AfterExpiry_Reverts() public {
        _createRoom();
        vm.warp(block.timestamp + 601);

        vm.startPrank(players[0]);
        token.approve(address(game), STAKE);
        vm.expectRevert(PlagueGame.RoomExpiredError.selector);
        game.joinRoom(1);
        vm.stopPrank();
    }

    function test_JoinRoom_Full_Reverts() public {
        _createRoom();
        _fillRoom(); // fills up to maxPlayers (6)

        address extra = makeAddr("extra");
        token.mint(extra, MINT);
        vm.startPrank(extra);
        token.approve(address(game), STAKE);
        vm.expectRevert(PlagueGame.RoomFull.selector);
        game.joinRoom(1);
        vm.stopPrank();
    }

    // ── startGame ────────────────────────────────────────────────────────────────

    function test_StartGame() public {
        _createRoom();
        _fillRoom();

        vm.prank(host);
        game.startGame(1);

        assertEq(uint(game.getRoom(1).status), uint(PlagueGame.RoomStatus.Starting));
    }

    function test_StartGame_NotHost_Reverts() public {
        _createRoom();
        _fillRoom();

        vm.prank(players[0]);
        vm.expectRevert(PlagueGame.NotHost.selector);
        game.startGame(1);
    }

    function test_StartGame_TooFewPlayers_Reverts() public {
        _createRoom();
        // Only host joins (1 player, need 4)
        vm.startPrank(host);
        token.approve(address(game), STAKE);
        game.joinRoom(1);
        vm.expectRevert(PlagueGame.NotEnoughPlayers.selector);
        game.startGame(1);
        vm.stopPrank();
    }

    // ── expireRoom ───────────────────────────────────────────────────────────────

    function test_ExpireRoom_Refunds() public {
        _createRoom();
        vm.startPrank(players[0]);
        token.approve(address(game), STAKE);
        game.joinRoom(1);
        vm.stopPrank();
        vm.startPrank(players[1]);
        token.approve(address(game), STAKE);
        game.joinRoom(1);
        vm.stopPrank();

        uint256 balBefore0 = token.balanceOf(players[0]);
        uint256 balBefore1 = token.balanceOf(players[1]);

        vm.warp(block.timestamp + 601);
        game.expireRoom(1);

        assertEq(token.balanceOf(players[0]), balBefore0 + STAKE);
        assertEq(token.balanceOf(players[1]), balBefore1 + STAKE);
        assertEq(uint(game.getRoom(1).status), uint(PlagueGame.RoomStatus.Ended));
    }

    function test_ExpireRoom_NotExpiredYet_Reverts() public {
        _createRoom();
        vm.expectRevert("Room has not expired yet");
        game.expireRoom(1);
    }

    function test_ExpireRoom_NotWaiting_Reverts() public {
        _createRoom();
        _fillRoom();
        vm.prank(host);
        game.startGame(1);

        vm.warp(block.timestamp + 601);
        vm.expectRevert(PlagueGame.RoomNotWaiting.selector);
        game.expireRoom(1);
    }

    // ── Role commitments & active phase ──────────────────────────────────────────

    function test_SubmitRoleCommitment() public {
        _createAndStart();

        vm.prank(players[0]);
        game.submitRoleCommitment(1, keccak256("commitment-0"), "");

        PlagueGame.PlayerState memory p = game.getPlayer(1, players[0]);
        assertTrue(p.roleCommitted);
        assertEq(p.roleCommitment, keccak256("commitment-0"));
    }

    function test_SubmitRoleCommitment_Twice_Reverts() public {
        _createAndStart();
        vm.prank(players[0]);
        game.submitRoleCommitment(1, keccak256("commitment-0"), "");

        vm.prank(players[0]);
        vm.expectRevert(PlagueGame.AlreadyCommitted.selector);
        game.submitRoleCommitment(1, keccak256("commitment-0"), "");
    }

    // ── Full round: Case A (single top, no proof → eliminated) ───────────────────

    function test_FullRound_CaseA_Elimination() public {
        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);

        // Backend infects players[0]
        vm.prank(backend);
        game.assignInfection(1, players[0]);

        // Open voting (skip discussion phase)
        vm.prank(backend);
        game.openVoting(1);

        // 5 players (players[1..4] + host) vote for players[0] — players[5] is not in the room
        for (uint256 i = 1; i < 5; i++) {
            vm.prank(players[i]);
            game.castVote(1, players[0]);
        }
        // host also votes
        vm.prank(host);
        game.castVote(1, players[0]);

        game.resolveRound(1);

        // players[0] should be eliminated
        assertEq(
            uint(game.getPlayer(1, players[0]).status),
            uint(PlagueGame.PlayerStatus.Eliminated)
        );
    }

    // ── Full round: Case B (top candidate has proof → saved) ─────────────────────

    function test_FullRound_CaseB_SavedByProof() public {
        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);

        // Backend infects players[0]
        vm.prank(backend);
        game.assignInfection(1, players[0]);

        // players[1] is top vote target — submits innocence proof during Discussion
        bytes32 nullifier = keccak256("nullifier-p1-r1");
        vm.prank(players[1]);
        game.submitInnocenceProof(1, keccak256("comm-1"), nullifier, "");

        vm.prank(backend);
        game.openVoting(1);

        // players[0,2,3,4] and host vote for players[1] — players[5] is not in the room
        for (uint256 i = 0; i < 5; i++) {
            if (players[i] == players[1]) continue;
            vm.prank(players[i]);
            game.castVote(1, players[1]);
        }
        vm.prank(host);
        game.castVote(1, players[1]);

        game.resolveRound(1);

        // players[1] should NOT be eliminated (saved by proof)
        assertNotEq(
            uint(game.getPlayer(1, players[1]).status),
            uint(PlagueGame.PlayerStatus.Eliminated)
        );
    }

    function test_Tie_AllCleanWithProof_AreSaved() public {
        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);

        // Infect players[0] so clean tied candidates can be players[1] and players[2]
        vm.prank(backend);
        game.assignInfection(1, players[0]);

        // Both tied clean candidates submit innocence proofs
        vm.prank(players[1]);
        game.submitInnocenceProof(1, keccak256("comm-1"), keccak256("nullifier-p1-r1"), "");
        vm.prank(players[2]);
        game.submitInnocenceProof(1, keccak256("comm-2"), keccak256("nullifier-p2-r1"), "");

        vm.prank(backend);
        game.openVoting(1);

        // Force a 3-3 tie between players[1] and players[2]
        vm.prank(host);
        game.castVote(1, players[1]);
        vm.prank(players[3]);
        game.castVote(1, players[1]);
        vm.prank(players[4]);
        game.castVote(1, players[1]);

        vm.prank(players[0]);
        game.castVote(1, players[2]);
        vm.prank(players[1]);
        game.castVote(1, players[2]);
        vm.prank(players[2]);
        game.castVote(1, players[2]);

        game.resolveRound(1);

        assertNotEq(
            uint(game.getPlayer(1, players[1]).status),
            uint(PlagueGame.PlayerStatus.Eliminated)
        );
        assertNotEq(
            uint(game.getPlayer(1, players[2]).status),
            uint(PlagueGame.PlayerStatus.Eliminated)
        );
    }

    function test_Tie_WithInfectedCandidate_EliminatesInfectedEvenWithProof() public {
        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);

        // Infect players[0] so this candidate is vulnerable in tie resolution
        vm.prank(backend);
        game.assignInfection(1, players[0]);

        // In bypass mode even infected can submit; resolution must still eliminate infected candidate
        vm.prank(players[0]);
        game.submitInnocenceProof(1, keccak256("comm-0"), keccak256("nullifier-p0-r1"), "");
        vm.prank(players[1]);
        game.submitInnocenceProof(1, keccak256("comm-1"), keccak256("nullifier-p1-r1"), "");

        vm.prank(backend);
        game.openVoting(1);

        // Force a 3-3 tie between infected players[0] and clean players[1]
        vm.prank(host);
        game.castVote(1, players[0]);
        vm.prank(players[2]);
        game.castVote(1, players[0]);
        vm.prank(players[3]);
        game.castVote(1, players[0]);

        vm.prank(players[0]);
        game.castVote(1, players[1]);
        vm.prank(players[1]);
        game.castVote(1, players[1]);
        vm.prank(players[4]);
        game.castVote(1, players[1]);

        game.resolveRound(1);

        assertEq(
            uint(game.getPlayer(1, players[0]).status),
            uint(PlagueGame.PlayerStatus.Eliminated)
        );
        assertNotEq(
            uint(game.getPlayer(1, players[1]).status),
            uint(PlagueGame.PlayerStatus.Eliminated)
        );
    }

    function test_Tie_WithMultipleInfectedCandidates_EliminatesAllTiedInfected() public {
        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);

        // Round 1: infect players[0], then eliminate players[4] so game continues.
        vm.prank(backend);
        game.assignInfection(1, players[0]);

        vm.prank(backend);
        game.openVoting(1);

        vm.prank(host);
        game.castVote(1, players[4]);
        vm.prank(players[0]);
        game.castVote(1, players[4]);

        game.resolveRound(1);

        // Round 2: infect players[1] so two infected players are alive.
        vm.prank(backend);
        game.assignInfection(1, players[1]);

        vm.prank(backend);
        game.openVoting(1);

        // Force top tie between infected players[0] and players[1].
        vm.prank(host);
        game.castVote(1, players[0]);
        vm.prank(players[2]);
        game.castVote(1, players[0]);

        vm.prank(players[0]);
        game.castVote(1, players[1]);
        vm.prank(players[1]);
        game.castVote(1, players[1]);

        vm.prank(players[3]);
        game.castVote(1, host);

        game.resolveRound(1);

        assertEq(
            uint(game.getPlayer(1, players[0]).status),
            uint(PlagueGame.PlayerStatus.Eliminated)
        );
        assertEq(
            uint(game.getPlayer(1, players[1]).status),
            uint(PlagueGame.PlayerStatus.Eliminated)
        );
    }

    function test_Tie_NoInfectedAmongTop_EliminatesAllUnprotectedCleanAndSavesProvedClean() public {
        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);

        vm.prank(backend);
        game.assignInfection(1, players[0]); // infected not in top tie below

        // players[1] is protected clean; players[2] and players[3] are unprotected clean.
        vm.prank(players[1]);
        game.submitInnocenceProof(1, keccak256("comm-1"), keccak256("nullifier-p1-r1"), "");

        vm.prank(backend);
        game.openVoting(1);

        // Build a 2-2-2 tie among players[1], players[2], players[3].
        vm.prank(host);
        game.castVote(1, players[1]);
        vm.prank(players[4]);
        game.castVote(1, players[1]);

        vm.prank(players[0]);
        game.castVote(1, players[2]);
        vm.prank(players[2]);
        game.castVote(1, players[2]);

        vm.prank(players[1]);
        game.castVote(1, players[3]);
        vm.prank(players[3]);
        game.castVote(1, players[3]);

        game.resolveRound(1);

        assertNotEq(
            uint(game.getPlayer(1, players[1]).status),
            uint(PlagueGame.PlayerStatus.Eliminated)
        );
        assertEq(
            uint(game.getPlayer(1, players[2]).status),
            uint(PlagueGame.PlayerStatus.Eliminated)
        );
        assertEq(
            uint(game.getPlayer(1, players[3]).status),
            uint(PlagueGame.PlayerStatus.Eliminated)
        );
    }

    // ── Nullifier replay prevention ───────────────────────────────────────────────

    function test_NullifierReplay_Reverts() public {
        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);

        vm.prank(backend);
        game.assignInfection(1, players[0]);

        bytes32 nullifier = keccak256("nullifier-replay");

        vm.prank(players[1]);
        game.submitInnocenceProof(1, keccak256("comm-1"), nullifier, "");

        // Second submission with same nullifier must revert
        vm.prank(players[2]);
        vm.expectRevert(PlagueGame.NullifierUsed.selector);
        game.submitInnocenceProof(1, keccak256("comm-2"), nullifier, "");
    }

    // ── Proof fee charged after free slot ────────────────────────────────────────

    function test_ProofFee_ChargedAfterFreeSlotUsed() public {
        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);
        vm.prank(backend);
        game.assignInfection(1, players[0]);

        // Round 1 — free proof (no token approval needed)
        vm.prank(players[1]);
        game.submitInnocenceProof(1, keccak256("comm-1"), keccak256("null-r1"), "");

        // End round 1 — vote to eliminate a clean player so the infected player survives.
        // players[0] (infected) votes for players[4] → players[4] gets 2 votes, others 1 self-vote.
        vm.prank(backend);
        game.openVoting(1);
        vm.prank(players[0]);
        game.castVote(1, players[4]);
        game.resolveRound(1); // players[4] eliminated; game continues

        // Round 2 — paid proof; approve FEE before submitting
        vm.prank(backend);
        game.assignInfection(1, players[2]);

        uint256 balBefore = token.balanceOf(players[1]);
        vm.startPrank(players[1]);
        token.approve(address(game), FEE);
        game.submitInnocenceProof(1, keccak256("comm-1"), keccak256("null-r2"), "");
        vm.stopPrank();

        // Fee should have been deducted
        assertEq(token.balanceOf(players[1]), balBefore - FEE);
    }

    // ── Absent-vote rule ─────────────────────────────────────────────────────────

    function test_AbsentVoteRule_SelfVote_WhenNoLeader() public {
        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);

        vm.prank(backend);
        game.assignInfection(1, players[0]);

        vm.prank(backend);
        game.openVoting(1);

        // Nobody votes — resolveRound should apply self-votes (no leader yet)
        // This just checks it doesn't revert
        game.resolveRound(1);
    }

    // ── Backend-only guards ───────────────────────────────────────────────────────

    function test_BeginActivePhase_NotBackend_Reverts() public {
        _createAndStart();
        _submitAllCommitments();

        vm.prank(players[0]);
        vm.expectRevert(PlagueGame.Unauthorized.selector);
        game.beginActivePhase(1);
    }

    function test_AssignInfection_NotBackend_Reverts() public {
        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);

        vm.prank(players[0]);
        vm.expectRevert(PlagueGame.Unauthorized.selector);
        game.assignInfection(1, players[1]);
    }

    function test_AssignInfection_TargetMustBeClean_RevertsForAlreadyInfected() public {
        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);

        // First infection establishes patient zero at players[0]
        vm.prank(backend);
        game.assignInfection(1, players[0]);

        vm.prank(backend);
        game.openVoting(1);

        // Vote to eliminate a clean player (host) so the infected player survives into round 2.
        // players[0] (infected) votes for host → host gets 2 votes (explicit + self), all others 1 self-vote.
        vm.prank(players[0]);
        game.castVote(1, host);
        game.resolveRound(1); // host eliminated; game continues (infected still alive)

        // Next infection phase: trying to re-infect already-infected player must fail
        vm.prank(backend);
        vm.expectRevert(PlagueGame.InvalidInfectionTarget.selector);
        game.assignInfection(1, players[0]);
    }

    function test_PatientZeroSuccession_WhenCurrentIsEliminated() public {
        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);

        // Round 1: B = players[0] becomes initial patient zero
        vm.prank(backend);
        game.assignInfection(1, players[0]);
        assertEq(game.currentPatientZero(1), players[0]);

        vm.prank(backend);
        game.openVoting(1);
        // Vote to eliminate players[4] (clean) so infected players[0] survives into round 2.
        // players[0] votes for players[4] → players[4] gets 2 votes, all others get 1 self-vote.
        vm.prank(players[0]);
        game.castVote(1, players[4]);
        game.resolveRound(1); // players[4] eliminated; game continues

        // Round 2: B infects E = players[1]
        vm.prank(backend);
        game.assignInfection(1, players[1]);
        assertEq(game.currentPatientZero(1), players[0]);

        vm.prank(backend);
        game.openVoting(1);

        // Eliminate current patient zero (players[0])
        // players[4] was eliminated in round 1; remaining voters: host + players[0..3]
        vm.prank(host);
        game.castVote(1, players[0]);
        vm.prank(players[1]);
        game.castVote(1, players[0]);
        vm.prank(players[2]);
        game.castVote(1, players[0]);
        vm.prank(players[3]);
        game.castVote(1, players[0]);
        vm.prank(players[0]);
        game.castVote(1, players[0]);

        game.resolveRound(1);

        // B eliminated, first infected successor E must now be patient zero
        assertEq(
            uint(game.getPlayer(1, players[0]).status),
            uint(PlagueGame.PlayerStatus.Eliminated)
        );
        assertEq(game.currentPatientZero(1), players[1]);
    }

    // ── ZKVerifier bypass toggle ──────────────────────────────────────────────────

    function test_ZKVerifier_BypassOff_InvalidProof_Reverts() public {
        // Set up the game with bypass ON so commitments and infection assignment succeed.
        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);

        vm.prank(backend);
        game.assignInfection(1, players[0]);

        // NOW disable bypass — subsequent proof submissions must be real.
        vm.prank(admin);
        zkVerifier.setBypass(false);

        // Empty innocence proof should be rejected when bypass is off.
        vm.prank(players[1]);
        vm.expectRevert(PlagueGame.InvalidProof.selector);
        game.submitInnocenceProof(1, keccak256("comm-1"), keccak256("nullifier"), "");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────

    function _createRoom() internal {
        vm.prank(host);
        game.createRoom(6, STAKE, FEE, 600);
    }

    /// @dev Host + 5 players approve and join (6 total = maxPlayers)
    function _fillRoom() internal {
        vm.startPrank(host);
        token.approve(address(game), STAKE);
        game.joinRoom(1);
        vm.stopPrank();

        for (uint256 i = 0; i < 5; i++) {
            vm.startPrank(players[i]);
            token.approve(address(game), STAKE);
            game.joinRoom(1);
            vm.stopPrank();
        }
    }

    /// @dev Create room, fill it, and call startGame
    function _createAndStart() internal {
        _createRoom();
        _fillRoom();
        vm.prank(host);
        game.startGame(1);
    }

    function _submitAllCommitments() internal {
        // host + players[0..4] (6 players total)
        vm.prank(host);
        game.submitRoleCommitment(1, keccak256("commitment-host"), "");
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(players[i]);
            game.submitRoleCommitment(1, keccak256(abi.encodePacked("commitment", i)), "");
        }
    }
}
