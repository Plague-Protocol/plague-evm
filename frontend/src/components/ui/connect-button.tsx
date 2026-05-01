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
          ? 'linear-gradient(135deg, #39ff14, #5a8a2a)'
          : 'linear-gradient(135deg, #cc1414, #39ff14)',
        color: '#060b06',
        boxShadow: '0 0 12px rgba(57,255,20,0.35)',
      }}
    >
      {label}
    </button>
  )
}
