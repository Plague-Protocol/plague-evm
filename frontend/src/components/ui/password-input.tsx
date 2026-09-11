'use client'

/**
 * PasswordInput — a masked field with a reveal toggle.
 *
 * The Shield Password is not a credential; it is a phrase the player has to
 * retype correctly, from memory, several minutes later, under a timer, to prove
 * they are clean. A typo at setup is silent — it surfaces only when the shield
 * fails to activate, by which point the round is lost and so is the stake.
 * Being able to read back what you typed is the difference between a mistake
 * you catch and one that costs money.
 *
 * Masked by default all the same: players share screens, and the phrase is the
 * one secret in the game that another player must never see.
 */

import { useState } from 'react'

export interface PasswordInputProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder?: string
  readonly borderColor?: string
  readonly className?: string
  readonly disabled?: boolean
  /** Submit-on-Enter and the like. */
  readonly onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
}

export function PasswordInput({
  value,
  onChange,
  placeholder,
  borderColor = 'rgba(107,142,35,0.4)',
  className = '',
  disabled = false,
  onKeyDown,
}: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false)

  return (
    <div className={`relative ${className}`}>
      <input
        type={revealed ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        // pr-11 leaves room for the toggle; without it a long phrase runs
        // underneath the icon and the last characters — the ones most likely
        // to hold the typo — are the ones you cannot read.
        className="w-full rounded border bg-transparent px-3 py-2 pr-11 font-mono text-sm focus:outline-none"
        style={{ borderColor, color: '#d4c9b2' }}
      />
      <button
        type="button"
        onClick={() => setRevealed(r => !r)}
        aria-label={revealed ? 'Hide password' : 'Show password'}
        aria-pressed={revealed}
        // Tall enough to be a comfortable tap target on a phone without
        // growing the field itself.
        className="absolute right-0 top-0 flex h-full w-11 items-center justify-center transition-opacity hover:opacity-100"
        style={{ color: '#8fa882', opacity: 0.7 }}
      >
        {revealed ? (
          // Eye with a slash — currently visible, tap to hide.
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          // Plain eye — currently hidden, tap to show.
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  )
}
