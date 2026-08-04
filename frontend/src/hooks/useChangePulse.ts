'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * True for a moment each time `value` changes after the first render.
 *
 * Drives the gold flash on numbers that move under the reader (a player joins a
 * lobby room, a bot seat frees up). Pair it with the `.count-pulse` class in
 * globals.css.
 *
 * Both call sites previously did this by adjusting state during render, the
 * "previous value" pattern from the React docs. That pattern is fine for
 * deriving state, but it does not work for a one-shot signal: the render-phase
 * setState makes React throw that render away and re-run the component, and the
 * re-run compares against the already-updated previous value, so the flag is
 * false in every render that actually commits. The flash never played. Setting
 * it from an effect after commit is what makes it fire.
 */
export function useChangePulse(value: number | null | undefined, ms = 450): boolean {
  const [pulsing, setPulsing] = useState(false)
  const seenFirstRef = useRef(false)

  useEffect(() => {
    // The initial value is not a change, so mounting must not flash. This also
    // keeps a freshly rendered lobby list from lighting up every room card.
    if (!seenFirstRef.current) {
      seenFirstRef.current = true
      return
    }
    setPulsing(true)
    const timer = setTimeout(() => setPulsing(false), ms)
    return () => clearTimeout(timer)
  }, [value, ms])

  return pulsing
}
