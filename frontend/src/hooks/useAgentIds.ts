'use client'

/**
 * useAgentAddresses — which players in this room hold an on-chain agent identity.
 *
 * Verifiability, not decoration: the same ERC-8004 balanceOf call resolves for
 * anyone, so a visitor can confirm the badge instead of trusting it. It also
 * works for third-party agents, which is the point — the claim is "agents can
 * compete here", not "our bots are here".
 *
 * Resolved once per distinct roster. Registrations do not change mid-game, and
 * re-querying every render would put an identity lookup on the hot path of a
 * time-boxed phase.
 */

import { useEffect, useRef, useState } from 'react'
import { readAgentAddresses } from '@/lib/contract'

const NETWORK = (process.env.NEXT_PUBLIC_NETWORK === 'testnet' ? 'testnet' : 'mainnet') as
  'testnet' | 'mainnet'

export function useAgentAddresses(addresses: readonly string[]): Set<string> {
  const [agents, setAgents] = useState<Set<string>>(new Set())
  const seenRef = useRef<string>('')

  useEffect(() => {
    const key = [...addresses].map(a => a.toLowerCase()).sort().join(',')
    if (!key || key === seenRef.current) return
    seenRef.current = key

    let cancelled = false
    void readAgentAddresses(addresses as `0x${string}`[], NETWORK)
      .then(res => { if (!cancelled) setAgents(res) })
      .catch(() => { /* no badges is a fine outcome; never break the roster */ })
    return () => { cancelled = true }
  }, [addresses])

  return agents
}
