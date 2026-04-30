// role_commitment.nr
// Circuit: Proves a player committed to a role (patient_zero or clean)
// without revealing which role they have
//
// Public inputs:  commitment (Poseidon hash of role + secret)
// Private inputs: role (0 = clean, 1 = patient_zero), secret
//
// TODO: Issue #35 - Implement and test this circuit

use dep::std::hash::poseidon;

// Role constants
global ROLE_CLEAN: Field = 0;
global ROLE_PATIENT_ZERO: Field = 1;

fn main(
    // Public
    commitment: pub Field,
    // Private
    role: Field,
    secret: Field,
) {
    // 1. Constrain role to valid values (0 or 1)
    // role * (role - 1) == 0  ←  role is boolean
    assert(role * (role - 1) == 0);

    // 2. Recompute commitment from private inputs
    let computed_commitment = poseidon::bn254::hash_2([role, secret]);

    // 3. Assert it matches the public commitment
    assert(computed_commitment == commitment);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

#[test]
fn test_clean_player_commitment() {
    // TODO: Issue #35
    // let secret = 12345;
    // let commitment = poseidon::bn254::hash_2([ROLE_CLEAN, secret]);
    // main(commitment, ROLE_CLEAN, secret);
}

#[test]
fn test_patient_zero_commitment() {
    // TODO: Issue #35
}

#[test(should_fail)]
fn test_invalid_role_rejected() {
    // role = 2 should fail the boolean constraint
    // TODO: Issue #35
}
