# Plague Protocol — Deployment Guide

Complete steps to deploy to **Celo Alfajores testnet** (or mainnet).

---

## Prerequisites

| Tool | Install |
|------|---------|
| Node 18+ | `nvm install 18` |
| Foundry | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |
| Noir / nargo | `curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install \| bash && noirup` |
| Alfajores CELO | [faucet.celo.org](https://faucet.celo.org) — fund deployer + backend signer |

---

## 1 — Prepare wallets

You need **two** separate wallets:

| Wallet | Purpose | Min balance (testnet) |
|--------|---------|----------------------|
| **Deployer** | Signs the `forge script` broadcast | 0.1 CELO |
| **Backend signer** | Signs `beginActivePhase`, `assignInfection`, `openVoting`, `resolveRound` on-chain | 0.05 CELO |

Generate a throwaway key pair for the backend signer (never reuse a real wallet):

```bash
cast wallet new
# prints Address + Private Key — save both
```

Fund both addresses at <https://faucet.celo.org>.

---

## 2 — Set root-level env vars

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

Required variables:

```
# Foundry deploy
PRIVATE_KEY=<deployer hex private key, no 0x prefix>
BACKEND_SIGNER=<backend signer address>
PLATFORM_RECEIVER=<address that receives proof fees + 0.3% pot>

# Celo RPC
CELO_TESTNET_RPC=https://alfajores-forno.celo-testnet.org
# CELO_MAINNET_RPC=https://forno.celo.org

# cUSD token addresses
CUSD_TOKEN=0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1   # Alfajores
# CUSD_TOKEN=0x765DE816845861e75A25fCA122bb6022DB77Eaca # Mainnet

# Celoscan API key (optional, only needed for --verify)
# Get one at https://celoscan.io/myapikey
CELOSCAN_API_KEY=
```

---

## 3 — Build contracts

```bash
forge build
```

All warnings are lint hints — no errors expected.

---

## 4 — Dry-run the deploy (no broadcast)

```bash
forge script contracts/script/Deploy.s.sol \
  --rpc-url celo_testnet
```

Check the console output:

```
Deployer           : 0x...
Backend signer     : 0x...
Platform receiver  : 0x...
cUSD token         : 0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1
ZKVerifier stub deployed  : <simulated>
PlagueGame deployed       : <simulated>
```

---

## 5 — Broadcast to Alfajores

```bash
forge script contracts/script/Deploy.s.sol \
  --rpc-url celo_testnet \
  --broadcast
```

With source verification (requires `CELOSCAN_API_KEY`):

```bash
forge script contracts/script/Deploy.s.sol \
  --rpc-url celo_testnet \
  --broadcast \
  --verify
```

The terminal will print the deployed `PlagueGame` address. Save it.

Deployment receipts are written to `contracts/deployments/` automatically by Foundry broadcast.

---

## 6 — Set CONTRACT_ADDRESS in backend

Copy `backend/.env.example` to `backend/.env`:

```bash
cp backend/.env.example backend/.env
```

Fill in:

```
CONTRACT_ADDRESS=<PlagueGame address from step 5>
PLATFORM_RECEIVER=<same as PLATFORM_RECEIVER above>
BACKEND_PRIVATE_KEY=<backend signer hex private key, WITH 0x prefix>
CELO_RPC_URL=https://alfajores-forno.celo-testnet.org
NETWORK=testnet
```

---

## 7 — Set CONTRACT_ADDRESS in frontend

Copy `frontend/.env.local.example` to `frontend/.env.local`:

```bash
cp frontend/.env.local.example frontend/.env.local
```

Fill in:

```
NEXT_PUBLIC_CONTRACT_ADDRESS=<PlagueGame address from step 5>
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
```

---

## 8 — Build ZK circuit artifacts

Artifacts are gitignored and must be generated locally:

```bash
cd zk && bash scripts/build-circuits.sh
```

This compiles the three Noir circuits and copies JSON artifacts to
`frontend/public/circuits/`. Re-run whenever circuits change.

---

## 9 — Start the stack

```bash
# Terminal 1 — backend
cd backend && npm run dev

# Terminal 2 — frontend
cd frontend && npm run dev
```

Or from root (if concurrently is configured):

```bash
npm run dev
```

---

## Mainnet checklist

Before deploying to mainnet:

- [ ] Replace `ZKVerifier` stub with the real Noir-generated on-chain verifier
  (`ZK_VERIFIER_ADDR` env var in the deploy script)
- [ ] Set `bypassEnabled = false` — the stub always returns `true`; never use it on mainnet
- [ ] Audit contract — especially `_distributePot` and `_applyAbsentVotes`
- [ ] Use a hardware wallet or multisig for `PRIVATE_KEY`
- [ ] Point `CUSD_TOKEN` to mainnet cUSD: `0x765DE816845861e75A25fCA122bb6022DB77Eaca`
- [ ] Set `CELO_MAINNET_RPC` and change `--rpc-url` to `celo_mainnet`

---

## Deployed addresses (fill in after each deploy)

| Network | PlagueGame | ZKVerifier | Block |
|---------|-----------|-----------|-------|
| Alfajores | — | — | — |
| Celo Mainnet | — | — | — |
