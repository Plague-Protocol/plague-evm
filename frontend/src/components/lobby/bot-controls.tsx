'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { formatToken } from '@/lib/format'

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
  const [msg, setMsg] = useState<string | null>(null)
  const reduced = useReducedMotion()
  // Pulse the free-bot counter when it changes while mounted.
  // Render-time state adjustment — the React-endorsed "previous value" pattern.
  const [prevAvail, setPrevAvail] = useState<number | null>(null)
  const availJustChanged = prevAvail !== null && avail !== null && prevAvail !== avail.available
  if ((avail?.available ?? null) !== prevAvail) setPrevAvail(avail?.available ?? null)

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
      setMsg(r.ok ? `Sending ${j.queued ?? effectiveCount} bot(s) — they'll join shortly.` : j.message ?? 'Could not add bots.')
      void load()
    } catch {
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
          <span className="font-mono text-xs" style={{ color: '#4a5e44' }}>
            Bot pool is offline.
          </span>
        ) : stakeTooHigh ? (
          <span className="font-mono text-xs" style={{ color: '#4a5e44' }}>
            Stake too high for bots (max {formatToken(capWei)} {TOKEN}). Lower the stake to fill with bots.
          </span>
        ) : (
          <>
            <motion.span
              key={avail.available}
              initial={availJustChanged && !reduced ? { scale: 1.35, color: '#f5c518' } : false}
              animate={{ scale: 1, color: '#d4c9b2' }}
              transition={{ type: 'spring', stiffness: 300, damping: 16 }}
              className="inline-block font-mono text-xs"
            >
              {avail.available}/{avail.total} free
            </motion.span>
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
      {msg && (
        <p className="mt-2 font-mono text-[11px]" style={{ color: '#8fa882' }}>
          {msg}
        </p>
      )}
    </div>
  )
}
