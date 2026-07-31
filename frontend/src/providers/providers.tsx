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
  // The anti-flash gate only needs to cover the pre-hydration window: the SSR
  // HTML paints before SplashScreen's mount effect can decide whether to show.
  // It flips in a mount effect, which commits in the same pass as the splash's
  // own — so the opaque overlay is already on top when children become visible.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])

  // NEVER gate this on `splashResolved` alone. That kept every page's content at
  // opacity 0 until the user clicked through the splash, and opacity-0 subtrees
  // are ineligible for Largest Contentful Paint — so Lighthouse recorded no LCP
  // candidate at all and returned NO_LCP, which zeroes out the whole Performance
  // category. Verified with a CDP paint probe. The splash is a fixed, fully
  // opaque #000 overlay at z-index 9999, so it already hides what's underneath;
  // this gate is belt-and-braces for the first frame only.
  const contentVisible = hydrated || splashResolved

  return (
    <ThirdwebProvider>
    <SoundProvider>
      <SplashScreen onResolved={() => setSplashResolved(true)} />
      <WalletProvider>
        <PlayerNameProvider>
          <div
            style={{
              opacity: contentVisible ? 1 : 0,
              pointerEvents: splashResolved ? 'auto' : 'none',
            }}
          >
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
