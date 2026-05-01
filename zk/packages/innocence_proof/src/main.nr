// innocence_proof.nr
// Circuit: Proves a player is clean (not infected, not patient_zero)
// without revealing their secret or role.
//
// Public inputs:
//   commitment   -- Poseidon(role, secret), stored on-chain at game start
//   nullifier    -- Poseidon(secret, room_id, round_number), prevents replay
//
// Private inputs:
//   role         -- must equal ROLE_CLEAN (0); infected players CANNOT prove
//   secret       -- player's private salt
//   room_id      -- binds proof to specific room
//   round_number -- binds proof to specific round (no cross-round replay)
//
// Rules enforced:
//   - Only CLEAN players (role == 0) can generate a valid proof.
//   - Nullifier is unique per (player, room, round) -- max 1 submission/round.
//   - Proof is generated client-side at any point; submitted only during a
//     voting tie when player is a tied top-vote candidate.
//
// TODO: Issue #36 - Implement and test this circuit

use std::hash::poseidon2_permutation;

fn poseidon_hash2(input: [Field; 2]) -> Field {
    let mut state: [Field; 4] = [0, 0, 0, 0];
    state[0] = input[0];
    state[1] = input[1];
    state[2] = 0;
    state[3] = 0;
    let out = poseidon2_permutation(state);
    out[0]
}

fn poseidon_hash3(input: [Field; 3]) -> Field {
    let mut state: [Field; 4] = [0, 0, 0, 0];
    state[0] = input[0];
    state[1] = input[1];
    state[2] = input[2];
    state[3] = 0;
    let out = poseidon2_permutation(state);
    out[0]
}

global ROLE_CLEAN: Field = 0;

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
    let computed_commitment = poseidon_hash2([role, secret]);
    assert(computed_commitment == commitment);

    // 4. Verify nullifier is correctly bound to (secret, room_id, round_number)
    //    This prevents:
    //      - reusing the same proof across rounds
    //      - submitting proofs in rooms the player isn't in
    //      - submitting more than one proof per player per round
    let computed_nullifier = poseidon_hash3([secret, room_id, round_number]);
    assert(computed_nullifier == nullifier);
}

// --- Tests --------------------------------------------------------------

#[test]
fn test_clean_player_proof() {
    let secret = 99999;
    let room_id = 1;
    let round = 2;
    let commitment = poseidon_hash2([ROLE_CLEAN, secret]);
    let nullifier  = poseidon_hash3([secret, room_id, round]);
    main(commitment, nullifier, ROLE_CLEAN, secret, room_id, round);
}

#[test(should_fail)]
fn test_infected_player_cannot_prove() {
    // role = 1 (patient_zero/infected) should fail the ROLE_CLEAN assertion
    let secret = 11111;
    let room_id = 1;
    let round = 1;
    let role = 1;
    let commitment = poseidon_hash2([role, secret]);
    let nullifier  = poseidon_hash3([secret, room_id, round]);
    main(commitment, nullifier, role, secret, room_id, round);
}

#[test(should_fail)]
fn test_wrong_round_rejected() {
    // Correct proof for round 2 submitted in round 3 -- nullifier mismatch
    let secret = 22222;
    let room_id = 1;
    let round_correct = 2;
    let round_submitted = 3;
    let commitment = poseidon_hash2([ROLE_CLEAN, secret]);
    let nullifier  = poseidon_hash3([secret, room_id, round_correct]);
    main(commitment, nullifier, ROLE_CLEAN, secret, room_id, round_submitted);
}

#[test(should_fail)]
fn test_wrong_room_rejected() {
    // Correct proof for room A submitted in room B -- nullifier mismatch
    let secret = 33333;
    let room_correct = 1;
    let room_submitted = 2;
    let round = 1;
    let commitment = poseidon_hash2([ROLE_CLEAN, secret]);
    let nullifier  = poseidon_hash3([secret, room_correct, round]);
    main(commitment, nullifier, ROLE_CLEAN, secret, room_submitted, round);
}
