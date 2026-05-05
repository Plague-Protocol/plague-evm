// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Faucet} from "./interfaces/IERC20Faucet.sol";

/**
 * @title FaucetCUSD
 * @notice Testnet-only cUSD faucet for Plague Protocol.
 *
 *  Anyone can call claim() to receive dripAmount cUSD once per cooldown window.
 *  The owner funds the contract by transferring cUSD directly to its address and
 *  can adjust drip settings or withdraw remaining funds.
 *
 * ── DO NOT DEPLOY ON MAINNET ──────────────────────────────────────────────────
 */
contract FaucetCUSD {
    address public owner;
    IERC20Faucet public cUsd;

    uint256 public dripAmount = 50 ether;  // 50 cUSD (18 decimals)
    uint256 public cooldown   = 24 hours;

    mapping(address => uint256) public lastClaimed;

    // ── Events ────────────────────────────────────────────────────────────────
    event Claimed(address indexed user, uint256 amount);
    event DripAmountSet(uint256 newAmount);
    event CooldownSet(uint256 newCooldown);
    event Withdrawn(address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed previous, address indexed newOwner);

    // ── Errors ────────────────────────────────────────────────────────────────
    error NotOwner();
    error CooldownActive(uint256 availableAt);
    error ZeroAddress();
    error ZeroDripAmount();

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        if (msg.sender != owner) revert NotOwner();
    }

    constructor(address _cUsd) {
        if (_cUsd == address(0)) revert ZeroAddress();
        owner = msg.sender;
        cUsd  = IERC20Faucet(_cUsd);
    }

    // ── Public ────────────────────────────────────────────────────────────────

    /**
     * @notice Claim `dripAmount` cUSD. One claim per `cooldown` period per address.
     *         Reverts if the faucet is empty or the caller is in cooldown.
     */
    function claim() external {
        uint256 last = lastClaimed[msg.sender];
        if (last != 0) {
            uint256 availableAt = last + cooldown;
            if (block.timestamp < availableAt) revert CooldownActive(availableAt);
        }

        // Update state before mint (checks-effects-interactions)
        lastClaimed[msg.sender] = block.timestamp;

        // Mint tokens directly to the caller — no pre-funding required
        cUsd.mint(msg.sender, dripAmount);

        emit Claimed(msg.sender, dripAmount);
    }

    // ── View ──────────────────────────────────────────────────────────────────

    /**
     * @notice Unix timestamp (seconds) when `user` may next call claim().
     *         Returns 0 if the user has never claimed (can claim immediately).
     */
    function nextClaimAt(address user) external view returns (uint256) {
        uint256 last = lastClaimed[user];
        if (last == 0) return 0;
        return last + cooldown;
    }

    /** @notice Total cUSD minted so far by this faucet. */
    function faucetBalance() external view returns (uint256) {
        return cUsd.balanceOf(address(this));
    }

    // ── Owner ─────────────────────────────────────────────────────────────────

    /** @notice Change the amount of cUSD dispensed per claim. */
    function setDripAmount(uint256 _amount) external onlyOwner {
        if (_amount == 0) revert ZeroDripAmount();
        dripAmount = _amount;
        emit DripAmountSet(_amount);
    }

    /** @notice Change the per-address cooldown between claims (seconds). */
    function setCooldown(uint256 _cooldown) external onlyOwner {
        cooldown = _cooldown;
        emit CooldownSet(_cooldown);
    }

    /**
     * @notice Withdraw cUSD from the faucet back to `to`.
     *         Useful if the faucet needs to be drained before an upgrade.
     */
    function withdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        bool ok = cUsd.transfer(to, amount);
        require(ok, "cUSD transfer failed");
        emit Withdrawn(to, amount);
    }

    /** @notice Transfer ownership to a new address. */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
