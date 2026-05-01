# PlagueProtocol — Full Game Playthrough

> 8-player game, stake 10 XLM each, proof_fee 2 XLM, max 7 rounds.  
> Pot starts at **80 XLM**. Proof fees are added as they're paid.

---

## Setup

| Player | Role | Wallet (short) |
|--------|------|----------------|
| Alice  | **Patient Zero** | `G...A1` |
| Bob    | Clean | `G...B2` |
| Carol  | Clean | `G...C3` |
| Dave   | Clean | `G...D4` |
| Eve    | Clean | `G...E5` |
| Frank  | Clean | `G...F6` |
| Grace  | Clean | `G...G7` |
| Henry  | Clean | `G...H8` |

> All players submit `commitment = Poseidon(role, secret)` on-chain.  
> Only Alice knows her role is Patient Zero. Everyone else sees "Clean".

**Pot:** 80 XLM (8 × 10)

---

## Round 1

### Infection Phase
System selects: `eligible_clean_alive[ hash(room1, round1, prevTxHash) % 7 ]` → **Bob**

- Alice learns nothing new (she was already infected)
- Bob receives private event `infection_assigned` — he's now infected
- Nobody else is told who was infected or why

**Alive: 8 | Clean: 6 (Carol/Dave/Eve/Frank/Grace/Henry) | Infected: 2 (Alice, Bob)**

### Discussion Phase
Everyone chats. No one has hard information yet.

```
Dave:   "Has anyone noticed any patterns? Alice seems quiet."
Eve:    "Alice is always quiet lol. I'm looking at Henry."
Alice:  "Nothing to hide."
Grace:  "Bob made some weird voting decisions in last game. Suspicious."
Bob:    "Lol, that was one game."
Carol:  "Let's vote out the most suspicious. I'm going Dave."
Henry:  "Agreed with Carol. Dave's deflecting."
```

> Alice pre-generates proof client-side — **fails** (circuit rejects `role = patient_zero ≠ 0`). She submits nothing.  
> Bob also tries to generate — **fails** (infected). Submits nothing.  
> Carol, Dave, Eve, Frank, Grace, Henry generate valid proofs. None choose to submit yet — no one feels at serious risk this early. **Proof window closes when voting opens.**

### Voting Phase
| Voter | Target |
|-------|--------|
| Alice | Dave |
| Bob   | Dave |
| Carol | Dave |
| Dave  | Alice |
| Eve   | Henry |
| Frank | Dave |
| Grace | Dave |
| Henry | Alice |

**Vote tally:**
- Dave: 5 votes
- Alice: 2 votes
- Henry: 1 vote

No tie. Dave eliminated (most votes, no proof needed).

### Reveal Phase
`player_eliminated` event → **Dave** is eliminated.

**Endgame check (alive only):** infected=2, clean=5 → `infected(2) < clean(5)` → **continue**

**Pot:** 80 XLM (stake drain mechanic TBD — pot unchanged for this walkthrough)

---

## Round 2

### Infection Phase
Eligible clean alive: Carol, Eve, Frank, Grace, Henry (5 players)  
System: `hash(room1, round2, prevTxHash) % 5` → **Grace**

- Grace receives private `infection_assigned`
- Room sees nothing

**Alive: 7 | Clean: 4 (Carol/Eve/Frank/Henry) | Infected: 3 (Alice, Bob, Grace)**

### Discussion Phase
```
Alice:  "Dave was clean, that's unfortunate. I still think Henry is odd."
Bob:    "Yeah, Henry's been agreeing with everyone — that's sus."
Henry:  "I've been reasoning out loud! I can prove I'm clean if needed."
Eve:    "I'm going to vote Alice this round. She pushed hard for Dave."
Carol:  "Alice did seem awfully confident Dave was infected."
Frank:  "I'm between Alice and Bob honestly."
Grace:  "Let's coordinate on one target. Alice."
Henry:  "Fine, Alice."
```

