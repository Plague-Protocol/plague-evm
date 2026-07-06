'use client'

/**
 * useHeartbeat — plays the looping heartbeat overlay during tense moments
 * (e.g. the local player's final voting seconds). Sits UNDER the phase loop
 * track at low volume; fades in on activation and out on deactivation or mute.
 *
 * Purely additive: it never touches the soundscape's own audio element, so the
 * phase track and heartbeat coexist. Autoplay rejections are swallowed (the
 * user has always interacted by the time voting is reachable).
 */

import { useEffect, useRef } from 'react'

const HEARTBEAT_SRC = '/sounds/heartbeat.mp3'
const TARGET_VOLUME = 0.4
const FADE_MS = 400

export function useHeartbeat(active: boolean, muted: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const fadeRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const clearFade = () => {
      if (fadeRef.current) { clearInterval(fadeRef.current); fadeRef.current = null }
    }

    // Lazily create the element on first activation.
    if (active && !audioRef.current) {
      const a = new Audio(HEARTBEAT_SRC)
      a.loop = true
      a.volume = 0
      audioRef.current = a
    }

    const audio = audioRef.current
    if (!audio) return

    const target = active && !muted ? TARGET_VOLUME : 0

    if (active && !muted && audio.paused) {
      audio.play().catch(() => {/* autoplay blocked — ignore */})
    }

    clearFade()
    const step = TARGET_VOLUME / (FADE_MS / 40)
    fadeRef.current = setInterval(() => {
      const cur = audio.volume
      if (Math.abs(cur - target) <= step) {
        audio.volume = target
        if (target === 0) audio.pause()
        clearFade()
      } else {
        audio.volume = cur < target ? cur + step : cur - step
      }
    }, 40)

    return clearFade
  }, [active, muted])

  // Stop and release on unmount.
  useEffect(() => {
    return () => {
      if (fadeRef.current) clearInterval(fadeRef.current)
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    }
  }, [])
}
