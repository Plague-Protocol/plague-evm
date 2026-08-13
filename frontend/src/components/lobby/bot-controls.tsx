'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatToken } from '@/lib/format'
import { useChangePulse } from '@/hooks/useChangePulse'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'
const TOKEN = 'USDm'

interface Availability {
  online: boolean
  available: number
  total: number
  maxStakeWei: string
}

/**
 * Lets a room host pull bots from the shared pool into their waiting room so they
 * can try the game without other humans. Self-contained: polls availability and
 * posts the add request itself.
 */
export function BotControls({
  roomId,
  stakeAmount,
  freeSeats,
}: {
  roomId: bigint
  stakeAmount: bigint
  freeSeats: number
}) {
  const [avail, setAvail] = useState<Availability | null>(null)
  const [count, setCount] = useState(1)
  const [adding, setAdding] = useState(false)
  const [msgIsError, setMsgIsError] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // Flash the free-bot counter when the pool changes under the host.
  const availJustChanged = useChangePulse(avail?.available)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/bots/availability`)
      if (r.ok) setAvail((await r.json()) as Availability)
    } catch {
      /* leave previous state */
    }
  }, [])

  useEffect(() => {
    void load()
    // Backend-only fetch (no RPC), but still pointless in a hidden tab.
    const id = setInterval(() => {
      if (document.hidden) return
      void load()
    }, 5_000)
    return () => clearInterval(id)
  }, [load])

  if (!avail) return null

  const capWei = BigInt(avail.maxStakeWei || '0')
  const stakeTooHigh = stakeAmount > capWei
  const maxAddable = Math.max(0, Math.min(avail.available, freeSeats))
  const effectiveCount = Math.min(Math.max(count, 1), Math.max(1, maxAddable))
  const disabled = adding || !avail.online || stakeTooHigh || maxAddable < 1

  const add = async () => {
    setAdding(true)
    setMsg(null)
    try {
      const r = await fetch(`${BACKEND_URL}/api/bots/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: roomId.toString(), count: effectiveCount }),
      })
      const j = (await r.json().catch(() => ({}))) as { queued?: number; message?: string }
      const n = j.queued ?? effectiveCount
      setMsgIsError(!r.ok)
      setMsg(r.ok ? `Sending in ${n} bot${n === 1 ? '' : 's'} — they join in a few seconds.` : j.message ?? 'Could not add bots.')
      void load()
    } catch {
      setMsgIsError(true)
      setMsg('Network error reaching the bot pool.')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div
      className="mt-4 rounded border px-3 py-2"
      style={{ borderColor: 'rgba(107,142,35,0.25)', backgroundColor: 'rgba(107,142,35,0.06)' }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: '#8fa882' }}>
          🤖 Play with bots
        </span>

        {!avail.online ? (
          <span className="font-mono text-xs" style={{ color: '#7d9a72' }}>
            Bot pool is offline.
          </span>
        ) : stakeTooHigh ? (
          <span className="font-mono text-xs" style={{ color: '#7d9a72' }}>
            Stake too high for bots (max {formatToken(capWei)} {TOKEN}). Lower the stake to fill with bots.
          </span>
        ) : (
          <>
            {/* CSS pulse rather than framer-motion: this component renders
                inside every lobby room card, so importing the animation
                library here would put it back on the lobby's critical path. */}
            <span
              className={`inline-block font-mono text-xs${availJustChanged ? ' count-pulse' : ''}`}
              style={{ color: '#d4c9b2' }}
            >
              {avail.available}/{avail.total} free
            </span>
            <select
              value={effectiveCount}
              onChange={e => setCount(Number(e.target.value))}
              disabled={disabled}
              className="rounded border bg-transparent px-2 py-1 font-mono text-xs disabled:opacity-40"
              style={{ borderColor: 'rgba(107,142,35,0.3)', color: '#d4c9b2' }}
            >
              {Array.from({ length: Math.max(1, maxAddable) }, (_, i) => i + 1).map(n => (
                <option key={n} value={n} style={{ backgroundColor: '#0e180d' }}>
                  {n} bot{n > 1 ? 's' : ''}
                </option>
              ))}
            </select>
            <button
              onClick={add}
              disabled={disabled}
              className="rounded border px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider transition-all hover:opacity-90 disabled:opacity-40"
              style={{ borderColor: '#6b8e23', color: '#84cc16', backgroundColor: 'rgba(107,142,35,0.1)' }}
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
          </>
        )}
      </div>
      {/* Status, deliberately loud.
          This was 11px in the same muted green as the body copy, and only
          appeared once the request had already finished — so the host pressed
          Add, saw nothing change for a few seconds, and pressed it again. It now
          says what is happening WHILE it happens, and the outcome is coloured so
          a failure cannot be mistaken for a success. */}
      {adding && (
        <p
          className="toxic-pulse mt-2 rounded border px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider"
          style={{ color: '#f5c518', borderColor: 'rgba(245,197,24,0.5)', backgroundColor: 'rgba(245,197,24,0.1)' }}
        >
          Sending in {effectiveCount} bot{effectiveCount === 1 ? '' : 's'}…
        </p>
      )}
      {!adding && msg && (
        <p
          className="mt-2 rounded border px-3 py-2 font-mono text-xs leading-relaxed"
          style={msgIsError
            ? { color: '#e63329', borderColor: 'rgba(230,51,41,0.45)', backgroundColor: 'rgba(230,51,41,0.08)' }
            : { color: '#84cc16', borderColor: 'rgba(107,142,35,0.45)', backgroundColor: 'rgba(107,142,35,0.08)' }}
        >
          {msg}
        </p>
      )}
    </div>
  )
}
