# Plague Protocol — Project State & Guide

> Authoritative source of truth for the current state of this project.
> **Read this before assuming anything about deployment status.** Updated 2026-07-09.

---

## ⚠️ Deployment state (read first)

**This project IS LIVE ON CELO MAINNET (chain 42220) with real USDm (cUSD) stakes.**
It is not a testnet-only prototype. All three core contracts are deployed AND source-verified.

### Mainnet (chain 42220) — LIVE + VERIFIED

| Contract | Address | Explorer |
|---|---|---|
| PlagueGame | `0xe157fD2564246Afa41cfAFaDA01a9A6f3e082710` | [Blockscout ✓](https://celo.blockscout.com/address/0xe157fD2564246Afa41cfAFaDA01a9A6f3e082710) |
| FeeManager | `0xc0a030a9C51c1aBc8273447EB889Fe3e96c4e2DB` | [Blockscout ✓](https://celo.blockscout.com/address/0xc0a030a9C51c1aBc8273447EB889Fe3e96c4e2DB) |
| PotEscrow  | `0xDB0858e4a10261431927c549163F3D0E1F7d2435` | [Blockscout ✓](https://celo.blockscout.com/address/0xDB0858e4a10261431927c549163F3D0E1F7d2435) |
| Stake currency | `0x765DE816845861e75A25fCA122bb6898B8B1282a` | USDm (cUSD), 18 decimals |

- **Live frontend:** https://zplague.xyz  (also https://z-plague.vercel.app) — routes: `/lobby`, `/game`, `/leaderboard`, `/demo`
- **Deployer EOA:** `0xF9aa21D3921C7F292738D4E5864EaE3543081E98` (deployed ~2026-06-10)

### Backend / agents / DB — self-hosted VPS (as of 2026-07-08)

The backend, self-play agents, Postgres, and Redis all run on **one Tencent
Lighthouse VPS** (Frankfurt, Ubuntu 22.04 + Docker), fronted by **Caddy** for
auto-TLS. Neon/Upstash/Render were evaluated and dropped in favour of this single
self-hosted box. Full stack + runbook: [`deploy/`](deploy/) (`docker-compose.yml`,
`Caddyfile`, `.env.example`, `pg-backup.sh`, `README.md`).

- **Public API:** `https://api.zplague.xyz` (health: `/health` → `{"ok":true}`). Frontend sets `NEXT_PUBLIC_BACKEND_URL` to this.
- **VPS:** `43.131.58.132`, user `ubuntu`, repo at `/opt/plague`; compose runs from `/opt/plague/deploy` (`docker compose up -d`).
- **Gas:** every wallet (5 bot agents + backend signer `0xb895af9AA23451314601822B403E4e6f7456E950`) pays gas in **native CELO**, NOT USDm fee-currency. USDm = stakes/pot only. If a wallet runs out of CELO its txns fail.
- **Bots:** 5 ERC-8004 agents self-play every 12h (`SELF_PLAY_IDLE_MS=43200000`); bot proofs persist on the `agentdata` docker volume (setup runs once).
- Update a service: `cd /opt/plague && git pull && cd deploy && docker compose up -d --build <svc>`.

### Testnet (Celo Sepolia, chain 11142220)

| Contract | Address |
|---|---|
| PlagueGame | `0x63c020880f2dd7E357F4c2aB70d03fb67E12BF3d` |

This is the address wired into the local `.env` files (`agents/.env`, `backend/.env`, `frontend/.env.local`) for local dev. The **mainnet** addresses live in the commented-out blocks of those same `.env` files (e.g. `backend/.env` line 58).

### 🚨 The `broadcast/` gotcha — do NOT trust it for mainnet

`broadcast/Deploy.s.sol/42220/run-latest.json` points to `0xa7fa…d3d9`, which has **EMPTY bytecode on mainnet** — that was a failed/simulated `forge script` run that never landed. **It is not the live contract.**

The real mainnet deploy (`0xe157…2710`) was done via an ad-hoc `forge create`-style command, which leaves **no `broadcast/` artifact**. So the absence of a broadcast record is expected, not a sign it isn't deployed. Always confirm mainnet state via Blockscout or an `eth_getCode` RPC call, never via `broadcast/`.

---

## Architecture

- `contracts/` — Solidity 0.8.28 (Foundry). `PlagueGame.sol` (rooms, escrow, voting, payout), `FeeManager.sol`, `PotEscrow.sol`, ZK verifiers.
- `frontend/` — Next.js 14 + TypeScript + Tailwind. Deployed on Vercel.
- `backend/` — Node/Express/Socket.io + Prisma/Postgres. Rooms, real-time events, leaderboard.
- `agents/` — self-play AI agents (identity, registration, runner) that play on-chain.
- `zk/circuits/` — Noir circuits: `role_commitment`, `innocence_proof`, `infection_proof`.

## Incident runbook

Live-ops playbook (stuck game phases, benched bots / gas floor, gas-drain
diagnosis, chat names, wallet session): [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).
Check it before re-deriving a diagnosis for a production symptom.

## Key facts that have caused confusion before

- **Platform fee is 1.5%**, i.e. `(pot * 15) / 1000` in `PlagueGame.sol` (~L1235). It was raised from 0.3% in commit `4834ea0` (2026-05-14). Any code/test/doc still saying 0.3% is stale.
- **PlagueGame has no constructor** — it uses `initialize()`. FeeManager/PotEscrow take `(admin, authorizedGame, cUsdToken)`.
- Naming: `cUSD` in code is Celo's `USDm` (Mento). Same token, `0x765DE8…1282a` on mainnet.

## Build / test / verify

```bash
forge build
forge test                       # 100/100 passing as of 2026-07-03

# Re-verify a mainnet contract on Blockscout (no real API key needed —
# foundry.toml's [etherscan] block forces a key var, so pass a dummy):
CELOSCAN_API_KEY=dummy forge verify-contract <ADDRESS> \
  contracts/src/<Name>.sol:<Name> \
  --verifier blockscout --verifier-url https://celo.blockscout.com/api/ \
  --compiler-version 0.8.28 --num-of-optimizations 200 \
  [--constructor-args 0x<abi-encoded-args>]
```

## Current readiness snapshot (2026-07-03)

Live + verified on mainnet, frontend shipped, 100/100 tests passing, ZK + agent layers built.
Remaining optional polish: a 30–60s demo walkthrough clip, and a listing in The Grid ecosystem directory (not currently indexed). Best-fit grant: **Prezenti Frontier Pool** (AI & agent-economy infrastructure).
