'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  AutoConnect,
  useActiveAccount,
  useActiveWallet,
  useActiveWalletChain,
  useConnect,
  useConnectModal,
  useDisconnect,
  useIsAutoConnecting,
  useSwitchActiveWalletChain,
} from 'thirdweb/react'
import { createWallet } from 'thirdweb/wallets'
import { thirdwebClient, supportedWallets, targetChain, celo, celoSepolia } from '@/lib/thirdweb'

declare global {
  interface Window {
    ethereum?: {
      isMiniPay?: boolean
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
      on: (event: string, handler: (...args: unknown[]) => void) => void
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void
    }
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

interface WalletContextValue {
  isConnected: boolean
  address: `0x${string}` | null
  chainId: number | null
  isLoading: boolean
  error: string | null
  isMiniPay: boolean
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  switchToCelo: (network?: 'mainnet' | 'testnet') => Promise<void>
  signMessage: (message: string) => Promise<`0x${string}`>
}

// ── Context ──────────────────────────────────────────────────────────────────

const WalletContext = createContext<WalletContextValue | null>(null)

// ── Provider ─────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: ReactNode }) {
  const account      = useActiveAccount()
  const activeWallet = useActiveWallet()
  const activeChain  = useActiveWalletChain()
  const { disconnect: twDisconnect } = useDisconnect()
  const switchChain  = useSwitchActiveWalletChain()
  const { connect: twConnect }  = useConnect()
  const { connect: openModal }  = useConnectModal()

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [isMiniPay, setIsMiniPay] = useState(false)
  // True while <AutoConnect> below is re-hydrating the last session on page
  // load — surfaced as isLoading so the UI doesn't flash "Connect Wallet".
  const isAutoConnecting = useIsAutoConnecting()

  // MiniPay injects window.ethereum — detect and auto-connect silently
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!window.ethereum?.isMiniPay) return
    setIsMiniPay(true)
    twConnect(async () => {
      const wallet = createWallet('io.metamask') // reads window.ethereum
      await wallet.connect({ client: thirdwebClient })
      return wallet
    })
  // twConnect is stable ref — only run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isConnected = !!account
  const address     = (account?.address ?? null) as `0x${string}` | null
  const chainId     = activeChain?.id ?? null

  const connect = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      await openModal({
        client: thirdwebClient,
        wallets: supportedWallets,
        chain: targetChain(),
        // Social/email/phone sign-in (inAppWallet, first in supportedWallets)
        // is surfaced as the primary option; external wallets sit below it.
        title: 'Sign In',
        showThirdwebBranding: false,
        size: 'compact',
      })
    } catch (err) {
      // User dismissed modal or connection failed
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setIsLoading(false)
    }
  }, [openModal])

  const disconnect = useCallback(async () => {
    if (activeWallet) twDisconnect(activeWallet)
  }, [activeWallet, twDisconnect])

  const switchToCelo = useCallback(async (network: 'mainnet' | 'testnet' = 'testnet') => {
    const chain = network === 'mainnet' ? celo : celoSepolia
    await switchChain(chain)
  }, [switchChain])

  const signMessage = useCallback(async (message: string): Promise<`0x${string}`> => {
    if (!account) throw new Error('Wallet not connected.')
    return account.signMessage({ message })
  }, [account])

  return (
    <WalletContext.Provider value={{
      isConnected,
      address,
      chainId,
      isLoading: isLoading || isAutoConnecting,
      error,
      isMiniPay,
      connect,
      disconnect,
      switchToCelo,
      signMessage,
    }}>
      {/* Restore the last-connected session on page load. thirdweb persists
          the wallet id in localStorage but only replays it when AutoConnect
          (or a prebuilt ConnectButton) is mounted — our headless
          useConnectModal flow never triggered it, so refresh = disconnect. */}
      <AutoConnect client={thirdwebClient} wallets={supportedWallets} />
      {children}
    </WalletContext.Provider>
  )
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>')
  return ctx
}
