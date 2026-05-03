// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title INoirVerifier
 * @notice Minimal interface matching the Solidity contract produced by
 *         `nargo codegen-verifier` (Barretenberg Groth16 / UltraHonk backend).
 *
 *         Every generated verifier exposes exactly one function:
 *           verify(proof, publicInputs) → bool
 *
 *         Public inputs are passed as a flat bytes32[] where each element
 *         is a single Noir `Field` value, left-padded to 32 bytes, in the
 *         same order they appear as `pub` parameters in the circuit's main().
 */
interface INoirVerifier {
    function verify(
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external view returns (bool);
}
