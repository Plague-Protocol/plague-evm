'use client'

import { useWallet } from '@/hooks/useWallet'

export function ConnectButton() {
  const { isConnected, address, isLoading, connect, disconnect } = useWallet()

  const label = isLoading
    ? 'Connecting…'
    : isConnected && address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : 'Connect Wallet'

  return (
    <button
      onClick={isConnected ? disconnect : connect}
      disabled={isLoading}
      className="flex-shrink-0 whitespace-nowrap rounded-lg px-4 py-1.5 font-mono text-xs font-bold uppercase tracking-wider transition-all duration-150 hover:opacity-90 disabled:opacity-50"
      style={{
        background: isConnected
          ? 'linear-gradient(135deg, #06b6d4, #a855f7)'
          : 'linear-gradient(135deg, #a855f7, #06b6d4)',
        color: '#f0f4f8',
        boxShadow: '0 0 12px rgba(168,85,247,0.4)',
      }}
    >
      {label}
    </button>
  )
}
