import type { Metadata, Viewport } from 'next'
import { Oswald, VT323, Rajdhani, Share_Tech_Mono } from 'next/font/google'
import localFont from 'next/font/local'
import Script from 'next/script'
import { Providers } from '@/providers/providers'
import './globals.css'

const displayFont = localFont({
  src: '../../public/fonts/Zombie_Holocaust.ttf',
  weight: '400',
  style: 'normal',
  variable: '--font-display',
  display: 'swap',
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

// maximum-scale=1 stops iOS Safari from auto-zooming the viewport when a form
// field (including third-party ones like the Thirdweb sign-in modal) is focused.
// iOS 10+ still permits manual pinch-zoom, so accessibility is preserved.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export const metadata: Metadata = {
  title: 'Zombie Plague — On-Chain Social Deduction',
  description:
    'A decentralised social deduction game powered by ZK proofs and Celo EVM smart contracts.',
  manifest: '/manifest.json',
  icons: {
    icon: '/z-plague-icon.png',
    apple: '/z-plague-icon.png',
  },
  openGraph: {
    title: 'Zombie Plague',
    description: 'Can you find Patient Zero before the infection spreads?',
    images: [{ url: '/images/z-plague-image.png', width: 1200, height: 630 }],
  },
  other: {
    'talentapp:project_verification': '734c0dd315dbccb48f9a22fb0dd3124c1ec99e4cc50610ee9c895db0b5739aaa353547cba1bba32353ac5c633a1a10287cc39939f6046ab17b845323baa09542',
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
    'apple-mobile-web-app-title': 'Z-Plague',
    'theme-color': '#16a34a',
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
        <Script id="sw-register" strategy="afterInteractive">{`
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js');
            });
          }
        `}</Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
