'use client'

import { useEffect, useRef, useState } from 'react'
import type { RoundPhase } from '@/types/game'
import { stopAllAudio } from '@/lib/audio-registry'

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

/** Post-game bed. See the `ended` branch in the scene effect. */
const ENDED_TRACK = LOOP_TRACKS.lobby
const ENDED_VOLUME = BASE_VOLUME * 0.6

// ── Web Audio ─────────────────────────────────────────────────────────────────
//
// This used HTMLAudioElement with `loop = true`. Two problems, both phone-only:
//
//   1. Elements unlock individually on mobile, so an element built mid-game with
//      no gesture since had play() rejected — one track played all game.
//   2. MP3 carries encoder padding, so every loop restart is an audible gap.
//      `discussion-phase.mp3` is 6.3s against a 180s discussion phase: it
//      restarts ~29 times, which is the stuttering that was reported. Desktop
//      decoders paper over it; mobile ones do not.
//
// Web Audio fixes both by construction. One AudioContext is unlocked once, and
// looping a decoded AudioBuffer has no re-seek and no padding — it is sample
// accurate, so a 6-second bed is genuinely seamless. Gain ramps are scheduled on
// the audio clock rather than driven by setInterval, so a backgrounded tab
// throttling timers can no longer strand a fade half-finished.

let ctx: AudioContext | null = null
let loopGain: GainNode | null = null
let loopSource: AudioBufferSourceNode | null = null
/** A source ramping out but not yet stopped. See fadeOutLoop / killFadingSource. */
let fadingSource: AudioBufferSourceNode | null = null
let loopToken = 0
const buffers = new Map<string, Promise<AudioBuffer>>()

let hasGesture = false
const gestureWaiters = new Set<() => void>()

function loadBuffer(src: string): Promise<AudioBuffer> {
  const cached = buffers.get(src)
  if (cached) return cached
  // The in-flight promise is cached, not just the result, so a phase that
  // changes twice quickly cannot start two downloads of the same track.
  const p = fetch(src)
    .then(r => r.arrayBuffer())
    .then(b => ctx!.decodeAudioData(b))
  buffers.set(src, p)
  p.catch(() => buffers.delete(src))
  return p
}

function buildContext() {
  if (ctx) return
  type WithWebkit = typeof globalThis & { webkitAudioContext?: typeof AudioContext }
  const Ctor = window.AudioContext ?? (globalThis as WithWebkit).webkitAudioContext
  if (!Ctor) return
  ctx = new Ctor()
  loopGain = ctx.createGain()
  loopGain.gain.value = 0
  loopGain.connect(ctx.destination)
  void ctx.resume()
}

