/**
 * Audio singletons for the ArenaDoors entrance.
 *
 * These live apart from the component purely for bundle reasons. The lobby
 * calls `primeArenaSounds()` from its create/join click handlers, and while
 * this code sat inside `components/game/ArenaDoors.tsx` that one import pulled
 * framer-motion (~112 kB raw) into the lobby's first-load JS for a function
 * that touches no animation at all. The lobby route no longer loads the
 * animation library; keep it that way by not importing the component here.
 *
 * The module-level elements are the point: priming on the lobby and playing on
 * the game page have to hit the same `HTMLAudioElement` instances, or the
 * unlocked-by-gesture state is lost in the navigation between them.
 */

import { trackAudio } from './audio-registry'

// Browsers only allow audio after a RECENT user gesture. In live play the lobby
// click is followed by a wallet prompt + an on-chain tx, so by the time the
// game page mounts the gesture has expired and play() is silently blocked
// (the demo works because Start Demo -> doors is instant). primeArenaSounds()
// plays both tracks muted for an instant while the gesture is still valid,
// permanently unlocking these elements for gesture-free playback later.
let primedCreak: HTMLAudioElement | null = null
let primedPulse: HTMLAudioElement | null = null
let soundsInUse = false

export function getArenaSounds() {
  if (typeof window === 'undefined') return null
  if (!primedCreak || !primedPulse) {
    // Tracked so backgrounding the app silences them. The heartbeat especially:
    // it is `loop = true`, so without this it plays forever behind whatever the
    // user switched to.
    primedCreak = trackAudio(new Audio('/sounds/door-creak.mp3'))
    primedPulse = trackAudio(new Audio('/sounds/heartbeat.mp3'))
    primedPulse.loop = true
  }
  return { creak: primedCreak, pulse: primedPulse }
}

/** Marks the tracks as playing for real, so priming can't pause them mid-beat. */
export function markArenaSoundsInUse(inUse: boolean) {
  soundsInUse = inUse
}

export function primeArenaSounds() {
  const s = getArenaSounds()
  if (!s) return
  for (const a of [s.creak, s.pulse]) {
    a.muted = true
    a.play()
      .then(() => {
        // Don't yank the audio back if the doors started for real meanwhile.
        if (!soundsInUse) { a.pause(); a.currentTime = 0 }
        a.muted = false
      })
      .catch(() => { a.muted = false })
  }
}

// Ramp an audio element to silence then stop it — the creak is longer than the
// door beat, and a hard cut mid-sound is more jarring than no sound at all.
export function fadeOutAndStop(a: HTMLAudioElement, ms = 400) {
  const v0 = a.volume
  const t0 = performance.now()
  const step = () => {
    const k = (performance.now() - t0) / ms
    if (k >= 1) { a.pause(); return }
    a.volume = v0 * (1 - k)
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}
