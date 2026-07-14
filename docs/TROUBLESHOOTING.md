# Troubleshooting Runbook

> Operational playbook for live incidents. Each section: symptom → how the
> system self-heals → how to diagnose → what to do.
> Born from the 2026-07-14 live playtest + bot-pool incident. Update as new
> failure modes appear.

---

## 1. Game stuck in a phase (e.g. "ROUND N — INFECTION" never advances)

### Two distinct causes — tell them apart first

**A. Display-only stall (frontend showing stale state, chain already moved).**
Root cause was a race: `loadRoomFromChain` reads through forno's load-balanced
RPC nodes, which lag each other. A slow in-flight read carrying the *old*
phase could resolve after a fresher socket snapshot and overwrite it, pinning
the UI on a phase the chain had left. **Fixed in commit `34d3804`** with a
monotonic guard in `frontend/src/hooks/useGameState.ts` (`isStaleRound`):
on-chain `(currentRound, phaseStartedAt)` only move forward, so any incoming
read older than what's displayed is dropped.

**B. Genuine on-chain stall (the room really is stuck in Infection).**
The backend's phase-advance monitor (`backend/src/socket/handlers.ts`,
`handleInfectionPhase`, ticks every 2s) can only advance Infection by calling
`assignInfection(roomId, target)` with a **clean, alive** target. If every
alive player is already infected, there is no valid target and the room can
never leave the Infection phase by that path.

### How the system self-heals now (client side)

The game page escalates automatically while "Syncing next phase on-chain" is
showing:

| Time stuck | Action |
|---|---|
| every 4s | `refresh()` chain read + `request_room_refresh` to backend |
| 12s | "↺ Force resync" button appears (socket reconnect + fresh read) |
| 15s | **automatic** one-shot socket reconnect — rejoin makes the backend re-send its authoritative `room_state` snapshot |
| 30s | "⟳ Reload page" button appears (last resort for non-technical players) |

### Diagnosis

```bash
# On the VPS — did the backend hit the no-target dead-end?
cd /opt/plague/deploy
docker compose logs backend | grep "no clean alive"

# Any other phase-advance failures (gas, RPC, nonce)?
docker compose logs backend | grep "phase-advance-monitor" | tail -20

# What does the chain actually say? (room status/phase, from anywhere)
# currentPhase: 0=Infection 1=Discussion 2=Voting 3=Reveal
cast call 0xe157fD2564246Afa41cfAFaDA01a9A6f3e082710 "getRoom(uint256)" <ROOM_ID> --rpc-url https://forno.celo.org
```

- **Log shows `no clean alive players to infect`** → cause B. The warning
  fires once per room+round. This means the game reached round N with every
  alive player infected but was NOT ended by `finalizeElimination` in round
  N-1. That is a **contract-level question**: the win-condition check should
  arguably have ended the game as `infected_win`. If this ever fires, capture
  the room id + round and review `finalizeElimination` / win conditions in
  `contracts/src/PlagueGame.sol` before large-pot games hit it. Stakes in a
  stuck Active room are NOT recoverable via `expireRoom` (that only handles
  Waiting rooms) — check the contract for an admin path if funds are trapped.
- **Log shows repeated `assignInfection failed`** with a real error (not
  WrongPhase/NotActive) → backend signer problem: check its CELO gas
  (`0xb895af9AA23451314601822B403E4e6f7456E950`), RPC health, nonce.
- **No backend errors, chain says the phase DID advance** → it was a display
  stall (cause A). Should no longer happen post-`34d3804`; if it recurs,
  suspect a new state-merge path missing the `isStaleRound` guard.

---

## 2. Bots not joining / lobby shows fewer than 5 bots free

The agents runner has a **gas-floor guard** (`MIN_GAME_CELO_WEI`, default
1.5 CELO, `agents/src/config.ts`). Bots below the floor are excluded from
games AND from the lobby's availability count — by design. A bot that can
afford `joinRoom` (~0.04 CELO) but not the ZK role commitment stalls the room
at the commit phase and wastes everyone's gas, so it's benched instead.

