// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IPotEscrow
 * @notice Interface for the PotEscrow contract used by PlagueGame.
 */
interface IPotEscrow {
    // ─── Events ───────────────────────────────────────────────────────────────
    event PotDeposited(uint256 indexed roomId, uint256 amount, uint256 roomBalance);
    event PotReleased(uint256 indexed roomId, address indexed to, uint256 amount);
    event EmergencyWithdrawn(uint256 indexed roomId, address indexed to, uint256 amount);
    event AuthorizedGameUpdated(address indexed oldGame, address indexed newGame);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);

    // ─── Deposit / Release ────────────────────────────────────────────────────
    function deposit(uint256 roomId, uint256 amount) external;
    function release(uint256 roomId, address to, uint256 amount) external;

    // ─── Emergency ────────────────────────────────────────────────────────────
    function emergencyWithdraw(uint256 roomId, address to) external;

    // ─── View ─────────────────────────────────────────────────────────────────
    function roomBalance(uint256 roomId) external view returns (uint256);
    function totalHeld() external view returns (uint256);
    function totalDeposited() external view returns (uint256);
    function totalReleased() external view returns (uint256);

    // ─── Admin Config ─────────────────────────────────────────────────────────
    function setAuthorizedGame(address newGame) external;
    function transferAdmin(address newAdmin) external;
}
