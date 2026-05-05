// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC20Faucet
 * @notice Minimal ERC-20 surface needed by FaucetCUSD.
 */
interface IERC20Faucet {
    function mint(address to, uint256 amount) external;
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