### Voting Phase
| Voter | Target |
|-------|--------|
| Alice | Henry |
| Bob   | Henry |
| Carol | Alice |
| Eve   | Alice |
| Frank | Alice |
| Grace | Alice |
| Henry | Alice |

**Vote tally:**
- Alice: 5 votes
- Henry: 2 votes

No tie. Alice eliminated.

### Reveal Phase
`player_eliminated` → **Alice** eliminated.

> Alice was Patient Zero — but the game does NOT end because there are still other infected players (Bob, Grace).

**Endgame check:** infected=2 (Bob, Grace), clean=4 (Carol/Eve/Frank/Henry) → `2 < 4` → **continue**

---

## Round 3

### Infection Phase
Eligible clean alive: Carol, Eve, Frank, Henry (4 players)  
System: `hash(room1, round3, prevTxHash) % 4` → **Frank**

- Frank receives private `infection_assigned`

**Alive: 6 | Clean: 3 (Carol/Eve/Henry) | Infected: 3 (Bob, Grace, Frank)**

### Discussion Phase
```
Bob:    "Alice is gone but something still feels off. I'm going Henry."
Henry:  "I'm going Bob. He's been pushing the same targets as Alice."
Eve:    "Henry's onto something. Bob's votes aligned suspiciously."
Carol:  "Bob or Frank. Frank has been very quiet this round."
Frank:  "I'm thinking Eve deflects a lot."
```

> Henry feels targeted this round. He **submits his innocence proof** during discussion (uses his free slot):
> `nullifier = Poseidon(henry_secret, room1, 3)` — valid, accepted on-chain.
> `proof_submitted` event is broadcast — room sees Henry submitted a proof but doesn't know why.
> Bob attempts to generate a proof — **fails** (infected, circuit rejects). Submits nothing.
> **Proof window closes. Voting opens.**

### Voting Phase
| Voter | Target |
|-------|--------|
| Bob   | Henry |
| Grace | Henry |
| Frank | Henry |
| Carol | Bob |
| Eve   | Bob |
| Henry | Bob |

**Vote tally:**
- Henry: 3 votes
- Bob: 3 votes

**TIE detected** — votes tallied after timer expires.

Both Henry and Bob tied at 3 votes. Contract checks proofs submitted during discussion:

