'use client'

/**
 * useAgentIds — which players in this room are registered on-chain agents.
 *
 * The point is verifiability, not decoration. An id here resolves on 8004scan
 * independently of us, so a visitor can confirm the claim rather than trust the
 * badge.
 *
 * Resolved once per distinct roster: registrations do not change mid-game, and
 * re-querying every render would put an identity lookup on the hot path of a
 * time-boxed phase.
 */

import { useEffect, useRef, useState } from 'react'
import { readAgentIds } from '@/lib/contract'

const NETWORK = (process.env.NEXT_PUBLIC_NETWORK === 'testnet' ? 'testnet' : 'mainnet') as
  'testnet' | 'mainnet'

export function useAgentIds(addresses: readonly string[]): Record<string, string> {
  const [ids, setIds] = useState<Record<string, string>>({})
  const seenRef = useRef<string>('')

  useEffect(() => {
    const key = [...addresses].map(a => a.toLowerCase()).sort().join(',')
    if (!key || key === seenRef.current) return
    seenRef.current = key

    let cancelled = false
    void readAgentIds(addresses as `0x${string}`[], NETWORK)
      .then(res => { if (!cancelled) setIds(prev => ({ ...prev, ...res })) })
      .catch(() => { /* no badges is a fine outcome; never break the roster */ })
    return () => { cancelled = true }
  }, [addresses])

  return ids
}

/** Where anyone can verify an agent id, independently of this app. */
export function agentScanUrl(agentId: string): string {
  return `https://8004scan.io/agents/celo/${agentId}`
}
