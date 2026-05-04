// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PlagueGame} from "../src/PlagueGame.sol";
import {ZKVerifier} from "../src/ZKVerifier.sol";
import {StubZKVerifier} from "../src/StubZKVerifier.sol";
import {RoleCommitmentVerifier} from "../src/RoleCommitmentVerifier.sol";
import {InnocenceProofVerifier} from "../src/InnocenceProofVerifier.sol";

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
 *   ZK_VERIFIER_ADDR              If set, uses this IZKVerifier address directly (skip all ZK deployment)
 *   ROLE_COMMITMENT_VERIFIER_ADDR Address of an already-deployed role_commitment Honk verifier
 *   INNOCENCE_PROOF_VERIFIER_ADDR Address of an already-deployed innocence_proof Honk verifier
 *   ZK_BYPASS_ENABLED             Set to "true" to deploy StubZKVerifier (testnet dev only)
 *
 * ── ZK deployment priority ────────────────────────────────────────────────────
 *   1. ZK_VERIFIER_ADDR set                  → use as-is
 *   2. Both VERIFIER_ADDR env vars set        → wrap in ZKVerifier adapter
 *   3. Neither, ZK_BYPASS_ENABLED != "true"  → deploy RoleCommitmentVerifier +
 *                                               InnocenceProofVerifier from source,
 *                                               then wrap in ZKVerifier adapter
 *   4. ZK_BYPASS_ENABLED=true                → deploy StubZKVerifier (dev only)
 *
 * ── Predeployment (for ZK from source) ───────────────────────────────────────
 *   Circuits are compiled and verifier contracts are already generated at:
 *     contracts/src/RoleCommitmentVerifier.sol
 *     contracts/src/InnocenceProofVerifier.sol
 *   Regenerate them any time circuits change:
 *     cd zk && nargo compile
 *     bb write_vk -b target/role_commitment.json -o target/role_commitment_vk --oracle_hash keccak
 *     bb write_solidity_verifier -k target/role_commitment_vk/vk -o ../contracts/src/RoleCommitmentVerifier.sol
 *     bb write_vk -b target/innocence_proof.json -o target/innocence_proof_vk --oracle_hash keccak
 *     bb write_solidity_verifier -k target/innocence_proof_vk/vk -o ../contracts/src/InnocenceProofVerifier.sol
 *     # then rename HonkVerifier → RoleCommitmentVerifier / InnocenceProofVerifier in both files
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *   # Alfajores testnet — full ZK (deploys verifiers from source)
 *   forge script contracts/script/Deploy.s.sol \
 *     --rpc-url https://alfajores-forno.celo-testnet.org \
 *     --broadcast
 *
 *   # Alfajores testnet — bypass ZK (dev shortcut, no real proofs)
 *   ZK_BYPASS_ENABLED=true forge script contracts/script/Deploy.s.sol \
 *     --rpc-url https://alfajores-forno.celo-testnet.org \
 *     --broadcast
 *
 *   # Mainnet — full ZK
 *   forge script contracts/script/Deploy.s.sol \
 *     --rpc-url https://forno.celo.org \
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
                // Noir-generated verifiers that were already deployed.
                ZKVerifier adapter = new ZKVerifier(
                    roleVerifier,
                    innocenceVerifier
                );
                zkVerifierAddr = address(adapter);
                console.log("ZKVerifier adapter       :", zkVerifierAddr);
                console.log("  role_commitment verifier :", roleVerifier);
                console.log("  innocence_proof verifier :", innocenceVerifier);
            } else {
                // Decide: full ZK from source, or bypass stub?
                bool bypassEnabled = false;
                try vm.envBool("ZK_BYPASS_ENABLED") returns (bool b) {
                    bypassEnabled = b;
                } catch {}

                require(
                    !(block.chainid == 42220 && bypassEnabled),
                    "Refusing bypass-enabled verifier on Celo mainnet"
                );

                if (bypassEnabled) {
                    // Option 4: stub (dev/testnet only)
                    StubZKVerifier stub = new StubZKVerifier(true);
                    zkVerifierAddr      = address(stub);
                    console.log("StubZKVerifier (bypass)  :", zkVerifierAddr);
                } else {
                    // Option 3: deploy both Honk verifiers from source, then wrap.
                    RoleCommitmentVerifier roleV = new RoleCommitmentVerifier();
                    InnocenceProofVerifier innocV = new InnocenceProofVerifier();
                    ZKVerifier adapter = new ZKVerifier(address(roleV), address(innocV));
                    zkVerifierAddr = address(adapter);
                    console.log("RoleCommitmentVerifier   :", address(roleV));
                    console.log("InnocenceProofVerifier   :", address(innocV));
                    console.log("ZKVerifier adapter       :", zkVerifierAddr);
                }
            }
        }

        // ── PlagueGame ───────────────────────────────────────────────────────────
        PlagueGame game = new PlagueGame();
        game.initialize(deployer, backendSigner, zkVerifierAddr, platformReceiver, cUsdToken);
        console.log("PlagueGame deployed       :", address(game));

        vm.stopBroadcast();
    }
}
