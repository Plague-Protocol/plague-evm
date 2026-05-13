// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20}     from "./interfaces/IERC20.sol";
import {IPotEscrow} from "./interfaces/IPotEscrow.sol";

/**
 * @title PotEscrow
 * @notice Holds player stakes for each game room in isolation from PlagueGame logic.
 *
 *         Separating custody from game logic limits blast radius if PlagueGame ever
 *         has a vulnerability: player funds sit in a contract with a much smaller and
 *         simpler attack surface.
 *
 * ── Flow ──────────────────────────────────────────────────────────────────────────
 *   1. Player approves PlagueGame for stakeAmount.
 *   2. PlagueGame calls _safeTransferFrom(player → PlagueGame), then immediately:
 *        cUsdToken.approve(address(potEscrow), amount)
 *        potEscrow.deposit(roomId, amount)
 *      which moves tokens from PlagueGame → PotEscrow and records the room balance.
 *   3. At game end / refund, PlagueGame calls potEscrow.release(roomId, winner, share).
 *
 * ── Access control ────────────────────────────────────────────────────────────────
 *   admin          : can emergency-withdraw, update settings, transfer ownership.
 *   authorizedGame : the PlagueGame contract; allowed to call deposit() and release().
 */
contract PotEscrow is IPotEscrow {
    address public admin;
    address public authorizedGame;
    IERC20  public cUsdToken;

    mapping(uint256 roomId => uint256 balance) private _roomBal;

    uint256 public totalDeposited;
    uint256 public totalReleased;

    bool private _entered;

    // ─── Errors ───────────────────────────────────────────────────────────────────
    error Unauthorized();
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientRoomBalance();
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
     * @param _admin          Address with admin privileges (emergency withdraw, config).
     * @param _authorizedGame PlagueGame contract address allowed to deposit/release.
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

    // ─── Deposit ──────────────────────────────────────────────────────────────────

    /**
     * @notice Deposit player stake into escrow for a specific room.
     *         PlagueGame must approve this contract for `amount` before calling.
     * @param roomId Room the tokens belong to.
     * @param amount Amount of cUSD (wei) to deposit.
     */
    function deposit(uint256 roomId, uint256 amount) external onlyAuthorized nonReentrant {
        if (amount == 0) revert ZeroAmount();
        bool ok = cUsdToken.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();
        _roomBal[roomId] += amount;
        totalDeposited   += amount;
        emit PotDeposited(roomId, amount, _roomBal[roomId]);
    }

    // ─── Release ──────────────────────────────────────────────────────────────────

    /**
     * @notice Release pot funds to a recipient (winner payout or refund).
     *         Only callable by the authorized PlagueGame contract.
     * @param roomId Room the tokens belong to.
     * @param to     Recipient address.
     * @param amount Amount of cUSD (wei) to release.
     */
    function release(uint256 roomId, address to, uint256 amount) external onlyAuthorized nonReentrant {
        if (to     == address(0)) revert ZeroAddress();
        if (amount == 0)          revert ZeroAmount();
        if (_roomBal[roomId] < amount) revert InsufficientRoomBalance();
        _roomBal[roomId] -= amount;
        totalReleased    += amount;
        bool ok = cUsdToken.transfer(to, amount);
        if (!ok) revert TransferFailed();
        emit PotReleased(roomId, to, amount);
    }

    // ─── Emergency ────────────────────────────────────────────────────────────────

    /**
     * @notice Safety valve: admin can recover stuck funds for a specific room.
     *         Use only if PlagueGame can no longer call release() (e.g. after an upgrade).
     */
    function emergencyWithdraw(uint256 roomId, address to) external onlyAdmin nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = _roomBal[roomId];
        if (bal == 0) revert ZeroAmount();
        _roomBal[roomId] = 0;
        totalReleased   += bal;
        bool ok = cUsdToken.transfer(to, bal);
        if (!ok) revert TransferFailed();
        emit EmergencyWithdrawn(roomId, to, bal);
    }

    // ─── View ─────────────────────────────────────────────────────────────────────

    /** @notice cUSD currently held in escrow for a specific room. */
    function roomBalance(uint256 roomId) external view returns (uint256) {
        return _roomBal[roomId];
    }

    /** @notice Total cUSD currently held across all rooms. */
    function totalHeld() external view returns (uint256) {
        return cUsdToken.balanceOf(address(this));
    }

    // ─── Admin Config ─────────────────────────────────────────────────────────────

    /**
     * @notice Update the PlagueGame contract address permitted to deposit/release.
     *         Use when upgrading PlagueGame to a new deployment.
     */
    function setAuthorizedGame(address newGame) external onlyAdmin {
        if (newGame == address(0)) revert ZeroAddress();
        emit AuthorizedGameUpdated(authorizedGame, newGame);
        authorizedGame = newGame;
    }

    /**
     * @notice Transfer admin ownership to a new address.
     */
    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }
}
