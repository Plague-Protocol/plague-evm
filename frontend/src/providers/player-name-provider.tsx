'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'
import { useWallet } from '@/providers/wallet-provider'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'

export type SaveNameResult = 'ok' | 'taken' | 'error'

type PlayerNameContextValue = {
  /** Canonical display name for the connected wallet, null until loaded. */
  name: string | null
  loading: boolean
  saving: boolean
  save: (next: string) => Promise<SaveNameResult>
  /** null = indeterminate (empty input, unchanged, or request failed). */
  checkAvailability: (candidate: string) => Promise<boolean | null>
}

const PlayerNameContext = createContext<PlayerNameContextValue | null>(null)

/**
 * Owns the connected player's display name for the whole app.
 *
 * Lives at the root so the nav chip and the lobby's Account card read the same
 * value — previously the lobby held this in local state, which meant the name
 * could only be seen or changed from one card far down that page.
 *
 * On connect this calls ensure-nickname, which assigns a thematic name to
 * players who have none. That call is idempotent, so running it on every
 * connect is safe and a returning player's chosen name is never overwritten.
 */
export function PlayerNameProvider({ children }: { children: ReactNode }) {
  const { address } = useWallet()
  const [name, setName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Guards the "we picked a name for you" toast so it fires once per wallet per
  // session — React strict-mode double-mounts and wallet reconnects would
  // otherwise re-announce a name the player has already seen.
  const announcedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!address) {
      setName(null)
      return
    }
    // Ignore a resolved response for a wallet the user has already switched
    // away from, which would otherwise show the previous account's name.
    let cancelled = false
    setLoading(true)

    fetch(`${BACKEND_URL}/api/players/ensure-nickname`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    })
      .then(r => r.json())
      .then((d: { nickname: string | null; generated: boolean }) => {
        if (cancelled) return
        setName(d.nickname)
        if (d.generated && d.nickname && !announcedRef.current.has(address)) {
          announcedRef.current.add(address)
          toast.success(`You're playing as ${d.nickname} — tap your name up top to change it.`)
        }
      })
      .catch(() => { /* leave the name unset; the address fallback still renders */ })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [address])

  const checkAvailability = useCallback(async (candidate: string): Promise<boolean | null> => {
    const trimmed = candidate.trim()
    if (!trimmed || trimmed === name) return null
    try {
      const params = new URLSearchParams({ nickname: trimmed })
      if (address) params.set('address', address)
      const res = await fetch(`${BACKEND_URL}/api/players/check-nickname?${params}`)
      if (!res.ok) return null
      const data = await res.json() as { available: boolean }
      return data.available
    } catch {
      return null
    }
  }, [address, name])

  const save = useCallback(async (next: string): Promise<SaveNameResult> => {
    if (!address) return 'error'
    const trimmed = next.trim()
    if (!trimmed) return 'error'
    setSaving(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/players/nickname`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, nickname: trimmed }),
      })
      if (res.status === 409) {
        const data = await res.json() as { error?: string }
        toast.error(data.error || 'This display name is already taken.')
        return 'taken'
      }
      if (!res.ok) throw new Error('Failed to save')
      setName(trimmed)
      toast.success(`Name saved: ${trimmed}`)
      return 'ok'
    } catch {
      toast.error('Could not save name. Try again.')
      return 'error'
    } finally {
      setSaving(false)
    }
  }, [address])

  return (
    <PlayerNameContext.Provider value={{ name, loading, saving, save, checkAvailability }}>
      {children}
    </PlayerNameContext.Provider>
  )
}

export function usePlayerName(): PlayerNameContextValue {
  const ctx = useContext(PlayerNameContext)
  if (!ctx) throw new Error('usePlayerName must be used within a PlayerNameProvider')
  return ctx
}
