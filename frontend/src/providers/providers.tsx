'use client'

import { WalletProvider } from '@/providers/wallet-provider'
import { SoundProvider } from '@/providers/sound-provider'
import { SplashScreen } from '@/components/ui/splash-screen'
import { Toaster } from 'sonner'
import type { ReactNode } from 'react'

export function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SoundProvider>
      <SplashScreen />
      <WalletProvider>{children}</WalletProvider>
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: '#0e180d',
            border: '1px solid rgba(57,255,20,0.25)',
            color: '#d4c9b2',
            fontFamily: 'monospace',
            fontSize: '0.8rem',
          },
        }}
      />
    </SoundProvider>
  )
}
