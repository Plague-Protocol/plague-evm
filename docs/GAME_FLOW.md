# PlagueProtocol — Game Flow

> **Status: Finalized mechanics (v2)**  
> This document reflects the complete, authoritative ruleset.  
> See `docs/GAME_PLAYTHROUGH.md` for a worked 8-player example.

---

## 1. Lobby — Room Creation & Staking

- A player creates a room setting `min_players`, `max_players`, `stake_amount`, `proof_fee`, and `expiry_secs`
- **The host is automatically joined as the first player** at creation time — their `stake_amount` cUSD is transferred in the same transaction (they must approve the contract for at least `stake_amount` before calling `createRoom`)
- All players stake the same amount in cUSD — held in the **`PlagueGame` escrow contract**
- Once `min_players` is reached, the host starts the game → `RoomStatus: Waiting → Starting`

**Join window: `RoomStatus == Waiting` only.**  
Once `start_game` is called the window closes permanently. Players who were not in the room when the game started:
- Cannot join, stake, or earn winnings
- May subscribe to socket events to spectate (receive public broadcast events)
- Will NOT receive private events (`infection_assigned`, their own role)
- Cannot cast votes or submit proofs

Reasons the window is hard-closed:
- VRF role assignment happens at `start_game` — a late joiner has no role
- Pot total is fixed at that moment — mid-game stakes break payout math
- ZK commitments are submitted in the `Starting` phase — missing commitment = no valid proofs

**Room expiry.**  
Every waiting room has an `expires_at` timestamp set at creation: `created_at + expiry_secs` (default: 600 s / 10 minutes). If `min_players` is not reached before `expires_at`:
- The backend expiry monitor (15 s tick) calls `contract.expire_room(room_id)`
- The contract sets `room.status = Ended` and refunds every staked player
- A `room_expired` event is broadcast to all subscribers
- The lobby shows a live countdown per waiting room; rooms within 3 minutes of expiry are highlighted

Players decide whether to join a room based on full public information: **stake, proof fee, player count, slots remaining, and expiry countdown.** No system forces a player into a room — information does the nudging.

`expiry_secs` is configurable per room at creation time. Hosts who want a longer fill window set a higher value; the tradeoff is a longer wait for everyone already staked.

---

## 2. Role Assignment (VRF + ZK Commitment)

- The backend uses a VRF (Verifiable Random Function) to secretly assign:
  - **1 Player Zero** (first infected)
  - Everyone else: **Clean**
- Each player receives their role privately and generates a role commitment:
  ```
  commitment = Poseidon(role, secret)   ← role_commitment.nr
  ```
- All commitments are submitted on-chain. No one can see your role — it's cryptographically locked.

**Starting phase timeout.**  
Players have a configurable window to submit their commitment (default: 2 minutes, set by `ROLE_COMMIT_TIMEOUT_MS`). If the window expires:
- Players who did not commit are immediately eliminated from the game.
- If the remaining committed players satisfy `min_players`, `beginActivePhase` is called and the game proceeds normally.
- If committed survivors fall below `min_players`, `finalizeStartTimeout` is called instead:
  - Committed players split the pot equally.
  - If nobody committed at all, all players are fully refunded.
  - Room status is set to `Ended`.

- `RoomStatus: Starting → Active`, Round 1 begins.

---

## 3. Round Structure (repeated until endgame)

```
infection → discussion → voting → reveal
```

### Phase 1 — Infection
- The **system automatically assigns** infection each round — infected players do NOT choose their target.
- **Round 1 target:** `eligible_clean_alive[ keccak256(roomId : round : currentPatientZero : blockHash) % count ]`
- **Round 2+ target:** the player Patient Zero cast their vote for in the preceding voting phase, provided that player is still eligible (clean and alive).
- If the current Patient Zero is eliminated during vote resolution, their queued infection is **nullified** and no queued target is carried into the next round.
- Patient Zero's on-chain vote openly nominates a suspect for elimination — and secretly queues that same player as the next infection target. Both roles of the vote are public on-chain; only the infection consequence is hidden from other players.
- Spread rate: **+1 infected per round** (controlled, not exponential)
- After Round N: N total infected players
- Only the newly infected player receives a private `infection_assigned` event. The room is never told who was infected or why.

### Phase 2 — Discussion
- Open chat. Players reason, accuse, defend.
- **Proof submission window is OPEN.** Players may submit an innocence proof at any point during this phase.
  ```
  nullifier = Poseidon(secret, roomId, round)
  proof     = prove(role=CLEAN, secret, commitment, nullifier)  ← innocence_proof.nr
  ```
