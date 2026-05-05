// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockCUSD
 * @notice Testnet-only mintable ERC-20 that stands in for the real cUSD token.
 *         The designated minter (FaucetCUSD) calls mint() to create tokens on
 *         demand — no pre-funding required.
 *
 * ── DO NOT DEPLOY ON MAINNET ──────────────────────────────────────────────────
 */
contract MockCUSD {
    string  public constant name     = "Celo Dollar";
    string  public constant symbol   = "cUSD";
    uint8   public constant decimals = 18;

    address public owner;
    address public minter;

    uint256 private _totalSupply;
    mapping(address => uint256)                     private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    // ── Events ────────────────────────────────────────────────────────────────
    event Transfer(address indexed from,    address indexed to,      uint256 value);
    event Approval(address indexed owner_,  address indexed spender, uint256 value);
    event MinterSet(address indexed newMinter);

    // ── Errors ────────────────────────────────────────────────────────────────
    error NotOwner();
    error NotMinter();
    error ZeroAddress();

    constructor() {
        owner  = msg.sender;
        minter = msg.sender;
    }

    // ── Owner ─────────────────────────────────────────────────────────────────

    /**
     * @notice Assign a new minter address (typically FaucetCUSD).
     *         Only the owner may call this.
     */
    function setMinter(address _minter) external {
        if (msg.sender != owner) revert NotOwner();
        if (_minter == address(0)) revert ZeroAddress();
        minter = _minter;
        emit MinterSet(_minter);
    }

    // ── Minter ────────────────────────────────────────────────────────────────

    /**
     * @notice Mint `amount` tokens directly to `to`.
     *         Only callable by the designated minter (FaucetCUSD).
     */
    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        if (to == address(0)) revert ZeroAddress();
        _totalSupply   += amount;
        _balances[to]  += amount;
        emit Transfer(address(0), to, amount);
    }

    // ── ERC-20 ────────────────────────────────────────────────────────────────

    function totalSupply() external view returns (uint256) { return _totalSupply; }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function allowance(address owner_, address spender) external view returns (uint256) {
        return _allowances[owner_][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = _allowances[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "ERC20: insufficient allowance");
            _allowances[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    function _transfer(address from, address to, uint256 amount) internal {
        require(_balances[from] >= amount, "ERC20: insufficient balance");
        _balances[from] -= amount;
        _balances[to]   += amount;
        emit Transfer(from, to, amount);
    }
}
