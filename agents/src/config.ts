/**
 * config.ts — Environment, chain, and bot wallet setup.
 */
import 'dotenv/config'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { celo, celoSepolia } from 'viem/chains'

// ── Network ───────────────────────────────────────────────────────────────────

export const NETWORK = (process.env.NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
export const CHAIN = NETWORK === 'mainnet' ? celo : celoSepolia
export const RPC_URL =
  process.env.CELO_RPC_URL ??
  (NETWORK === 'mainnet' ? 'https://forno.celo.org' : 'https://forno.celo-testnet.org')

export const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS ?? '') as `0x${string}`
export const USDM_ADDRESS = (process.env.USDM_ADDRESS ?? '') as `0x${string}`
export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4000'
export const STAKE_AMOUNT = BigInt(process.env.STAKE_AMOUNT ?? '100000000000000') // 0.0001 USDm
export const CYCLE_DELAY_MS = Number(process.env.CYCLE_DELAY_MS ?? 30_000)

// Optional: pay gas in USDm instead of CELO.
// Set to the USDm token address to avoid needing CELO on each bot wallet.
// On mainnet: 0x765DE816845861e75A25fCA122bb6022DB77Eaca
// On testnet: leave unset (MockCUSD doesn't support fee currency)
export const FEE_CURRENCY_ADDRESS =
  process.env.FEE_CURRENCY_ADDRESS as `0x${string}` | undefined

if (!CONTRACT_ADDRESS) throw new Error('CONTRACT_ADDRESS env var is not set')
if (!USDM_ADDRESS) throw new Error('USDM_ADDRESS env var is not set')

// ── Public client ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL, { retryCount: 3, retryDelay: 500 }),
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
  const transport = http(RPC_URL, { retryCount: 3, retryDelay: 500 })
  return keys.map((key, index) => {
    const account = privateKeyToAccount(key)
    const walletClient = createWalletClient({ account, chain: CHAIN, transport })
    return { index, address: account.address, account, walletClient }
  })
}
