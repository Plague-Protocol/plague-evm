// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FaucetCUSD} from "../src/FaucetCUSD.sol";

/**
 * @title DeployFaucetScript
 * @notice Deploys the FaucetCUSD contract for Alfajores testnet.
 *
 * ── DO NOT RUN ON MAINNET ──────────────────────────────────────────────────────
 *
 * ── Required env vars ─────────────────────────────────────────────────────────
 *   PRIVATE_KEY   Deployer private key (hex, no 0x prefix)
 *   CUSD_TOKEN    cUSD address — Alfajores: 0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *   forge script contracts/script/DeployFaucet.s.sol \
 *     --rpc-url celo_testnet \
 *     --broadcast
 *
 *   After deploying, transfer cUSD to the printed faucet address to fund it.
 *   Then set NEXT_PUBLIC_FAUCET_ADDRESS in the frontend .env.local.
 */
contract DeployFaucetScript is Script {
    function run() external {
        require(
            block.chainid == 44787,
            unicode"FaucetCUSD is testnet-only — refusing to deploy on this chain"
        );

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address cUsdToken   = vm.envAddress("CUSD_TOKEN");

        address deployer = vm.addr(deployerKey);
        console.log("Deployer         :", deployer);
        console.log("cUSD token       :", cUsdToken);
        console.log("Chain ID         :", block.chainid);

        vm.startBroadcast(deployerKey);

        FaucetCUSD faucet = new FaucetCUSD(cUsdToken);
        console.log("FaucetCUSD       :", address(faucet));
        console.log("Drip amount      : 50 cUSD");
        console.log("Cooldown         : 24 hours");
        console.log("");
        console.log("Next steps:");
        console.log("  1. Transfer cUSD to the faucet address above to fund it.");
        console.log("  2. Set NEXT_PUBLIC_FAUCET_ADDRESS in frontend/.env.local");

        vm.stopBroadcast();
    }
}
