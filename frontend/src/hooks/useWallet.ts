'use client'

import { useState, useCallback, useEffect } from 'react'
import { createWalletClient, custom, getAddress } from 'viem'
import { celoAlfajores, celo } from 'viem/chains'

// Minimal EIP-1193 provider type for window.ethereum
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
      on: (event: string, handler: (...args: unknown[]) => void) => void
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void
    }
  }
}

interface WalletState {
  isConnected: boolean
  address: `0x${string}` | null
  chainId: number | null
  isLoading: boolean
  error: string | null
}

const CELO_CHAINS = {
  mainnet: celo,          // 42220
  testnet: celoAlfajores, // 44787
} as const

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    isConnected: false,
    address:     null,
    chainId:     null,
    isLoading:   false,
    error:       null,
  })

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
      const address    = getAddress(accounts[0])

      setState({
        isConnected: true,
        address,
        chainId:   parseInt(rawChainId, 16),
        isLoading: false,
        error:     null,
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

  const disconnect = useCallback(() => {
    setState({ isConnected: false, address: null, chainId: null, isLoading: false, error: null })
  }, [])

  // ── Switch / add Celo network ─────────────────────────────────────────────────

  const switchToCelo = useCallback(async (network: 'mainnet' | 'testnet' = 'testnet') => {
    if (!window.ethereum) throw new Error('No wallet detected.')
    const chain    = CELO_CHAINS[network]
    const chainHex = `0x${chain.id.toString(16)}`

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainHex }],
      })
    } catch (err: unknown) {
      // EIP-1193: 4902 = chain not yet added to the wallet
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId:         chainHex,
            chainName:       chain.name,
            nativeCurrency:  chain.nativeCurrency,
            rpcUrls:         chain.rpcUrls.default.http,
            blockExplorerUrls: chain.blockExplorers
              ? [chain.blockExplorers.default.url]
              : [],
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
      account:   state.address,
      chain:     celoAlfajores,
      transport: custom(window.ethereum as Parameters<typeof custom>[0]),
    })
    return wc.signMessage({ message })
  }, [state.address])

  // ── React to wallet events ────────────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return

    const handleAccountsChanged = (rawAccounts: unknown) => {
      const accounts = rawAccounts as string[]
      if (!accounts.length) {
        setState({ isConnected: false, address: null, chainId: null, isLoading: false, error: null })
      } else {
        setState(prev => ({ ...prev, address: getAddress(accounts[0]) }))
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

  return { ...state, connect, disconnect, switchToCelo, signMessage }
}

