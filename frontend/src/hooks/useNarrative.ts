'use client'

/**
 * useNarrative — the themed copy set for whatever theme is currently applied.
 *
 * Reads data-theme straight off <html> and watches it, rather than threading a
 * context provider through the tree. The attribute is already the single source
 * of truth: the pre-paint boot script sets it, the picker mutates it, and CSS
 * keys off it. A provider would be a second source that has to be kept in step
 * with the first.
 */

import { useEffect, useState } from 'react'
import { isThemeId, type ThemeId } from '@/lib/theme'
import { narrativeFor, type NarrativeSet } from '@/lib/narrative'

function readTheme(): ThemeId | null {
  if (typeof document === 'undefined') return null
  const v = document.documentElement.getAttribute('data-theme')
  return isThemeId(v) ? v : null
}

export function useActiveTheme(): ThemeId | null {
  // Starts null so server and first client render agree; the observer below
  // corrects it immediately after mount. Copy is the only thing keyed off this,
  // so a single frame of default labels is invisible next to the palette, which
  // the boot script already applied before paint.
  const [theme, setTheme] = useState<ThemeId | null>(null)

  useEffect(() => {
    setTheme(readTheme())
    const el = document.documentElement
    const obs = new MutationObserver(() => setTheme(readTheme()))
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  return theme
}

export function useNarrative(): NarrativeSet {
  return narrativeFor(useActiveTheme())
}
