'use client'

import { useEffect, useState, useCallback, useRef } from 'react'

const AMBIENT_TRACK = '/sounds/ambient-lobby.mp3'

const BG_FRAMES = [
  '/images/bg-horror.jpg',
  '/images/bg-zombie-portrait.jpg',
  '/images/bg-patient-zero.jpg',
  '/images/bg-game.jpg',
] as const

// ── Lore lines — typewriter text sequence ─────────────────────────────────────
const LORE: string[] = [
  'OUTBREAK DETECTED',
  'ORIGIN: UNKNOWN',
  'PATHOGEN: UNTRACEABLE',
  'CONTAINMENT: FAILED',
  'One infected. No cure. No mercy.',
  'Find Patient Zero.',
  'Before the plague takes hold.',
]

// ── Typewriter hook ───────────────────────────────────────────────────────────
function useTypewriter(lines: string[], msPerChar = 40, msBetweenLines = 600) {
  const [displayed, setDisplayed] = useState<string[]>([])
  const [activeLine, setActiveLine] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    let lineIdx = 0
    let charIdx = 0

    const tick = () => {
      if (cancelled) return
      if (lineIdx >= lines.length) {
        setDone(true)
        return
      }

      setActiveLine(lineIdx)
      const current = lines[lineIdx]
      charIdx++
      setDisplayed(prev => {
        const next = [...prev]
        // Clamp slice index so the final character never gets dropped.
        const end = Math.min(charIdx, current.length)
        next[lineIdx] = current.slice(0, end)
        return next
      })

      if (charIdx >= current.length) {
        // Force the final full line value before moving to the next line.
        setDisplayed(prev => {
          const next = [...prev]
          next[lineIdx] = current
          return next
        })
        lineIdx++
        charIdx = 0
        setTimeout(tick, msBetweenLines)
      } else {
        setTimeout(tick, msPerChar)
      }
    }
    setTimeout(tick, 600)
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { displayed, activeLine, done }
}

// ── Particles — tiny biohazard dots drifting upward ───────────────────────────
interface Particle {
  id: number
  x: number
  size: number
  delay: number
  duration: number
}

function generateParticles(n: number): Particle[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    size: 3 + Math.random() * 5,
    delay: Math.random() * 8,
    duration: 6 + Math.random() * 8,
  }))
}

const PARTICLES = generateParticles(24)

