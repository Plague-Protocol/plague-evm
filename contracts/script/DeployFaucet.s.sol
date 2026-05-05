// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockCUSD}    from "../src/MockCUSD.sol";
import {FaucetCUSD}  from "../src/FaucetCUSD.sol";

/**
 * @title DeployFaucetScript
 * @notice Deploys MockCUSD (mintable test token) + FaucetCUSD for Celo Sepolia.
 *
 *  MockCUSD replaces the real cUSD entirely on testnet.  The FaucetCUSD is
 *  granted the sole minter role and mints fresh tokens whenever claim() is called
 *  — no pre-funding required.
 *
 * ── DO NOT RUN ON MAINNET ──────────────────────────────────────────────────────
 *
 * ── Required env vars ─────────────────────────────────────────────────────────
 *   PRIVATE_KEY   Deployer private key (hex, no 0x prefix)
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *   forge script contracts/script/DeployFaucet.s.sol \
 *     --rpc-url celo_testnet \
 *     --broadcast
 *
 *   After deploying:
 *     1. Set CUSD_TOKEN=<MockCUSD address> in .env
 *     2. Redeploy PlagueGame: forge script contracts/script/Deploy.s.sol --rpc-url celo_testnet --broadcast
 *     3. Update NEXT_PUBLIC_FAUCET_ADDRESS + NEXT_PUBLIC_CONTRACT_ADDRESS in frontend/.env.local
 */
contract DeployFaucetScript is Script {
    function run() external {
        require(
            block.chainid == 11142220,
            unicode"FaucetCUSD is testnet-only — refusing to deploy on this chain"
        );

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        console.log("Deployer         :", deployer);
        console.log("Chain ID         :", block.chainid);

        vm.startBroadcast(deployerKey);

        // 1. Deploy the mintable mock token
        MockCUSD mockCUSD = new MockCUSD();
        console.log("MockCUSD         :", address(mockCUSD));

        // 2. Deploy the faucet, passing MockCUSD as the token it distributes
        FaucetCUSD faucet = new FaucetCUSD(address(mockCUSD));
        console.log("FaucetCUSD       :", address(faucet));

        // 3. Grant FaucetCUSD the exclusive minter role on MockCUSD
        mockCUSD.setMinter(address(faucet));
        console.log("Minter set to FaucetCUSD");

        console.log("");
        console.log("Drip amount      : 50 cUSD");
        console.log("Cooldown         : 24 hours");
        console.log("");
        console.log("=== NEXT STEPS ===");
        console.log("1. Copy MockCUSD address above -> set CUSD_TOKEN=<address> in .env");
        console.log("2. Redeploy PlagueGame:");
        console.log("   forge script contracts/script/Deploy.s.sol --rpc-url celo_testnet --broadcast");
        console.log("3. Update frontend/.env.local:");
        console.log("   NEXT_PUBLIC_FAUCET_ADDRESS=<FaucetCUSD address>");
        console.log("   NEXT_PUBLIC_CONTRACT_ADDRESS=<new PlagueGame address>");

        vm.stopBroadcast();
    }
}
