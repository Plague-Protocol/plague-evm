// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {RoleCommitmentVerifier} from "../src/RoleCommitmentVerifier.sol";
import {InnocenceProofVerifier} from "../src/InnocenceProofVerifier.sol";
import {ZKVerifier} from "../src/ZKVerifier.sol";

contract DeployVerifiers is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        RoleCommitmentVerifier roleV  = new RoleCommitmentVerifier();
        InnocenceProofVerifier innocV = new InnocenceProofVerifier();
        ZKVerifier adapter = new ZKVerifier(address(roleV), address(innocV));

        vm.stopBroadcast();

        console.log("ROLE_COMMITMENT_VERIFIER_ADDR=%s", address(roleV));
        console.log("INNOCENCE_PROOF_VERIFIER_ADDR=%s", address(innocV));
        console.log("ZK_VERIFIER_ADDR=%s",              address(adapter));
    }
}
