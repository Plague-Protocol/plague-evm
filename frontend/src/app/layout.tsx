import type { Metadata, Viewport } from 'next'
import { Oswald, VT323, Share_Tech_Mono, Eater, Nosifer } from 'next/font/google'
import Script from 'next/script'
import { Providers } from '@/providers/providers'
import './globals.css'

// Decayed "eaten" display face — headers, player names, stats.
const displayFont = Eater({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display',
  display: 'swap',
})

// Dripping-blood face reserved for the scream moments: phase stamps,
// game-over verdict. Kept separate so it stays scary on mobile too.
const horrorFont = Nosifer({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-horror',
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

// Mobile-friendly mono — chat/feed reading text swaps to this under 640px.
// Display/horror faces are NOT swapped on mobile (heading sizes stay readable).
const monoMobileFont = Share_Tech_Mono({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-mono-mobile',
})

// Do NOT reintroduce `maximumScale: 1` / user-scalable=no. Lighthouse flags it
// as an accessibility failure (it blocks pinch-zoom for low-vision users), and
// it cost points on every audited route. It was there to stop iOS Safari
// auto-zooming on input focus — the correct fix for that is a >=16px font-size
// on form fields, which `globals.css` now enforces.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export const metadata: Metadata = {
  // Without this, Next resolves Open Graph image URLs against localhost:3000 and
  // warns on every build — social/link previews then point at a dead host.
  metadataBase: new URL('https://zplague.xyz'),
  title: 'Zombie Plague — On-Chain Social Deduction',
  description:
    'A decentralised social deduction game powered by ZK proofs and Celo EVM smart contracts.',
  manifest: '/manifest.json',
  // z-plague-icon.png is a 1024px, 1.8 MB PNG. Pointing the favicon and the
  // apple-touch icon at it made every page load drag ~1.8 MB down purely for
  // tab furniture. These resized variants are 2.4 KB / 58 KB.
  icons: {
    icon: '/favicon-32.png',
    apple: '/apple-touch-icon.png',
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
    <html lang="en" className={`${displayFont.variable} ${horrorFont.variable} ${bodyFont.variable} ${monoFont.variable} ${monoMobileFont.variable}`}>
      <head>
        {/* The veil's mark is the first meaningful paint on every route, so let
            the preload scanner find it before CSS is even parsed. */}
        <link rel="preload" as="image" href="/images/splash-mark.webp" fetchPriority="high" />
        {/* Runs before first paint. A returning visitor within the same session
            has already seen the intro, so the veil must never flash for them —
            this is the standard pre-paint flag pattern, and it has to be inline
            and blocking to beat the renderer. */}
        <script
          id="intro-veil-flag"
          dangerouslySetInnerHTML={{
            __html: `try{if(sessionStorage.getItem('plague_intro_seen')){document.documentElement.dataset.introSeen='1'}}catch(e){}`,
          }}
        />
      </head>
      <body className="antialiased">
        <Script id="sw-register" strategy="afterInteractive">{`
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js');
            });
          }
        `}</Script>

        {/*
          Server-rendered intro veil. This exists for one reason: Largest
          Contentful Paint.

          The client SplashScreen can only mount after hydration. Previously the
          page content was held at opacity 0 until then, so on a mid-range phone
          NOTHING contentful painted for ~3s — FCP and LCP were the same number,
          both equal to hydration time, and mobile Performance sat at 78.

          This markup ships in the HTML itself, so it paints in the first frame:
          it gives an immediate LCP candidate (a bounded <img>, not a
          full-viewport background, which Chrome would exclude), and it opaquely
          covers the content underneath so that content no longer needs an
          opacity gate. Providers removes this node once React is mounted and
          the real splash has taken over.
        */}
        <div id="intro-veil" aria-hidden="true">
          <img
            src="/images/splash-mark.webp"
            alt=""
            width={224}
            height={224}
            fetchPriority="high"
            decoding="sync"
          />
        </div>

        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
