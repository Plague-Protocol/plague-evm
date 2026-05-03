// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PlagueGameVerifier} from "../src/PlagueGameVerifier.sol";

/// @dev Mock Noir verifier with a configurable pass/fail toggle.
contract MockNoirVerifier {
    bool public shouldPass;
    constructor(bool _shouldPass) { shouldPass = _shouldPass; }
    function setShouldPass(bool v) external { shouldPass = v; }
    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return shouldPass;
    }
}

contract PlagueGameVerifierTest is Test {
    MockNoirVerifier roleV;
    MockNoirVerifier innocV;
    PlagueGameVerifier adapter;

    function setUp() public {
        roleV   = new MockNoirVerifier(true);
        innocV  = new MockNoirVerifier(true);
        adapter = new PlagueGameVerifier(address(roleV), address(innocV));
    }

    function test_VerifyRoleCommitment_PassesWhenVerifierPasses() public view {
        assertTrue(adapter.verifyRoleCommitment(keccak256("commitment"), "proof"));
    }

    function test_VerifyRoleCommitment_FailsWhenVerifierFails() public {
        roleV.setShouldPass(false);
        assertFalse(adapter.verifyRoleCommitment(keccak256("commitment"), "proof"));
    }

    function test_VerifyInnocenceProof_PassesWhenVerifierPasses() public view {
        assertTrue(adapter.verifyInnocenceProof(keccak256("c"), keccak256("n"), "proof"));
    }

    function test_VerifyInnocenceProof_FailsWhenVerifierFails() public {
        innocV.setShouldPass(false);
        assertFalse(adapter.verifyInnocenceProof(keccak256("c"), keccak256("n"), "proof"));
    }

    function test_VerifyRoleCommitment_DoesNotCallInnocenceVerifier() public {
        // Role commitment should only hit roleV, not innocV
        innocV.setShouldPass(false);
        // Still passes because only roleV is queried
        assertTrue(adapter.verifyRoleCommitment(keccak256("c"), ""));
    }

    function test_VerifyInnocenceProof_DoesNotCallRoleVerifier() public {
        // Innocence proof should only hit innocV, not roleV
        roleV.setShouldPass(false);
        // Still passes because only innocV is queried
        assertTrue(adapter.verifyInnocenceProof(keccak256("c"), keccak256("n"), ""));
    }

    function test_Constructor_ZeroRoleVerifier_Reverts() public {
        vm.expectRevert(PlagueGameVerifier.ZeroAddress.selector);
        new PlagueGameVerifier(address(0), address(innocV));
    }

    function test_Constructor_ZeroInnocenceVerifier_Reverts() public {
        vm.expectRevert(PlagueGameVerifier.ZeroAddress.selector);
        new PlagueGameVerifier(address(roleV), address(0));
    }

    function test_ImmutableAddressesStoredCorrectly() public view {
        assertEq(address(adapter.ROLE_COMMITMENT_VERIFIER()), address(roleV));
        assertEq(address(adapter.INNOCENCE_PROOF_VERIFIER()), address(innocV));
    }
}

// ══════════════════════════════════════════════════════════════════════════════
//  FaucetCUSDTest
// ══════════════════════════════════════════════════════════════════════════════

