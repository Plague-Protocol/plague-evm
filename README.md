# 🦠 PlagueProtocol — On-Chain Social Deduction

> *Can you find Patient Zero before the infection spreads?*

PlagueProtocol is a fully decentralised, zero-knowledge social deduction game built on **Stellar/Soroban** smart contracts. Players stake XLM to join a room. One player is secretly assigned as **Patient Zero** via verifiable randomness. Each round, Patient Zero silently infects others. Infected players unknowingly drain the pot. The town must vote to eliminate suspects before infected players reach majority or lose everything.

**No server knows who the thief is. No one can cheat the randomness. No one can lie about their role.**

---

## ✨ What Makes This Different

| Feature | How |
|---|---|
| **Provably fair roles** | Chainlink-style VRF on Stellar assigns Patient Zero — not even the server knows in advance |
| **ZK hidden roles** | Players commit to their role using a Poseidon hash. ZK circuits (Noir) prove claims without revealing the role |
| **Real stakes** | Players stake XLM. Infected players lose stake each round via on-chain drain. Winners auto-paid. |
| **No middleman** | Soroban smart contracts handle all escrow, voting, and payouts |
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
├── contracts/         # Soroban (Rust)
│   └── src/
│       ├── game/      # PlagueGame.sol — rooms, escrow, voting, payout
│       ├── zk/        # ZKVerifier — Groth16 proof verification
│       └── token/     # Optional: PLAGUE governance token
└── zk/
    ├── circuits/      # Noir circuits (role_commitment, innocence_proof, infection_proof)
    └── keys/          # Trusted setup keys (not committed)
```

---

## ✅ Current Status

- Frontend: responsive landing page and lobby scaffold shipped in `frontend/src/app`
- Backend: room routes and socket handlers tracked in `backend/src`
- Contracts: Soroban modules and tests tracked in `contracts/src` and `contracts/test`
- ZK: Noir circuit scaffolding tracked in `zk/circuits`

---

## 🎥 Demo Readiness

- Live demo URL: `coming soon`
- Demo artifacts to include before grant review:
   - 30-60s UI walkthrough clip
   - Screenshots of landing, lobby, and round view
   - Quick local run instructions

---

## 🎮 Game Loop

```
1. Players join room & stake XLM  →  Funds escrowed in contract
2. VRF assigns Patient Zero        →  Verifiably random, nobody knows ahead of time
3. All players commit their role   →  ZK commitment stored on-chain
4. Round begins
   ├── Infection phase:   Patient Zero silently infects one player
   ├── Discussion phase:  Players discuss openly (off-chain chat)
   ├── Voting phase:      Players vote on-chain to eliminate a suspect
   └── Drain:             Infected players lose stake to pot
5. Win conditions checked
   ├── Clean team wins:   All infected eliminated → clean players split pot
   └── Infected win:      Infected reach majority → infected split pot
6. Auto-payout via contract
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- Rust + Soroban CLI (`cargo install --locked soroban-cli`)
- Noir (`noirup`)
- Redis (for backend room caching)
- [Freighter wallet](https://www.freighter.app/) browser extension

### Installation

```bash
git clone https://github.com/plague-game/PlagueProtocol
cd PlagueProtocol

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
cd contracts

# Build all contracts
cargo build --target wasm32-unknown-unknown --release

# Run tests
cargo test

# Deploy to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/plague_game.wasm \
  --source YOUR_SECRET_KEY \
  --network testnet
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
| Wallet | Freighter (Stellar browser wallet) |
| Backend | Node.js, Express, Socket.io, Redis |
| Smart Contracts | Soroban (Rust), Stellar testnet/mainnet |
| ZK Circuits | Noir, Groth16/PLONK, snarkjs |
| Randomness | Stellar VRF / commit-reveal scheme |

---

## 🌐 Roadmap

- [ ] **v0.1** — Playable game without ZK (roles server-assigned, revealed at end)
- [ ] **v0.2** — Soroban escrow + on-chain voting live on testnet
- [ ] **v0.3** — ZK role commitments (Noir circuits + on-chain verifier)
- [ ] **v0.4** — Full ZK: infection proofs + innocence proofs
- [ ] **v0.5** — Mainnet launch + leaderboard
- [ ] **v1.0** — DAO governance, PLAGUE token, tournaments

---

## 🤝 Contributing

Plague is **90% community-built**. We rely on open source contributors for nearly everything — frontend components, contract logic, ZK circuits, testing, documentation, and design.

**Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR.**

Browse open issues by label:
- [`good first issue`](../../issues?q=label%3A"good+first+issue") — Start here
- [`frontend`](../../issues?q=label%3Afrontend) — UI/UX work
- [`contract`](../../issues?q=label%3Acontract) — Soroban/Rust work
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
