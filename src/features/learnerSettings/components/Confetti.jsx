// Confetti — a lightweight, dependency-free celebration burst. Rendered when a
// learner unlocks a new badge on the Progress card. Honours reduced-motion
// (renders nothing) and auto-clears after the animation so it never lingers.

import { useEffect, useState } from 'react'

const COLORS = ['#2563eb', '#7c3aed', '#22c55e', '#f59e0b', '#ef4444', '#0ea5e9']

function reducedMotion() {
  if (typeof window === 'undefined') return false
  try {
    if (document.body?.getAttribute('data-a11y-motion') === 'reduced') return true
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false
  } catch {
    return false
  }
}

// `fireKey` changing to a new truthy value triggers a burst. Kept deterministic
// (index-derived offsets, no Math.random at module load) so it's SSR-safe.
export default function Confetti({ fireKey }) {
  const [pieces, setPieces] = useState(null)

  useEffect(() => {
    if (!fireKey || reducedMotion()) return undefined
    const count = 90
    const next = Array.from({ length: count }, (_, i) => {
      const left = (i * 37) % 100
      const delay = (i % 12) * 0.06
      const drift = ((i * 53) % 40) - 20
      const size = 7 + ((i * 13) % 8)
      return {
        id: `${fireKey}-${i}`,
        left,
        delay,
        drift,
        size,
        color: COLORS[i % COLORS.length],
        duration: 2 + ((i % 6) * 0.18),
      }
    })
    setPieces(next)
    const t = setTimeout(() => setPieces(null), 2800)
    return () => clearTimeout(t)
  }, [fireKey])

  if (!pieces) return null
  return (
    <div className="lset-confetti" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 1.5,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `translateX(${p.drift}px)`,
          }}
        />
      ))}
    </div>
  )
}
