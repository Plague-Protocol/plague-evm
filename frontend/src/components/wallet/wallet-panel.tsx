'use client'

import { useEffect, useState } from 'react'
import { useWallet } from '@/hooks/useWallet'
import { createPublicClient, http, parseAbi } from 'viem'
import { celoSepolia, celo } from 'viem/chains'

const CUSD_ABI = parseAbi([
  'function balanceOf(address account) external view returns (uint256)',
])

const CUSD_ADDRESSES: Record<number, `0x${string}`> = {
  11142220: '0xEF4d55D6dE8e8d73232827Cd1e9b2F2dBb45bC80', // Celo Sepolia
  42220: '0x765DE816845861e75A25fCA122bb6022DB77Eaca',   // Mainnet
}

const CHAIN_NAMES: Record<number, string> = {
  11142220: 'Celo Sepolia',
  42220: 'Celo Mainnet',
}

function useBalance(address: `0x${string}` | null, chainId: number | null) {
  const [balance, setBalance] = useState<string | null>(null)
  useEffect(() => {
    if (!address || !chainId) { setBalance(null); return }
    const cUSDAddress = CUSD_ADDRESSES[chainId]
    if (!cUSDAddress) { setBalance(null); return }
    const client = createPublicClient({
      chain:     chainId === 42220 ? celo : celoSepolia,
      transport: http(),
    })
    client.readContract({ address: cUSDAddress, abi: CUSD_ABI, functionName: 'balanceOf', args: [address] })
      .then(raw => setBalance((Number(raw) / 1e18).toFixed(2)))
      .catch(() => setBalance(null))
  }, [address, chainId])
  return balance
}

type WalletPanelProps = Readonly<{
  variant?: 'dark' | 'light'
}>

export function WalletPanel({ variant = 'dark' }: WalletPanelProps) {
  const isDark = variant === 'dark'
  const { isConnected, address, chainId, isLoading, error, connect, disconnect, switchToCelo } = useWallet()
  const balance = useBalance(address, chainId)

  const networkName = chainId ? (CHAIN_NAMES[chainId] ?? `Chain ${chainId}`) : '—'
  const shortAddress = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'
  const isWrongNetwork = isConnected && chainId !== null && !CUSD_ADDRESSES[chainId]

  return (
    <section
      className={[
        'hud-panel p-5',
        isDark ? 'bg-plague-black text-plague-white' : 'bg-plague-white text-plague-black',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={`font-mono text-xs uppercase tracking-[0.2em] ${isDark ? 'text-plague-white/75' : 'text-plague-black/65'}`}>
            Wallet Status
          </p>
          <h3 className="mt-2 font-display text-4xl leading-none">
            {isConnected ? 'Connected' : 'Disconnected'}
          </h3>
        </div>
        <span className={`inline-block h-3 w-3 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-500'}`} />
      </div>

      {isConnected && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className={`border p-3 rounded ${isDark ? 'border-white/20 bg-white/5' : 'border-black/20 bg-black/5'}`}>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-400">Address</p>
            <p className="mt-2 font-mono text-sm" title={address ?? ''}>{shortAddress}</p>
          </div>
          <div className={`border p-3 rounded ${isDark ? 'border-white/20 bg-white/5' : 'border-black/20 bg-black/5'}`}>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-400">Network</p>
            <p className={`mt-2 font-mono text-sm ${isWrongNetwork ? 'text-red-400' : ''}`}>{networkName}</p>
          </div>
          <div className={`border p-3 rounded ${isDark ? 'border-white/20 bg-white/5' : 'border-black/20 bg-black/5'}`}>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-400">cUSD Balance</p>
            <p className="mt-2 font-display text-2xl leading-none">{balance === null ? '…' : `${balance} cUSD`}</p>
          </div>
        </div>
      )}

      {isWrongNetwork && (
        <p className="mt-3 font-mono text-xs text-red-400">
          Switch to Celo to use Plague Protocol.
        </p>
      )}

      {error && (
        <p className="mt-3 font-mono text-xs text-red-400">{error}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {isConnected ? (
          <>
            {isWrongNetwork && (
              <button
                onClick={() => switchToCelo('testnet')}
                className="rounded border px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider transition-all hover:opacity-90"
                style={{ backgroundColor: '#f5c518', borderColor: '#f5c518', color: '#0a0e27' }}
              >
                Switch to Celo
              </button>
            )}
            <button
              onClick={disconnect}
              className="rounded border px-4 py-3 font-mono text-xs uppercase tracking-wider transition-all hover:opacity-90"
              style={{ borderColor: 'rgba(230,51,41,0.5)', color: '#e63329' }}
            >
              Disconnect
            </button>
          </>
        ) : (
          <button
            onClick={connect}
            disabled={isLoading}
            className="rounded border px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#a855f7', borderColor: '#a855f7', color: '#f0f4f8' }}
          >
            {isLoading ? 'Connecting…' : 'Connect Wallet'}
          </button>
        )}
      </div>
    </section>
  )
}
