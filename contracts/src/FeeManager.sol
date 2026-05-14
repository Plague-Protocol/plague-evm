// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20}      from "./interfaces/IERC20.sol";
import {IFeeManager} from "./interfaces/IFeeManager.sol";

/**
 * @title FeeManager
 * @notice Manages platform fee collection and withdrawal for the Plague Protocol.
 *
 *         PlagueGame transfers cUSD fee tokens directly here instead of holding
 *         them internally, giving a clean separation of concerns:
 *           - PlagueGame handles game logic and pot escrow.
 *           - FeeManager handles platform revenue independently.
 *
 *         Fee sources:
 *           - Proof fees (per-activation beyond the free one) forwarded by PlagueGame.
 *           - 1.5% of each game pot forwarded by PlagueGame at game end.
 *
 * ── Access control ────────────────────────────────────────────────────────────────
 *   admin          : can withdraw fees, update settings, transfer ownership.
 *   authorizedGame : the PlagueGame contract address; allowed to call depositFee().
 */
contract FeeManager is IFeeManager {
    address public admin;
    address public authorizedGame;
    IERC20  public cUsdToken;

    uint256 public totalDeposited;
    uint256 public totalWithdrawn;

    bool private _entered;

    // ─── Errors ───────────────────────────────────────────────────────────────────
    error Unauthorized();
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientBalance();
    error TransferFailed();
    error Reentrancy();

    // ─── Modifiers ────────────────────────────────────────────────────────────────
    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyAuthorized() {
        if (msg.sender != authorizedGame && msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────────

    /**
     * @param _admin          Address with admin privileges (withdrawal, config).
     * @param _authorizedGame PlagueGame contract address allowed to deposit fees.
     * @param _cUsdToken      cUSD ERC-20 address for the target network.
     */
    constructor(address _admin, address _authorizedGame, address _cUsdToken) {
        if (_admin          == address(0)) revert ZeroAddress();
        if (_authorizedGame == address(0)) revert ZeroAddress();
        if (_cUsdToken      == address(0)) revert ZeroAddress();
        admin          = _admin;
        authorizedGame = _authorizedGame;
        cUsdToken      = IERC20(_cUsdToken);
    }

    // ─── Fee Deposit ──────────────────────────────────────────────────────────────

    /**
     * @notice Accept a fee deposit from the authorized PlagueGame contract.
     *         PlagueGame must transfer `amount` cUSD to this contract BEFORE calling
     *         this function (or in the same tx via a direct transfer + this call).
     *         Alternatively, PlagueGame may call depositFee() and this contract will
     *         pull the tokens via transferFrom — the caller must have approved this
     *         contract for at least `amount`.
     * @param amount Amount of cUSD (wei) being deposited as platform fee.
     */
    function depositFee(uint256 amount) external onlyAuthorized nonReentrant {
        if (amount == 0) revert ZeroAmount();
        bool ok = cUsdToken.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();
        totalDeposited += amount;
        emit FeeDeposited(msg.sender, amount, cUsdToken.balanceOf(address(this)));
    }

    // ─── Withdrawal ───────────────────────────────────────────────────────────────

    /**
     * @notice Withdraw accumulated fees to `recipient`. Admin only.
     * @param recipient Destination address for the cUSD transfer.
     * @param amount    Amount to withdraw; reverts if it exceeds the contract balance.
     */
    function withdraw(address recipient, uint256 amount) external onlyAdmin nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 bal = cUsdToken.balanceOf(address(this));
        if (amount > bal) revert InsufficientBalance();
        totalWithdrawn += amount;
        bool ok = cUsdToken.transfer(recipient, amount);
        if (!ok) revert TransferFailed();
        emit FeeWithdrawn(recipient, amount);
    }

    /**
     * @notice Withdraw ALL accumulated fees to `recipient`. Admin only.
     */
    function withdrawAll(address recipient) external onlyAdmin nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        uint256 bal = cUsdToken.balanceOf(address(this));
        if (bal == 0) revert ZeroAmount();
        totalWithdrawn += bal;
        bool ok = cUsdToken.transfer(recipient, bal);
        if (!ok) revert TransferFailed();
        emit FeeWithdrawn(recipient, bal);
    }

    // ─── View ─────────────────────────────────────────────────────────────────────

    /** @notice Current cUSD balance held by this contract (available to withdraw). */
    function balance() external view returns (uint256) {
        return cUsdToken.balanceOf(address(this));
    }

    // ─── Admin Config ─────────────────────────────────────────────────────────────

    /**
     * @notice Update the PlagueGame contract address permitted to deposit fees.
     *         Use when upgrading PlagueGame to a new deployment.
     */
    function setAuthorizedGame(address newGame) external onlyAdmin {
        if (newGame == address(0)) revert ZeroAddress();
        emit AuthorizedGameUpdated(authorizedGame, newGame);
        authorizedGame = newGame;
    }

    /**
     * @notice Transfer admin ownership to a new address.
     *         Two-step transfer is recommended: set newAdmin first, then confirm
     *         from the new address by calling acceptAdmin() (not implemented here
     *         for simplicity — add if needed for production).
     */
    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }
}
