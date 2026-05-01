'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface SoundContextValue {
  muted: boolean
  toggleMute: () => void
}

const SoundContext = createContext<SoundContextValue | null>(null)

export function SoundProvider({ children }: { children: ReactNode }) {
  const [muted, setMuted] = useState(false)
  const toggleMute = useCallback(() => setMuted(m => !m), [])
  return (
    <SoundContext.Provider value={{ muted, toggleMute }}>
      {children}
    </SoundContext.Provider>
  )
}

export function useSound(): SoundContextValue {
  const ctx = useContext(SoundContext)
  if (!ctx) throw new Error('useSound must be used inside <SoundProvider>')
  return ctx
}
