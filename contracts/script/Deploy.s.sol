// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PlagueGame} from "../src/PlagueGame.sol";
import {FeeManager}  from "../src/FeeManager.sol";
import {PotEscrow}   from "../src/PotEscrow.sol";
import {ZKVerifier} from "../src/ZKVerifier.sol";
import {RoleCommitmentVerifier} from "../src/RoleCommitmentVerifier.sol";
import {InnocenceProofVerifier} from "../src/InnocenceProofVerifier.sol";

/**
 * @title DeployScript
 * @notice Foundry deployment script for the Plague Protocol on Celo.
 *
 * ── Required env vars ─────────────────────────────────────────────────────────
 *   PRIVATE_KEY        Deployer private key (hex, with 0x prefix)
 *   BACKEND_SIGNER     Address of the off-chain game server wallet
 *   PLATFORM_RECEIVER  Address to receive proof fees + 0.3% pot fees
 *   CUSD_TOKEN         cUSD ERC-20 address for the target network
 *                       Celo Sepolia: 0xae10a9e08d979e7d154d3b0212fb7cbf70fa6bb1
 *                       Mainnet     : 0x765DE816845861e75A25fCA122bb6022DB77Eaca
 *
 * ── Optional env vars ─────────────────────────────────────────────────────────
 *   ZK_VERIFIER_ADDR              If set, uses this IZKVerifier address directly (skip all ZK deployment)
 *   ROLE_COMMITMENT_VERIFIER_ADDR Address of an already-deployed role_commitment Honk verifier
 *   INNOCENCE_PROOF_VERIFIER_ADDR Address of an already-deployed innocence_proof Honk verifier
 *   FEE_MANAGER_ADDR              If set, reuses this FeeManager (must be admin-owned by deployer)
 *                                 and calls setAuthorizedGame(newPlagueGame). Skips FeeManager deploy.
 *   POT_ESCROW_ADDR               If set, reuses this PotEscrow (must be admin-owned by deployer)
 *                                 and calls setAuthorizedGame(newPlagueGame). Skips PotEscrow deploy.
 *
 * ── ZK deployment priority ────────────────────────────────────────────────────
 *   1. ZK_VERIFIER_ADDR set               → use as-is
 *   2. Both VERIFIER_ADDR env vars set     → wrap in ZKVerifier adapter
 *   3. Neither                            → deploy RoleCommitmentVerifier +
 *                                           InnocenceProofVerifier from source,
 *                                           then wrap in ZKVerifier adapter
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
 *   # Celo Sepolia testnet — using existing ZK verifier
 *   forge script contracts/script/Deploy.s.sol \
 *     --rpc-url https://forno.celo-sepolia.celo-testnet.org \
 *     --broadcast
 *
 *   # Mainnet — full ZK from source
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
        //   3. Neither                         → deploy both Honk verifiers from source, then wrap
        address zkVerifierAddr;
        try vm.envAddress("ZK_VERIFIER_ADDR") returns (address existing) {
            zkVerifierAddr = existing;
            console.log("Using existing IZKVerifier:", zkVerifierAddr);
        } catch {
            address roleVerifier;
            address innocenceVerifier;
            bool hasRoleVerifier      = false;
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
                ZKVerifier adapter = new ZKVerifier(roleVerifier, innocenceVerifier);
                zkVerifierAddr = address(adapter);
                console.log("ZKVerifier adapter       :", zkVerifierAddr);
                console.log("  role_commitment verifier :", roleVerifier);
                console.log("  innocence_proof verifier :", innocenceVerifier);
            } else {
                require(
                    block.chainid != 42220,
                    "Refusing to deploy ZK verifiers from source on Celo mainnet without explicit addresses"
                );
                RoleCommitmentVerifier roleV  = new RoleCommitmentVerifier();
                InnocenceProofVerifier innocV = new InnocenceProofVerifier();
                ZKVerifier adapter = new ZKVerifier(address(roleV), address(innocV));
                zkVerifierAddr = address(adapter);
                console.log("RoleCommitmentVerifier   :", address(roleV));
                console.log("InnocenceProofVerifier   :", address(innocV));
                console.log("ZKVerifier adapter       :", zkVerifierAddr);
            }
        }

        // ── PlagueGame ───────────────────────────────────────────────────────────
        PlagueGame game = new PlagueGame();
        game.initialize(deployer, backendSigner, zkVerifierAddr, platformReceiver, cUsdToken);
        console.log("PlagueGame deployed       :", address(game));

        // ── FeeManager ───────────────────────────────────────────────────────────
        address feeManagerAddr;
        try vm.envAddress("FEE_MANAGER_ADDR") returns (address existingFeeManager) {
            FeeManager(existingFeeManager).setAuthorizedGame(address(game));
            feeManagerAddr = existingFeeManager;
            console.log("FeeManager reused         :", feeManagerAddr);
            console.log("  authorizedGame set to    :", address(game));
        } catch {
            FeeManager feeManager = new FeeManager(deployer, address(game), cUsdToken);
            feeManagerAddr = address(feeManager);
            console.log("FeeManager deployed       :", feeManagerAddr);
        }
        game.setFeeManager(feeManagerAddr);

        // ── PotEscrow ────────────────────────────────────────────────────────────
        address potEscrowAddr;
        try vm.envAddress("POT_ESCROW_ADDR") returns (address existingPotEscrow) {
            PotEscrow(existingPotEscrow).setAuthorizedGame(address(game));
            potEscrowAddr = existingPotEscrow;
            console.log("PotEscrow reused          :", potEscrowAddr);
            console.log("  authorizedGame set to    :", address(game));
        } catch {
            PotEscrow potEscrow = new PotEscrow(deployer, address(game), cUsdToken);
            potEscrowAddr = address(potEscrow);
            console.log("PotEscrow deployed        :", potEscrowAddr);
        }
        game.setPotEscrow(potEscrowAddr);

        vm.stopBroadcast();
    }
}
