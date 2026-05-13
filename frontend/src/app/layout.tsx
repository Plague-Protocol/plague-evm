import type { Metadata } from 'next'
import { Creepster, Oswald, VT323, Rajdhani, Share_Tech_Mono } from 'next/font/google'
import Script from 'next/script'
import { Providers } from '@/providers/providers'
import './globals.css'

const displayFont = Creepster({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display',
})

const bodyFont = Oswald({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-body',
})

const monoFont = VT323({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-mono',
})

// Mobile-friendly alternatives — readable but still gamey
const displayMobileFont = Rajdhani({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-display-mobile',
})

const monoMobileFont = Share_Tech_Mono({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-mono-mobile',
})

export const metadata: Metadata = {
  title: 'Zombie Plague — On-Chain Social Deduction',
  description:
    'A decentralised social deduction game powered by ZK proofs and Celo EVM smart contracts.',
  icons: {
    icon: '/z-plague-icon.png',
    apple: '/z-plague-icon.png',
  },
  openGraph: {
    title: 'Zombie Plague',
    description: 'Can you find Patient Zero before the infection spreads?',
    images: [{ url: '/images/z-plague-image.png', width: 1200, height: 630 }],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} ${displayMobileFont.variable} ${monoMobileFont.variable}`}>
      <body className="antialiased">
        {/* Unregister any stale service workers so cached JS chunks never
            shadow fresh Next.js assets (prevents "undefined factory" errors). */}
        <Script id="sw-cleanup" strategy="afterInteractive">{`
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(registrations) {
              registrations.forEach(function(r) { r.unregister(); });
            });
          }
        `}</Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
