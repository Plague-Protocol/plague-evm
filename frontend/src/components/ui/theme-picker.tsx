'use client'

/**
 * ThemePicker — lets a player pin a palette, or follow the calendar.
 *
 * The seasonal rotation exists so a returning player isn't looking at an
 * identical screen every visit. Letting them choose is the other half of that:
 * a theme someone picked is theirs, which is a cheaper kind of ownership than
 * anything we could build into the game itself.
 *
 * Writes data-theme straight onto <html>, matching the pre-paint boot script in
 * layout.tsx so a reload lands on the same palette without a flash.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  THEMES, DEFAULT_THEME, THEME_STORAGE_KEY, THEME_AUTO,
  resolveTheme, scheduledTheme, type ThemeId,
} from '@/lib/theme'

function apply(id: ThemeId): void {
  const el = document.documentElement
  if (id === DEFAULT_THEME) el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', id)
}

export function ThemePicker() {
  // 'auto' or a pinned id. Read from storage on mount so SSR and the client
  // agree on the first render (the boot script already set the attribute).
  const [choice, setChoice] = useState<string>(THEME_AUTO)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(THEME_STORAGE_KEY)
      setChoice(raw ?? THEME_AUTO)
    } catch {
      /* storage unavailable — stay on auto */
    }
    setReady(true)
  }, [])

  const pick = useCallback((value: string) => {
    setChoice(value)
    try {
      if (value === THEME_AUTO) localStorage.removeItem(THEME_STORAGE_KEY)
      else localStorage.setItem(THEME_STORAGE_KEY, value)
    } catch {
      /* choice still applies for this page view */
    }
    apply(resolveTheme(value === THEME_AUTO ? null : value))
  }, [])

  // Render nothing until storage is read: a picker that shows the wrong
  // selection for a frame invites a pointless second click.
  if (!ready) return null

  const auto = scheduledTheme()
  const autoName = THEMES.find(t => t.id === auto)?.name ?? auto

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>
        Theme
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => pick(THEME_AUTO)}
          aria-pressed={choice === THEME_AUTO}
          title={`Follows the calendar — currently ${autoName}`}
          className="rounded border px-2 py-1 font-mono text-[11px] transition-opacity hover:opacity-80"
          style={{
            borderColor: choice === THEME_AUTO ? 'var(--accent-bio)' : 'var(--bg-tertiary)',
            color: choice === THEME_AUTO ? 'var(--accent-bio)' : 'var(--text-muted)',
          }}
        >
          Auto
        </button>
        {THEMES.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => pick(t.id)}
            aria-pressed={choice === t.id}
            title={t.blurb}
            className="rounded border px-2 py-1 font-mono text-[11px] transition-opacity hover:opacity-80"
            style={{
              borderColor: choice === t.id ? 'var(--accent-bio)' : 'var(--bg-tertiary)',
              color: choice === t.id ? 'var(--accent-bio)' : 'var(--text-muted)',
            }}
          >
            {t.name}
          </button>
        ))}
      </div>
    </div>
  )
}
