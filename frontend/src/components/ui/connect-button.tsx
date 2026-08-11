'use client'

import { useState, useRef, useEffect } from 'react'
import { useWallet } from '@/hooks/useWallet'

/**
 * `align` controls which edge the account dropdown hangs from.
 *
 * The default 'right' is correct in the desktop header, where the button sits
 * at the far right and the panel opens inward. In the mobile menu the button is
 * the LEFT-most item, so a right-anchored 200px panel starts at roughly -74px
 * and gets clipped off-screen — which is exactly what MiniPay showed on device:
 * "SIGNED IN" rendered as "SNED IN" with the address and copy row cut in half.
 */
export function ConnectButton({ align = 'right' }: { align?: 'left' | 'right' } = {}) {
  const { isConnected, address, isLoading, isMiniPay, connect, disconnect } = useWallet()
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

  // MiniPay manages its own wallet — no connect UI needed
  if (isMiniPay && !isConnected) return null

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
          background: 'linear-gradient(135deg, #cc1414, #c97a12)',
          color: '#060b06',
          boxShadow: '0 0 12px rgba(107,142,35,0.35)',
        }}
      >
        {isLoading ? 'Connecting…' : 'Play Now'}
      </button>
    )
  }

  const short = `${address.slice(0, 6)}…${address.slice(-4)}`

  // MiniPay's gateway rules forbid a raw 0x… address as the *primary* user
  // identifier — a truncated form is allowed only as a secondary hint. Inside
  // MiniPay the chip therefore reads "Account" and the address appears once,
  // truncated, inside the dropdown. Outside MiniPay (desktop wallets) the full
  // address is genuinely useful, so it stays.
  const chipLabel = isMiniPay ? 'Account' : short

  return (
    <div ref={ref} className="relative flex-shrink-0" style={{ zIndex: 100 }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider transition-all duration-150 hover:opacity-90"
        style={{
          background: 'linear-gradient(135deg, #6b8e23, #5a8a2a)',
          color: '#060b06',
          boxShadow: '0 0 10px rgba(107,142,35,0.3)',
        }}
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: '#060b06', boxShadow: '0 0 4px rgba(0,0,0,0.5)' }}
        />
        {chipLabel}
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
        >
          <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        </svg>
      </button>

      {open && (
        <div
          className={`absolute top-full mt-1 min-w-[200px] max-w-[calc(100vw-2rem)] rounded-xl border p-2 ${
            align === 'left' ? 'left-0' : 'right-0'
          }`}
          style={{ backgroundColor: '#0a100a', borderColor: 'rgba(107,142,35,0.2)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', zIndex: 200, position: 'absolute' }}
        >
          {/* Address — truncated under MiniPay (secondary hint only), full
              elsewhere, where desktop users actually want to read it. */}
          <div className="px-3 py-2">
            <p className="font-mono text-[10px] uppercase tracking-wider" style={{ color: '#7d9a72' }}>Signed In</p>
            <p className="mt-1 font-mono text-xs break-all" style={{ color: '#8fa882' }}>
              {isMiniPay ? short : address}
            </p>
          </div>

          <div className="my-1 border-t" style={{ borderColor: 'rgba(107,142,35,0.1)' }} />

          {/* Copy */}
          <button
            onClick={copy}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 font-mono text-xs uppercase tracking-wider transition-all hover:opacity-80"
            style={{ color: copied ? '#6b8e23' : '#8fa882', backgroundColor: copied ? 'rgba(107,142,35,0.08)' : 'transparent' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            {copied ? 'Copied!' : 'Copy Address'}
          </button>

          {/* Sign Out — hidden in MiniPay (no concept of signing out) */}
          {!isMiniPay && (
            <button
              onClick={handleDisconnect}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 font-mono text-xs uppercase tracking-wider transition-all hover:opacity-80"
              style={{ color: '#cc1414', backgroundColor: 'transparent' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Sign Out
            </button>
          )}
        </div>
      )}
    </div>
  )
}
