'use client'

import { ThirdwebProvider } from 'thirdweb/react'
import { WalletProvider } from '@/providers/wallet-provider'
import { PlayerNameProvider } from '@/providers/player-name-provider'
import { SoundProvider } from '@/providers/sound-provider'
import { SplashScreen } from '@/components/ui/splash-screen'
import { Toaster } from 'sonner'
import { useEffect, useState, type ReactNode } from 'react'

export function Providers({ children }: Readonly<{ children: ReactNode }>) {
  const [splashResolved, setSplashResolved] = useState(false)

  // Hand off from the server-rendered #intro-veil (see layout.tsx) to the real
  // client splash. By the time this effect runs, SplashScreen has committed in
  // the same pass, so whatever should be covering the page already is.
  useEffect(() => {
    document.getElementById('intro-veil')?.remove()
  }, [])

  // Children are NEVER opacity-gated. Two earlier versions of this file did gate
  // them, and both wrecked Largest Contentful Paint:
  //   1. `opacity: splashResolved ? 1 : 0` held content invisible until the user
  //      clicked through the splash. Lighthouse never clicks, so the whole app
  //      stayed at opacity 0 and Chrome recorded no LCP candidate at all —
  //      NO_LCP, which voids the entire Performance category.
  //   2. Gating on hydration instead still meant nothing contentful painted
  //      before the JS bundle had parsed and run. FCP and LCP collapsed onto the
  //      same ~3s number on a throttled phone; mobile Performance was 78.
  // The veil covers the page from the very first frame instead, which is both
  // faster and does not depend on JavaScript. Verified with a CDP paint probe.
  return (
    <ThirdwebProvider>
    <SoundProvider>
      <SplashScreen onResolved={() => setSplashResolved(true)} />
      <WalletProvider>
        <PlayerNameProvider>
          <div style={{ pointerEvents: splashResolved ? 'auto' : 'none' }}>
            {children}
          </div>
        </PlayerNameProvider>
      </WalletProvider>
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: '#0e180d',
            border: '1px solid rgba(107,142,35,0.25)',
            color: '#d4c9b2',
            fontFamily: 'monospace',
            fontSize: '0.8rem',
          },
        }}
      />
    </SoundProvider>
    </ThirdwebProvider>
  )
}
