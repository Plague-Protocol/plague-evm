# 🦠 PlagueProtocol — On-Chain Social Deduction

> *Can you find Patient Zero before the infection spreads?*

PlagueProtocol is a fully decentralised, zero-knowledge social deduction game built on **Celo EVM** smart contracts. Players stake cUSD to join a room. One player is secretly assigned as **Patient Zero** via verifiable randomness. Each round, Patient Zero silently infects others. Infected players unknowingly drain the pot. The town must vote to eliminate suspects before infected players reach majority or lose everything.

**No server knows who the thief is. No one can cheat the randomness. No one can lie about their role.**

---

## ✨ What Makes This Different

| Feature | How |
|---|---|
| **Provably fair roles** | Backend-signed role assignment — verifiable on-chain commitment, not even the server can forge it |
| **ZK hidden roles** | Players commit to their role using a Poseidon hash. ZK circuits (Noir) prove claims without revealing the role |
| **Real stakes** | Players stake cUSD. Proof fees go to platform. Platform takes 1.5% of pot. Winners auto-paid. |
| **No middleman** | Solidity smart contracts on Celo handle all escrow, voting, and payouts |
| **Neobrutalist UI** | Built with Next.js 14, Tailwind, Framer Motion |

---

## 🏗️ Architecture

```
PlagueProtocol/
├── frontend/          # Next.js 14 + TypeScript + Tailwind
│   └── src/
│       ├── app/       # App router pages (lobby, game, leaderboard)
│       ├── components/ # UI, game, wallet components
│       ├── hooks/     # useWallet, useGameState, useZK
│       ├── lib/       # contract.ts, zk.ts, socket client
│       └── types/     # Shared TypeScript types
├── backend/           # Node.js + Express + Socket.io
│   └── src/
│       ├── routes/    # REST API (rooms, players)
│       ├── socket/    # Real-time game event handlers
│       └── services/  # Game logic, VRF, chain indexer
├── contracts/         # Solidity (Foundry)
│   └── src/
│       ├── PlagueGame.sol   # rooms, escrow, voting, payout
│       └── ZKVerifier.sol   # IZKVerifier interface + dev bypass stub
└── zk/
    ├── circuits/      # Noir circuits (role_commitment, innocence_proof, infection_proof)
    └── keys/          # Trusted setup keys (not committed)
```

---

## ✅ Current Status

**Live on Celo Mainnet (chain 42220) with real USDm (cUSD) stakes.** All core contracts are deployed and source-verified.

