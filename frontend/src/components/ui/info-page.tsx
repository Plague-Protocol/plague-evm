import type { ReactNode } from 'react'
import { SiteNav } from './site-nav'
import { SiteFooter } from './site-footer'

/**
 * Shared shell for the static content pages (/support, /terms, /privacy):
 * nav on top, a themed hero title, prose sections, footer. Keeps the plague
 * look without every page re-declaring the background scaffolding.
 */
export function InfoPage({
  path,
  kicker,
  title,
  intro,
  children,
}: Readonly<{
  path: string
  kicker: string
  title: string
  intro?: string
  children: ReactNode
}>) {
  return (
    <main className="min-h-screen" style={{ backgroundColor: '#060b06', color: '#d4c9b2' }}>
      <div className="sticky top-0 z-50 px-4 pt-4 sm:px-8 sm:pt-6">
        <div className="mx-auto w-full max-w-6xl">
          <SiteNav currentPath={path} />
        </div>
      </div>

      <header className="px-6 py-14 text-center">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4">
          <span className="font-mono text-xs uppercase tracking-[0.3em]" style={{ color: '#6b8e23' }}>
            {kicker}
          </span>
          <h1
            className="font-display text-4xl font-black leading-none sm:text-6xl"
            style={{
              background: 'linear-gradient(135deg, #cc1414 0%, #c97a12 50%, #6b8e23 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {title}
          </h1>
          {intro && (
            <p className="max-w-xl font-mono text-sm leading-relaxed" style={{ color: '#8fa882' }}>
              {intro}
            </p>
          )}
        </div>
      </header>

      <div className="px-4 pb-20 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {children}
        </div>
      </div>

      <SiteFooter />
    </main>
  )
}

/** One titled card of body copy on an info page. */
export function InfoSection({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section
      className="rounded-xl border p-6"
      style={{ backgroundColor: '#0a100a', borderColor: 'rgba(107,142,35,0.18)' }}
    >
      <h2 className="font-heading text-xl font-bold sm:text-2xl" style={{ color: '#d4c9b2' }}>
        {title}
      </h2>
      <div className="mt-3 space-y-3 font-body text-sm leading-relaxed" style={{ color: '#a0bb94' }}>
        {children}
      </div>
    </section>
  )
}
