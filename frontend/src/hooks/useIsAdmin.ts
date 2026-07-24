'use client'

import { useEffect, useState } from 'react'
import { useWallet } from './useWallet'
import { createContractClient } from '@/lib/contract'

// Module-level cache: the contract admin never changes within a session, and
// the nav renders on every page — one RPC read total, not one per navigation.
let cachedAdmin: `0x${string}` | null | undefined

/** True when the connected wallet is the contract's admin(). */
export function useIsAdmin(): boolean {
  const { address } = useWallet()
  const [admin, setAdmin] = useState<`0x${string}` | null>(cachedAdmin ?? null)

  useEffect(() => {
    if (cachedAdmin !== undefined) { setAdmin(cachedAdmin); return }
    if (!address) return // don't spend an RPC read until a wallet connects

    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}` | undefined
    if (!contractAddress) { cachedAdmin = null; return }
    const network = (process.env.NEXT_PUBLIC_NETWORK ?? 'testnet') as 'testnet' | 'mainnet'

    createContractClient({ contractAddress, network })
      .getAdmin()
      .then(a => { cachedAdmin = a; setAdmin(a) })
      .catch(() => { /* leave uncached; retried on next mount */ })
  }, [address])

  return !!address && !!admin && address.toLowerCase() === admin.toLowerCase()
}
