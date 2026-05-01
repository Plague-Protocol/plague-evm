'use client'

import { useState, useRef, useEffect } from 'react'
import { useWallet } from '@/hooks/useWallet'

export function ConnectButton() {
  const { isConnected, address, isLoading, connect, disconnect } = useWallet()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const copy = () => {
    if (!address) return
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDisconnect = () => {
    setOpen(false)
    disconnect()
  }

  if (!isConnected || !address) {
    return (
      <button
        onClick={connect}
        disabled={isLoading}
        className="flex-shrink-0 whitespace-nowrap rounded-lg px-4 py-1.5 font-mono text-xs font-bold uppercase tracking-wider transition-all duration-150 hover:opacity-90 disabled:opacity-50"
        style={{
          background: 'linear-gradient(135deg, #cc1414, #39ff14)',
          color: '#060b06',
          boxShadow: '0 0 12px rgba(57,255,20,0.35)',
        }}
      >
        {isLoading ? 'Connecting…' : 'Connect Wallet'}
      </button>
    )
  }

  const short = `${address.slice(0, 6)}…${address.slice(-4)}`

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider transition-all duration-150 hover:opacity-90"
        style={{
          background: 'linear-gradient(135deg, #39ff14, #5a8a2a)',
          color: '#060b06',
          boxShadow: '0 0 10px rgba(57,255,20,0.3)',
        }}
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: '#060b06', boxShadow: '0 0 4px rgba(0,0,0,0.5)' }}
        />
        {short}
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
        >
          <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-xl border p-2"
          style={{ backgroundColor: '#0a100a', borderColor: 'rgba(57,255,20,0.2)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
        >
          {/* Full address */}
          <div className="px-3 py-2">
            <p className="font-mono text-[10px] uppercase tracking-wider" style={{ color: '#4a5e44' }}>Connected</p>
            <p className="mt-1 font-mono text-xs break-all" style={{ color: '#8fa882' }}>{address}</p>
          </div>

          <div className="my-1 border-t" style={{ borderColor: 'rgba(57,255,20,0.1)' }} />

          {/* Copy */}
          <button
            onClick={copy}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 font-mono text-xs uppercase tracking-wider transition-all hover:opacity-80"
            style={{ color: copied ? '#39ff14' : '#8fa882', backgroundColor: copied ? 'rgba(57,255,20,0.08)' : 'transparent' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            {copied ? 'Copied!' : 'Copy Address'}
          </button>

          {/* Disconnect */}
          <button
            onClick={handleDisconnect}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 font-mono text-xs uppercase tracking-wider transition-all hover:opacity-80"
            style={{ color: '#cc1414', backgroundColor: 'transparent' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Disconnect
          </button>
        </div>
      )}
    </div>
  )
}
