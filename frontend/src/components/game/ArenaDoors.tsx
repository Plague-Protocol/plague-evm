'use client'

/**
 * ArenaDoors — one-shot "easing the doors open" entrance, played when a player
 * walks into a game room.
 *
 * Horror pacing: the doors never fully stop once they start — a continuous,
 * trembling creep (stop-start reads as mechanical; a slow crawl reads as fear).
 * The room behind is revealed out of pure darkness, a survivor sprints across
 * the crack a step ahead of whatever is behind them, a pair of red eyes glints
 * in the gap during the peek, a whispered "stay quiet…" flickers below, and
 * a low heartbeat plays underneath (the sound of your own fear, honoring the
 * global mute toggle).
 *
 * The runner reads in this order on purpose: something ran past, and THEN
 * something looked at you.
 *
 * ⚠ The runner is CSS/SVG, not a video clip, and that is deliberate. This beat
 * fires on every room entry, and the audience is MiniPay users on metered
 * mobile data — a per-entry video download is a recurring charge for a
 * cutscene they have already seen, and it would also have to block entry while
 * it buffered, which breaks the non-blocking property below. Its footsteps are
 * synthesised (lib/door-foley.ts) for the same reason: no new audio asset.
 *
 * When it plays — once per room per browser session:
 *  - Fires immediately on mount (so it covers the room's loading moment and the
 *    audio starts in sync), guarded by sessionStorage per roomId. Re-entering
 *    the same room later in the session — including lobby round-trips mid-game —
 *    shows nothing; a new room (new game) plays again.
 *  - Spectators walking into a live zone get the full beat too — their entry
 *    click is a fresh gesture, so the audio plays without priming.
 *
 * Pure transform + opacity, so it runs on the GPU compositor thread and never
 * touches layout/paint — cheap even on low-end mobile. No image/video assets
 * and no new dependencies (framer-motion is already bundled).
 *
 * Deliberately unobtrusive:
 *  - Non-blocking theatre: the game view renders BEHIND this the whole time.
 *  - Skipped entirely under prefers-reduced-motion.
 *  - Tap anywhere to dismiss immediately.
 */

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useSound } from '@/providers/sound-provider'
import { getArenaSounds, markArenaSoundsInUse, fadeOutAndStop } from '@/lib/arena-sounds'
import { playFootsteps, playDoorStop } from '@/lib/door-foley'

// ── Timeline (seconds unless noted) ───────────────────────────────────────────
//
// The beat is OPEN → RUN → SLAM → BOLT, and the slam is the point. An entrance
// that only opens says "you arrived"; one that shuts behind you says "you got
// in", which is the feeling the run is for. Everything below is timed backwards
// from that.
//
//   0.40s  the doors give, and start creeping
//   1.00s  eyes glint in the crack
//   2.60s  fully open — the way in, and the first sight of the room
//   2.85s  a survivor makes the gap
//   3.15s  the doors start swinging back
//   3.60s  slam, then the bolt
//   4.40s  release — the overlay fades and you are inside
//
const OPEN_DELAY = 0.4   // stillness before the first movement
const SWING_S    = 4.0   // whole open-hold-slam cycle
const HOLD_MS    = 4_400 // total on-screen time before auto-dismiss (ms)

// Runner beat — sits inside the hold at full open (2.60s–3.16s), so the dash
// happens through a doorway that is actually open and is clear of the frame
// before the doors start back. Short: it should look like it barely fit.
const RUN_DELAY_S = 2.55
const RUN_DUR_S   = 0.58

// Continuous creep out, a held breath at full open, then a fast slam back.
//
// The opening keeps its original character: crack open a sliver, keep crawling
// through the "peek" (never a dead stop), then commit. What is new is the tail
// — a brief hold at 112° that gives the run somewhere to happen, and a return
// to 2° on `easeIn` so the doors ACCELERATE into the frame. A linear close
// reads as a mechanism; an accelerating one reads as weight.
//
// They stop at 2° rather than 0° so the seam still shows a hairline of the room
// behind: barred, not sealed.
const DOOR_KEYFRAMES = [0, 13, 19, 112, 112, 2] // degrees (negated for the left door)
const DOOR_TIMES     = [0, 0.10, 0.26, 0.55, 0.69, 0.80]
const DOOR_EASES     = ['easeOut', 'linear', 'easeInOut', 'linear', 'easeIn'] as const

/** Wall-clock second at which the doors finish slamming — the sound cue and the
 *  release both hang off this rather than repeating the arithmetic. */
const SLAM_AT_S = OPEN_DELAY + SWING_S * DOOR_TIMES[5]

// Shared industrial-door surface: dark panel + faint scanlines, matching the
// game's existing PhaseTransition texture.
const scanlines =
  'repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.55) 2px 4px)'

// Audio singletons and the fade helper live in `@/lib/arena-sounds` so the
// lobby can prime them (it calls primeArenaSounds() from its create/join
// handlers) without importing this file and dragging framer-motion into the
// lobby's first-load JS.

export interface ArenaDoorsProps {
  readonly roomId: string | null
}

