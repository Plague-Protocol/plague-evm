// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IZKVerifier} from "./interfaces/IZKVerifier.sol";

/**
 * @title StubZKVerifier
 * @notice Development-only stub that accepts all proofs.
 *
 *         ⚠️  NEVER deploy with bypassEnabled = true to a production network.
 *
 *         Replace this contract with the Noir-generated Groth16 Verifier.sol
 *         before mainnet deployment, then call `setBypass(false)` or simply
 *         do not deploy this stub at all.
 */
contract StubZKVerifier is IZKVerifier {
    /// @notice When true all proofs are accepted unconditionally (dev/test only).
    bool public bypassEnabled;

    address public owner;

    event BypassSet(bool enabled);

    constructor(bool _bypassEnabled) {
        owner          = msg.sender;
        bypassEnabled  = _bypassEnabled;
    }

    function setBypass(bool enabled) external {
        require(msg.sender == owner, "StubZKVerifier: not owner");
        bypassEnabled = enabled;
        emit BypassSet(enabled);
    }

    function verifyRoleCommitment(
        bytes32, /*commitment*/
        bytes calldata /*proof*/
    ) external view override returns (bool) {
        return bypassEnabled;
    }

    function verifyInnocenceProof(
        bytes32, /*commitment*/
        bytes32, /*nullifier*/
        bytes calldata /*proof*/
    ) external view override returns (bool) {
        return bypassEnabled;
    }
}
