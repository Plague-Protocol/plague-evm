// infection_proof.nr
// Circuit: Proves a player performed a valid infection action
// without revealing who they are
//
// Public inputs:  infector_commitment, current_patient_zero_commitment,
//                 target_address (as Field), nullifier
// Private inputs: infector_role, infector_secret, round_number
//
// Hashes use poseidon2_permutation (Barretenberg BN254 Poseidon2).
// JS equivalent: Barretenberg.poseidon2Permutation([...], Fr.ZERO, Fr.ZERO)[0]

global ROLE_PATIENT_ZERO: Field = 1;
global ROLE_INFECTED: Field = 2;

/// Poseidon2 compression of two field elements.
fn hash2(a: Field, b: Field) -> Field {
    std::hash::poseidon2_permutation([a, b, 0, 0])[0]
}

/// Poseidon2 compression of three field elements.
fn hash3(a: Field, b: Field, c: Field) -> Field {
    std::hash::poseidon2_permutation([a, b, c, 0])[0]
}

fn main(
    // Public
    infector_commitment: pub Field,
    current_patient_zero_commitment: pub Field,
    target_address: pub Field,
    nullifier: pub Field,
    // Private
    infector_role: Field,
    infector_secret: Field,
    round_number: Field,
) {
    // 0. The prover must be the CURRENT patient zero for this round.
    assert(infector_commitment == current_patient_zero_commitment);

    // 1. Infector must be Patient Zero (1) or Infected (2)
    assert((infector_role - 1) * (infector_role - 2) == 0);

    // 2. Verify commitment matches infector role + secret
    let computed_commitment = hash2(infector_role, infector_secret);
    assert(computed_commitment == infector_commitment);

    // 3. Nullifier ties proof to (infector, target, round) - prevents reuse
    let computed_nullifier = hash3(infector_secret, target_address, round_number);
    assert(computed_nullifier == nullifier);
}

// --- Tests --------------------------------------------------------------

#[test]
fn test_patient_zero_can_infect() {
    let infector_secret = 55555;
    let infector_role = ROLE_PATIENT_ZERO;
    let target_address = 123456;
    let round_number = 1;

    let infector_commitment = hash2(infector_role, infector_secret);
    let current_pz_commitment = infector_commitment;
    let nullifier = hash3(infector_secret, target_address, round_number);

    main(
        infector_commitment,
        current_pz_commitment,
        target_address,
        nullifier,
        infector_role,
        infector_secret,
        round_number,
    );
}

#[test]
fn test_infected_can_infect_if_is_current_patient_zero() {
    let infector_secret = 77777;
    let infector_role = ROLE_INFECTED;
    let target_address = 999;
    let round_number = 2;

    let infector_commitment = hash2(infector_role, infector_secret);
    let current_pz_commitment = infector_commitment;
    let nullifier = hash3(infector_secret, target_address, round_number);

    main(
        infector_commitment,
        current_pz_commitment,
        target_address,
        nullifier,
        infector_role,
        infector_secret,
        round_number,
    );
}

#[test(should_fail)]
fn test_only_current_patient_zero_commitment_allowed() {
    let infector_secret = 88888;
    let infector_role = ROLE_PATIENT_ZERO;
    let target_address = 42;
    let round_number = 1;

    let infector_commitment = hash2(infector_role, infector_secret);
    let other_secret = 99999;
    let current_pz_commitment = hash2(ROLE_PATIENT_ZERO, other_secret);
    let nullifier = hash3(infector_secret, target_address, round_number);

    main(
        infector_commitment,
        current_pz_commitment,
        target_address,
        nullifier,
        infector_role,
        infector_secret,
        round_number,
    );
}

#[test(should_fail)]
fn test_wrong_target_rejected_via_nullifier_mismatch() {
    let infector_secret = 2222;
    let infector_role = ROLE_PATIENT_ZERO;
    let target_correct = 100;
    let target_submitted = 101;
    let round_number = 3;

    let infector_commitment = hash2(infector_role, infector_secret);
    let current_pz_commitment = infector_commitment;
    let nullifier = hash3(infector_secret, target_correct, round_number);

    main(
        infector_commitment,
        current_pz_commitment,
        target_submitted,
        nullifier,
        infector_role,
        infector_secret,
        round_number,
    );
}