export function ArenaDoors({ roomId }: ArenaDoorsProps) {
  const reduced = useReducedMotion()
  const { muted } = useSound()
  const [show, setShow] = useState(false)
  // Which roomId this mount has already decided for — prevents status flaps
  // (waiting → active) from re-running the play/suppress decision mid-beat.
  const decidedForRef = useRef<string | null>(null)
  // Auto-dismiss timer lives in a ref so a dependency change can't cancel it
  // and strand the overlay on screen.
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pulseRef = useRef<HTMLAudioElement | null>(null)
  const creakRef = useRef<HTMLAudioElement | null>(null)

  // Fire immediately on mount — the doors cover the room's loading moment and
  // the audio starts in sync with them. Once per roomId per browser session.
  useEffect(() => {
    if (!roomId || reduced) return
    if (decidedForRef.current === roomId) return  // already decided this visit
    decidedForRef.current = roomId
    const key = `arena-doors:${roomId}`
    if (sessionStorage.getItem(key)) return       // this room already played this session
    sessionStorage.setItem(key, '1')
    setShow(true)
    hideTimerRef.current = setTimeout(() => setShow(false), HOLD_MS)
  }, [roomId, reduced])

  useEffect(() => () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
  }, [])

  // Heartbeat under the door beat — your own pulse in your ears — plus the
  // hinge creak, cued to the doors' first movement. Same pattern as
  // useSoundscape's stings; autoplay rejection is swallowed silently.
  useEffect(() => {
    if (!show) return
    const s = getArenaSounds()
    if (!s) return
    markArenaSoundsInUse(true)
    const { pulse, creak } = s

    pulse.currentTime = 0
    pulse.volume = 0.45
    pulseRef.current = pulse
    pulse.play().catch(() => {})

    // Creak starts with the overlay itself — the hinge strains from the very
    // first touch, before the door visibly gives.
    creak.currentTime = 0
    creak.volume = 0.6
    creakRef.current = creak
    creak.play().catch(() => {})

    return () => {
      markArenaSoundsInUse(false)
      fadeOutAndStop(pulse)
      fadeOutAndStop(creak) // longer than the beat — fade, don't chop
      pulseRef.current = null
      creakRef.current = null
    }
  }, [show])

  // Footsteps under the runner, then the bolt as the doors commit. Synthesised,
  // so there is nothing to preload and nothing to fail to load; both calls
  // resolve to silence if WebAudio is unavailable or still suspended.
  //
  // `muted` is read at fire time rather than in the dependency list on purpose:
  // these are one-shots, so un-muting midway should not retroactively fire a
  // footstep for a moment that has already passed.
  const mutedRef = useRef(muted)
  useEffect(() => { mutedRef.current = muted }, [muted])
  useEffect(() => {
    if (!show || reduced) return
    const steps = setTimeout(() => {
      if (!mutedRef.current) void playFootsteps(6, 0.22)
    }, RUN_DELAY_S * 1_000)
    // The slam, cued to the frame the doors actually meet — a hair early, so
    // the sound leads the picture by a few ms the way a real impact does.
    const slam = setTimeout(() => {
      if (!mutedRef.current) void playDoorStop(0.3)
    }, SLAM_AT_S * 1_000 - 40)
    return () => { clearTimeout(steps); clearTimeout(slam) }
  }, [show, reduced])

  // Honor the global mute toggle live, without restarting playback.
  useEffect(() => {
    if (pulseRef.current) pulseRef.current.volume = muted ? 0 : 0.45
    if (creakRef.current) creakRef.current.volume = muted ? 0 : 0.6
  }, [muted, show])

  const swing = {
    duration: SWING_S,
    delay: OPEN_DELAY,
    times: DOOR_TIMES,
    ease: [...DOOR_EASES],
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="arena-doors"
          aria-hidden="true"
          className="fixed inset-0 z-[80] overflow-hidden"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.4, ease: 'easeIn' } }}
          onClick={() => setShow(false)}
        >
          {/* Darkness behind the doors — the room emerges from pitch black only
              after the doors have committed, so the crack reveals nothing. */}
          <motion.div
            className="absolute inset-0"
            style={{ backgroundColor: '#020402' }}
            initial={{ opacity: 0.96 }}
            animate={{ opacity: 0 }}
            transition={{ delay: 1.9, duration: 0.7, ease: 'easeInOut' }}
          />

          {/* The runner — a survivor bolts across the gap a step ahead of
              something. Rendered BEFORE the doors in DOM order so the doors
              paint over it: like the eyes below, it is only ever visible
              through the crack, which is what sells it as happening out there
              rather than on a screen. Clipped to a narrow centre band so it
              cannot spill past the seam on wide viewports. */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-[38vh] w-[62vw] max-w-[420px] overflow-hidden">
              <motion.div
                className="absolute top-1/2 h-[30vh] max-h-[150px] w-auto"
                style={{ translateY: '-50%' }}
                initial={{ x: '-160%', opacity: 0 }}
                animate={{ x: '160%', opacity: [0, 1, 1, 0] }}
                transition={{
                  delay: RUN_DELAY_S,
                  duration: RUN_DUR_S,
                  ease: 'linear',
                  opacity: { times: [0, 0.15, 0.8, 1], duration: RUN_DUR_S, delay: RUN_DELAY_S },
                }}
              >
                {/* Mid-stride silhouette. Solid black against the dark room —
                    it reads as motion and absence of light, not as a character,
                    which is both cheaper and more frightening. */}
                <svg viewBox="0 0 60 100" className="h-full w-auto" aria-hidden="true">
                  <g fill="#000">
                    <circle cx="34" cy="12" r="7" />
                    <path d="M31 19 q-7 4 -8 13 l-2 14 q0 3 3 3 l14 0 q4 0 4 -4 l-1 -14 q-1 -9 -6 -12 z" />
                    {/* trailing + leading arm */}
                    <path d="M27 24 q-11 5 -16 15 q-1 3 2 4 q3 1 4 -2 q4 -8 12 -11 z" />
                    <path d="M40 23 q10 3 14 12 q1 3 -2 4 q-3 1 -4 -2 q-3 -6 -10 -8 z" />
                    {/* driving front leg + extended back leg */}
                    <path d="M28 48 q-9 8 -11 20 q-1 4 3 5 q4 1 5 -3 q2 -10 9 -15 z" />
                    <path d="M38 48 q9 10 20 13 q4 1 4 -3 q0 -4 -4 -5 q-9 -3 -13 -11 z" />
                  </g>
                </svg>
              </motion.div>
            </div>
          </div>

          {/* Eyes in the dark — a red pair glints in the crack mid-peek, blinks
              once, and is gone before the doors open wide. Did you see it? */}
          <motion.div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0, 1, 1, 0, 1, 0] }}
            transition={{ delay: 1.0, duration: 1.3, times: [0, 0.15, 0.3, 0.55, 0.62, 0.75, 1], ease: 'linear' }}
          >
            <div className="flex items-center gap-3" style={{ transform: 'translateY(-6px)' }}>
              <span className="h-[7px] w-[9px] rounded-full" style={{ backgroundColor: '#e63329', boxShadow: '0 0 10px #e63329, 0 0 22px rgba(230,51,41,0.6)' }} />
              <span className="h-[6px] w-[8px] rounded-full" style={{ backgroundColor: '#e63329', boxShadow: '0 0 8px #e63329, 0 0 18px rgba(230,51,41,0.5)', transform: 'translateY(1px)' }} />
            </div>
          </motion.div>

          {/* Trembling wrapper — a scared hand's micro-shake on both doors. */}
          <motion.div
            className="absolute inset-0 flex"
            style={{ perspective: 1100 }}
            animate={{ x: [0, -1.2, 0.8, -0.6, 1, -0.8, 0.4, 0] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
          >
            {/* Left door — hinged on the left edge, eases away into the room. */}
            <motion.div
              className="relative h-full w-1/2 origin-left"
              style={{
                backgroundColor: '#0a120a',
                backgroundImage: scanlines,
                boxShadow: 'inset -48px 0 90px rgba(0,0,0,0.75)',
                borderRight: '2px solid rgba(107,142,35,0.35)',
              }}
              initial={{ rotateY: 0 }}
              animate={{ rotateY: DOOR_KEYFRAMES.map(d => -d) }}
              transition={swing}
            >
              {/* seam-side hazard stripe */}
              <div
                className="absolute inset-y-0 right-0 w-6 opacity-40"
                style={{ backgroundImage: 'repeating-linear-gradient(45deg, #f5c518 0 8px, #0a120a 8px 16px)' }}
              />
            </motion.div>

            {/* Right door — mirror. */}
            <motion.div
              className="relative h-full w-1/2 origin-right"
              style={{
                backgroundColor: '#0a120a',
                backgroundImage: scanlines,
                boxShadow: 'inset 48px 0 90px rgba(0,0,0,0.75)',
                borderLeft: '2px solid rgba(107,142,35,0.35)',
              }}
              initial={{ rotateY: 0 }}
              animate={{ rotateY: DOOR_KEYFRAMES }}
              transition={swing}
            >
              <div
                className="absolute inset-y-0 left-0 w-6 opacity-40"
                style={{ backgroundImage: 'repeating-linear-gradient(-45deg, #f5c518 0 8px, #0a120a 8px 16px)' }}
              />
            </motion.div>
          </motion.div>

          {/* Vignette — closes the edges in for the whole beat. */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(ellipse at center, transparent 42%, rgba(2,4,2,0.9) 100%)' }}
          />

          {/* Whispered warning — flickers like a dying light, gone by mid-open. */}
          <motion.p
            className="pointer-events-none absolute inset-x-0 bottom-[18%] text-center font-mono text-xs lowercase tracking-[0.5em]"
            style={{ color: '#8fa882', textShadow: '0 0 12px rgba(107,142,35,0.5)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.9, 0.25, 0.8, 0.1, 0.7, 0] }}
            transition={{ delay: 0.9, duration: 2.1, times: [0, 0.18, 0.3, 0.5, 0.62, 0.8, 1], ease: 'linear' }}
          >
            stay quiet…
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
