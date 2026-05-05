// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FaucetCUSD} from "../src/FaucetCUSD.sol";

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

contract FaucetCUSDTest is Test {
    FaucetCUSD faucet;
    MockERC20  token;

    address faucetOwner = makeAddr("faucetOwner");
    address user1       = makeAddr("user1");
    address user2       = makeAddr("user2");

    uint256 constant DRIP = 50 ether;

    function setUp() public {
        token = new MockERC20();
        vm.prank(faucetOwner);
        faucet = new FaucetCUSD(address(token));
        // No pre-funding: FaucetCUSD mints tokens on demand rather than holding a balance
    }

    // ── constructor ───────────────────────────────────────────────────────────

    function test_Constructor_SetsOwnerAndToken() public view {
        assertEq(faucet.owner(), faucetOwner);
        assertEq(address(faucet.cUsd()), address(token));
    }

    function test_Constructor_DefaultDripAmount() public view {
        assertEq(faucet.dripAmount(), DRIP);
    }

    function test_Constructor_DefaultCooldown() public view {
        assertEq(faucet.cooldown(), 24 hours);
    }

    function test_Constructor_ZeroToken_Reverts() public {
        vm.expectRevert(FaucetCUSD.ZeroAddress.selector);
        new FaucetCUSD(address(0));
    }

    // ── claim ─────────────────────────────────────────────────────────────────

    function test_Claim_TransfersDripToUser() public {
        uint256 before = token.balanceOf(user1);
        vm.prank(user1);
        faucet.claim();
        assertEq(token.balanceOf(user1), before + DRIP);
    }

    function test_Claim_SetsLastClaimed() public {
        vm.prank(user1);
        faucet.claim();
        assertEq(faucet.lastClaimed(user1), block.timestamp);
    }

    function test_Claim_DuringCooldown_Reverts() public {
        vm.prank(user1);
        faucet.claim();
        uint256 cd = faucet.cooldown();
        uint256 claimedAt = faucet.lastClaimed(user1);

        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSelector(FaucetCUSD.CooldownActive.selector, claimedAt + cd));
        faucet.claim();
    }

    function test_Claim_AfterCooldown_Succeeds() public {
        vm.prank(user1);
        faucet.claim();
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(user1);
        faucet.claim();
        assertEq(token.balanceOf(user1), DRIP * 2);
    }

    function test_Claim_DifferentUsersIndependentCooldowns() public {
        vm.prank(user1); faucet.claim();
        vm.prank(user2); faucet.claim();
        assertEq(token.balanceOf(user1), DRIP);
        assertEq(token.balanceOf(user2), DRIP);
    }

    // ── nextClaimAt ───────────────────────────────────────────────────────────

    function test_NextClaimAt_ZeroBeforeFirstClaim() public view {
        assertEq(faucet.nextClaimAt(user1), 0);
    }

    function test_NextClaimAt_AfterFirstClaim() public {
        vm.prank(user1);
        faucet.claim();
        assertEq(faucet.nextClaimAt(user1), block.timestamp + 24 hours);
    }

    // ── faucetBalance ─────────────────────────────────────────────────────────

    // FaucetCUSD no longer holds tokens — it mints on demand, so faucetBalance() is always 0
    function test_FaucetBalance_ReturnsZeroWhenUnfunded() public view {
        assertEq(faucet.faucetBalance(), 0);
    }

    // ── setDripAmount ─────────────────────────────────────────────────────────

    function test_SetDripAmount_UpdatesValue() public {
        vm.prank(faucetOwner);
        faucet.setDripAmount(100 ether);
        assertEq(faucet.dripAmount(), 100 ether);
    }

    function test_SetDripAmount_Zero_Reverts() public {
        vm.prank(faucetOwner);
        vm.expectRevert(FaucetCUSD.ZeroDripAmount.selector);
        faucet.setDripAmount(0);
    }

    function test_SetDripAmount_NotOwner_Reverts() public {
        vm.prank(user1);
        vm.expectRevert(FaucetCUSD.NotOwner.selector);
        faucet.setDripAmount(1 ether);
    }

    function test_SetDripAmount_AffectsNextClaim() public {
        vm.prank(faucetOwner);
        faucet.setDripAmount(100 ether);
        vm.prank(user1);
        faucet.claim();
        assertEq(token.balanceOf(user1), 100 ether);
    }

    // ── setCooldown ───────────────────────────────────────────────────────────

    function test_SetCooldown_UpdatesValue() public {
        vm.prank(faucetOwner);
        faucet.setCooldown(12 hours);
        assertEq(faucet.cooldown(), 12 hours);
    }

    function test_SetCooldown_NotOwner_Reverts() public {
        vm.prank(user1);
        vm.expectRevert(FaucetCUSD.NotOwner.selector);
        faucet.setCooldown(1 hours);
    }

    function test_SetCooldown_ZeroAllowed() public {
        // Zero cooldown means claim anytime
        vm.prank(faucetOwner);
        faucet.setCooldown(0);
        vm.prank(user1);
        faucet.claim();
        vm.prank(user1);
        faucet.claim();
        assertEq(token.balanceOf(user1), DRIP * 2);
    }

    // ── withdraw ──────────────────────────────────────────────────────────────

    function test_Withdraw_TransfersAmount() public {
        // Seed the faucet with some tokens (simulates edge case, e.g. accidental transfer)
        token.mint(address(faucet), 100 ether);
        uint256 before = token.balanceOf(faucetOwner);
        vm.prank(faucetOwner);
        faucet.withdraw(faucetOwner, 100 ether);
        assertEq(token.balanceOf(faucetOwner), before + 100 ether);
    }

    function test_Withdraw_ZeroRecipient_Reverts() public {
        vm.prank(faucetOwner);
        vm.expectRevert(FaucetCUSD.ZeroAddress.selector);
        faucet.withdraw(address(0), 1 ether);
    }

    function test_Withdraw_NotOwner_Reverts() public {
        vm.prank(user1);
        vm.expectRevert(FaucetCUSD.NotOwner.selector);
        faucet.withdraw(user1, 1 ether);
    }

    // ── transferOwnership ─────────────────────────────────────────────────────

    function test_TransferOwnership_UpdatesOwner() public {
        vm.prank(faucetOwner);
        faucet.transferOwnership(user1);
        assertEq(faucet.owner(), user1);
    }

    function test_TransferOwnership_ZeroAddress_Reverts() public {
        vm.prank(faucetOwner);
        vm.expectRevert(FaucetCUSD.ZeroAddress.selector);
        faucet.transferOwnership(address(0));
    }

    function test_TransferOwnership_NotOwner_Reverts() public {
        vm.prank(user1);
        vm.expectRevert(FaucetCUSD.NotOwner.selector);
        faucet.transferOwnership(user2);
    }

    function test_TransferOwnership_NewOwnerCanAdminister() public {
        vm.prank(faucetOwner);
        faucet.transferOwnership(user1);

        vm.prank(user1);
        faucet.setDripAmount(1 ether);
        assertEq(faucet.dripAmount(), 1 ether);
    }

    function test_TransferOwnership_OldOwnerLosesAccess() public {
        vm.prank(faucetOwner);
        faucet.transferOwnership(user1);

        vm.prank(faucetOwner);
        vm.expectRevert(FaucetCUSD.NotOwner.selector);
        faucet.setDripAmount(1 ether);
    }

    function test_TransferOwnership_EmitsEvent() public {
        vm.prank(faucetOwner);
        vm.expectEmit(true, true, false, false);
        emit FaucetCUSD.OwnershipTransferred(faucetOwner, user1);
        faucet.transferOwnership(user1);
    }
}
