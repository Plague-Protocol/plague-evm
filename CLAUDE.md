# Plague Protocol — Project State & Guide

> Authoritative source of truth for the current state of this project.
> **Read this before assuming anything about deployment status.** Updated 2026-07-29.

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
- **Gas:** every wallet (8 bot agents + backend signer `0xb895af9AA23451314601822B403E4e6f7456E950`) pays gas in **native CELO**, NOT USDm fee-currency. USDm = stakes/pot only. If a wallet runs out of CELO its txns fail.
- **Bots:** 8 ERC-8004 agents. Self-play fires after a **randomized** idle gap
  (`SELF_PLAY_MIN_MS`..`SELF_PLAY_MAX_MS`, compose defaults 8–12h), capped at
  `SELF_PLAY_MAX_GAMES_PER_DAY` (3) per rolling 24h, played by a random subset of
  the *funded* bots. Bot proofs persist on the `agentdata` docker volume (setup
  runs once).
  - ⚠ `SELF_PLAY_IDLE_MS` is **vestigial** — still set in `docker-compose.yml`,
    but `runner.ts` never reads it. Tuning it does nothing; use MIN/MAX.
  - ⚠ Restarting the `agents` container **resets the idle clock**
    (`allIdleSince = Date.now()` at module load), so every deploy pushes the next
    self-play game out by another full 8–12h. Bots going quiet right after a
    deploy is expected, not a fault. Confirm with
    `docker inspect -f '{{.State.StartedAt}} {{.RestartCount}}' $(docker compose ps -q agents)`.
- **Bot loss budget:** `BOT_DAILY_LOSS_BUDGET_WEI` (default 0.05 USDm/24h) stops
  bots joining *staked human rooms* once the pool's combined USDm drawdown passes
  it — self-play is exempt, since bots only pay each other. Topping the wallets up
  re-marks the opening balance and releases the breaker.
  `BOT_MAX_SEATS_PER_HUMAN_ROOM` (compose default 0 = uncapped) caps bot seats per
  human room.
- ⚠ **compose uses an explicit `environment:` map, not `env_file`.** A var added to
  `deploy/.env` that isn't also named in `docker-compose.yml` is **silently
  ignored** — no error, the container just uses its code default.
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

## Grant / BD submission doc (local-only — read it, never commit it)

`docs/CELO_STARTUPBANK_SUBMISSION.md` is the working submission package for the
**Celo StartupBank** programme (Ambassador → MiniPay BD + Celo Core DevRel).
It holds the filled-in checklist, verified mainnet tx hashes for every
user-facing method, PageSpeed history, MiniPay compliance status, and the
outstanding TODO list.

- **It is in `.gitignore` on purpose.** It contains an unvarnished readiness
  assessment — known gaps, the bot-vs-human traction caveat, unverified MiniPay
  claims — that should not be public in an open repo. Do **not** `git add -f` it,
  and do not let a broad `git add .` sweep it in (the ignore rule prevents this).
- **Do keep it current.** When frontend work changes anything it tracks
  (PageSpeed scores, MiniPay compliance, contract/tx evidence, support channels),
  update the doc in the same pass — just leave it out of the commit.
- Scores are recorded per pass, so previous numbers stay visible as a baseline.
  Append a new pass rather than overwriting history.

## Incident runbook

Live-ops playbook (stuck game phases, benched bots / gas floor, gas-drain
diagnosis, chat names, wallet session): [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).
Check it before re-deriving a diagnosis for a production symptom.

## MiniPay support (⚠️ PARTIALLY verified — connect yes, transactions no)

The app loads in MiniPay's in-app browser. Four fixes landed 2026-07-20 after it
was found asking MiniPay users to connect a wallet.

- ✅ **Zero-click connect is device-verified** (2026-07-31, real phone) — no
  connect prompt appears in MiniPay.
- ⚠️ **No transaction has ever been run inside MiniPay on a device.** Stake →
  role commit → vote → payout is still theory: it typechecks and builds, nothing
  more. This is the single biggest unverified claim in any submission package.
  Verifying needs ngrok + a physical phone (MiniPay has no emulator).

