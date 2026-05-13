// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IFeeManager
 * @notice Interface for the FeeManager contract used by PlagueGame.
 */
interface IFeeManager {
    // ─── Events ───────────────────────────────────────────────────────────────
    event FeeDeposited(address indexed from, uint256 amount, uint256 balance);
    event FeeWithdrawn(address indexed to, uint256 amount);
    event AuthorizedGameUpdated(address indexed oldGame, address indexed newGame);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);

    // ─── Deposit ──────────────────────────────────────────────────────────────
    function depositFee(uint256 amount) external;

    // ─── Withdrawal ───────────────────────────────────────────────────────────
    function withdraw(address recipient, uint256 amount) external;
    function withdrawAll(address recipient) external;

    // ─── View ─────────────────────────────────────────────────────────────────
    function balance() external view returns (uint256);
    function totalDeposited() external view returns (uint256);
    function totalWithdrawn() external view returns (uint256);

    // ─── Admin Config ─────────────────────────────────────────────────────────
    function setAuthorizedGame(address newGame) external;
    function transferAdmin(address newAdmin) external;
}
