'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import type { RoundPhase } from '@/types/game'
import { trackAudio, stopAllAudio } from '@/lib/audio-registry'

// ── Track manifest ────────────────────────────────────────────────────────────
// Each looping track fades in/out as the phase changes.
// One-shot stings are played immediately and stop after they finish.

const LOOP_TRACKS: Record<string, string> = {
  lobby:      '/sounds/ambient-lobby.mp3',
  infection:  '/sounds/infection-phase.mp3',
  discussion: '/sounds/discussion-phase.mp3',
  voting:     '/sounds/voting-phase.mp3',
}

// One-shot stings played on phase entry (do not loop)
const STING_TRACKS: Partial<Record<RoundPhase | 'lobby' | 'clean-win', string>> = {
  reveal:      '/sounds/reveal-sting.mp3',
  'clean-win': '/sounds/reveal-sting.mp3',
}

// Played once at game-over
export const GAME_OVER_TRACKS = {
  infected: '/sounds/infected-win.mp3',
  clean:    '/sounds/reveal-sting.mp3',
}

const FADE_DURATION_MS = 1500
const BASE_VOLUME = 0.35


// ── Gesture gate + the element pool ───────────────────────────────────────────
//
// Mobile browsers unlock audio PER ELEMENT, not per page. An element created
// during a user gesture may play; one constructed three minutes later, with no
// gesture since, has play() rejected — and that rejection is a silent promise
// rejection we were swallowing.
//
// The old code built `new Audio(src)` on every phase change, so on a phone the
// first track (created near the tap that entered the room) played and looped
// forever while every later phase was refused. Desktop has no such policy once
// the page is unlocked, which is exactly why laptops were fine and phones were
// not — same code, same phase data, different media policy.
//
// So the whole session shares two elements, both unlocked during the first real
// gesture and then reused by swapping `src`. Nothing is ever constructed mid-game.
//
// It also fixes audio outliving the page: two permanent elements are always
// registered with the audio registry, so backgrounding pauses them. Freshly
// built elements could be created, orphaned, and left playing with nothing
// holding a reference — and a fade-out that relied on setInterval never
// completed once the browser throttled timers in a hidden tab.

let loopEl:  HTMLAudioElement | null = null
let stingEl: HTMLAudioElement | null = null
let hasGesture = false
const gestureWaiters = new Set<() => void>()

/** Play-then-pause during a gesture is what actually lifts the mobile block. */
function unlock(el: HTMLAudioElement): void {
  el.play().then(() => el.pause()).catch(() => {/* nothing to unlock on desktop */})
}

function buildPool() {
  if (loopEl) return
  loopEl = trackAudio(new Audio())
  loopEl.loop = true
  loopEl.volume = 0
  stingEl = trackAudio(new Audio())
  stingEl.volume = 0
  unlock(loopEl)
  unlock(stingEl)
}

function armGestureListener() {
  if (typeof window === 'undefined' || hasGesture) return
  const events = ['pointerdown', 'keydown', 'touchstart'] as const
  const handler = () => {
    if (hasGesture) return
    hasGesture = true
    // Must happen synchronously inside the gesture — a later tick is too late.
    buildPool()
    for (const w of gestureWaiters) w()
    gestureWaiters.clear()
    for (const e of events) window.removeEventListener(e, handler)
  }
  for (const e of events) window.addEventListener(e, handler, { once: true, passive: true })
}

function useHasGesture(): boolean {
  const [ready, setReady] = useState(hasGesture)
  useEffect(() => {
    if (hasGesture) { setReady(true); return }
    const wake = () => setReady(true)
    gestureWaiters.add(wake)
    armGestureListener()
    return () => { gestureWaiters.delete(wake) }
  }, [])
  return ready
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSoundscape(scene: RoundPhase | 'lobby', muted: boolean) {
  const gestureReady = useHasGesture()
  const sceneRef = useRef<string | null>(null)
  const fadeRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearFade = useCallback(() => {
    if (fadeRef.current) clearInterval(fadeRef.current)
    fadeRef.current = null
  }, [])

  /** Ramp the shared loop element to `target`, then optionally stop it. */
  const rampTo = useCallback((target: number, thenPause = false) => {
    const el = loopEl
    if (!el) return
    clearFade()
    const step = Math.max(Math.abs(target - el.volume) / (FADE_DURATION_MS / 50), 0.01)
    fadeRef.current = setInterval(() => {
      const diff = target - el.volume
      if (Math.abs(diff) <= step) {
        el.volume = target
        clearFade()
        if (thenPause) el.pause()
        return
      }
      el.volume = Math.min(1, Math.max(0, el.volume + Math.sign(diff) * step))
    }, 50)
  }, [clearFade])

  // ── Switch loop track when the scene changes ──────────────────────────────
  useEffect(() => {
    if (!gestureReady || !loopEl) return
    if (sceneRef.current === scene) return
    sceneRef.current = scene

    const stingSrc = STING_TRACKS[scene as keyof typeof STING_TRACKS]
    if (stingSrc && stingEl) {
      stingEl.src = stingSrc
      stingEl.volume = muted ? 0 : BASE_VOLUME + 0.15
      stingEl.play().catch(() => {})
    }

    const src = scene === 'ended' ? null : LOOP_TRACKS[scene] ?? null
    if (!src) {
      rampTo(0, true)
      return
    }

    // Swap the source on the element that is already allowed to play. Assigning
    // `src` resets playback, so this is a hard cut rather than a crossfade —
    // one unlocked element that always works beats two that sometimes do.
    clearFade()
    loopEl.src = src
    loopEl.volume = 0
    loopEl.play().catch(() => {/* gesture expired — stays silent */})
    if (!muted) rampTo(BASE_VOLUME)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, gestureReady])

  // ── Respond to mute toggle ────────────────────────────────────────────────
  useEffect(() => {
    if (!loopEl) return
    if (muted) {
      clearFade()
      loopEl.volume = 0
      loopEl.pause()
      return
    }
    if (sceneRef.current && sceneRef.current !== 'ended') {
      loopEl.play().catch(() => {})
      rampTo(BASE_VOLUME)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted])

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearFade()
      // Hard stop, not a fade. A fade here relies on timers that a backgrounded
      // browser throttles to a crawl, which is how audio survived leaving the
      // page and kept playing behind everything else.
      if (loopEl) { loopEl.pause(); loopEl.volume = 0 }
      if (stingEl) { stingEl.pause(); stingEl.volume = 0 }
      sceneRef.current = null
      stopAllAudio()
    }
  }, [clearFade])
}

// ── One-shot helper (game-over stings, eliminations etc.) ────────────────────
//
// Reuses the shared sting element for the same unlock reason as the loop. A
// second one-shot interrupts the first rather than layering, which is correct
// here: these fire on eliminations and game-over, where the newest event is the
// one worth hearing.
export function playSting(src: string, muted: boolean, volume = BASE_VOLUME + 0.15) {
  if (muted || !stingEl) return
  stingEl.src = src
  stingEl.volume = volume
  stingEl.play().catch(() => {})
}
