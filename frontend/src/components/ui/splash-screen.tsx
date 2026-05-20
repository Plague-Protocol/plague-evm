'use client'

import { useEffect, useState, useCallback, useRef } from 'react'

const AMBIENT_TRACK = '/sounds/ambient-lobby.mp3'
const SCREAM_TRACK  = '/sounds/infected-win.mp3'

const GATE_VIDEO   = '/videos/zombie-clip-1.mp4'
const FINALE_VIDEO = '/videos/zombie-clip-2.mp4'

const BG_FRAMES = [
  '/images/bg-horror.jpg',
  '/images/bg-zombie-portrait.jpg',
  '/images/bg-patient-zero.jpg',
  '/images/bg-game.jpg',
] as const

// ── Story — three acts. Acts 1 & 2 fade+collapse when the next act begins. ───
type Act = 1 | 2 | 3
interface StoryLine { text: string; act: Act }

const STORY: StoryLine[] = [
  // Act I — Incubation
  { text: 'Day 1 — a single cough in a crowded market.', act: 1 },
  { text: 'Day 3 — two patients. High fever. Confusion.', act: 1 },
  { text: 'Day 7 — the hospitals stopped counting.', act: 1 },
  // Act II — Conspiracy
  { text: 'The authorities declared full containment.', act: 2 },
  { text: 'They lied.', act: 2 },
  { text: 'The pathogen was already past the walls.', act: 2 },
  // Act III — The Game (persists, never fades)
  { text: 'Someone in this room carried it here.', act: 3 },
  { text: 'One of you is Patient Zero.', act: 3 },
  { text: 'Trust no one.  Find them first.', act: 3 },
]

const MS_PER_CHAR      = 44
const MS_BETWEEN_LINES = 720
const ACT_FADE_MS      = 1300  // CSS transition duration for fading acts out
const ACT_PAUSE_MS     = 2000  // total pause (fade + settle) before next act types

// ── Per-line render state ─────────────────────────────────────────────────────
interface LineState {
  text:      string
  full:      string
  opacity:   number
  collapsed: boolean
  act:       1 | 2 | 3
}

// ── Pure state-updater factories ──────────────────────────────────────────────
function fadeAct(act: Act) {
  return (prev: LineState[]) => prev.map(l => l.act === act ? { ...l, opacity: 0 } : l)
}
function collapseAct(act: Act) {
  return (prev: LineState[]) => prev.map(l => l.act === act ? { ...l, collapsed: true } : l)
}
function startLine(i: number, text: string, act: Act) {
  return (prev: LineState[]) => {
    const next = [...prev]
    next[i] = { text: '', full: text, opacity: 1, collapsed: false, act }
    return next
  }
}
function updateChar(i: number, text: string, c: number) {
  return (prev: LineState[]) =>
    prev.map((l, idx) => idx === i ? { ...l, text: text.slice(0, c) } : l)
}
function completeLine(i: number, text: string) {
  return (prev: LineState[]) =>
    prev.map((l, idx) => idx === i ? { ...l, text } : l)
}

// ── Async typewriter — only runs once active is true ──────────────────────────
function useStoryTypewriter(active: boolean) {
  const [lines, setLines]           = useState<LineState[]>([])
  const [activeLine, setActiveLine] = useState(0)
  const [done, setDone]             = useState(false)

  useEffect(() => {
    if (!active) return
    setLines([])
    setActiveLine(0)
    setDone(false)

    let cancelled = false
    const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

    async function transitionAct(fadingAct: Act) {
      setLines(fadeAct(fadingAct))
      setTimeout(() => { if (!cancelled) setLines(collapseAct(fadingAct)) }, ACT_FADE_MS + 100)
      await wait(ACT_PAUSE_MS)
    }

    async function typeLine(i: number, text: string, act: Act) {
      setActiveLine(i)
      setLines(startLine(i, text, act))
      await wait(MS_PER_CHAR)
      for (let c = 1; c <= text.length; c++) {
        if (cancelled) return
        setLines(updateChar(i, text, c))
        if (c < text.length) await wait(MS_PER_CHAR)
      }
      if (!cancelled) setLines(completeLine(i, text))
      await wait(MS_BETWEEN_LINES)
    }

    async function run() {
      let prevAct: number | null = null
      for (let i = 0; i < STORY.length; i++) {
        if (cancelled) return
        const { text, act } = STORY[i]
        if (prevAct !== null && act !== prevAct) {
          await transitionAct(prevAct as Act)
          if (cancelled) return
        }
        await typeLine(i, text, act)
        prevAct = act
      }
      if (!cancelled) setDone(true)
    }

    run()
    return () => { cancelled = true }
  }, [active])

  return { lines, activeLine, done }
}

