import { useEffect, useState } from 'react'

/**
 * Lightweight CSS-only confetti burst — no extra deps.
 * Renders ~30 coloured squares that fall + fade over 2.5 seconds.
 * Triggered from game "done" screens when the player earns a badge or
 * hits a big score milestone. Fully self-cleaning.
 */
export default function Confetti({ fire = 0 }) {
  const [instances, setInstances] = useState([])

  useEffect(() => {
    if (!fire) return
    const id = Date.now()
    setInstances((xs) => [...xs, { id, pieces: makePieces(30) }])
    const timeout = setTimeout(() => {
      setInstances((xs) => xs.filter((x) => x.id !== id))
    }, 2800)
    return () => clearTimeout(timeout)
  }, [fire])

  if (instances.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {instances.map((inst) => (
        <div key={inst.id} className="absolute inset-0">
          {inst.pieces.map((p, i) => (
            <span
              key={i}
              className="absolute block rounded-sm"
              style={{
                left: `${p.left}%`,
                top: '-6%',
                width: `${p.size}px`,
                height: `${p.size}px`,
                background: p.color,
                transform: `rotate(${p.rot}deg)`,
                animation: `zx-confetti-fall ${p.duration}s ${p.delay}s ease-in forwards`,
              }}
            />
          ))}
        </div>
      ))}
      <style>{`
        @keyframes zx-confetti-fall {
          0%   { transform: translate3d(0, 0, 0) rotate(0deg); opacity: 1; }
          100% { transform: translate3d(var(--dx, 30px), 120vh, 0) rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  )
}

function makePieces(n) {
  const colors = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#eab308']
  const pieces = []
  for (let i = 0; i < n; i++) {
    pieces.push({
      left: Math.random() * 100,
      size: 6 + Math.random() * 8,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * 360,
      duration: 1.8 + Math.random() * 0.8,
      delay: Math.random() * 0.3,
    })
  }
  return pieces
}