function armGestureListener() {
  if (typeof window === 'undefined' || hasGesture) return

  // `touchstart` is deliberately absent. Chrome and Brave exclude it from user
  // activation on purpose — so that scrolling a page cannot unlock audio —
  // while iOS Safari accepts it. With `touchstart` armed as a one-shot, a
  // single scroll on Android fired the handler, marked the gesture consumed and
  // removed every listener, leaving a context that could never resume: the
  // lobby was silent for the rest of the session and no later tap retried.
  const events = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const

  const handler = () => {
    if (hasGesture) return
    buildContext()   // must be created inside the gesture on iOS
    if (!ctx) return

    // The gesture only counts once the context is actually running. Anything
    // the browser declined to treat as activation leaves us armed for the next
    // one, instead of burning the unlock on it.
    void ctx.resume().then(() => {
      if (hasGesture || ctx?.state !== 'running') return
      hasGesture = true
      for (const w of gestureWaiters) w()
      gestureWaiters.clear()
      for (const e of events) window.removeEventListener(e, handler)
    }).catch(() => { /* not a real activation — stay armed */ })
  }

  for (const e of events) window.addEventListener(e, handler, { passive: true })
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

function rampGain(target: number) {
  if (!ctx || !loopGain) return
  const now = ctx.currentTime
  loopGain.gain.cancelScheduledValues(now)
  loopGain.gain.setValueAtTime(loopGain.gain.value, now)
  loopGain.gain.linearRampToValueAtTime(target, now + FADE_DURATION_MS / 1000)
}

function stopLoop() {
  if (loopSource) {
    try { loopSource.stop() } catch { /* already stopped */ }
    loopSource.disconnect()
    loopSource = null
  }
}

/** Milliseconds of ramp before the loop is cut. Short enough to read as "off". */
const STOP_FADE_MS = 90

/** Ramp before suspending on backgrounding. Shorter — the app is already gone. */
const SUSPEND_FADE_MS = 60

/**
 * Leave-the-page version of stopLoop: ramp to silence, *then* stop.
 *
 * `stopLoop` cuts the buffer mid-waveform at full gain, which is a step
 * discontinuity — audible as a sharp click when navigating away from the lobby
 * or a game on mobile. Zeroing the gain afterwards was too late to prevent it.
 *
 * Both the ramp and the stop are scheduled on the audio clock, so they complete
 * on the audio thread after React has torn the component down. The module-level
 * context outlives the component, which is what makes that safe. Disconnection
 * waits for `onended` so nothing is unplugged mid-sound either.
 *
 * Not used when switching phase loops: those share one gain node, so a fade
 * there would be overwritten by the incoming track's fade-in. Only correct
 * where nothing follows.
 */
function fadeOutLoop() {
  if (!ctx || !loopGain) { stopLoop(); return }
  const now   = ctx.currentTime
  const endAt = now + STOP_FADE_MS / 1000

  loopGain.gain.cancelScheduledValues(now)
  loopGain.gain.setValueAtTime(loopGain.gain.value, now)
  loopGain.gain.linearRampToValueAtTime(0, endAt)

  const source = loopSource
  loopSource = null
  if (!source) return
  fadingSource = source
  source.onended = () => {
    if (fadingSource === source) fadingSource = null
    try { source.disconnect() } catch { /* already gone */ }
  }
  try { source.stop(endAt) } catch { stopLoop() }
}

/**
 * Cut a still-fading source immediately.
 *
 * A fade-out survives the component that started it, so a route change back
 * within STOP_FADE_MS would leave the old track feeding the shared gain node
 * while the new one ramps up on it — the incoming `rampGain` cancels the
 * outgoing fade, so both play. Rare and quiet, but unbounded if the player
 * bounces between pages, and there is only one gain node to share.
 */
function killFadingSource() {
  if (!fadingSource) return
  try { fadingSource.stop() } catch { /* already stopped */ }
  try { fadingSource.disconnect() } catch { /* already gone */ }
  fadingSource = null
}

async function playLoop(src: string, target: number) {
  if (!ctx || !loopGain) return
  const token = ++loopToken
  const buffer = await loadBuffer(src).catch(() => null)
  // A newer scene arrived while this was decoding — drop it. Without the token
  // a slow first load could start under whatever phase came next.
  if (!buffer || token !== loopToken || !ctx || !loopGain) return
  stopLoop()
  killFadingSource()   // nothing from a previous page may bleed into this one
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = true          // sample-accurate, no gap at the seam
  source.connect(loopGain)
  source.start()
  loopSource = source
  loopGain.gain.setValueAtTime(0, ctx.currentTime)
  rampGain(target)
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSoundscape(scene: RoundPhase | 'lobby', muted: boolean) {
  const gestureReady = useHasGesture()
  const sceneRef = useRef<string | null>(null)
  const mutedRef = useRef(muted)
  useEffect(() => { mutedRef.current = muted }, [muted])

  useEffect(() => {
    if (!gestureReady || !ctx) return
    if (sceneRef.current === scene) return
    sceneRef.current = scene

    const stingSrc = STING_TRACKS[scene as keyof typeof STING_TRACKS]
    if (stingSrc) playSting(stingSrc, mutedRef.current)

    // A results screen in dead silence reads as the sound having broken,
    // especially after fifteen minutes of continuous audio. The game keeps a
    // quiet bed under it — the lobby ambient at 60% — until the player leaves,
    // which is what the state actually is: back at a menu, game over.
    const src = scene === 'ended' ? ENDED_TRACK : LOOP_TRACKS[scene] ?? null
    const target = scene === 'ended' ? ENDED_VOLUME : BASE_VOLUME
    if (!src) { rampGain(0); return }
    void playLoop(src, mutedRef.current ? 0 : target)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, gestureReady])

  useEffect(() => {
    if (!ctx || !sceneRef.current) return
    rampGain(muted ? 0 : (sceneRef.current === 'ended' ? ENDED_VOLUME : BASE_VOLUME))
  }, [muted])

  // Suspending the whole context is the reliable way to go quiet in the
  // background — one switch for every node, and nothing left ringing because a
  // throttled timer never reached the line that would have paused it.
  //
  // But suspending it *while it is still producing sound* is what caused the
  // buzz heard after backgrounding the app on mobile: measured at a 375 Hz
  // fundamental with harmonics past 12 kHz, and 48000/128 = 375 — one Web Audio
  // render quantum, repeating. The graph stops being rendered while the output
  // device keeps pulling, so the hardware loops the last block it was given
  // until the audio session tears down.
  //
  // Fix: ramp to silence first, so the block left looping is silence. The ramp
  // is scheduled on the audio clock, which runs on the audio thread — it
  // completes even though backgrounding freezes the main thread. The suspend
  // itself is best-effort on a timer; if that never fires the context is
  // already silent, which is the outcome that matters.
  useEffect(() => {
    const silence = () => {
      if (!ctx) return
      const now = ctx.currentTime
      if (loopGain) {
        loopGain.gain.cancelScheduledValues(now)
        loopGain.gain.setValueAtTime(loopGain.gain.value, now)
        loopGain.gain.linearRampToValueAtTime(0, now + SUSPEND_FADE_MS / 1000)
      }
      window.setTimeout(() => {
        if (document.hidden) void ctx?.suspend()
      }, SUSPEND_FADE_MS + 20)
    }

    const onVisibility = () => {
      if (!ctx) return
      if (document.hidden) { silence(); return }
      if (!sceneRef.current) return
      // The gain was ramped to zero on the way out, so resuming the context is
      // not enough on its own — without this the app comes back silent.
      void ctx.resume().then(() => {
        if (!sceneRef.current) return
        rampGain(mutedRef.current ? 0 : (sceneRef.current === 'ended' ? ENDED_VOLUME : BASE_VOLUME))
      }).catch(() => { /* resume needs a fresh gesture — the listener handles it */ })
    }

    // `pagehide` gets its own handler rather than sharing the one above. It can
    // fire while `document.hidden` is still false (bfcache navigation), which
    // would send it down the *resume* branch and ramp the volume back up on a
    // page that is going away — the opposite of what is wanted.
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', silence)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', silence)
    }
  }, [])

  useEffect(() => {
    return () => {
      loopToken++          // cancel any decode still in flight
      // Ramped, not cut — see fadeOutLoop. The old `stopLoop()` + `gain = 0`
      // here was the sharp click heard when leaving the lobby or a game.
      fadeOutLoop()
      sceneRef.current = null
      stopAllAudio()       // arena creak/heartbeat still use HTMLAudioElement
    }
  }, [])
}

// ── One-shot helper (game-over stings, eliminations etc.) ────────────────────
export function playSting(src: string, muted: boolean, volume = BASE_VOLUME + 0.15) {
  if (muted || !ctx) return
  void loadBuffer(src).then(buffer => {
    if (!ctx) return
    const source = ctx.createBufferSource()
    const gain = ctx.createGain()
    gain.gain.value = volume
    source.buffer = buffer
    source.connect(gain)
    gain.connect(ctx.destination)
    // Self-disposing: one-shots used to be built as elements nobody held a
    // reference to, which is how stings outlived the page that started them.
    source.onended = () => { source.disconnect(); gain.disconnect() }
    source.start()
  }).catch(() => {/* missing or undecodable — silence is fine */})
}
