'use client'

import { WalletProvider } from '@/providers/wallet-provider'
import { SoundProvider } from '@/providers/sound-provider'
import { SplashScreen } from '@/components/ui/splash-screen'
import { Toaster } from 'sonner'
import { useState, type ReactNode } from 'react'

export function Providers({ children }: Readonly<{ children: ReactNode }>) {
  const [splashResolved, setSplashResolved] = useState(false)

  return (
    <SoundProvider>
      <SplashScreen onResolved={() => setSplashResolved(true)} />
      <WalletProvider>
        {/* Visibility gate: hide children until splash resolves to prevent flash */}
        <div
          style={{
            opacity: splashResolved ? 1 : 0,
            transition: 'opacity 0.3s ease',
            pointerEvents: splashResolved ? 'auto' : 'none',
          }}
        >
          {children}
        </div>
      </WalletProvider>
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
