// innocence_proof.nr
// Circuit: Proves a player is clean (not infected, not patient_zero)
// without revealing their secret or role.
//
// Public inputs:
//   commitment   -- poseidon2_permutation([role, secret, 0, 0])[0]
//   nullifier    -- poseidon2_permutation([secret, room_id, round_number, 0])[0]
//
// Private inputs:
//   role         -- must equal ROLE_CLEAN (0); infected players CANNOT prove
//   secret       -- player's private salt
//   room_id      -- binds proof to specific room
//   round_number -- binds proof to specific round (no cross-round replay)

global ROLE_CLEAN: Field = 0;

/// Poseidon2 compression of two field elements.
/// Matches: Barretenberg.poseidon2Permutation([a, b, 0, 0])[0] in @aztec/bb.js
fn hash2(a: Field, b: Field) -> Field {
    std::hash::poseidon2_permutation([a, b, 0, 0])[0]
}

/// Poseidon2 compression of three field elements.
/// Matches: Barretenberg.poseidon2Permutation([a, b, c, 0])[0] in @aztec/bb.js
fn hash3(a: Field, b: Field, c: Field) -> Field {
    std::hash::poseidon2_permutation([a, b, c, 0])[0]
}

fn main(
    // Public
    commitment:    pub Field,
    nullifier:     pub Field,
    // Private
    role:          Field,
    secret:        Field,
    room_id:       Field,
    round_number:  Field,
) {
    // 1. Constrain role to valid values (boolean: 0 = clean, 1 = patient_zero)
    assert(role * (role - 1) == 0);

    // 2. Prove role is CLEAN -- infected players fail here
    assert(role == ROLE_CLEAN);

    // 3. Verify commitment matches player's on-chain registration
    let computed_commitment = hash2(role, secret);
    assert(computed_commitment == commitment);

    // 4. Verify nullifier is correctly bound to (secret, room_id, round_number)
    //    This prevents:
    //      - reusing the same proof across rounds
    //      - submitting proofs in rooms the player isn't in
    //      - submitting more than one proof per player per round
    let computed_nullifier = hash3(secret, room_id, round_number);
    assert(computed_nullifier == nullifier);
}

// --- Tests --------------------------------------------------------------

#[test]
fn test_clean_player_proof() {
    let secret = 99999;
    let room_id = 1;
    let round = 2;
    let commitment = hash2(ROLE_CLEAN, secret);
    let nullifier  = hash3(secret, room_id, round);
    main(commitment, nullifier, ROLE_CLEAN, secret, room_id, round);
}

#[test(should_fail)]
fn test_infected_player_cannot_prove() {
    let secret = 11111;
    let room_id = 1;
    let round = 1;
    let role = 1;
    let commitment = hash2(role, secret);
    let nullifier  = hash3(secret, room_id, round);
    main(commitment, nullifier, role, secret, room_id, round);
}

#[test(should_fail)]
fn test_wrong_round_rejected() {
    let secret = 22222;
    let room_id = 1;
    let round_correct = 2;
    let round_submitted = 3;
    let commitment = hash2(ROLE_CLEAN, secret);
    let nullifier  = hash3(secret, room_id, round_correct);
    main(commitment, nullifier, ROLE_CLEAN, secret, room_id, round_submitted);
}

#[test(should_fail)]
fn test_wrong_room_rejected() {
    let secret = 33333;
    let room_correct = 1;
    let room_submitted = 2;
    let round = 1;
    let commitment = hash2(ROLE_CLEAN, secret);
    let nullifier  = hash3(secret, room_correct, round);
    main(commitment, nullifier, ROLE_CLEAN, secret, room_submitted, round);
}
