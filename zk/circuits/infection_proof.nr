// infection_proof.nr
// Circuit: Proves a player performed a valid infection action
// without revealing who they are
//
// Public inputs:  infector_commitment, target_address (as Field), nullifier
// Private inputs: infector_role, infector_secret, round_number
//
// TODO: Issue #31 - Complete and test this circuit

use dep::std::hash::poseidon;

global ROLE_PATIENT_ZERO: Field = 1;
global ROLE_INFECTED: Field = 2;

fn main(
    // Public
    infector_commitment: pub Field,
    target_address: pub Field,
    nullifier: pub Field,
    // Private
    infector_role: Field,
    infector_secret: Field,
    round_number: Field,
) {
    // 1. Infector must be Patient Zero (1) or Infected (2)
    assert((infector_role - 1) * (infector_role - 2) == 0);

    // 2. Verify commitment matches infector role + secret
    let computed_commitment = poseidon::bn254::hash_2([infector_role, infector_secret]);
    assert(computed_commitment == infector_commitment);

    // 3. Nullifier ties proof to (infector, target, round) — prevents reuse
    let computed_nullifier = poseidon::bn254::hash_3([infector_secret, target_address, round_number]);
    assert(computed_nullifier == nullifier);
}
