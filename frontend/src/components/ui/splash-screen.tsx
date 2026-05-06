'use client'

import { useEffect, useState, useCallback } from 'react'

const STORAGE_KEY = 'plague_intro_seen'

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
      const current = lines[lineIdx]
      charIdx++
      setDisplayed(prev => {
        const next = [...prev]
        next[lineIdx] = current.slice(0, charIdx)
        return next
      })
      if (charIdx >= current.length) {
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

  return { displayed, done }
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
  const { displayed, done } = useTypewriter(LORE)

  // Check if we should show: first-ever visit only
  useEffect(() => {
    if (typeof globalThis.localStorage === 'undefined') return
    if (!globalThis.localStorage.getItem(STORAGE_KEY)) {
      setVisible(true)
    }
  }, [])

  const dismiss = useCallback(() => {
    setExiting(true)
    globalThis.localStorage?.setItem(STORAGE_KEY, '1')
    setTimeout(() => setVisible(false), 800)
  }, [])

  // Allow keyboard Enter/Space to dismiss too
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, dismiss])

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Plague Protocol intro"
      className="splash-root"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000',
        overflow: 'hidden',
        animation: exiting ? 'splash-exit 0.8s ease-in forwards' : 'splash-enter 0.6s ease-out both',
      }}
    >
      {/* Scanlines overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 4px)',
        pointerEvents: 'none',
        zIndex: 1,
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
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(180,0,0,0.18) 100%)',
        pointerEvents: 'none',
        zIndex: 0,
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
                key={i}
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-mono)',
                  fontSize: isLate ? '1.05rem' : '0.8rem',
                  letterSpacing: isLate ? '0.05em' : '0.22em',
                  color: isLate ? '#d4c9b2' : '#e63329',
                  textShadow: isLate ? undefined : '0 0 8px rgba(230,51,41,0.6)',
                  fontWeight: isLate ? 400 : 700,
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
            pointerEvents: done ? 'auto' : 'none',
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
      </div>
    </div>
  )
}
