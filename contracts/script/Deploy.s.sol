// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/PlagueGame.sol";
import "../src/ZKVerifier.sol";

/**
 * @title DeployScript
 * @notice Foundry deployment script for the Plague Protocol on Celo.
 *
 * ── Required env vars ─────────────────────────────────────────────────────────
 *   PRIVATE_KEY       Deployer private key (hex, no 0x prefix)
 *   BACKEND_SIGNER    Address of the off-chain game server wallet
 *
 * ── Optional env vars ─────────────────────────────────────────────────────────
 *   ZK_VERIFIER_ADDR  If set, uses an existing verifier instead of deploying stub
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *   # Alfajores testnet (bypass ZK for dev)
 *   forge script contracts/script/Deploy.s.sol \
 *     --rpc-url celo_testnet \
 *     --broadcast \
 *     --verify
 *
 *   # Mainnet (set ZK_VERIFIER_ADDR to the Noir-generated verifier first)
 *   forge script contracts/script/Deploy.s.sol \
 *     --rpc-url celo_mainnet \
 *     --broadcast \
 *     --verify
 */
contract DeployScript is Script {
    function run() external {
        uint256 deployerKey   = vm.envUint("PRIVATE_KEY");
        address backendSigner = vm.envAddress("BACKEND_SIGNER");

        // Deployer address derived from the key
        address deployer = vm.addr(deployerKey);
        console.log("Deployer       :", deployer);
        console.log("Backend signer :", backendSigner);

        vm.startBroadcast(deployerKey);

        // ── ZK Verifier ──────────────────────────────────────────────────────────
        // Use an existing verifier address if provided (e.g. Noir-generated Groth16
        // verifier on mainnet). Otherwise deploy the dev stub with bypass enabled.
        address zkVerifierAddr;
        try vm.envAddress("ZK_VERIFIER_ADDR") returns (address existing) {
            zkVerifierAddr = existing;
            console.log("Using existing ZKVerifier :", zkVerifierAddr);
        } catch {
            ZKVerifier stub = new ZKVerifier(true /* bypassEnabled for dev */);
            zkVerifierAddr  = address(stub);
            console.log("ZKVerifier stub deployed  :", zkVerifierAddr);
        }

        // ── PlagueGame ───────────────────────────────────────────────────────────
        PlagueGame game = new PlagueGame();
        game.initialize(deployer, backendSigner, zkVerifierAddr);
        console.log("PlagueGame deployed       :", address(game));

        vm.stopBroadcast();
    }
}