// ── Particles ─────────────────────────────────────────────────────────────────
interface Particle { id: number; x: number; size: number; delay: number; duration: number }

const PARTICLES: Particle[] = Array.from({ length: 24 }, (_, i) => ({
  id: i,
  x: Math.random() * 100,
  size: 3 + Math.random() * 5,
  delay: Math.random() * 8,
  duration: 6 + Math.random() * 8,
}))

// ── Component ─────────────────────────────────────────────────────────────────
export function SplashScreen({ onResolved }: { onResolved?: () => void } = {}) {
  const [visible,      setVisible]      = useState(false)
  const [exiting,      setExiting]      = useState(false)
  const [finaleStatic, setFinaleStatic] = useState(false)
  const [titleSlam,    setTitleSlam]    = useState(false)
  const [splashMuted,  setSplashMuted]  = useState(false)
  const [bgIndex,      setBgIndex]      = useState(0)
  // gate = logo screen requiring a click; story = typewriter + audio running
  const [phase,        setPhase]        = useState<'gate' | 'story'>('gate')

  const ambientRef         = useRef<HTMLAudioElement | null>(null)
  const transientAudiosRef = useRef<HTMLAudioElement[]>([])
  const lastHeartbeatRef   = useRef(0)

  // Track and play a one-shot Audio so the mute toggle can stop it later.
  const playOneShot = useCallback((src: string, volume: number) => {
    const audio = new Audio(src)
    audio.volume = volume
    transientAudiosRef.current.push(audio)
    audio.addEventListener('ended', () => {
      transientAudiosRef.current = transientAudiosRef.current.filter(a => a !== audio)
    })
    audio.play().catch(() => {})
    return audio
  }, [])

  const stopAllTransients = useCallback(() => {
    const audios = transientAudiosRef.current
    transientAudiosRef.current = []
    for (const audio of audios) audio.pause()
  }, [])

  const { lines, activeLine, done } = useStoryTypewriter(phase === 'story')

  // Act III triggers the finale zombie clip — fades in behind the climax text
  const inAct3 = phase === 'story' && (lines[activeLine]?.act === 3 || done)

  // ── First-time visitor ───────────────────────────────────────────────────────
  useEffect(() => {
    const seen = globalThis.window !== undefined && sessionStorage.getItem('plague_intro_seen')
    if (!seen) {
      setVisible(true)
    } else {
      onResolved?.()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Lock body scroll while splash is open ────────────────────────────────────
  useEffect(() => {
    document.body.style.overflow = visible ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [visible])

  // ── Background crossfade — independent 4.5 s timer ───────────────────────────
  useEffect(() => {
    if (!visible) return
    setBgIndex(0)
    const id = setInterval(() =>
      setBgIndex(i => Math.min(BG_FRAMES.length - 1, i + 1)), 4500)
    return () => clearInterval(id)
  }, [visible])

  // ── Gate click — starts audio synchronously inside the user gesture ──────────
  const beginStory = useCallback(() => {
    if (phase !== 'gate') return
    if (!splashMuted) {
      const audio = new Audio(AMBIENT_TRACK)
      audio.loop   = true
      audio.volume = 0.28
      ambientRef.current = audio
      audio.play().catch(() => {})
    }
    setPhase('story')
  }, [phase, splashMuted])

  // ── Cleanup ambient + transients on visible reset ───────────────────────────
  useEffect(() => {
    if (visible) return
    ambientRef.current?.pause()
    if (ambientRef.current) ambientRef.current.currentTime = 0
    ambientRef.current = null
    stopAllTransients()
  }, [visible, stopAllTransients])

  // ── Respond to mute toggle on existing ambient + one-shot audio ──────────────
  useEffect(() => {
    if (splashMuted) {
      ambientRef.current?.pause()
      stopAllTransients()
      return
    }
    const audio = ambientRef.current
    if (!audio) return
    audio.volume = 0.28
    audio.play().catch(() => {})
  }, [splashMuted, stopAllTransients])

  // ── Heartbeat — rate-limited to max once per 1.4 s ───────────────────────────
  useEffect(() => {
    if (!visible || splashMuted || phase !== 'story') return
    const now = Date.now()
    if (now - lastHeartbeatRef.current < 1400) return
    lastHeartbeatRef.current = now
    playOneShot('/sounds/heartbeat.mp3', 0.18)
  }, [activeLine, visible, splashMuted, phase, playOneShot])

  // ── Scream — fires at Act I climax (line 2 "Day 7…"), echoes out over 4 s ────
  useEffect(() => {
    if (!visible || activeLine !== 2 || splashMuted || phase !== 'story') return
    let fade: ReturnType<typeof setInterval> | null = null
    const fire = setTimeout(() => {
      const scream = playOneShot(SCREAM_TRACK, 0.24)
      let step = 0
      fade = setInterval(() => {
        step++
        scream.volume = Math.max(0, 0.24 * (1 - step / 20))
        if (step >= 20) { if (fade) clearInterval(fade); scream.pause() }
      }, 200)
    }, 500)
    return () => {
      clearTimeout(fire)
      if (fade) clearInterval(fade)
    }
  }, [activeLine, visible, splashMuted, phase, playOneShot])

  // ── Dismiss / finale ─────────────────────────────────────────────────────────
  const dismiss = useCallback(() => {
    if (exiting || finaleStatic) return
    if (globalThis.window !== undefined) sessionStorage.setItem('plague_intro_seen', '1')
    setFinaleStatic(true)
    setTitleSlam(true)
    if (!splashMuted) {
      playOneShot('/sounds/reveal-sting.mp3', 0.35)
    }
    setTimeout(() => setExiting(true), 260)
    if (ambientRef.current) { ambientRef.current.pause(); ambientRef.current.currentTime = 0 }
    setTimeout(() => {
      stopAllTransients()
      setVisible(false); setFinaleStatic(false); setTitleSlam(false); onResolved?.()
    }, 900)
  }, [exiting, finaleStatic, splashMuted, playOneShot, stopAllTransients])

  // ── Keyboard dismiss (only during story) ─────────────────────────────────────
  useEffect(() => {
    if (!visible || phase !== 'story') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') dismiss()
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [visible, dismiss, phase])

  if (!visible) return null

  return (
    <dialog
      open
      aria-label="Zombie Plague intro"
      style={{
        position:        'fixed',
        inset:           0,
        width:           '100vw',
        height:          '100vh',
        maxWidth:        '100vw',
        maxHeight:       '100vh',
        zIndex:          9999,
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        justifyContent:  'center',
        backgroundColor: '#000',
        overflow:        'hidden',
        border:          'none',
        padding:         0,
        margin:          0,
        animation: exiting
          ? 'splash-exit 0.8s ease-in forwards'
          : 'splash-enter 0.6s ease-out both',
      }}
    >
      {/* Mute toggle — only shown once story is running */}
      {phase === 'story' && (
        <button
          onClick={() => setSplashMuted(m => !m)}
          aria-label={splashMuted ? 'Unmute intro audio' : 'Mute intro audio'}
          style={{
            position:        'absolute',
            top:             '1rem',
            right:           '1rem',
            zIndex:          10,
            display:         'flex',
            alignItems:      'center',
            gap:             '0.4rem',
            background:      'rgba(6,11,6,0.7)',
            border:          '1px solid rgba(107,142,35,0.35)',
            borderRadius:    '6px',
            padding:         '0.4rem 0.75rem',
            cursor:          'pointer',
            fontFamily:      'var(--font-mono)',
            fontSize:        '0.65rem',
            letterSpacing:   '0.14em',
            color:           splashMuted ? '#4a5e44' : '#6b8e23',
            backdropFilter:  'blur(8px)',
          }}
        >
          <span style={{ fontSize: '1rem', lineHeight: 1 }}>{splashMuted ? '🔇' : '🔊'}</span>
          <span>{splashMuted ? 'MUTED' : 'SOUND ON'}</span>
        </button>
      )}

      {/* Background layers — stacked, crossfade via opacity transition */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        {BG_FRAMES.map((src, i) => (
          <div key={src} style={{
            position:           'absolute',
            inset:              0,
            backgroundImage:    `url(${src})`,
            backgroundSize:     'cover',
            backgroundPosition: 'center',
            transform:          'scale(1.04)',
            filter:             'saturate(0.9) contrast(1.05) brightness(0.38)',
            opacity:            i === bgIndex ? 1 : 0,
            transition:         'opacity 2.5s ease',
          }} />
        ))}
      </div>

      {/* Zombie video — pre-splash gate */}
      {phase === 'gate' && (
        <video
          src={GATE_VIDEO}
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
          style={{
            position:      'absolute',
            inset:         0,
            zIndex:        0,
            width:         '100%',
            height:        '100%',
            objectFit:     'cover',
            filter:        'saturate(0.7) contrast(1.1) brightness(0.5)',
            opacity:       0.85,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Zombie video — Act III climax (fades in over the image stack) */}
      {phase === 'story' && (
        <video
          src={FINALE_VIDEO}
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
          style={{
            position:    'absolute',
            inset:       0,
            zIndex:      0,
            width:       '100%',
            height:      '100%',
            objectFit:   'cover',
            filter:      'saturate(0.7) contrast(1.15) brightness(0.42)',
            opacity:     inAct3 ? 0.7 : 0,
            transition:  'opacity 1.6s ease',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Scanlines */}
      <div style={{
        position:        'absolute',
        inset:           0,
        zIndex:          1,
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 4px)',
        pointerEvents:   'none',
      }} />

      {/* Finale static burst */}
      <div style={{
        position:        'absolute',
        inset:           0,
        zIndex:          3,
        pointerEvents:   'none',
        opacity:         finaleStatic ? 0.55 : 0,
        transition:      'opacity 0.18s ease',
        backgroundImage: 'radial-gradient(circle at 20% 10%, rgba(255,255,255,0.38) 0 1px, transparent 1px), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.28) 0 1px, transparent 1px), radial-gradient(circle at 55% 30%, rgba(255,255,255,0.42) 0 1px, transparent 1px)',
        backgroundSize:  '6px 6px, 8px 8px, 5px 5px',
        animation:       finaleStatic ? 'splash-static 0.22s steps(4) infinite' : 'none',
      }} />

      {/* Floating particles */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        {PARTICLES.map(p => (
          <span key={p.id} style={{
            position:        'absolute',
            bottom:          '-12px',
            left:            `${p.x}%`,
            width:           `${p.size}px`,
            height:          `${p.size}px`,
            borderRadius:    '50%',
            backgroundColor: 'rgba(107,142,35,0.35)',
            boxShadow:       '0 0 6px rgba(107,142,35,0.5)',
            animation:       `splash-particle ${p.duration}s ${p.delay}s ease-in infinite`,
          }} />
        ))}
      </div>

      {/* Blood vignette */}
      <div style={{
        position:      'absolute',
        inset:         0,
        zIndex:        1,
        pointerEvents: 'none',
        background:    'linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.7) 100%), radial-gradient(ellipse at center, transparent 35%, rgba(180,0,0,0.22) 100%)',
      }} />

      {/* ── Gate phase — click to unlock audio + begin story ─────────────────── */}
      {phase === 'gate' && (
        <div style={{
          position:      'relative',
          zIndex:        2,
          display:       'flex',
          flexDirection: 'column',
          alignItems:    'center',
          gap:           '1.5rem',
          padding:       '1rem',
          textAlign:     'center',
        }}>
          <div style={{
            fontSize:   'clamp(2.5rem, 10vw, 4rem)',
            lineHeight: 1,
            animation:  'splash-pulse 3s ease-in-out infinite',
            filter:     'drop-shadow(0 0 24px rgba(230,51,41,0.8))',
          }}>☣</div>

          <h1 style={{
            fontFamily:    'var(--font-display)',
            fontSize:      'clamp(2.4rem, 7vw, 4.2rem)',
            lineHeight:    1,
            color:         '#d4c9b2',
            letterSpacing: '0.06em',
            textShadow:    '0 0 30px rgba(230,51,41,0.5)',
            margin:        0,
          }}>
            ZOMBIE PLAGUE
          </h1>

          <button
            onClick={beginStory}
            style={{
              marginTop:       '0.5rem',
              padding:         '0.75rem 2.5rem',
              fontFamily:      'var(--font-mono)',
              fontSize:        '1rem',
              letterSpacing:   '0.28em',
              textTransform:   'uppercase',
              fontWeight:      700,
              color:           '#060b06',
              backgroundColor: '#6b8e23',
              border:          '2px solid #6b8e23',
              borderRadius:    '6px',
              cursor:          'pointer',
              boxShadow:       '0 0 24px rgba(107,142,35,0.6)',
              animation:       'splash-pulse 2s ease-in-out infinite',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 40px rgba(107,142,35,0.9)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 24px rgba(107,142,35,0.6)'
            }}
          >
            DARE TO ENTER
          </button>

          <p style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      '0.62rem',
            letterSpacing: '0.14em',
            color:         '#4a5e44',
            margin:        0,
          }}>
            {/* CLICK TO BEGIN · AUDIO ENABLED */}
          </p>
        </div>
      )}

      {/* ── Story phase — typewriter + enter button ───────────────────────────── */}
      {phase === 'story' && (
        <div style={{
          position:      'relative',
          zIndex:        2,
          display:       'flex',
          flexDirection: 'column',
          alignItems:    'center',
          gap:           '1.25rem',
          padding:       '1rem',
          maxWidth:      '600px',
          width:         '100%',
          textAlign:     'center',
        }}>

          {/* Biohazard + title */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{
              fontSize:  'clamp(2.5rem, 10vw, 4rem)',
              lineHeight: 1,
              animation: 'splash-pulse 3s ease-in-out infinite',
              filter:    'drop-shadow(0 0 24px rgba(230,51,41,0.8))',
            }}>☣</div>

            <h1 style={{
              fontFamily:    'var(--font-display)',
              fontSize:      'clamp(2.4rem, 7vw, 4.2rem)',
              lineHeight:    1,
              color:         '#d4c9b2',
              letterSpacing: '0.06em',
              textShadow:    '0 0 30px rgba(230,51,41,0.5)',
              margin:        0,
              transform:     titleSlam ? 'scale(1.12) skewX(-2deg)' : 'scale(1)',
              transition:    'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
            }}>
              ZOMBIE PLAGUE
            </h1>
          </div>

          {/* Story lines — fade+collapse between acts */}
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {lines.map((line, i) => {
              const isAct3   = line.act === 3
              const isClimax = isAct3 && i === STORY.length - 1 && done
              let fontSize = '0.82rem'
              if (isAct3) fontSize = i === STORY.length - 1 ? '1.15rem' : '0.95rem'
              let marginBottom: string | number = isAct3 ? '0.55rem' : '0.32rem'
              if (line.collapsed) marginBottom = 0
              let textColor = '#7a8c74'
              if (isAct3) textColor = '#d4c9b2'
              if (isClimax) textColor = '#e63329'
              const cursor = i === activeLine && !done
                ? { borderRight: '2px solid #6b8e23', paddingRight: '4px' }
                : {}
              return (
                <div key={line.full} style={{
                  opacity:      line.opacity,
                  maxHeight:    line.collapsed ? '0px' : '3rem',
                  overflow:     'hidden',
                  transition:   `opacity ${ACT_FADE_MS}ms ease, max-height ${ACT_FADE_MS + 200}ms ease, margin-bottom ${ACT_FADE_MS + 200}ms ease`,
                  marginBottom,
                  width:        '100%',
                  textAlign:    'center',
                }}>
                  <p style={{
                    margin:        0,
                    fontFamily:    'var(--font-mono)',
                    fontSize,
                    letterSpacing: isAct3 ? '0.04em' : '0.06em',
                    paddingRight:  '0.12em',
                    color:      textColor,
                    textShadow: isClimax ? '0 0 14px rgba(230,51,41,0.75)' : 'none',
                    fontWeight: isAct3 ? 600 : 400,
                    ...cursor,
                  }}>
                    {line.text}
                  </p>
                </div>
              )
            })}
          </div>

          {/* ENTER button — appears when story finishes */}
          <button
            onClick={dismiss}
            disabled={exiting || finaleStatic}
            style={{
              marginTop:     '0.25rem',
              padding:       '0.75rem 2.5rem',
              fontFamily:    'var(--font-mono)',
              fontSize:      '1rem',
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              fontWeight:    700,
              color:         '#060b06',
              backgroundColor: '#6b8e23',
              border:        '2px solid #6b8e23',
              borderRadius:  '6px',
              cursor:        'pointer',
              boxShadow:     '0 0 24px rgba(107,142,35,0.6)',
              opacity:       done ? 1 : 0,
              transform:     done ? 'translateY(0)' : 'translateY(8px)',
              transition:    'opacity 0.6s ease, transform 0.6s ease, box-shadow 0.2s',
              pointerEvents: done && !exiting && !finaleStatic ? 'auto' : 'none',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 40px rgba(107,142,35,0.9)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 24px rgba(107,142,35,0.6)'
            }}
          >
            ENTER
          </button>

          <p style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      '0.65rem',
            letterSpacing: '0.15em',
            color:         '#4a5e44',
            margin:        0,
            opacity:       done ? 0.7 : 0,
            transition:    'opacity 0.8s 0.3s',
          }}>
            Press ENTER or SPACE to continue
          </p>

        </div>
      )}
    </dialog>
  )
}
