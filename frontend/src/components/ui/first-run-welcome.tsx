'use client'

/**
 * FirstRunWelcome — a one-time router shown to a visitor who has never been here.
 *
 * Deliberately NOT another explainer. The demo's welcome screen already carries a
 * six-bullet "what you'll experience" list directly above its Start button, and
 * players still reported not knowing what to do — so a seventh paragraph earlier
 * in the funnel is the one intervention we know fails. Text before an activity
 * gets skipped; that is normal behaviour, not a copy problem.
 *
 * So this asks for a DECISION rather than a read: three routes, one line each,
 * no prose to skim past. It is centred and deliberate so it cannot be missed,
 * but it is cheap to answer — the teaching happens in the walkthrough, the demo,
 * and the in-game coach marks, each at the moment it is relevant.
 *
 * Shows once per browser. Escape and the backdrop both dismiss it.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

const STORAGE_KEY = 'plague_seen_welcome_v1'

const ROUTES = [
  {
    href: '/how-to-play',
    icon: '👁',
    label: 'Watch a round',
    hint: '30 seconds, no wallet',
    accent: '#f5c518',
  },
  {
    href: '/demo',
    icon: '🎮',
    label: 'Play a free demo',
    hint: 'Full match, nothing staked',
    accent: '#6b8e23',
  },
  {
    href: '/lobby',
    icon: '☣',
    label: 'Play for real',
    hint: 'Stake USDm, take the pot',
    accent: '#cc1414',
  },
] as const

export function FirstRunWelcome() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // Private browsing throws on access; a welcome card is never worth a crash.
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true)
    } catch {
      /* storage unavailable — skip the card rather than show it every load */
    }
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* nothing to do */ }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome — choose how to start"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <button
        type="button"
        aria-label="Dismiss"
        onClick={close}
        className="absolute inset-0 cursor-default"
        style={{ backgroundColor: 'rgba(6,11,6,0.92)' }}
      />

      <div
        className="relative w-full max-w-md rounded-lg border p-5 sm:p-6"
        style={{ backgroundColor: '#0a100a', borderColor: 'rgba(107,142,35,0.4)', boxShadow: '4px 4px 0 rgba(0,0,0,0.6)' }}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: '#6b8e23' }}>
          First time here?
        </p>
        <h2 className="mt-2 font-heading text-2xl font-bold sm:text-3xl" style={{ color: '#d4c9b2' }}>
          Pick a way in.
        </h2>

        <ul className="mt-5 space-y-2.5">
          {ROUTES.map(r => (
            <li key={r.href}>
              <Link
                href={r.href}
                onClick={close}
                className="flex items-center gap-3 rounded border p-3 transition-opacity hover:opacity-80"
                style={{ borderColor: 'rgba(107,142,35,0.25)', backgroundColor: '#060b06' }}
              >
                <span aria-hidden className="text-lg" style={{ color: r.accent }}>{r.icon}</span>
                <span className="min-w-0">
                  <span className="block font-heading text-sm font-bold" style={{ color: '#d4c9b2' }}>
                    {r.label}
                  </span>
                  <span className="block font-mono text-[11px]" style={{ color: '#7d9a72' }}>
                    {r.hint}
                  </span>
                </span>
                <span aria-hidden className="ml-auto font-mono text-xs" style={{ color: r.accent }}>→</span>
              </Link>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={close}
          className="mt-4 w-full py-1 font-mono text-[11px] underline transition-opacity hover:opacity-70"
          style={{ color: '#7d9a72' }}
        >
          I&apos;ll look around first
        </button>
      </div>
    </div>
  )
}
