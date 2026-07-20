'use client'

import { useEffect, useRef, useState } from 'react'
import { usePlayerName } from '@/providers/player-name-provider'

type DisplayNameEditorProps = {
  /** Fired after a successful save. */
  onDone?: () => void
  /** Omit to hide the cancel button (e.g. when there's nothing to fall back to). */
  onCancel?: () => void
  autoFocus?: boolean
}

/**
 * Input + availability check + save for the player's display name.
 *
 * Shared by the nav chip's popover and the lobby Account card so both entry
 * points behave identically — same debounce, same taken-name feedback.
 */
export function DisplayNameEditor({ onDone, onCancel, autoFocus = true }: DisplayNameEditorProps) {
  const { name, saving, save, checkAvailability } = usePlayerName()
  const [input, setInput] = useState(name ?? '')
  const [available, setAvailable] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced availability lookup. A response that lands after the user has
  // typed further is discarded, otherwise a stale verdict can overwrite the
  // current one and mislabel a free name as taken.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const trimmed = input.trim()
    if (!trimmed || trimmed === name) {
      setAvailable(null)
      setChecking(false)
      return
    }
    let cancelled = false
    setChecking(true)
    timerRef.current = setTimeout(async () => {
      const result = await checkAvailability(trimmed)
      if (cancelled) return
      setAvailable(result)
      setChecking(false)
    }, 400)
    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [input, name, checkAvailability])

  const submit = async () => {
    const result = await save(input)
    if (result === 'ok') onDone?.()
    else if (result === 'taken') setAvailable(false)
  }

  const blocked = saving || !input.trim() || available === false

  return (
    <>
      <div className="flex gap-2">
        <input
          type="text"
          maxLength={20}
          placeholder="Your name"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !blocked) submit()
            if (e.key === 'Escape') onCancel?.()
          }}
          autoFocus={autoFocus}
          className="min-w-0 flex-1 rounded border bg-transparent px-3 py-2 font-mono text-xs focus:outline-none placeholder:opacity-30"
          style={{
            borderColor: available === false ? 'rgba(230,51,41,0.5)' : 'rgba(107,142,35,0.4)',
            color: '#d4c9b2',
          }}
        />
        <button
          onClick={submit}
          disabled={blocked}
          className="rounded border px-3 py-2 font-mono text-xs uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-40"
          style={{ borderColor: 'rgba(107,142,35,0.4)', color: '#6b8e23' }}
        >
          {saving ? '…' : 'Save'}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded border px-3 py-2 font-mono text-xs uppercase tracking-wider transition-all hover:opacity-90"
            style={{ borderColor: 'rgba(212,201,178,0.2)', color: '#8fa882' }}
          >
            Cancel
          </button>
        )}
      </div>
      {input.trim() && input.trim() !== name && (
        <p
          className="mt-1 font-mono text-[10px]"
          style={{
            color: checking ? '#4a5e44' : available === true ? '#6b8e23' : available === false ? '#e63329' : '#4a5e44',
          }}
        >
          {checking ? 'Checking…' : available === true ? '✓ Available' : available === false ? '✗ Already taken' : ''}
        </p>
      )}
    </>
  )
}
