// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PlagueGame} from "../src/PlagueGame.sol";
import {ZKVerifier} from "../src/ZKVerifier.sol";
import {StubZKVerifier} from "../src/StubZKVerifier.sol";

/**
 * @title DeployScript
 * @notice Foundry deployment script for the Plague Protocol on Celo.
 *
 * ── Required env vars ─────────────────────────────────────────────────────────
 *   PRIVATE_KEY        Deployer private key (hex, no 0x prefix)
 *   BACKEND_SIGNER     Address of the off-chain game server wallet
 *   PLATFORM_RECEIVER  Address to receive proof fees + 0.3% pot fees
 *   CUSD_TOKEN         cUSD ERC-20 address for the target network
 *                       Alfajores: 0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1
 *                       Mainnet  : 0x765DE816845861e75A25fCA122bb6022DB77Eaca
 *
 * ── Optional env vars ─────────────────────────────────────────────────────────
 *   ZK_VERIFIER_ADDR              If set, uses this IZKVerifier address directly (skip deployment)
 *   ROLE_COMMITMENT_VERIFIER_ADDR Address of the Noir-generated role_commitment verifier
 *   INNOCENCE_PROOF_VERIFIER_ADDR Address of the Noir-generated innocence_proof verifier
 *   ZK_BYPASS_ENABLED             If both verifier addrs are absent, deploy StubZKVerifier
 *
 * ── Predeployment (required for production ZK) ───────────────────────────────
 *   1. Generate Noir Groth16 verifier contracts from circuits:
 *        cd zk/packages/role_commitment && nargo prove && nargo codegen-verifier
 *        cd ../innocence_proof       && nargo prove && nargo codegen-verifier
 *   2. Deploy both generated verifier contracts on target network.
 *   3. Export deployed addresses as ROLE_COMMITMENT_VERIFIER_ADDR and
 *      INNOCENCE_PROOF_VERIFIER_ADDR.
 *   4. Run this script: it deploys ZKVerifier (adapter) and wires PlagueGame.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *   # Alfajores testnet (bypass ZK for dev)
 *   forge script contracts/script/Deploy.s.sol \
 *     --rpc-url celo_testnet \
 *     --broadcast \
 *     --verify
 *
 *   # Mainnet (recommended): set ROLE_COMMITMENT_VERIFIER_ADDR and
 *   # INNOCENCE_PROOF_VERIFIER_ADDR so this script deploys ZKVerifier adapter.
 *   forge script contracts/script/Deploy.s.sol \
 *     --rpc-url celo_mainnet \
 *     --broadcast \
 *     --verify
 */
contract DeployScript is Script {
    function run() external {
        uint256 deployerKey      = vm.envUint("PRIVATE_KEY");
        address backendSigner    = vm.envAddress("BACKEND_SIGNER");
        address platformReceiver = vm.envAddress("PLATFORM_RECEIVER");
        address cUsdToken        = vm.envAddress("CUSD_TOKEN");

        // Deployer address derived from the key
        address deployer = vm.addr(deployerKey);
        console.log("Deployer           :", deployer);
        console.log("Backend signer     :", backendSigner);
        console.log("Platform receiver  :", platformReceiver);
        console.log("cUSD token         :", cUsdToken);

        vm.startBroadcast(deployerKey);

        // ── ZK Verifier ──────────────────────────────────────────────────────────
        // Priority order:
        //   1. ZK_VERIFIER_ADDR set            → use it directly
        //   2. Both Noir verifier addrs set    → deploy ZKVerifier adapter
        //   3. Neither                         → deploy dev bypass stub
        address zkVerifierAddr;
        try vm.envAddress("ZK_VERIFIER_ADDR") returns (address existing) {
            // Option 1: caller already has a fully deployed adapter.
            zkVerifierAddr = existing;
            console.log("Using existing IZKVerifier:", zkVerifierAddr);
        } catch {
            address roleVerifier;
            address innocenceVerifier;
            bool hasRoleVerifier     = false;
            bool hasInnocenceVerifier = false;

            try vm.envAddress("ROLE_COMMITMENT_VERIFIER_ADDR") returns (address a) {
                roleVerifier     = a;
                hasRoleVerifier  = true;
            } catch {}

            try vm.envAddress("INNOCENCE_PROOF_VERIFIER_ADDR") returns (address a) {
                innocenceVerifier     = a;
                hasInnocenceVerifier  = true;
            } catch {}

            if (hasRoleVerifier && hasInnocenceVerifier) {
                // Option 2: deploy the production adapter pointing at the two
                // Noir-generated verifiers.
                ZKVerifier adapter = new ZKVerifier(
                    roleVerifier,
                    innocenceVerifier
                );
                zkVerifierAddr = address(adapter);
                console.log("ZKVerifier adapter       :", zkVerifierAddr);
                console.log("  role_commitment verifier :", roleVerifier);
                console.log("  innocence_proof verifier :", innocenceVerifier);
            } else {
                // Option 3: fall back to the bypass stub (dev/local only).
                bool bypassEnabled = false;
                try vm.envBool("ZK_BYPASS_ENABLED") returns (bool configuredBypass) {
                    bypassEnabled = configuredBypass;
                } catch {}

                require(
                    !(block.chainid == 42220 && bypassEnabled),
                    "Refusing bypass-enabled verifier on Celo mainnet"
                );

                StubZKVerifier stub = new StubZKVerifier(bypassEnabled);
                zkVerifierAddr      = address(stub);
                console.log("StubZKVerifier deployed  :", zkVerifierAddr);
                console.log("ZK bypass enabled         :", bypassEnabled);
            }
        }

        // ── PlagueGame ───────────────────────────────────────────────────────────
        PlagueGame game = new PlagueGame();
        game.initialize(deployer, backendSigner, zkVerifierAddr, platformReceiver, cUsdToken);
        console.log("PlagueGame deployed       :", address(game));

        vm.stopBroadcast();
    }
}