// ── Component ─────────────────────────────────────────────────────────────────
export function SplashScreen() {
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [finaleStatic, setFinaleStatic] = useState(false)
  const [titleSlam, setTitleSlam] = useState(false)
  const [audioArmed, setAudioArmed] = useState(false)
  const [bgIndex, setBgIndex] = useState(0)
  const ambientRef = useRef<HTMLAudioElement | null>(null)
  const { displayed, activeLine, done } = useTypewriter(LORE)

  // Always show intro on each fresh visit before entering the app.
  useEffect(() => {
    setVisible(true)
  }, [])

  // Background beat progression tracks the currently typed line.
  useEffect(() => {
    setBgIndex(Math.min(BG_FRAMES.length - 1, Math.floor(activeLine / 2)))
  }, [activeLine])

  // Light heartbeat punctuates each story beat.
  useEffect(() => {
    if (!visible) return
    const beat = new Audio('/sounds/heartbeat.mp3')
    beat.volume = 0.18
    beat.play().catch(() => {
      // Ignore autoplay errors; ambient fallback prompt covers interaction.
    })
  }, [activeLine, visible])

  // Intro ambient sound. If autoplay is blocked, arm and retry on first user input.
  useEffect(() => {
    if (!visible) return

    const audio = new Audio(AMBIENT_TRACK)
    audio.loop = true
    audio.volume = 0.28
    ambientRef.current = audio

    const start = async () => {
      try {
        await audio.play()
      } catch {
        setAudioArmed(true)
      }
    }

    void start()

    return () => {
      audio.pause()
      audio.currentTime = 0
      ambientRef.current = null
    }
  }, [visible])

  useEffect(() => {
    if (!visible || !audioArmed || !ambientRef.current) return
    const resume = () => {
      const audio = ambientRef.current
      if (!audio) return
      audio.play().then(() => setAudioArmed(false)).catch(() => {
        // Keep armed state until a browser-permitted interaction succeeds.
      })
    }
    globalThis.addEventListener('pointerdown', resume, { once: true })
    globalThis.addEventListener('keydown', resume, { once: true })
    return () => {
      globalThis.removeEventListener('pointerdown', resume)
      globalThis.removeEventListener('keydown', resume)
    }
  }, [visible, audioArmed])

  const dismiss = useCallback(() => {
    if (exiting || finaleStatic) return
    setFinaleStatic(true)
    setTitleSlam(true)
    const sting = new Audio('/sounds/reveal-sting.mp3')
    sting.volume = 0.35
    sting.play().catch(() => {
      // Ignore autoplay restrictions for the one-shot sting.
    })

    setTimeout(() => {
      setExiting(true)
    }, 260)

    if (ambientRef.current) {
      ambientRef.current.pause()
      ambientRef.current.currentTime = 0
    }
    setTimeout(() => {
      setVisible(false)
      setFinaleStatic(false)
      setTitleSlam(false)
    }, 900)
  }, [exiting, finaleStatic])

  // Allow keyboard Enter/Space to dismiss too
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') dismiss()
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [visible, dismiss])

  if (!visible) return null

  return (
    <dialog
      open
      aria-label="Plague Protocol intro"
      className="splash-root"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        maxWidth: '100vw',
        maxHeight: '100vh',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000',
        overflow: 'hidden',
        border: 'none',
        padding: 0,
        margin: 0,
        animation: exiting ? 'splash-exit 0.8s ease-in forwards' : 'splash-enter 0.6s ease-out both',
      }}
    >
      {/* Story background frame */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          backgroundImage: `url(${BG_FRAMES[bgIndex]})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          transform: 'scale(1.04)',
          filter: 'saturate(0.9) contrast(1.05) brightness(0.4)',
          transition: 'background-image 1.1s ease, filter 1.1s ease',
        }}
      />

      {/* Scanlines overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 4px)',
        pointerEvents: 'none',
        zIndex: 1,
      }} />

      {/* Finale static burst */}
      <div style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 3,
        opacity: finaleStatic ? 0.55 : 0,
        transition: 'opacity 0.18s ease',
        backgroundImage: 'radial-gradient(circle at 20% 10%, rgba(255,255,255,0.38) 0 1px, transparent 1px), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.28) 0 1px, transparent 1px), radial-gradient(circle at 55% 30%, rgba(255,255,255,0.42) 0 1px, transparent 1px)',
        backgroundSize: '6px 6px, 8px 8px, 5px 5px',
        animation: finaleStatic ? 'splash-static 0.22s steps(4) infinite' : 'none',
      }} />

      {/* Floating particles */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        {PARTICLES.map(p => (
          <span
            key={p.id}
            style={{
              position: 'absolute',
              bottom: '-12px',
              left: `${p.x}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              borderRadius: '50%',
              backgroundColor: 'rgba(57,255,20,0.35)',
              boxShadow: '0 0 6px rgba(57,255,20,0.5)',
              animation: `splash-particle ${p.duration}s ${p.delay}s ease-in infinite`,
            }}
          />
        ))}
      </div>

      {/* Blood vignette */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.7) 100%), radial-gradient(ellipse at center, transparent 35%, rgba(180,0,0,0.22) 100%)',
        pointerEvents: 'none',
        zIndex: 1,
      }} />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2rem', padding: '2rem', maxWidth: '560px', textAlign: 'center' }}>

        {/* Biohazard symbol */}
        <div
          style={{
            fontSize: '5rem',
            lineHeight: 1,
            animation: 'splash-pulse 3s ease-in-out infinite',
            filter: 'drop-shadow(0 0 24px rgba(230,51,41,0.8))',
          }}
        >
          ☣
        </div>

        {/* Title */}
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(2.8rem, 8vw, 5rem)',
            lineHeight: 1,
            color: '#d4c9b2',
            letterSpacing: '0.06em',
            textShadow: '0 0 30px rgba(230,51,41,0.5)',
            margin: 0,
            transform: titleSlam ? 'scale(1.12) skewX(-2deg)' : 'scale(1)',
            transition: 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
        >
          PLAGUE PROTOCOL
        </h1>

        {/* Typewriter lore */}
        <div style={{ minHeight: '9rem', width: '100%', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {displayed.map((line, i) => {
            const isLate = i >= 4        // last 3 lines are prose
            const isLast = i === displayed.length - 1
            return (
              <p
                key={LORE[i]}
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-mono)',
                  fontSize: isLate ? '1.05rem' : '0.8rem',
                  letterSpacing: isLate ? '0.05em' : '0.22em',
                  color: isLate ? '#d4c9b2' : '#e63329',
                  textShadow: isLate ? undefined : '0 0 8px rgba(230,51,41,0.6)',
                  fontWeight: isLate ? 400 : 700,
                  paddingInline: '0.35rem',
                  overflow: 'visible',
                  // Blinking cursor on the line currently being typed
                  ...(isLast && !done ? { borderRight: '2px solid #39ff14', paddingRight: '2px' } : {}),
                }}
              >
                {line}
              </p>
            )
          })}
        </div>

        {/* Enter button — fades in when typewriter finishes */}
        <button
          onClick={dismiss}
          disabled={exiting || finaleStatic}
          style={{
            marginTop: '0.5rem',
            padding: '0.75rem 2.5rem',
            fontFamily: 'var(--font-mono)',
            fontSize: '1rem',
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: '#060b06',
            backgroundColor: '#39ff14',
            border: '2px solid #39ff14',
            borderRadius: '6px',
            cursor: 'pointer',
            boxShadow: '0 0 24px rgba(57,255,20,0.6)',
            opacity: done ? 1 : 0,
            transform: done ? 'translateY(0)' : 'translateY(8px)',
            transition: 'opacity 0.6s ease, transform 0.6s ease, box-shadow 0.2s',
            pointerEvents: done && !exiting && !finaleStatic ? 'auto' : 'none',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 40px rgba(57,255,20,0.9)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 24px rgba(57,255,20,0.6)' }}
        >
          ENTER
        </button>

        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.65rem',
            letterSpacing: '0.15em',
            color: '#4a5e44',
            margin: 0,
            opacity: done ? 0.7 : 0,
            transition: 'opacity 0.8s 0.3s',
          }}
        >
          Press ENTER or SPACE to continue
        </p>

        {audioArmed && (
          <p
            style={{
              margin: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: '0.65rem',
              letterSpacing: '0.14em',
              color: '#f5c518',
            }}
          >
            Tap anywhere to enable intro audio
          </p>
        )}
      </div>
    </dialog>
  )
}
