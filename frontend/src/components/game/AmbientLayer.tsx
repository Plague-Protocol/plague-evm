'use client'

/**
 * AmbientLayer — atmospheric dread layer for game surfaces.
 *
 * Two pieces, both purely decorative (aria-hidden, pointer-events-none):
 *  1. Spore particles — a sparse canvas of bio-green motes drifting upward,
 *     rendered UNDER the content cards (z-index 1 sibling).
 *  2. Breathing vignette — a slow radial darkening at the edges that sits
 *     ABOVE content (z-40) but below nav (z-50). Switches to a faster red
 *     pulse when `urgent` (e.g. final seconds of a voting window).
 *
 * Honors prefers-reduced-motion: particles are skipped entirely and the
 * vignette renders static. Canvas pauses when the tab is hidden.
 */

import { useEffect, useRef, useState } from 'react'

const SPORE_COUNT = 22
const SPORE_COLOR = '107,142,35' // moss green, matches game palette

interface Spore {
  x: number; y: number
  r: number
  vx: number; vy: number
  alpha: number
  phase: number
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduced
}

function SporeField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let spores: Spore[] = []
    let w = 0
    let h = 0

    const resize = () => {
      w = canvas.width = window.innerWidth
      h = canvas.height = window.innerHeight
    }
    const seed = () => {
      spores = Array.from({ length: SPORE_COUNT }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.8 + Math.random() * 1.8,
        vx: -0.05 - Math.random() * 0.12,
        vy: -0.08 - Math.random() * 0.18,
        alpha: 0.08 + Math.random() * 0.2,
        phase: Math.random() * Math.PI * 2,
      }))
    }

    resize()
    seed()

    let t = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (document.hidden) return
      t += 0.016
      ctx.clearRect(0, 0, w, h)
      for (const s of spores) {
        s.x += s.vx + Math.sin(t * 0.7 + s.phase) * 0.08
        s.y += s.vy
        if (s.y < -4 || s.x < -4) { // respawn at bottom/right
          s.x = Math.random() * w
          s.y = h + 4
        }
        const twinkle = 0.75 + 0.25 * Math.sin(t * 1.4 + s.phase)
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${SPORE_COLOR},${(s.alpha * twinkle).toFixed(3)})`
        ctx.fill()
      }
    }
    raf = requestAnimationFrame(tick)

    window.addEventListener('resize', resize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0"
      style={{ zIndex: 1 }}
    />
  )
}

export function AmbientLayer({ urgent = false }: { readonly urgent?: boolean }) {
  const reduced = usePrefersReducedMotion()

  const vignetteColor = urgent ? '204,20,20' : '6,11,6'
  // Urgent → red "lub-dub" heartbeat cadence (~1.1s/beat); calm → slow breathe.
  let animation = 'none'
  if (!reduced) {
    animation = urgent
      ? 'vignette-heartbeat 1.1s ease-in-out infinite'
      : 'vignette-breathe 9s ease-in-out infinite'
  }
  return (
    <>
      {!reduced && <SporeField />}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          zIndex: 40,
          background: `radial-gradient(ellipse at center, transparent 55%, rgba(${vignetteColor},${urgent ? 0.4 : 0.42}) 100%)`,
          animation,
          transition: 'background 0.8s ease',
        }}
      />
    </>
  )
}