- **Play now:** [z-plague.vercel.app](https://z-plague.vercel.app/) — lobby, match, leaderboard, and a free demo mode
- **Contracts:** deployed + [verified on Blockscout](https://celo.blockscout.com/address/0xe157fD2564246Afa41cfAFaDA01a9A6f3e082710) (see [Deployments](#-deployments) below); Foundry suite passing 100/100
- **Frontend:** shipped on Vercel (Next.js 14)
- **Backend:** room routes, real-time socket events, and Postgres-backed leaderboard live in `backend/src`
- **ZK:** Noir circuits (`role_commitment`, `innocence_proof`, `infection_proof`) in `zk/circuits`
- **Agents:** self-play AI agents in `agents/src` that join and play rooms on-chain

---

## 🌐 Deployments

### Celo Mainnet (chain 42220) — live + verified

| Contract | Address |
|---|---|
| PlagueGame | [`0xe157fD2564246Afa41cfAFaDA01a9A6f3e082710`](https://celo.blockscout.com/address/0xe157fD2564246Afa41cfAFaDA01a9A6f3e082710) |
| FeeManager | [`0xc0a030a9C51c1aBc8273447EB889Fe3e96c4e2DB`](https://celo.blockscout.com/address/0xc0a030a9C51c1aBc8273447EB889Fe3e96c4e2DB) |
| PotEscrow  | [`0xDB0858e4a10261431927c549163F3D0E1F7d2435`](https://celo.blockscout.com/address/0xDB0858e4a10261431927c549163F3D0E1F7d2435) |
| Stake currency | `0x765DE816845861e75A25fCA122bb6898B8B1282a` (USDm / cUSD) |

Celo Sepolia testnet (chain 11142220) PlagueGame: `0x63c020880f2dd7E357F4c2aB70d03fb67E12BF3d`.

> Note for contributors: the real mainnet deploy is **not** recorded in `broadcast/` (it was deployed via `forge create`). Confirm on-chain state via Blockscout or RPC, not `broadcast/`. See `CLAUDE.md` for details.

---

## 🎮 Game Loop

```
1. Players join room & stake cUSD      →  Funds escrowed in contract
2. Host starts game                    →  Join window closes; RoomStatus: Starting
3. All players commit their role       →  ZK commitment: Poseidon(role, secret) on-chain
                                          (time-limited window — too few commits ends game early)
4. Patient Zero assigned               →  Verifiable private event; no one else knows
5. Round begins
   ├── Infection phase:   Round 1 — deterministic target; Round 2+ — target is PZ's prior vote
   ├── Discussion phase:  Players discuss; clean players may submit ZK innocence proofs
   ├── Voting phase:      All players vote on-chain; absent players self-vote (silence = guilt)
   └── Reveal:            Contract resolves votes, eliminates players, checks endgame
6. Win conditions checked
   ├── Clean team wins:   All infected eliminated → clean players split pot
   ├── Infected win:      Infected > clean alive → infected players split pot
   └── Draw:              1v1 parity or max rounds reached
7. Auto-payout via contract — no manual claim needed
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- Foundry (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- Noir (`noirup`)
- Redis (for backend room caching)
- MetaMask or Valora browser extension

### Installation

```bash
git clone https://github.com/Plague-Protocol/plague-evm
cd plague-evm

# Install all JS dependencies
npm install

# Copy env files
cp .env.example backend/.env
cp .env.example frontend/.env.local
# Edit both files with your values

# Start frontend + backend in parallel
npm run dev
```

### Running Contracts Locally

```bash
# Build contracts
forge build

# Run tests
forge test -vvv

# Deploy to Celo Sepolia testnet
forge script contracts/script/Deploy.s.sol --rpc-url $CELO_RPC_URL --broadcast
```

### Compiling ZK Circuits

```bash
cd zk/circuits

# Compile role commitment circuit
nargo compile role_commitment

# Run circuit tests
nargo test

# Generate proving key (requires powers of tau ceremony)
# See docs/zk-setup.md for trusted setup instructions
```

---

## 🔧 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, TypeScript, Tailwind CSS, Framer Motion |
| Wallet | MetaMask / Valora (EIP-1193) |
| Backend | Node.js, Express, Socket.io, Redis |
| Smart Contracts | Solidity 0.8.24, Foundry, Celo Sepolia/Mainnet |
| ZK Circuits | Noir, Groth16/PLONK, snarkjs |
| Randomness | Backend-signed commit-reveal scheme |

---

## 🌐 Roadmap

- [x] **v0.1** — Playable game without ZK (roles server-assigned, revealed at end)
- [x] **v0.2** — Solidity escrow + on-chain voting live on Celo Sepolia testnet
- [x] **v0.3** — ZK role commitments (Noir circuits + on-chain verifier)
- [x] **v0.4** — Full ZK: infection proofs + innocence proofs
- [x] **v0.5** — Mainnet launch + leaderboard
- [ ] **v1.0** — DAO governance, PLAGUE token, tournaments

---

## 🤝 Contributing

Plague is **90% community-built**. We rely on open source contributors for nearly everything — frontend components, contract logic, ZK circuits, testing, documentation, and design.

**Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR.**

Browse open issues by label:
- [`good first issue`](../../issues?q=label%3A"good+first+issue") — Start here
- [`frontend`](../../issues?q=label%3Afrontend) — UI/UX work
- [`contract`](../../issues?q=label%3Acontract) — Solidity/Foundry work
- [`zk`](../../issues?q=label%3Azk) — ZK circuit work
- [`backend`](../../issues?q=label%3Abackend) — Node.js/API work
- [`easy`](../../issues?q=label%3Aeasy) / [`medium`](../../issues?q=label%3Amedium) / [`hard`](../../issues?q=label%3Ahard) — Difficulty

---

## 📄 License

MIT — see [LICENSE](./LICENSE)

---

## 💬 Community

- Telegram: [@CrypticNerd](https://t.me/CrypticNerd)
- GitHub Discussions: [Discussions tab](../../discussions)
