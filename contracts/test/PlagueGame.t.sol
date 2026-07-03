// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PlagueGame} from "../src/PlagueGame.sol";
import {IZKVerifier} from "../src/interfaces/IZKVerifier.sol";

/// @dev Always-pass ZK verifier for tests — replaces deleted StubZKVerifier.
contract MockZKVerifier is IZKVerifier {
    function verifyRoleCommitment(bytes32, bytes calldata) external pure returns (bool) { return true; }
    function verifyInnocenceProof(bytes32, bytes32, bytes calldata) external pure returns (bool) { return true; }
}

/// @dev Always-reject ZK verifier used to simulate bypass-off behaviour.
contract RejectZKVerifier is IZKVerifier {
    function verifyRoleCommitment(bytes32, bytes calldata) external pure returns (bool) { return false; }
    function verifyInnocenceProof(bytes32, bytes32, bytes calldata) external pure returns (bool) { return false; }
}

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
    MockZKVerifier  zkVerifier;
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
        zkVerifier = new MockZKVerifier();
        game       = new PlagueGame();
        game.initialize(admin, backend, address(zkVerifier), platform, address(token));
        vm.stopPrank();

        // Host must approve stake for createRoom auto-join transfer.
        vm.prank(host);
        token.approve(address(game), type(uint256).max);
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
        assertEq(r.config.minPlayers, 3);
        assertEq(r.config.maxPlayers, 6);
        assertEq(r.expiresAt, r.createdAt + 600);
    }

    function test_CreateRoom_InvalidMaxPlayers_Reverts() public {
        vm.prank(host);
        vm.expectRevert();
        game.createRoom(3, STAKE, FEE, 600); // below min 4
    }

    function test_CreateRoom_ZeroStake_Reverts() public {
        vm.prank(host);
        vm.expectRevert(bytes("stakeAmount must be > 0"));
        game.createRoom(6, 0, FEE, 600);
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
        // Only host is present (auto-joined by createRoom)
        vm.startPrank(host);
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

    function test_RoleCommitTimeout_EliminatesUncommittedAndStarts() public {
        _createAndStart();

        vm.prank(host);
        game.submitRoleCommitment(1, keccak256("commitment-host"), "");
        vm.prank(players[0]);
        game.submitRoleCommitment(1, keccak256("commitment-0"), "");
        vm.prank(players[1]);
        game.submitRoleCommitment(1, keccak256("commitment-1"), "");
        vm.prank(players[2]);
        game.submitRoleCommitment(1, keccak256("commitment-2"), "");

        vm.warp(block.timestamp + game.ROLE_COMMIT_TIMEOUT_SECS() + 1);

        vm.prank(backend);
        game.eliminateUncommittedPlayers(1);

        assertEq(uint(game.getPlayer(1, players[3]).status), uint(PlagueGame.PlayerStatus.Eliminated));
        assertEq(uint(game.getPlayer(1, players[4]).status), uint(PlagueGame.PlayerStatus.Eliminated));

        vm.prank(backend);
        game.beginActivePhase(1);
        assertEq(uint(game.getRoom(1).status), uint(PlagueGame.RoomStatus.Active));
    }

    function test_RoleCommitTimeout_TooFewCommitted_FinalizesAndPaysCommitted() public {
        _createAndStart();

        // Only two players commit (below minPlayers=3).
        vm.prank(host);
        game.submitRoleCommitment(1, keccak256("commitment-host"), "");
        vm.prank(players[0]);
        game.submitRoleCommitment(1, keccak256("commitment-0"), "");

        uint256 hostBefore = token.balanceOf(host);
        uint256 p0Before = token.balanceOf(players[0]);

        vm.warp(block.timestamp + game.ROLE_COMMIT_TIMEOUT_SECS() + 1);

        vm.prank(backend);
        game.finalizeStartTimeout(1);

        // Room is closed and cannot get stuck in Starting.
        PlagueGame.Room memory r = game.getRoom(1);
        assertEq(uint(r.status), uint(PlagueGame.RoomStatus.Ended));
        assertEq(uint(r.currentPhase), uint(PlagueGame.RoundPhase.Ended));

        // Non-committers are eliminated.
        assertEq(uint(game.getPlayer(1, players[1]).status), uint(PlagueGame.PlayerStatus.Eliminated));
        assertEq(uint(game.getPlayer(1, players[2]).status), uint(PlagueGame.PlayerStatus.Eliminated));
        assertEq(uint(game.getPlayer(1, players[3]).status), uint(PlagueGame.PlayerStatus.Eliminated));
        assertEq(uint(game.getPlayer(1, players[4]).status), uint(PlagueGame.PlayerStatus.Eliminated));

        // Entire pot (6 * STAKE) is split among committed survivors (host + players[0]).
        uint256 expectedShare = (6 * STAKE) / 2;
        assertEq(token.balanceOf(host), hostBefore + expectedShare);
        assertEq(token.balanceOf(players[0]), p0Before + expectedShare);
        assertEq(game.getRoom(1).pot, 0);
    }

    function test_FinalizeElimination_ChecksWinnerBeforeQueuedInfection() public {
        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);

        vm.prank(backend);
        game.assignInfection(1, players[0]);

        vm.prank(backend);
        game.openVoting(1);

        // Current PZ votes players[1] for next infection, but gets eliminated this round.
        vm.prank(players[0]);
        game.castVote(1, players[1]);
        vm.prank(players[1]);
        game.castVote(1, players[0]);
        vm.prank(players[2]);
        game.castVote(1, players[0]);
        vm.prank(players[3]);
        game.castVote(1, players[0]);
        vm.prank(players[4]);
        game.castVote(1, players[0]);
        vm.prank(host);
        game.castVote(1, players[0]);

        _resolveAndFinalize();

        // Clean should win before any queued next infection can be applied.
        assertEq(uint(game.getRoom(1).status), uint(PlagueGame.RoomStatus.Ended));
        assertEq(uint(game.getPlayer(1, players[1]).status), uint(PlagueGame.PlayerStatus.Clean));
    }

    function test_FinalizeElimination_ParityAboveOne_ContinuesGame() public {
        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);

        // Round 1: infect players[0], queue players[1], eliminate players[4].
        vm.prank(backend);
        game.assignInfection(1, players[0]);

        vm.prank(backend);
        game.openVoting(1);

        vm.prank(players[0]);
        game.castVote(1, players[1]);
        vm.prank(players[1]);
        game.castVote(1, players[4]);
        vm.prank(players[2]);
        game.castVote(1, players[4]);
        vm.prank(players[3]);
        game.castVote(1, players[4]);
        vm.prank(players[4]);
        game.castVote(1, players[4]);
        vm.prank(host);
        game.castVote(1, players[4]);

        _resolveAndFinalize();

        // Round 2: queued target players[1] becomes infected.
        vm.prank(backend);
        game.assignInfection(1, players[1]);

        vm.prank(backend);
        game.openVoting(1);

        // Eliminate one clean so we end Reveal at 2 infected vs 2 clean.
        vm.prank(players[0]);
        game.castVote(1, players[3]);
        vm.prank(players[1]);
        game.castVote(1, players[3]);
        vm.prank(host);
        game.castVote(1, players[3]);
        vm.prank(players[2]);
        game.castVote(1, host);
        vm.prank(players[3]);
        game.castVote(1, host);

        _resolveAndFinalize();

        // 2v2 parity is no longer an infected win; game must continue.
        PlagueGame.Room memory r = game.getRoom(1);
        assertEq(uint(r.status), uint(PlagueGame.RoomStatus.Active));
        assertEq(uint(r.currentPhase), uint(PlagueGame.RoundPhase.Infection));
        assertEq(r.currentRound, 3);
    }

    function test_InfectionPhase_StrictMajorityEndsBeforeReveal() public {
        // Build a 4-player room where round-2 infection creates a strict
        // infected majority and should end the game immediately.
        vm.prank(host);
        game.createRoom(4, STAKE, FEE, 600);

        for (uint256 i = 0; i < 3; i++) {
            vm.startPrank(players[i]);
            token.approve(address(game), STAKE);
            game.joinRoom(1);
            vm.stopPrank();
        }

        vm.prank(host);
        game.startGame(1);

        vm.prank(host);
        game.submitRoleCommitment(1, keccak256("commitment-host"), "");
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(players[i]);
            game.submitRoleCommitment(1, keccak256(abi.encodePacked("commitment", i)), "");
        }

        vm.prank(backend);
        game.beginActivePhase(1);

        // Round 1: infect players[0], queue players[1], eliminate players[2].
        vm.prank(backend);
        game.assignInfection(1, players[0]);
        vm.prank(backend);
        game.openVoting(1);

        vm.prank(players[0]);
        game.castVote(1, players[1]);
        vm.prank(players[1]);
        game.castVote(1, players[2]);
        vm.prank(players[2]);
        game.castVote(1, players[2]);
        vm.prank(host);
        game.castVote(1, players[2]);

        _resolveAndFinalize();

        // Round 2: players[1] becomes infected (2 infected, 1 clean) and game ends.
        vm.prank(backend);
        game.assignInfection(1, players[1]);

        assertEq(uint(game.getRoom(1).status), uint(PlagueGame.RoomStatus.Ended));
        assertEq(uint(game.getRoom(1).currentPhase), uint(PlagueGame.RoundPhase.Ended));
    }

    function test_PatientZeroVote_DrivesNextInfectionTarget() public {
        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);

        vm.prank(backend);
        game.assignInfection(1, players[0]);

        vm.prank(backend);
        game.openVoting(1);

        // Keep game alive by eliminating a clean player, while PZ points to players[1].
        vm.prank(players[0]);
        game.castVote(1, players[1]);
        vm.prank(players[2]);
        game.castVote(1, players[4]);
        vm.prank(players[3]);
        game.castVote(1, players[4]);
        vm.prank(players[4]);
        game.castVote(1, players[4]);
        vm.prank(host);
        game.castVote(1, players[4]);
        vm.prank(players[1]);
        game.castVote(1, players[4]);

        _resolveAndFinalize();

        // Round 2 Infection: backend argument is ignored in favor of queued PZ target.
        vm.prank(backend);
        game.assignInfection(1, players[2]);

        assertEq(uint(game.getPlayer(1, players[1]).status), uint(PlagueGame.PlayerStatus.Infected));
        assertEq(uint(game.getPlayer(1, players[2]).status), uint(PlagueGame.PlayerStatus.Clean));
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

        _resolveAndFinalize();

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

        _resolveAndFinalize();

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

        _resolveAndFinalize();

        assertNotEq(
            uint(game.getPlayer(1, players[1]).status),
            uint(PlagueGame.PlayerStatus.Eliminated)
        );
        assertNotEq(
            uint(game.getPlayer(1, players[2]).status),
            uint(PlagueGame.PlayerStatus.Eliminated)
        );
    }

    function test_Tie_WithInfectedCandidate_EliminatesInfectedAndSavesProvedClean() public {
        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);

        // Infect players[0] so this candidate is vulnerable in tie resolution
        vm.prank(backend);
        game.assignInfection(1, players[0]);

        // Only the clean tied candidate can submit a valid innocence proof.
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

        _resolveAndFinalize();

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

        // Round 1: infect players[0], queue players[1] via PZ vote,
        // then eliminate players[4] so game continues.
        vm.prank(backend);
        game.assignInfection(1, players[0]);

        vm.prank(backend);
        game.openVoting(1);

        vm.prank(players[0]);
        game.castVote(1, players[1]);
        vm.prank(host);
        game.castVote(1, players[4]);
        vm.prank(players[2]);
        game.castVote(1, players[4]);
        vm.prank(players[3]);
        game.castVote(1, players[4]);
        vm.prank(players[4]);
        game.castVote(1, players[4]);
        vm.prank(players[1]);
        game.castVote(1, players[4]);

        _resolveAndFinalize();

        // Round 2: queued players[1] becomes infected so two infected are alive.
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

        _resolveAndFinalize();

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

        _resolveAndFinalize();

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
        _resolveAndFinalize(); // players[4] eliminated; game continues

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
        _resolveAndFinalize();
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

    function test_AssignInfection_SkipsWhenQueuedTargetIsInvalid() public {
        _createAndStart();
        _submitAllCommitments();

        vm.prank(backend);
        game.beginActivePhase(1);

        // First infection establishes patient zero at players[0]
        vm.prank(backend);
        game.assignInfection(1, players[0]);

        vm.prank(backend);
        game.openVoting(1);

        // Queue an invalid next target by having PZ vote themself (already infected).
        // Eliminate a clean player (host) so game continues to round 2.
        vm.prank(players[0]);
        game.castVote(1, players[0]);
        vm.prank(players[1]);
        game.castVote(1, host);
        _resolveAndFinalize(); // host eliminated; game continues (infected still alive)

        // Round 2 Infection: queued target is invalid, so no new infection is applied.
        vm.prank(backend);
        game.assignInfection(1, players[2]);

        assertEq(uint(game.getPlayer(1, players[2]).status), uint(PlagueGame.PlayerStatus.Clean));
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
        // Queue players[1] as next infection target by PZ vote,
        // while others eliminate players[4] so game continues.
        vm.prank(players[0]);
        game.castVote(1, players[1]);
        vm.prank(players[2]);
        game.castVote(1, players[4]);
        vm.prank(players[3]);
        game.castVote(1, players[4]);
        vm.prank(players[4]);
        game.castVote(1, players[4]);
        vm.prank(host);
        game.castVote(1, players[4]);
        vm.prank(players[1]);
        game.castVote(1, players[4]);
        _resolveAndFinalize(); // players[4] eliminated; game continues

        // Round 2: queued target (players[1]) becomes infected.
        vm.prank(backend);
        game.assignInfection(1, players[1]);
        assertEq(uint(game.getPlayer(1, players[1]).status), uint(PlagueGame.PlayerStatus.Infected));
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

        _resolveAndFinalize();

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

        // Swap to a reject-all verifier to simulate real ZK validation.
        RejectZKVerifier rejectV = new RejectZKVerifier();
        vm.prank(admin);
        game.setZkVerifier(address(rejectV));

        // Empty innocence proof should be rejected when verifier rejects.
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

    function _resolveAndFinalize() internal {
        game.resolveRound(1);
        vm.prank(backend);
        game.finalizeElimination(1);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
//  Additional PlagueGame coverage (admin setters, fees, maxActiveRooms, payouts)
// ══════════════════════════════════════════════════════════════════════════════

contract PlagueGameExtendedTest is Test {
    PlagueGame  game;
    MockZKVerifier  zkVerifier;
    MockERC20   token;

    address admin    = makeAddr("admin");
    address backend  = makeAddr("backend");
    address platform = makeAddr("platform");
    address host     = makeAddr("host");

    address[] players;

    uint256 constant STAKE = 10e18;
    uint256 constant FEE   = 1e18;
    uint256 constant MINT  = 1000e18;

    function setUp() public {
        token = new MockERC20();
        token.mint(host, MINT);
        for (uint8 i = 0; i < 6; i++) {
            address p = makeAddr(string(abi.encodePacked("ext_player", i)));
            players.push(p);
            token.mint(p, MINT);
        }
        vm.startPrank(admin);
        zkVerifier = new MockZKVerifier();
        game       = new PlagueGame();
        game.initialize(admin, backend, address(zkVerifier), platform, address(token));
        vm.stopPrank();

        // Host must approve stake for createRoom auto-join transfer.
        vm.prank(host);
        token.approve(address(game), type(uint256).max);
    }

    // ── Initialize zero-address guards ────────────────────────────────────────

    function test_Initialize_ZeroAdmin_Reverts() public {
        PlagueGame fresh = new PlagueGame();
        vm.expectRevert("admin address required");
        fresh.initialize(address(0), backend, address(zkVerifier), platform, address(token));
    }

    function test_Initialize_ZeroBackend_Reverts() public {
        PlagueGame fresh = new PlagueGame();
        vm.expectRevert("backendSigner address required");
        fresh.initialize(admin, address(0), address(zkVerifier), platform, address(token));
    }

    function test_Initialize_ZeroZkVerifier_Reverts() public {
        PlagueGame fresh = new PlagueGame();
        vm.expectRevert("zkVerifier address required");
        fresh.initialize(admin, backend, address(0), platform, address(token));
    }

    function test_Initialize_ZeroPlatformReceiver_Reverts() public {
        PlagueGame fresh = new PlagueGame();
        vm.expectRevert("platformReceiver address required");
        fresh.initialize(admin, backend, address(zkVerifier), address(0), address(token));
    }

    function test_Initialize_ZeroCUSD_Reverts() public {
        PlagueGame fresh = new PlagueGame();
        vm.expectRevert("cUSD token address required");
        fresh.initialize(admin, backend, address(zkVerifier), platform, address(0));
    }

    // ── Admin setters ─────────────────────────────────────────────────────────

    function test_SetPlatformReceiver_UpdatesValue() public {
        address newR = makeAddr("newReceiver");
        vm.prank(admin);
        game.setPlatformReceiver(newR);
        assertEq(game.platformReceiver(), newR);
    }

    function test_SetPlatformReceiver_Zero_Reverts() public {
        vm.prank(admin);
        vm.expectRevert("platformReceiver address required");
        game.setPlatformReceiver(address(0));
    }

    function test_SetPlatformReceiver_NotAdmin_Reverts() public {
        vm.prank(players[0]);
        vm.expectRevert(PlagueGame.Unauthorized.selector);
        game.setPlatformReceiver(makeAddr("x"));
    }

    function test_SetBackendSigner_UpdatesValue() public {
        address nb = makeAddr("newBackend");
        vm.prank(admin);
        game.setBackendSigner(nb);
        assertEq(game.backendSigner(), nb);
    }

    function test_SetBackendSigner_Zero_Reverts() public {
        vm.prank(admin);
        vm.expectRevert("backendSigner address required");
        game.setBackendSigner(address(0));
    }

    function test_SetBackendSigner_NotAdmin_Reverts() public {
        vm.prank(players[0]);
        vm.expectRevert(PlagueGame.Unauthorized.selector);
        game.setBackendSigner(makeAddr("x"));
    }

    function test_SetZkVerifier_UpdatesValue() public {
        MockZKVerifier newV = new MockZKVerifier();
        vm.prank(admin);
        game.setZkVerifier(address(newV));
        assertEq(address(game.zkVerifier()), address(newV));
    }

    function test_SetZkVerifier_Zero_Reverts() public {
        vm.prank(admin);
        vm.expectRevert("zkVerifier address required");
        game.setZkVerifier(address(0));
    }

    function test_SetZkVerifier_NotAdmin_Reverts() public {
        vm.prank(players[0]);
        vm.expectRevert(PlagueGame.Unauthorized.selector);
        game.setZkVerifier(makeAddr("x"));
    }

    // ── maxActiveRooms ────────────────────────────────────────────────────────

    function test_SetMaxActiveRooms_UpdatesValue() public {
        vm.prank(admin);
        game.setMaxActiveRooms(5);
        assertEq(game.maxActiveRooms(), 5);
    }

    function test_SetMaxActiveRooms_Zero_Reverts() public {
        vm.prank(admin);
        vm.expectRevert("maxActiveRooms must be > 0");
        game.setMaxActiveRooms(0);
    }

    function test_SetMaxActiveRooms_NotAdmin_Reverts() public {
        vm.prank(players[0]);
        vm.expectRevert(PlagueGame.Unauthorized.selector);
        game.setMaxActiveRooms(1);
    }

    function test_TooManyActiveRooms_Reverts() public {
        vm.prank(admin);
        game.setMaxActiveRooms(2);

        vm.prank(host);
        game.createRoom(6, STAKE, FEE, 600);
        vm.prank(host);
        game.createRoom(6, STAKE, FEE, 600);

        vm.prank(host);
        vm.expectRevert(PlagueGame.TooManyActiveRooms.selector);
        game.createRoom(6, STAKE, FEE, 600);
    }

    function test_ActiveRoomCount_DecreasesOnExpiry() public {
        vm.prank(host);
        game.createRoom(6, STAKE, FEE, 600);
        uint256 before = game.activeRoomCount();

        vm.warp(block.timestamp + 601);
        game.expireRoom(1);

        assertEq(game.activeRoomCount(), before - 1);
    }

    // ── Platform fees accumulation and withdrawal ─────────────────────────────

    function test_PlatformFees_AccumulateFromProofFees() public {
        _createAndStart();
        _submitAllCommitments();
        vm.prank(backend);
        game.beginActivePhase(1);
        vm.prank(backend);
        game.assignInfection(1, players[0]);

        // First proof free; end round 1 without anyone being eliminated
        vm.prank(players[1]);
        game.submitInnocenceProof(1, keccak256("comm-1"), keccak256("null-r1-p1"), "");
        vm.prank(backend);
        game.openVoting(1);
        vm.prank(players[0]);
        game.castVote(1, host);
        _resolveAndFinalize();

        // Round 2: players[1]'s second proof must be paid
        vm.prank(backend);
        game.assignInfection(1, players[2]);

        vm.startPrank(players[1]);
        token.approve(address(game), FEE);
        game.submitInnocenceProof(1, keccak256("comm-1"), keccak256("null-r2-p1"), "");
        vm.stopPrank();

        assertEq(game.platformFees(), FEE);
    }

    function test_PlatformFees_AccumulateFromPot() public {
        _createAndStart();
        _submitAllCommitments();
        vm.prank(backend);
        game.beginActivePhase(1);
        vm.prank(backend);
        game.assignInfection(1, players[0]);
        vm.prank(backend);
        game.openVoting(1);
        for (uint256 i = 1; i < 5; i++) {
            vm.prank(players[i]);
            game.castVote(1, players[0]);
        }
        vm.prank(host);
        game.castVote(1, players[0]);
        _resolveAndFinalize();

        uint256 totalStaked = STAKE * 6;
        uint256 expectedFee = (totalStaked * 3) / 1000;
        assertGe(game.platformFees(), expectedFee);
    }

    function test_WithdrawPlatformFees_TransfersToPlatformReceiver() public {
        _runOneCompleteGame();

        uint256 fees      = game.platformFees();
        assertGt(fees, 0, "should have accumulated fees");

        uint256 balBefore = token.balanceOf(platform);
        vm.prank(admin);
        game.withdrawPlatformFees();

        assertEq(token.balanceOf(platform), balBefore + fees);
        assertEq(game.platformFees(), 0);
    }

    function test_WithdrawPlatformFees_NotAdmin_Reverts() public {
        vm.prank(players[0]);
        vm.expectRevert(PlagueGame.Unauthorized.selector);
        game.withdrawPlatformFees();
    }

    // ── Pot conservation (no dust stranded) ───────────────────────────────────

    function test_PotConservation_AfterCleanWin() public {
        _runOneCompleteGame();

        assertEq(game.getRoom(1).pot, 0, "pot should be zeroed after payout");
        // Contract balance must equal exactly the unclaimed platform fees
        assertEq(
            token.balanceOf(address(game)),
            game.platformFees(),
            "contract balance != platformFees (dust stranded)"
        );
    }

    // ── Endgame: clean win payout math ────────────────────────────────────────

    function test_Endgame_CleanWin_WinnersReceiveShares() public {
        _createAndStart();
        _submitAllCommitments();
        vm.prank(backend);
        game.beginActivePhase(1);
        vm.prank(backend);
        game.assignInfection(1, players[0]);
        vm.prank(backend);
        game.openVoting(1);
        for (uint256 i = 1; i < 5; i++) {
            vm.prank(players[i]);
            game.castVote(1, players[0]);
        }
        vm.prank(host);
        game.castVote(1, players[0]);

        uint256 pot          = game.getRoom(1).pot;
        uint256 platformFee  = (pot * 15) / 1000;  // 1.5% — matches PlagueGame._distribute
        uint256 netPot       = pot - platformFee;
        uint256 winnerCount  = 5;
        uint256 share        = netPot / winnerCount;
        uint256 dust         = netPot - (share * winnerCount);

        uint256 hostBefore   = token.balanceOf(host);

        _resolveAndFinalize();

        assertEq(uint(game.getRoom(1).status), uint(PlagueGame.RoomStatus.Ended));
        assertEq(token.balanceOf(host), hostBefore + share);
        assertEq(game.platformFees(), platformFee + dust);
    }

    // ── Reentrancy guard (structural check) ───────────────────────────────────

    function test_Reentrancy_FlagResetAfterCall() public {
        // Verify calls succeed sequentially (flag is reset after each call)
        vm.prank(host);
        game.createRoom(6, STAKE, FEE, 600);

        vm.startPrank(players[0]);
        token.approve(address(game), STAKE);
        game.joinRoom(1);
        vm.stopPrank();

        // Second join by a different player must also succeed (flag reset properly)
        vm.startPrank(players[1]);
        token.approve(address(game), STAKE);
        game.joinRoom(1);
        vm.stopPrank();

        assertEq(game.getRoom(1).players.length, 3);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _createRoom() internal {
        vm.prank(host);
        game.createRoom(6, STAKE, FEE, 600);
    }

    function _fillRoom() internal {
        for (uint256 i = 0; i < 5; i++) {
            vm.startPrank(players[i]);
            token.approve(address(game), STAKE);
            game.joinRoom(1);
            vm.stopPrank();
        }
    }

    function _createAndStart() internal {
        _createRoom();
        _fillRoom();
        vm.prank(host);
        game.startGame(1);
    }

    function _submitAllCommitments() internal {
        vm.prank(host);
        game.submitRoleCommitment(1, keccak256("commitment-host"), "");
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(players[i]);
            game.submitRoleCommitment(1, keccak256(abi.encodePacked("commitment", i)), "");
        }
    }

    function _runOneCompleteGame() internal {
        _createAndStart();
        _submitAllCommitments();
        vm.prank(backend);
        game.beginActivePhase(1);
        vm.prank(backend);
        game.assignInfection(1, players[0]);
        vm.prank(backend);
        game.openVoting(1);
        for (uint256 i = 1; i < 5; i++) {
            vm.prank(players[i]);
            game.castVote(1, players[0]);
        }
        vm.prank(host);
        game.castVote(1, players[0]);
        _resolveAndFinalize();
    }

    function _resolveAndFinalize() internal {
        game.resolveRound(1);
        vm.prank(backend);
        game.finalizeElimination(1);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
//  ZKVerifierTest
// ══════════════════════════════════════════════════════════════════════════════

