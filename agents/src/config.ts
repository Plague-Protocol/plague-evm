/**
 * config.ts — Environment, chain, and bot wallet setup.
 */
import 'dotenv/config'
import { createPublicClient, createWalletClient, fallback, getAddress, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { celo, celoSepolia } from 'viem/chains'
import { toDataSuffix } from '@celo/attribution-tags'

// ── Network ───────────────────────────────────────────────────────────────────

export const NETWORK = (process.env.NETWORK ?? 'testnet') as 'testnet' | 'mainnet'

// Celo's block base fee can rise between fee estimation and tx submission,
// producing "max fee per gas less than block base fee" rejections that force the
// bots to retry. viem's default only adds 20% headroom (baseFeeMultiplier 1.2);
// bump it so a single tx stays valid across a base-fee bump. maxFeePerGas is only
// a cap — the actual base fee is what's paid at inclusion — so this costs nothing.
const _baseChain = NETWORK === 'mainnet' ? celo : celoSepolia
export const CHAIN = {
  ..._baseChain,
  fees: { ..._baseChain.fees, baseFeeMultiplier: 2 },
}
export const RPC_URL =
  process.env.CELO_RPC_URL ??
  (NETWORK === 'mainnet'
    ? 'https://forno.celo.org'
    : 'https://forno.celo-sepolia.celo-testnet.org')

// Primary + comma-separated fallbacks. The agents are otherwise single-homed on
// CELO_RPC_URL, so a single keyed-provider cap (e.g. Alchemy "Monthly capacity
// limit exceeded") takes every bot down — reads and writes alike — while the
// backend, which already fans out over fallbacks, keeps running. Mirror that
// here so an upstream outage silently fails over instead of benching the pool.
const RPC_FALLBACK_URLS = (process.env.CELO_RPC_FALLBACK_URLS ?? '')
  .split(',')
  .map(url => url.trim())
  .filter(Boolean)
const RPC_URLS = [RPC_URL, ...RPC_FALLBACK_URLS]

// Shared fallback transport: viem tries each endpoint in order, moving to the
// next on error. Reused by the public client and every bot wallet client.
const rpcTransport = fallback(
  RPC_URLS.map(url => http(url, { retryCount: 3, retryDelay: 500 })),
)

// Normalize to EIP-55 checksum so viem accepts addresses regardless of the
// casing used in .env (e.g. all-lowercase or all-uppercase hex).
function envAddress(name: string, required = true): `0x${string}` | undefined {
  const raw = process.env[name]
  if (!raw) {
    if (required) throw new Error(`${name} env var is not set`)
    return undefined
  }
  try {
    return getAddress(raw)
  } catch {
    throw new Error(`${name} is not a valid address: ${raw}`)
  }
}

export const CONTRACT_ADDRESS = envAddress('CONTRACT_ADDRESS') as `0x${string}`
export const USDM_ADDRESS = envAddress('USDM_ADDRESS') as `0x${string}`
export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4000'
export const STAKE_AMOUNT = BigInt(process.env.STAKE_AMOUNT ?? '100000000000000') // 0.0001 USDm
export const CYCLE_DELAY_MS = Number(process.env.CYCLE_DELAY_MS ?? 30_000)

// ── Bot pool (human-plays-with-bots) ───────────────────────────────────────────

// Max stake (wei) of a HUMAN room the bots will join. Caps attrition against the
// bots' funding — they lose this stake to the human if they lose. Keep it low:
// bots are a "try the game" convenience, not a real-money feature. 0.01 USDm.
export const BOT_MAX_STAKE_WEI = BigInt(process.env.BOT_MAX_STAKE_WEI ?? '10000000000000000')

// Minimum native CELO (wei) a bot must hold before it's allowed into a game.
// A full game SPENDS ≈0.55 CELO at recent gas prices, dominated by the ZK
// role-commitment verify (~2.1M gas ≈ 0.42 CELO). But the node's pre-flight
// balance check requires gasLimit × maxFeePerGas — and with baseFeeMultiplier 2
// above, that CAP is ~0.92 CELO for the commit alone (observed on-chain
// 2026-07-13: "balance 0.646, tx cost 0.921" rejection). A bot that can afford
// joinRoom but not the commitment deadlocks the room for everyone, so gate on
// the worst-case cap up-front. Default 1.5 CELO for headroom.
export const MIN_GAME_CELO_WEI = BigInt(process.env.MIN_GAME_CELO_WEI ?? '1500000000000000000')

// How long all bots must sit idle (no human demand) before they start a
// self-play game to keep on-chain activity up. Default 5 minutes.
export const SELF_PLAY_IDLE_MS = Number(process.env.SELF_PLAY_IDLE_MS ?? 300_000)

// Set SELF_PLAY_DISABLED=true to prevent bots from ever starting a self-play
// game. Bots will still join human rooms. Useful when bot wallets are low on
// funds and you don't want them burning gas on maintenance games.
export const SELF_PLAY_DISABLED = (process.env.SELF_PLAY_DISABLED ?? 'false').toLowerCase() === 'true'

// Shared secret for the runner's calls to the backend bot-coordination API.
export const BOT_RUNNER_SECRET = process.env.BOT_RUNNER_SECRET ?? ''

// Optional: pay gas in USDm instead of CELO.
// Set to the USDm token address to avoid needing CELO on each bot wallet.
// On mainnet: 0x765DE816845861e75A25fCA122bb6898B8B1282a
// On testnet: leave unset (MockCUSD doesn't support fee currency)
export const FEE_CURRENCY_ADDRESS = envAddress('FEE_CURRENCY_ADDRESS', false)

// ── Attribution (Celo Builders hackathon) ──────────────────────────────────────

// Celo Builders "Agentic Payments & DeFAI" hackathon attribution tag. Appended to
// every on-chain write's calldata via viem's `dataSuffix` so the tx is credited on
// the leaderboard (Celo mainnet, ends 2026-08-03). Contract ignores the trailing
// bytes; only the registered tag is credited. Decode a tx with `verifyTx` from
// @celo/attribution-tags. Override ATTRIBUTION_TAG only if the tag ever changes.
export const ATTRIBUTION_TAG = process.env.ATTRIBUTION_TAG ?? 'celo_c2d022d1d4ac'
export const ATTRIBUTION_SUFFIX = toDataSuffix(ATTRIBUTION_TAG)

// ── Public client ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: rpcTransport,
})

// ── Bot wallets ───────────────────────────────────────────────────────────────

export interface BotWallet {
  index: number
  address: `0x${string}`
  account: ReturnType<typeof privateKeyToAccount>
  walletClient: ReturnType<typeof createWalletClient>
}

function loadBotKeys(): `0x${string}`[] {
  const keys: `0x${string}`[] = []
  for (let i = 1; i <= 10; i++) {
    const val = process.env[`BOT_PRIVATE_KEY_${i}`]
    if (!val) break
    keys.push(val as `0x${string}`)
  }
  return keys
}

export function buildBotWallets(): BotWallet[] {
  const keys = loadBotKeys()
  if (keys.length < 3) {
    throw new Error(
      `Need at least 3 BOT_PRIVATE_KEY_N env vars (1..N). Found ${keys.length}.`,
    )
  }
  return keys.map((key, index) => {
    const account = privateKeyToAccount(key)
    const walletClient = createWalletClient({ account, chain: CHAIN, transport: rpcTransport })
    return { index, address: account.address, account, walletClient }
  })
}
