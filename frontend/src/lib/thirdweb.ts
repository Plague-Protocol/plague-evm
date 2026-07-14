import { createThirdwebClient } from 'thirdweb'
import { inAppWallet, createWallet } from 'thirdweb/wallets'
import { defineChain, celo as celoBase, celoSepoliaTestnet as celoSepoliaBase } from 'thirdweb/chains'

export const thirdwebClient = createThirdwebClient({
  clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!,
})

// ── RPC routing ────────────────────────────────────────────────────────────────
// thirdweb keeps a background chain-polling loop alive for the whole session
// (AutoConnect, active-account/balance/block watchers). Left to its defaults it
// resolves RPC to `<id>.rpc.thirdweb.com` and, when that is rejected for the
// current origin, falls back to Celo's PUBLIC nodes (forno, drpc). Those
// rate-limit by browser origin and drop CORS headers when throttled, so a busy
// lobby floods the console with "No 'Access-Control-Allow-Origin'" errors and
// steals the tab's connection pool — independent of our own contract reads,
// which already go through the proxy (see lib/contract.ts).
//
// Pin thirdweb's chain RPC to our same-origin backend proxy (/api/rpc). It
// forwards server-to-server to healthy upstreams (no browser CORS) and its
// method allowlist now includes eth_sendRawTransaction, so the in-app (social)
// wallet — which broadcasts through the chain RPC rather than an injected
// provider — still sends transactions. External wallets are unaffected (they
// broadcast through their own provider). If NEXT_PUBLIC_BACKEND_URL is unset
// (local dev without a backend) we leave thirdweb's default RPC in place.
function proxyRpcUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL
  if (!base) return undefined
  return `${base.replace(/\/$/, '')}/api/rpc`
}

function withProxyRpc<T extends { id: number }>(chain: T): T {
  const rpc = proxyRpcUrl()
  if (!rpc) return chain
  return defineChain({ ...chain, rpc }) as unknown as T
}

const celo         = withProxyRpc(celoBase)
const celoSepolia  = withProxyRpc(celoSepoliaBase)

export const supportedWallets = [
  inAppWallet({
    auth: { options: ['google', 'apple', 'email', 'phone'] },
  }),
  createWallet('io.metamask'),
  createWallet('com.coinbase.wallet'),
]

export function targetChain() {
  const network = (process.env.NEXT_PUBLIC_NETWORK ?? 'testnet') as 'mainnet' | 'testnet'
  return network === 'mainnet' ? celo : celoSepolia
}

export { celo, celoSepolia }