**Listing submission:** the intake form moved to
`https://developer.minipay.to/mini-app-listing` and its fields changed (app
name / tagline / publisher / support + ToS + privacy URLs / category / icon) —
the older `minipay.to/mini-apps` field list is stale. MiniPay also now requires
**exact dependency pinning, a committed lockfile, `ignore-scripts=true`, and a
7-day minimum package age**. Filled-in answer sheet, per-item audit, and the
`ignore-scripts` workspace trap: `docs/MINIPAY_LISTING_SUBMISSION.md` —
**gitignored on purpose**, same as the StartupBank doc; read it, never commit it.

⚠️ **`zplague.xyz` 308-redirects to `www.zplague.xyz`** — the apex is not
canonical. `metadataBase` in `layout.tsx` still points at the apex.

⚠️ **Never put `ignore-scripts=true` in the ROOT `.npmrc`.** npm ignores a
workspace-package `.npmrc` (`frontend/.npmrc` is documentation, not
enforcement), so the temptation is to move it up — but nine transitive deps
need install scripts (`@prisma/client`, `@prisma/engines`, `prisma`, `esbuild`,
`keccak`, `unrs-resolver`, `bufferutil`, `utf-8-validate`, `fsevents`) and
`backend/` + `agents/` would install without Prisma engines. Enforce it via the
Vercel env var `NPM_CONFIG_IGNORE_SCRIPTS=true` instead; the frontend alone was
verified to build clean with scripts skipped.

- **Never use `createWallet('io.metamask')` to reach MiniPay's provider.** In
  thirdweb v5 that resolves via `injectedProvider()`, a strict EIP-6963 rdns
  lookup (`mipdStore.js`: `find(p => p.info.rdns === walletId)`) with **no
  `window.ethereum` fallback**. MiniPay injects the provider but doesn't
  announce that rdns, so the lookup returns `undefined` and thirdweb silently
  degrades to its WalletConnect/deeplink path — surfacing as the connect modal
  appearing *inside* MiniPay, where there should be no wallet UI at all. Use
  `EIP1193.fromProvider({ provider: window.ethereum })`. The old call looked
  correct and even carried a comment claiming it read `window.ethereum`.
  (wagmi's `injected({ target: 'metaMask' })`, which MiniPay's own docs show,
  *does* have an `isMetaMask` fallback — hence the trap.)
- **MiniPay sets the fee currency, not you.** Per
  [docs](https://docs.minipay.xyz/technical-references/send-transaction.html):
  "MiniPay may ignore feeCurrency and choose the token the user has the most
  of." So do **not** plumb `feeCurrency` through — it's overridden. But *our own*
  `estimateContractGas` goes through the RPC proxy without it, so the node
  simulates a native-CELO payer with a zero balance and can reject with
  "insufficient funds" before MiniPay is consulted. `gasLimitFor()` in
  `lib/contract.ts` returns `undefined` under MiniPay so the wallet estimates.
- **No `wallet_switchEthereumChain`.** MiniPay is Celo-only and rejects it with
  a code other than 4902, which `ensureChain()` rethrows — killing every tx.
  Short-circuited via `isMiniPay()`.
- **MiniPay users hold USDC/USDT, often zero USDm.** Stakes are USDm-only
  (contract-level), so the lobby reads USDC (`0xcebA93…118C`, **6 dec**) and
  USDT (`0x48065f…3D5e`, **6 dec**) when USDm is 0 and shows a convert banner.
  Mainnet only — neither exists on Sepolia. Conversion is a hand-off to
  MiniPay's Pockets screen (`https://link.minipay.xyz/balance`); **no deeplink
  pre-fills a swap**. An in-app swap via Mento V3 (USDC/USDm pool
  `0x462fe0…A19E`, router `0x486184…B6f6`) is designed but unbuilt.
- ⚠️ **"MiniPay doesn't support message signing" is FALSE** — observed on a real
  device 2026-08-12: another Mini App (Waffles) raised a "Digital signature"
  sheet for a SIWE-style login and MiniPay signed it. That is `personal_sign`.
  Whether **`eth_signTypedData_v4`** works is still untested, and only that one
  matters for EIP-2612 `permit` — they are different RPC methods and a wallet
  can support one without the other. Don't collapse them.
- MiniPay constraints that already shape this code: `signMessage` is exposed but
  never called (nothing needs it yet), and **never
  display or require CELO** (MiniPay hides it; the low-CELO gate is already
  `isMiniPay`-exempt).

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
