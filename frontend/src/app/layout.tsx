import type { Metadata } from 'next'
import { Creepster, Oswald, VT323 } from 'next/font/google'
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

export const metadata: Metadata = {
  title: 'PlagueProtocol — On-Chain Social Deduction',
  description:
    'A decentralised social deduction game powered by ZK proofs and Celo EVM smart contracts.',
  openGraph: {
    title: 'PlagueProtocol',
    description: 'Can you find Patient Zero before the infection spreads?',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
