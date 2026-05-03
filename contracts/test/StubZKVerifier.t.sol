// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StubZKVerifier} from "../src/StubZKVerifier.sol";

contract StubZKVerifierTest is Test {
    StubZKVerifier verifier;
    address    owner = makeAddr("zkOwner");

    function setUp() public {
        vm.prank(owner);
        verifier = new StubZKVerifier(true);
    }

    function test_BypassOn_AcceptsAnyRoleCommitment() public view {
        assertTrue(verifier.verifyRoleCommitment(bytes32(0), ""));
    }

    function test_BypassOn_AcceptsAnyInnocenceProof() public view {
        assertTrue(verifier.verifyInnocenceProof(bytes32(0), bytes32(0), ""));
    }

    function test_BypassOff_RejectsRoleCommitment() public {
        vm.prank(owner);
        verifier.setBypass(false);
        assertFalse(verifier.verifyRoleCommitment(bytes32(0), ""));
    }

    function test_BypassOff_RejectsInnocenceProof() public {
        vm.prank(owner);
        verifier.setBypass(false);
        assertFalse(verifier.verifyInnocenceProof(bytes32(0), bytes32(0), ""));
    }

    function test_SetBypass_EmitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(false, false, false, true);
        emit StubZKVerifier.BypassSet(false);
        verifier.setBypass(false);
    }

    function test_SetBypass_NotOwner_Reverts() public {
        vm.prank(makeAddr("attacker"));
        vm.expectRevert("StubZKVerifier: not owner");
        verifier.setBypass(false);
    }

    function test_Constructor_BypassDisabled() public {
        StubZKVerifier v = new StubZKVerifier(false);
        assertFalse(v.bypassEnabled());
    }

    function test_Constructor_OwnerSet() public view {
        assertEq(verifier.owner(), owner);
    }
}

