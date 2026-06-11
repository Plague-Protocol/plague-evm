import { createThirdwebClient } from 'thirdweb'
import { inAppWallet, createWallet } from 'thirdweb/wallets'
import { celo, celoSepoliaTestnet } from 'thirdweb/chains'

export const thirdwebClient = createThirdwebClient({
  clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!,
})

export const supportedWallets = [
  inAppWallet({
    auth: { options: ['google', 'apple', 'email', 'phone'] },
  }),
  createWallet('io.metamask'),
  createWallet('com.coinbase.wallet'),
]

export function targetChain() {
  const network = (process.env.NEXT_PUBLIC_NETWORK ?? 'testnet') as 'mainnet' | 'testnet'
  return network === 'mainnet' ? celo : celoSepoliaTestnet
}

export { celo, celoSepoliaTestnet as celoSepolia }
