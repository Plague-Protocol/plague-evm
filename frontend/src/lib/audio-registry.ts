/**
 * One place that knows about every sound the app is playing.
 *
 * Audio here is created in three unrelated spots — the phase soundscape loop,
 * its one-shot stings, and the arena-door creak/heartbeat singletons — and none
 * of them could be stopped from outside the code that made them. Two things
 * followed from that:
 *
 *   - **Backgrounding kept playing.** Nothing listened for `visibilitychange`,
 *     so switching apps or tabs left the loop (and the heartbeat, which is
 *     `loop = true`) running out of sight.
 *   - **Stings outlived their page.** `new Audio(...).play()` with no reference
 *     kept is unreachable the moment the component unmounts, so navigating away
 *     mid-sting could not stop it.
 *
 * Registering every element fixes both without changing how any of them are
 * created: call `trackAudio()` on the way out and the registry handles the rest.
 *
 * Only elements this module paused are resumed. A track the user muted, or one
 * that finished while hidden, must stay silent — coming back to a tab should
 * never start audio the user did not leave running.
 */

const tracked = new Set<HTMLAudioElement>()

/** Paused by us on hide, so they are the only ones eligible to resume. */
const pausedByRegistry = new Set<HTMLAudioElement>()

let armed = false

function pauseAll(): void {
  for (const a of tracked) {
    if (!a.paused) {
      pausedByRegistry.add(a)
      a.pause()
    }
  }
}

function resumePaused(): void {
  for (const a of pausedByRegistry) {
    // Still tracked? A sting that ended while hidden was untracked on 'ended'
    // and must not be restarted.
    if (tracked.has(a)) a.play().catch(() => {/* gesture expired — stay silent */})
  }
  pausedByRegistry.clear()
}

function arm(): void {
  if (armed || typeof document === 'undefined') return
  armed = true

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseAll()
    else resumePaused()
  })

  // `pagehide` covers the cases visibilitychange does not fire for reliably —
  // iOS Safari/WKWebView backgrounding and bfcache navigation, which is exactly
  // the MiniPay in-app browser. Nothing is resumed from here; a page being
  // hidden this way is either gone or will fire visibilitychange on return.
  window.addEventListener('pagehide', pauseAll)
}

/** Register an element so it can be paused when the app is backgrounded. */
export function trackAudio<T extends HTMLAudioElement>(audio: T): T {
  arm()
  tracked.add(audio)
  // One-shots clean themselves up, so the registry does not accumulate a set
  // entry per sting for the lifetime of the session.
  audio.addEventListener('ended', () => untrackAudio(audio), { once: true })
  return audio
}

export function untrackAudio(audio: HTMLAudioElement): void {
  tracked.delete(audio)
  pausedByRegistry.delete(audio)
}

/** Ramp length before a route-exit stop. Long enough to kill the click, short
 *  enough that the sound is gone by the time the next screen paints. */
const STOP_FADE_MS = 90

/**
 * Stop everything now — used when leaving a route, where "pause and maybe
 * resume" is wrong: the scene that owned the sound is gone.
 *
 * Ramped rather than cut. `pause()` on a looping element (the arena heartbeat
 * is `loop = true`) stops it mid-waveform at full volume, and that step
 * discontinuity is audible as a sharp click — reported on mobile when leaving
 * the lobby or a game. The element is untracked up front so a `visibilitychange`
 * landing mid-fade cannot resume a track that is on its way out.
 *
 * Volume is restored after the pause: these are long-lived singletons, and one
 * left at 0 would replay silently the next time a scene starts it.
 */
export function stopAllAudio(): void {
  for (const a of [...tracked]) {
    untrackAudio(a)
    if (a.paused) continue

    const v0 = a.volume
    let done = false
    const finish = () => {
      if (done) return
      done = true
      a.pause()
      a.volume = v0
      // Rewind so a later scene starts the track from the top rather than
      // resuming mid-phrase from a game the player already left.
      try { a.currentTime = 0 } catch { /* not seekable yet */ }
    }

    // A hidden page gets no animation frames at all, so a route change that
    // coincides with backgrounding would leave the track playing forever.
    // Timers still fire when throttled; rAF does not. This is the guarantee,
    // the ramp below is only the polish.
    setTimeout(finish, STOP_FADE_MS + 50)
    if (document.hidden) { finish(); continue }

    const t0 = performance.now()
    const step = () => {
      if (done) return
      const k = (performance.now() - t0) / STOP_FADE_MS
      if (k >= 1) { finish(); return }
      a.volume = v0 * (1 - k)
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }
  pausedByRegistry.clear()
}
