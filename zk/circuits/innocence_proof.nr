// innocence_proof.nr
// Circuit: Proves a player is clean (not infected, not patient_zero)
// without revealing their secret or role.
//
// Public inputs:
//   commitment   — Poseidon(role, secret), stored on-chain at game start
//   nullifier    — Poseidon(secret, room_id, round_number), prevents replay
//
// Private inputs:
//   role         — must equal ROLE_CLEAN (0); infected players CANNOT prove
//   secret       — player’s private salt
//   room_id      — binds proof to specific room
//   round_number — binds proof to specific round (no cross-round replay)
//
// Rules enforced:
//   - Only CLEAN players (role == 0) can generate a valid proof.
//   - Nullifier is unique per (player, room, round) — max 1 submission/round.
//   - Proof is generated client-side at any point; submitted only during a
//     voting tie when player is a tied top-vote candidate.
//
// TODO: Issue #36 - Implement and test this circuit

use dep::std::hash::poseidon;

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

    // 2. Prove role is CLEAN — infected players fail here
    assert(role == ROLE_CLEAN);

    // 3. Verify commitment matches player’s on-chain registration
    let computed_commitment = poseidon::bn254::hash_2([role, secret]);
    assert(computed_commitment == commitment);

    // 4. Verify nullifier is correctly bound to (secret, room_id, round_number)
    //    This prevents:
    //      - reusing the same proof across rounds
    //      - submitting proofs in rooms the player isn’t in
    //      - submitting more than one proof per player per round
    let computed_nullifier = poseidon::bn254::hash_3([secret, room_id, round_number]);
    assert(computed_nullifier == nullifier);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[test]
fn test_clean_player_proof() {
    // TODO: Issue #36
    // let secret = 99999;
    // let room_id = 1;
    // let round = 2;
    // let commitment = poseidon::bn254::hash_2([ROLE_CLEAN, secret]);
    // let nullifier  = poseidon::bn254::hash_3([secret, room_id, round]);
    // main(commitment, nullifier, ROLE_CLEAN, secret, room_id, round);
}

#[test(should_fail)]
fn test_infected_player_cannot_prove() {
    // role = 1 (patient_zero/infected) should fail the ROLE_CLEAN assertion
    // TODO: Issue #36
}

#[test(should_fail)]
fn test_wrong_round_rejected() {
    // Correct proof for round 2 submitted in round 3 — nullifier mismatch
    // TODO: Issue #36
}

#[test(should_fail)]
fn test_wrong_room_rejected() {
    // Correct proof for room A submitted in room B — nullifier mismatch
    // TODO: Issue #36
}
