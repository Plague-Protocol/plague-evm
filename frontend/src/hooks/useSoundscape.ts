'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import type { RoundPhase } from '@/types/game'
import { trackAudio, untrackAudio, stopAllAudio } from '@/lib/audio-registry'

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

// ── Gesture gate ──────────────────────────────────────────────────────────────
// Constructing `new Audio(src)` starts the download immediately, but browsers
// refuse to play it until the user has interacted with the page — so on first
// paint we were fetching ambient-lobby.mp3 (679 KB, the second-largest asset on
// /lobby) purely to have `play()` rejected and the result discarded. On a Slow
// 4G phone that is bandwidth taken directly from the LCP image.
//
// So no track is constructed until a real gesture has happened. Subscribers are
// woken once, at which point the scene effect re-runs and starts audio that can
// actually be heard.

let hasGesture = false
const gestureWaiters = new Set<() => void>()

function armGestureListener() {
  if (typeof window === 'undefined' || hasGesture) return
  const fire = () => {
    if (hasGesture) return
    hasGesture = true
    for (const w of gestureWaiters) w()
    gestureWaiters.clear()
  }
  // `once` on each: whichever lands first wins, the rest are cleaned up below.
  const events = ['pointerdown', 'keydown', 'touchstart'] as const
  const handler = () => {
    fire()
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

export function useSoundscape(
  scene: RoundPhase | 'lobby',
  muted: boolean,
) {
  const gestureReady = useHasGesture()
  const audioRef  = useRef<HTMLAudioElement | null>(null)
  const sceneRef  = useRef<string | null>(null)
  // Only the fade-IN is shared state now. Fade-outs belong to the track being
  // retired and clean up after themselves, so nothing else can cancel one.

  const fadingIn  = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearFades = useCallback(() => {
    if (fadingIn.current) clearInterval(fadingIn.current)
  }, [])

  /**
   * Fade a track out and retire it.
   *
   * Owns its own interval rather than sharing `fadingOut.current`, and holds no
   * reference to "the current track". The old version did both, which is what
   * broke phase music: the swap ran as `fadeOut(current, startNew)` over 1500ms
   * while `audioRef` was only reassigned inside `startNew`, so a second scene
   * change during that window called `clearFades()`, killed the in-flight
   * interval, and `startNew` never fired. The outgoing track stayed installed as
   * the current one and the incoming track never started — every later phase
   * then found the same stale element and faded it again, which is why one
   * track played all game and stuttered doing it.
   *
   * Untracked immediately so the audio registry cannot resume a retired track
   * when the app returns from the background.
   */
  const retire = useCallback((audio: HTMLAudioElement) => {
    untrackAudio(audio)
    const step = Math.max(audio.volume / (FADE_DURATION_MS / 50), 0.01)
    const timer = setInterval(() => {
      if (audio.volume > step) {
        audio.volume = Math.max(0, audio.volume - step)
      } else {
        audio.volume = 0
        audio.pause()
        clearInterval(timer)
      }
    }, 50)
  }, [])

  const fadeIn = useCallback((audio: HTMLAudioElement) => {
    clearFades()
    audio.volume = 0
    audio.play().catch(() => {/* autoplay blocked — user hasn't interacted yet */})
    const target = muted ? 0 : BASE_VOLUME
    fadingIn.current = setInterval(() => {
      if (audio.volume < target - 0.01) {
        audio.volume = Math.min(target, audio.volume + target / (FADE_DURATION_MS / 50))
      } else {
        audio.volume = target
        clearInterval(fadingIn.current!)
      }
    }, 50)
  }, [clearFades, muted])

  // ── Switch loop track when scene changes ─────────────────────────────────
  useEffect(() => {
    // Nothing is fetched until the user has interacted; see the gesture gate.
    // This effect re-runs when `gestureReady` flips, so the current scene's
    // track starts at that moment rather than being skipped.
    if (!gestureReady) return

    const trackKey = scene === 'ended' ? null : scene
    const src = trackKey ? LOOP_TRACKS[trackKey] ?? null : null

    if (sceneRef.current === scene) return
    sceneRef.current = scene

    // Play one-shot sting if applicable
    const stingSrc = STING_TRACKS[scene as keyof typeof STING_TRACKS]
    if (stingSrc) {
      const sting = trackAudio(new Audio(stingSrc))
      sting.volume = muted ? 0 : BASE_VOLUME + 0.15
      sting.play().catch(() => {})
    }

    // Retire the outgoing track FIRST and unconditionally, so `audioRef` always
    // holds the track belonging to the current scene. The incoming track no
    // longer waits on the outgoing one's fade to finish, which is what made the
    // swap losable — the two overlap for ~1.5s instead, which is a crossfade
    // and sounds better than the gap it replaces.
    const outgoing = audioRef.current
    audioRef.current = null
    if (outgoing) retire(outgoing)

    if (!src) return

    const a = trackAudio(new Audio(src))
    a.loop = true
    a.volume = 0
    audioRef.current = a
    fadeIn(a)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, gestureReady])

  // ── Respond to mute toggle ────────────────────────────────────────────────
  //
  // Mutes the element in place instead of retiring it. It used to fade out on
  // mute and rebuild the track from `sceneRef` on unmute, which meant a second
  // Audio for the same scene, the first left tracked and playable — pressing
  // mute twice could leave two copies of one loop layered slightly apart.
  //
  // No fade on the way down: pressing mute should be immediate.
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    if (muted) {
      clearFades()
      a.volume = 0
      a.pause()
      return
    }
    a.play().catch(() => {/* gesture expired */})
    fadeIn(a)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted])

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearFades()
      if (audioRef.current) {
        audioRef.current.pause()
        untrackAudio(audioRef.current)
      }
      // Kills any sting still ringing too. Pausing only the loop left one-shots
      // playing after the player had already navigated away, since nothing held
      // a reference to them.
      stopAllAudio()
    }
  }, [clearFades])
}

// ── One-shot helper (game-over stings, eliminations etc.) ────────────────────
export function playSting(src: string, muted: boolean, volume = BASE_VOLUME + 0.15) {
  if (muted) return
  const a = trackAudio(new Audio(src))
  a.volume = volume
  a.play().catch(() => {})
}