- This is a **strategic bet** — you commit before seeing who will be the top-voted target. There's no guarantee you'll need it.
- Proof submission is public on-chain: everyone sees your address submitted a proof. They don't know why or what it means yet.
- Infected players **cannot** generate a valid innocence proof — the circuit enforces `role == CLEAN`.
- **Window closes when voting opens.** No proofs accepted during or after voting.

### Phase 3 — Voting
- Every alive player casts one on-chain vote:
  ```
  contract.cast_vote(room_id, target_address)
  ```
- Votes are **publicly visible** on-chain (who voted for whom).
- If all alive players vote before the timer ends, the backend resolves the voting phase early (no need to wait for countdown expiry).
- **Absent vote rule:** any player who doesn't vote before the timer expires has their vote automatically cast against **themselves**. Silence equals guilt — abstention is actively dangerous to the abstaining player, regardless of who is currently leading the vote.
- No proof submissions are accepted during this phase.

### Phase 4 — Reveal
- The contract runs the **tie resolution algorithm** and **endgame check**.

---

## 4. Proof Economy

| Rule | Detail |
|---|---|
| Free proofs | 1 per player per **game** |
| Paid proofs | `proof_fee` (added to pot) for each additional proof |
| Submission window | **Discussion phase only** — window closes when voting opens |
| Max submissions/round | 1 per player per round — enforced by nullifier set |
| Proof effect | Saves player from elimination **if** they end up as top-voted (or tied) |
| Who can prove | Only CLEAN players — infected fail the circuit assertion |
| Nullifier binding | `Poseidon(secret, roomId, round)` — prevents cross-round replay |
| Visibility | Proof submission address is public; effect only known at resolve time |

---

## 5. Vote Resolution Algorithm

After the voting phase timer expires (absent-vote rule applied first):

1. Tally all votes. Find top vote count.
2. Collect all players tied at that count (`top_candidates`).
3. Split into `protected` (submitted a valid proof this round) and `unprotected`.

**Case A — single top candidate, no proof:**
→ Eliminate that player. Emit `player_eliminated`.

**Case B — single top candidate, has proof:**
→ Player is saved. Emit `player_saved_by_proof` (address visible; no reason stated).
→ No elimination this round. Normal system infection continues next round.

**Case C — tied candidates, at least one infected:**
→ Eliminate all tied infected candidates.
→ Tied clean candidates with valid proofs are explicitly saved.
→ Emit `player_eliminated` for each eliminated tied infected candidate.

**Case D — tied candidates, no infected:**
→ Eliminate all tied unprotected clean candidates.
→ Tied clean candidates with valid proofs are saved.
→ If every tied clean candidate has a valid proof, nobody is eliminated.

---

## 6. Endgame Conditions

Checked after every Reveal phase using **alive player counts only** (eliminated players don't count):

| Priority | Condition | Outcome |
|---|---|---|
| 1 | `infected_alive == 0` | **Clean wins** |
| 2 | `infected_alive == 1 && clean_alive == 1` | **Draw** |
| 3 | `infected_alive > clean_alive` | **Infected wins** |
| 4 | `round >= max_rounds` | **Draw** |

**1v1 edge case:** 1 infected vs 1 clean is an immediate **Draw**.

---

## 7. Payout

- `total_pot = sum(all stakes)`
- Paid proof fees are collected separately as platform fees and are **not** added to the winner pot.
- **Winners** = alive players from the winning faction at game end.
- The contract takes a **0.3% platform fee** from `total_pot`; the remainder is split among winners.
- `payout_per_winner = (total_pot - platform_fee) / winners.len()` (integer division, remainder routed to platform fees)
- Eliminated and losing-faction players receive **nothing**.
- Distribution is **automatic** — the contract transfers directly after `finalizeElimination`, no manual claim.

---

## 8. Privacy Model

| Information | Who can see it |
|---|---|
| Role assignment | Player only (private VRF delivery) |
| Vote cast (who → whom) | Everyone (on-chain, transparent) |
| Proof submitted (address) | Everyone (on-chain event) |
| Proof outcome reason | Nobody (generic event only) |
| Infection source | Nobody (not even the infected player) |
| Infected players list | Nobody until game end or role reveal |
| Winners | Everyone (on-chain payout events) |

---

## 9. System Architecture

```
Browser (Next.js)
  ↓ Socket.io  (private events: infection_assigned, own role)
  ↕ REST/RPC
Backend (Node/Express)
  ↓ viem (Celo RPC + contract event watcher)
PlagueGame Contract  (Celo Sepolia / Celo Mainnet, Solidity 0.8.24)
  — escrow, votes, proof verification, tie resolution, payout
  ↑ ZK verifier calls
Noir circuits
  — role_commitment.nr    Poseidon(role, secret) binding
  — innocence_proof.nr    Prove role=CLEAN, nullifier H(secret,room,round)
  — infection_proof.nr    (reserved for future infection attribution features)
```
