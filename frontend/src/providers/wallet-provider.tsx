'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { createWalletClient, custom, getAddress } from 'viem'
import { celoSepolia, celo } from 'viem/chains'

// ── EIP-1193 type ────────────────────────────────────────────────────────────

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
      on: (event: string, handler: (...args: unknown[]) => void) => void
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void
    }
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

interface WalletState {
  isConnected: boolean
  address: `0x${string}` | null
  chainId: number | null
  isLoading: boolean
  error: string | null
}

interface WalletContextValue extends WalletState {
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  switchToCelo: (network?: 'mainnet' | 'testnet') => Promise<void>
  signMessage: (message: string) => Promise<`0x${string}`>
}

const CELO_CHAINS = {
  mainnet: celo,
  testnet: celoSepolia,
} as const

// ── Context ──────────────────────────────────────────────────────────────────

const WalletContext = createContext<WalletContextValue | null>(null)

// ── Provider ─────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    isConnected: false,
    address: null,
    chainId: null,
    isLoading: false,
    error: null,
  })

  // ── Silently restore existing session on mount (no prompt) ────────────────

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return

    const restore = async () => {
      try {
        const accounts = (await window.ethereum!.request({ method: 'eth_accounts' })) as string[]
        if (!accounts.length) return
        const rawChainId = (await window.ethereum!.request({ method: 'eth_chainId' })) as string
        setState({
          isConnected: true,
          address: getAddress(accounts[0]),
          chainId: parseInt(rawChainId, 16),
          isLoading: false,
          error: null,
        })
      } catch {
        // Silent — user hasn't connected yet
      }
    }

    restore()
  }, [])

  // ── Wallet events ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return

    const handleAccountsChanged = (rawAccounts: unknown) => {
      const accounts = rawAccounts as string[]
      if (!accounts.length) {
        setState({ isConnected: false, address: null, chainId: null, isLoading: false, error: null })
      } else {
        setState(prev => ({ ...prev, isConnected: true, address: getAddress(accounts[0]) }))
      }
    }

    const handleChainChanged = (rawChainId: unknown) => {
      setState(prev => ({ ...prev, chainId: parseInt(rawChainId as string, 16) }))
    }

    window.ethereum.on('accountsChanged', handleAccountsChanged)
    window.ethereum.on('chainChanged', handleChainChanged)

    return () => {
      window.ethereum?.removeListener('accountsChanged', handleAccountsChanged)
      window.ethereum?.removeListener('chainChanged', handleChainChanged)
    }
  }, [])

  // ── Connect ──────────────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))
    try {
      if (typeof window === 'undefined' || !window.ethereum) {
        throw new Error('No wallet detected. Install MetaMask or Valora.')
      }
      const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[]
      if (!accounts.length) throw new Error('No accounts returned from wallet.')
      const rawChainId = (await window.ethereum.request({ method: 'eth_chainId' })) as string
      setState({
        isConnected: true,
        address: getAddress(accounts[0]),
        chainId: parseInt(rawChainId, 16),
        isLoading: false,
        error: null,
      })
    } catch (err) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Unknown wallet error',
      }))
    }
  }, [])

  // ── Disconnect ────────────────────────────────────────────────────────────────

  const disconnect = useCallback(async () => {
    // Revoke dapp permissions so eth_accounts returns [] on next mount
    try {
      if (window.ethereum) {
        await window.ethereum.request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }],
        })
      }
    } catch {
      // wallet_revokePermissions may not be supported (e.g. Valora) — continue anyway
    }
    setState({ isConnected: false, address: null, chainId: null, isLoading: false, error: null })
  }, [])

  // ── Switch / add Celo network ─────────────────────────────────────────────────

  const switchToCelo = useCallback(async (network: 'mainnet' | 'testnet' = 'testnet') => {
    if (!window.ethereum) throw new Error('No wallet detected.')
    const chain = CELO_CHAINS[network]
    const chainHex = `0x${chain.id.toString(16)}`

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainHex }],
      })
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: chainHex,
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: chain.rpcUrls.default.http,
            blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : [],
          }],
        })
      } else {
        throw err
      }
    }
  }, [])

  // ── Sign message ──────────────────────────────────────────────────────────────

  const signMessage = useCallback(async (message: string): Promise<`0x${string}`> => {
    if (!state.address || !window.ethereum) throw new Error('Wallet not connected.')
    const wc = createWalletClient({
      account: state.address,
      chain: celoSepolia,
      transport: custom(window.ethereum as Parameters<typeof custom>[0]),
    })
    return wc.signMessage({ message })
  }, [state.address])

  return (
    <WalletContext.Provider value={{ ...state, connect, disconnect, switchToCelo, signMessage }}>
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
