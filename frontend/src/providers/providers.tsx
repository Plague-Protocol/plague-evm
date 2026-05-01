'use client'

import { WalletProvider } from '@/providers/wallet-provider'
import type { ReactNode } from 'react'

export function Providers({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>
}