**Why 1.5 when a game only spends ~0.55 CELO:** the node's pre-broadcast
balance check requires `gasLimit × maxFeePerGas` ≈ **0.92 CELO** for the
commitment alone (the agents' `baseFeeMultiplier: 2` doubles the fee *cap*;
actual spend is still ~0.42). The floor must clear the cap, not the spend.
Observed on-chain 2026-07-13: `balance 0.646, tx cost 0.921` rejection.

### Runbook

```bash
# Live availability (what the lobby sees)
curl -s https://api.zplague.xyz/api/bots/availability

# Which bots are benched and why (warnings fire on funded→broke transition
# and once at startup; recovery logs "back above gas floor — rejoining")
cd /opt/plague/deploy && docker compose logs agents | grep "gas floor" | tail
```

- **Top-ups need NO restart** — balances are re-read from chain every 60s;
  the bot rejoins automatically and the lobby count climbs on its own.
- Restart matrix: moved money → nothing; changed `.env` →
  `docker compose up -d agents`; pulled new code →
  `docker compose up -d --build agents`.
- Bot wallets: Bot1 `0xF78A…bCE1`, Bot2 `0xA8B5…a66b`, Bot3 `0xe481…b9C5`,
  Bot4 `0x93A7…cCde`, Bot5 `0xe175…f303`. Top up ~2–3+ CELO per bot.

---

## 3. Bot CELO draining faster than expected

**Cost anatomy per full game (mainnet, ~200 gwei):** `submitRoleCommitment`
(on-chain ZK verify, ~2.09M gas) ≈ **0.42 CELO** — 10–45× every other call.
`createRoom` ≈ 0.10, `joinRoom` ≈ 0.04, `startGame`/`castVote` ≈ 0.01.
Full 5-bot self-play game ≈ **2.5 CELO**. Role commitments are per-room by
design (hidden-role privacy) — there is no "commit once forever" optimization.

**If burn rate exceeds what `SELF_PLAY_IDLE_MS` implies, suspect a second
runner instance sharing the same keys.** Diagnostic method (July 2026 incident):
pull Bot1's `createRoom` timestamps from Blockscout and decompose into series —
each runner produces one clean `idle-interval + game-duration` period. Two
interleaved series = two processes. We found a forgotten Railway deployment
(one-month trial) self-playing every ~6h alongside the VPS's 12h runner;
it died at trial expiry 2026-07-13 and was deleted. Old deployment platforms
(Railway/Render) hold the mainnet bot keys in their env vars — delete the
services AND the env vars, or rotate keys. Shared keys across runners also
share nonce space → collisions/dropped txs.

```bash
# Identify which self-play series belongs to the VPS
docker compose logs --timestamps agents | grep "self-play game"
```

---

## 4. Chat shows addresses instead of names

Since `34d3804` the backend resolves chat names **server-side** in
`backend/src/socket/handlers.ts` (`chat_message` handler): DB nickname →
`Player N` (join order, matching the player cards) → short address. The
client-sent `displayName` is ignored (was spoofable).

If addresses reappear: the resolution fell through to the last-resort branch —
check backend logs for Prisma errors (nickname lookup) and whether
`chainAdapter.getRoom` succeeded (the `Player N` fallback needs the roster).

---

## 5. Wallet disconnects on page refresh

Fixed in `1370342`: thirdweb v5 only replays the persisted session when an
`<AutoConnect>` component is mounted; the headless `useConnectModal` flow
never mounted one. `AutoConnect` now lives in
`frontend/src/providers/wallet-provider.tsx` with `useIsAutoConnecting`
folded into `isLoading`. If reconnect breaks again, verify that component is
still rendered inside `WalletProvider` and that `supportedWallets` /
`thirdwebClient` props are intact.

---

## Quick reference

| What | Where |
|---|---|
| Live contracts + addresses | `CLAUDE.md` (top) |
| VPS | `ubuntu@43.131.58.132`, repo `/opt/plague`, compose in `/opt/plague/deploy` |
| Public API health | `https://api.zplague.xyz/health` |
| Bot availability | `GET /api/bots/availability` |
| Online presence | `GET /api/presence` |
| Backend signer (pays phase-advance gas) | `0xb895af9AA23451314601822B403E4e6f7456E950` — needs native CELO |
| Update one service | `cd /opt/plague && git pull && cd deploy && docker compose up -d --build <svc>` |
