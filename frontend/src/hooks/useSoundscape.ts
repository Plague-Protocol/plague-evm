'use client'

import { useEffect, useRef, useCallback } from 'react'
import type { RoundPhase } from '@/types/game'

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

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSoundscape(
  scene: RoundPhase | 'lobby',
  muted: boolean,
) {
  const audioRef  = useRef<HTMLAudioElement | null>(null)
  const sceneRef  = useRef<string | null>(null)
  const fadingOut = useRef<ReturnType<typeof setInterval> | null>(null)
  const fadingIn  = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearFades = useCallback(() => {
    if (fadingOut.current) clearInterval(fadingOut.current)
    if (fadingIn.current)  clearInterval(fadingIn.current)
  }, [])

  const fadeOut = useCallback((audio: HTMLAudioElement, onDone: () => void) => {
    clearFades()
    const step = audio.volume / (FADE_DURATION_MS / 50)
    fadingOut.current = setInterval(() => {
      if (audio.volume > step) {
        audio.volume = Math.max(0, audio.volume - step)
      } else {
        audio.volume = 0
        audio.pause()
        clearInterval(fadingOut.current!)
        onDone()
      }
    }, 50)
  }, [clearFades])

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
    const trackKey = scene === 'ended' ? null : scene
    const src = trackKey ? LOOP_TRACKS[trackKey] ?? null : null

    if (sceneRef.current === scene) return
    sceneRef.current = scene

    // Play one-shot sting if applicable
    const stingSrc = STING_TRACKS[scene as keyof typeof STING_TRACKS]
    if (stingSrc) {
      const sting = new Audio(stingSrc)
      sting.volume = muted ? 0 : BASE_VOLUME + 0.15
      sting.play().catch(() => {})
    }

    if (!src) {
      if (audioRef.current) fadeOut(audioRef.current, () => {})
      return
    }

    const startNew = () => {
      const a = new Audio(src)
      a.loop = true
      a.volume = 0
      audioRef.current = a
      fadeIn(a)
    }

    if (audioRef.current && !audioRef.current.paused) {
      fadeOut(audioRef.current, startNew)
    } else {
      startNew()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // ── Respond to mute toggle ────────────────────────────────────────────────
  useEffect(() => {
    if (!audioRef.current) return
    if (muted) {
      fadeOut(audioRef.current, () => {})
    } else if (!audioRef.current.paused) {
      clearFades()
      audioRef.current.volume = 0
      audioRef.current.play().catch(() => {})
      fadeIn(audioRef.current)
    } else if (sceneRef.current && sceneRef.current !== 'ended') {
      const src = LOOP_TRACKS[sceneRef.current]
      if (src) {
        const a = new Audio(src)
        a.loop = true
        audioRef.current = a
        fadeIn(a)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted])

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearFades()
      audioRef.current?.pause()
    }
  }, [clearFades])
}

// ── One-shot helper (game-over stings, eliminations etc.) ────────────────────
export function playSting(src: string, muted: boolean, volume = BASE_VOLUME + 0.15) {
  if (muted) return
  const a = new Audio(src)
  a.volume = volume
  a.play().catch(() => {})
}
