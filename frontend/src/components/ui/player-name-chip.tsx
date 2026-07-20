'use client'

import { useEffect, useRef, useState } from 'react'
import { usePlayerName } from '@/providers/player-name-provider'
import { useWallet } from '@/providers/wallet-provider'
import { DisplayNameEditor } from './display-name-editor'

type PlayerNameChipProps = {
  /**
   * Expand the editor in normal flow instead of an absolute popover. Used in
   * the mobile dropdown, where a floating panel would overflow the menu.
   */
  inline?: boolean
}

/**
 * The connected player's name, sitting beside the wallet button.
 *
 * This is the discoverability fix: identity belongs in the persistent header
 * where people look for it, not only in a card below the fold on the lobby.
 */
export function PlayerNameChip({ inline = false }: PlayerNameChipProps) {
  const { isConnected } = useWallet()
  const { name, loading } = usePlayerName()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Dismiss the popover on outside click or Escape. Skipped in inline mode,
  // where the editor is part of an already-dismissable menu.
  useEffect(() => {
    if (!open || inline) return
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, inline])

  if (!isConnected) return null

  const label = loading && !name ? '…' : name ?? 'Set name'

  return (
    <div ref={wrapRef} className={inline ? 'w-full' : 'relative'}>
      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Edit display name"
        aria-expanded={open}
        className="flex max-w-[10rem] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition-all hover:opacity-80"
        style={{
          borderColor: 'rgba(107,142,35,0.25)',
          backgroundColor: open ? 'rgba(107,142,35,0.1)' : 'transparent',
        }}
      >
        <span
          className="truncate font-mono text-xs font-bold tracking-wider"
          style={{ color: name ? '#d4c9b2' : '#6b8e23' }}
        >
          {label}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ color: '#4a5e44', flexShrink: 0 }}
        >
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>

      {open && (
        <div
          className={
            inline
              ? 'mt-2 w-full rounded-lg border p-3'
              : 'absolute right-0 top-full z-[200] mt-2 w-72 rounded-lg border p-3 backdrop-blur'
          }
          style={{ borderColor: 'rgba(107,142,35,0.3)', backgroundColor: 'rgba(6,11,6,0.98)' }}
        >
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#4a5e44' }}>
            Display Name
          </p>
          <DisplayNameEditor
            onDone={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
