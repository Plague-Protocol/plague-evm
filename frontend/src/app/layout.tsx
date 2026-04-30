import type { Metadata } from 'next'
import { Space_Grotesk, Space_Mono, Bebas_Neue } from 'next/font/google'
import './globals.css'

const displayFont = Bebas_Neue({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display',
})

const bodyFont = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-body',
})

const monoFont = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'PlagueProtocol — On-Chain Social Deduction',
  description:
    'A decentralised social deduction game powered by ZK proofs and Stellar/Soroban smart contracts.',
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
        {children}
      </body>
    </html>
  )
}