- Henry: **active proof this round** ✓
- Bob: **no proof** (couldn't generate one) ✕

**Case C — tied, some unprotected:** Bob eliminated.

**Endgame check:** infected=2 (Grace, Frank), clean=3 (Carol/Eve/Henry) → `2 < 3` → **continue**

---

## Round 4

### Infection Phase
Eligible clean alive: Carol, Eve, Henry (3 players)  
System: `hash(room1, round4, prevTxHash) % 3` → **Carol**

- Carol receives private `infection_assigned`

**Alive: 5 | Clean: 2 (Eve/Henry) | Infected: 3 (Grace/Frank/Carol)**

> Eve and Henry are the last two clean players.

**Endgame check at infection phase start:** not triggered (checked only after Reveal).

### Discussion Phase
```
Grace:  "This is getting intense. Eve has been flying under the radar."
Frank:  "I agree. Eve for this round."
Carol:  "Honestly yes, Eve."
Henry:  "Eve has been fine. I'm going Carol — something changed."
Eve:    "I'm going Grace. She's been coordinating votes weirdly."
```

> Eve and Henry are both nervous. Neither submits a proof (Eve doesn't think she's the main target; Henry already used his free slot and doesn't want to pay).  
> **Proof window closes. Voting opens.**

### Voting Phase
| Voter | Target |
|-------|--------|
| Grace | Eve |
| Frank | Eve |
| Carol | Eve |
| Henry | Carol |
| Eve   | Grace |

**Vote tally:**
- Eve: 3 votes
- Carol: 1 vote
- Grace: 1 vote

No tie. Eve eliminated.

### Reveal Phase
`player_eliminated` → **Eve**

**Endgame check:** infected=3 (Grace/Frank/Carol), clean=1 (Henry) → `infected(3) >= clean(1)` → **INFECTED WIN**

---

## Game Over

**Outcome:** Infected wins — infected count reached parity with clean before Henry could eliminate anyone.

**Winning faction (alive infected):** Grace, Frank, Carol  
**Eliminated / losing:** Alice (elim R2), Dave (elim R1), Bob (elim R3), Eve (elim R4), Henry (alive but losing faction)

**Payout:**
```
Total pot = 80 XLM (stakes) + 0 XLM (no paid proofs used) = 80 XLM
Winners   = Grace, Frank, Carol (3 players)
Per winner = 80 / 3 = 26 XLM each (remainder 2 XLM stays in contract)
```

> Henry was alive but on the losing clean team — receives nothing.  
> Contract auto-distributes directly after `resolve_round` on Round 4.

---

## Proof Economy Summary

| Player | Role | Free Proof Used | Paid Proofs | Notes |
|--------|------|-----------------|-------------|-------|
| Alice  | Patient Zero | No | 0 | Tried to generate, circuit rejected |
| Bob    | Infected | No | 0 | Tried to generate, circuit rejected |
| Carol  | Infected (R4+) | No | 0 | Was clean rounds 1–3, became infected |
| Dave   | Clean | No | 0 | Eliminated R1, no proof needed |
| Eve    | Clean | No | 0 | Eliminated R4, misjudged her risk |
| Frank  | Infected (R3+) | No | 0 | Was clean rounds 1–2, became infected |
| Grace  | Infected (R2+) | No | 0 | Was clean round 1 only |
| Henry  | Clean | **Yes** | 0 | Submitted during discussion R3, saved from tie |

---

## Key Mechanics Demonstrated

1. **Infection is system-assigned** — Alice never "chose" to infect Bob. No collusion leak.
2. **Infected cannot prove innocence** — Bob and Alice failed the circuit; they couldn't bluff with proofs.
3. **Proof submitted during discussion (not during vote)** — Henry bet on being targeted before votes were cast. Strategic risk, not a reactive safety net.
4. **Proof submission is public** — room saw Henry submitted a proof, which itself is information. He was betting the cost of the signal was worth avoiding elimination.
5. **Generic resolution event** — room saw `"Vote resolved by protocol"` — nobody could tell if it was proof-related.
6. **Endgame: parity = infected win** — when infected ≥ clean among alive players, game ends.
7. **Auto payout** — no manual claim; contract distributed 80 XLM directly.

---

## Alternate Scenario A: Case B — Single Top-Voted Saved by Proof

> What if in Round 3, Henry (clean) was the *sole* top-voted candidate (not a tie) and had submitted a proof during discussion?

1. Votes tallied: Henry has 4 votes, Bob has 2. Henry is the clear top candidate.
2. Henry submitted a valid innocence proof during discussion.
3. **Case B** — sole top candidate has proof.
4. Henry is **saved** — no elimination this round.
5. `player_saved_by_proof` event broadcast (Henry's address visible, no reason stated).
6. Game continues. System assigns normal infection for next round.
7. Next round: discussion resumes, and now everyone knows Henry submitted a proof, meaning he was likely top-voted, meaning the group may feel foolish for voting an innocent player.

**Strategic trade-off:** Henry revealed he was clean (valid proof = must be clean) but also drew social attention that he was almost eliminated. Infected players may now pivot their strategy.

---

## Alternate Scenario B: Case D — All-Proofs Tie

> What if the tie in Round 3 had been between Henry (clean, proof submitted) and Carol (also clean, proof submitted)?

1. Both submit valid proofs during discussion.
2. Votes tied: Henry 3, Carol 3.
3. **Case D** — all tied candidates have active proofs.
4. Nobody eliminated. Both Henry and Carol survive.
5. No forced infection occurs — only the PZ drives infection. The next round's normal system infection proceeds as usual.
6. Broadcast: `"Vote resolved by protocol"` — no names, no proof hints.

**Key difference:** Nobody is punished for being in the all-proof tie. The game simply continues with a normal system infection next round. This is the only scenario where a round can end with zero eliminations and zero extra infections.
