// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IZKVerifier}   from "./interfaces/IZKVerifier.sol";
import {INoirVerifier} from "./interfaces/INoirVerifier.sol";

/**
 * @title PlagueGameVerifier
 * @notice Production IZKVerifier adapter for PlagueGame.
 *
 *         Wires the two Noir-generated Groth16 verifiers to the single
 *         IZKVerifier interface that PlagueGame.sol expects.
 *
 * ── How to deploy ──────────────────────────────────────────────────────────
 *
 *  1. Compile circuits and generate Solidity verifiers:
 *
 *       cd zk/packages/role_commitment
 *       nargo prove
 *       nargo codegen-verifier          # → Verifier.sol (rename: RoleCommitmentVerifier.sol)
 *
 *       cd ../innocence_proof
 *       nargo prove
 *       nargo codegen-verifier          # → Verifier.sol (rename: InnocenceProofVerifier.sol)
 *
 *  2. Deploy both generated Verifier.sol contracts on your target network.
 *
 *  3. Deploy this contract, passing those two addresses to the constructor.
 *
 *  4. Point PlagueGame at this adapter:
 *       - via ZK_VERIFIER_ADDR env var at deploy time, OR
 *       - via game.setZkVerifier(address(adapter)) after deploy.
 *
 * ── Circuit public input layout ────────────────────────────────────────────
 *
 *  role_commitment.nr
 *    pub[0]  commitment = Poseidon(role, secret)
 *
 *  innocence_proof.nr
 *    pub[0]  commitment = Poseidon(role, secret)
 *    pub[1]  nullifier  = Poseidon(secret, room_id, round_number)
 */
contract PlagueGameVerifier is IZKVerifier {
    INoirVerifier public immutable ROLE_COMMITMENT_VERIFIER;
    INoirVerifier public immutable INNOCENCE_PROOF_VERIFIER;

    error ZeroAddress();

    constructor(
        address _roleCommitmentVerifier,
        address _innocenceProofVerifier
    ) {
        if (_roleCommitmentVerifier  == address(0)) revert ZeroAddress();
        if (_innocenceProofVerifier  == address(0)) revert ZeroAddress();
        ROLE_COMMITMENT_VERIFIER = INoirVerifier(_roleCommitmentVerifier);
        INNOCENCE_PROOF_VERIFIER = INoirVerifier(_innocenceProofVerifier);
    }

    /**
     * @inheritdoc IZKVerifier
     * @dev Packs `commitment` as the sole public input and delegates to the
     *      Noir-generated role_commitment verifier.
     */
    function verifyRoleCommitment(
        bytes32 commitment,
        bytes calldata proof
    ) external view override returns (bool) {
        bytes32[] memory publicInputs = new bytes32[](1);
        publicInputs[0] = commitment;
        return ROLE_COMMITMENT_VERIFIER.verify(proof, publicInputs);
    }

    /**
     * @inheritdoc IZKVerifier
     * @dev Packs `commitment` and `nullifier` as public inputs (in the same
     *      order as `pub` params in innocence_proof.nr main()) and delegates
     *      to the Noir-generated innocence_proof verifier.
     */
    function verifyInnocenceProof(
        bytes32 commitment,
        bytes32 nullifier,
        bytes calldata proof
    ) external view override returns (bool) {
        bytes32[] memory publicInputs = new bytes32[](2);
        publicInputs[0] = commitment;
        publicInputs[1] = nullifier;
        return INNOCENCE_PROOF_VERIFIER.verify(proof, publicInputs);
    }
}
