# Zombie Plague — Autonomous Bot Runner

Autonomous agents that play Zombie Plague end-to-end on Celo.
Built for the [Celo Onchain Agents Hackathon](https://celopedia.notion.site) (June 15, 2026).

## Architecture

Each bot is a funded wallet that:
1. Approves cUSD spending
2. Creates/joins rooms on-chain
3. Submits ZK role commitments (via the backend `/api/prove` endpoint)
4. Casts votes during voting phases
5. Repeats indefinitely

No LLM required — bots use hardcoded game logic.

## Prerequisites

| Requirement | Details |
|---|---|
| Node.js ≥ 20 | ESM support |
| Backend running | `BACKEND_URL` must point to a live backend with `BB_BINARY_PATH` set |
| `zk/target/role_commitment.json` | Run `nargo compile` in `/zk` if missing |
| 5 funded wallets | Each needs CELO (gas) + cUSD/USDm (stakes × ~50 games) |

## Setup

```bash
cd agents
cp .env.example .env
# Edit .env with your NETWORK, CONTRACT_ADDRESS, USDM_ADDRESS, BOT_PRIVATE_KEY_1..5

npm install

# One-time: pre-generate ZK commitments + proofs (needs backend running)
npm run setup
```

`setup` takes ~2–10 minutes (proof generation per bot). Output: `data/bot-proofs.json`.

## Running

```bash
npm run runner
```

Bots loop continuously — create room → play game → wait 30s → repeat.

## ERC-8004 Registration (mainnet only)

After mainnet contract deployment, register each bot wallet as an on-chain agent:

```bash
NETWORK=mainnet npm run register
```

Requires: CELO on mainnet for gas. Output: `data/agent-registrations.json`.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `NETWORK` | `testnet` or `mainnet` | `testnet` |
| `CELO_RPC_URL` | RPC endpoint | Public Celo RPC |
| `CONTRACT_ADDRESS` | PlagueGame contract | — |
| `USDM_ADDRESS` | USDm token address | — |
| `FEE_CURRENCY_ADDRESS` | Pay gas in USDm (mainnet, optional — skips need for CELO) | unset |
| `BACKEND_URL` | Backend base URL | `http://localhost:4000` |
| `STAKE_AMOUNT` | Stake per game in wei | `100000000000000` (0.0001 USDm) |
| `CYCLE_DELAY_MS` | Wait between cycles | `30000` (30s) |
| `BOT_PRIVATE_KEY_1..5` | Bot wallet private keys | — |

## Contract Addresses

| Contract | Testnet (Celo Sepolia) | Mainnet (Celo) |
|---|---|---|
| PlagueGame | `0x63c020880f2dd7E357F4c2aB70d03fb67E12BF3d` | TBD |
| cUSD / USDm | `0xAE10A9E08D979E7D154D3B0212FB7CBF70FA6BB1` | `0x765DE816845861e75A25fCA122bb6022DB77Eaca` |
| ERC-8004 Identity Registry | — | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |

## Security Notes

- **Never commit private keys.** `.env` is gitignored.
- Bot wallets only need small balances (~0.01 CELO gas + ~$1 cUSD per run).
- The `setup` script sends witness bytes to your own backend — private keys never leave this machine.
