// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PlagueGame.sol";
import "../src/ZKVerifier.sol";

contract PlagueGameTest is Test {
    PlagueGame  game;
    ZKVerifier  zkVerifier;

    address admin   = makeAddr("admin");
    address backend = makeAddr("backend");
    address platform = makeAddr("platform");
    address host    = makeAddr("host");

    // Six players — enough for minPlayers (4) and a meaningful game
    address[] players;

    uint256 constant STAKE = 1 ether;
    uint256 constant FEE   = 0.1 ether;

    function setUp() public {
        // Fund all participants
        vm.deal(host, 100 ether);
        for (uint8 i = 0; i < 6; i++) {
            address p = makeAddr(string(abi.encodePacked("player", i)));
            players.push(p);
            vm.deal(p, 100 ether);
        }

        // Deploy with bypass ZK verifier so tests don't need real Noir proofs
        vm.startPrank(admin);
        zkVerifier = new ZKVerifier(true);
        game       = new PlagueGame();
        game.initialize(admin, backend, address(zkVerifier), platform);
        vm.stopPrank();
    }

    // ── Initialization ───────────────────────────────────────────────────────────

    function test_InitializeOnce() public {
        vm.prank(admin);
        vm.expectRevert(PlagueGame.AlreadyInitialized.selector);
        game.initialize(admin, backend, address(zkVerifier), platform);
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

        vm.prank(players[0]);
        game.joinRoom{value: STAKE}(1);

        PlagueGame.PlayerState memory p = game.getPlayer(1, players[0]);
        assertEq(p.staked, STAKE);
        assertEq(uint(p.status), uint(PlagueGame.PlayerStatus.Clean));
        assertEq(p.addr, players[0]);
    }

    function test_JoinRoom_WrongStake_Reverts() public {
        _createRoom();
        vm.prank(players[0]);
        vm.expectRevert(PlagueGame.WrongStakeAmount.selector);
        game.joinRoom{value: 0.5 ether}(1);
    }

    function test_JoinRoom_Duplicate_Reverts() public {
        _createRoom();
        vm.prank(players[0]);
        game.joinRoom{value: STAKE}(1);

        vm.prank(players[0]);
        vm.expectRevert(PlagueGame.AlreadyJoined.selector);
        game.joinRoom{value: STAKE}(1);
    }

    function test_JoinRoom_AfterExpiry_Reverts() public {
        _createRoom();
        vm.warp(block.timestamp + 601);

        vm.prank(players[0]);
        vm.expectRevert(PlagueGame.RoomExpiredError.selector);
        game.joinRoom{value: STAKE}(1);
    }

    function test_JoinRoom_Full_Reverts() public {
        _createRoom();
        _fillRoom(); // fills up to maxPlayers (6)

        address extra = makeAddr("extra");
        vm.deal(extra, 10 ether);
        vm.prank(extra);
        vm.expectRevert(PlagueGame.RoomFull.selector);
        game.joinRoom{value: STAKE}(1);
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
        vm.prank(host);
        game.joinRoom{value: STAKE}(1);

        vm.prank(host);
        vm.expectRevert(PlagueGame.NotEnoughPlayers.selector);
        game.startGame(1);
    }

    // ── expireRoom ───────────────────────────────────────────────────────────────

    function test_ExpireRoom_Refunds() public {
        _createRoom();
        vm.prank(players[0]);
        game.joinRoom{value: STAKE}(1);
        vm.prank(players[1]);
        game.joinRoom{value: STAKE}(1);

        uint256 balBefore0 = players[0].balance;
        uint256 balBefore1 = players[1].balance;

        vm.warp(block.timestamp + 601);
        game.expireRoom(1);

        assertEq(players[0].balance, balBefore0 + STAKE);
        assertEq(players[1].balance, balBefore1 + STAKE);
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

        // 5 players all vote for players[0]
        for (uint256 i = 1; i < 6; i++) {
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

        // All others vote for players[1]
        for (uint256 i = 0; i < 6; i++) {
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

    // ── ZKVerifier bypass toggle ──────────────────────────────────────────────────

    function test_ZKVerifier_BypassOff_InvalidProof_Reverts() public {
        // Disable bypass — proofs must be real (empty bytes will fail)
        vm.prank(admin);
        zkVerifier.setBypass(false);

        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);

        vm.prank(backend);
        game.assignInfection(1, players[0]);

        // Empty proof should be rejected when bypass is off
        vm.prank(players[1]);
        vm.expectRevert(PlagueGame.InvalidProof.selector);
        game.submitInnocenceProof(1, keccak256("comm-1"), keccak256("nullifier"), "");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────

    function _createRoom() internal {
        vm.prank(host);
        game.createRoom(6, STAKE, FEE, 600);
    }

    /// @dev Host + 5 players join (6 total = maxPlayers)
    function _fillRoom() internal {
        vm.prank(host);
        game.joinRoom{value: STAKE}(1);
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(players[i]);
            game.joinRoom{value: STAKE}(1);
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
