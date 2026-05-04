// role_commitment.nr
// Circuit: Proves a player committed to a role (patient_zero or clean)
// without revealing which role they have
//
// Public inputs:  commitment = poseidon2_permutation([role, secret, 0, 0])[0]
// Private inputs: role (0 = clean, 1 = patient_zero), secret
//
// JS equivalent: Barretenberg.poseidon2Permutation([Fr(role), Fr(secret), Fr(0), Fr(0)])[0]

// Role constants
global ROLE_CLEAN: Field = 0;
global ROLE_PATIENT_ZERO: Field = 1;

/// Poseidon2 compression of two field elements.
/// Matches: Barretenberg.poseidon2Permutation([a, b, 0, 0])[0] in @aztec/bb.js
fn hash2(a: Field, b: Field) -> Field {
    std::hash::poseidon2_permutation([a, b, 0, 0])[0]
}

fn main(
    // Public
    commitment: pub Field,
    // Private
    role: Field,
    secret: Field,
) {
    // 1. Constrain role to valid values (0 or 1)
    assert(role * (role - 1) == 0);

    // 2. Recompute commitment from private inputs
    let computed_commitment = hash2(role, secret);

    // 3. Assert it matches the public commitment
    assert(computed_commitment == commitment);
}

// --- Tests --------------------------------------------------------------

#[test]
fn test_clean_player_commitment() {
    let secret = 12345;
    let commitment = hash2(ROLE_CLEAN, secret);
    main(commitment, ROLE_CLEAN, secret);
}

#[test]
fn test_patient_zero_commitment() {
    let secret = 67890;
    let commitment = hash2(ROLE_PATIENT_ZERO, secret);
    main(commitment, ROLE_PATIENT_ZERO, secret);
}

#[test(should_fail)]
fn test_invalid_role_rejected() {
    let secret = 42;
    let role = 2;
    let commitment = hash2(role, secret);
    main(commitment, role, secret);
}
