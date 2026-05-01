'use client'

import { WalletProvider } from '@/providers/wallet-provider'
import { SoundProvider } from '@/providers/sound-provider'
import type { ReactNode } from 'react'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SoundProvider>
      <WalletProvider>{children}</WalletProvider>
    </SoundProvider>
  )
}
