import { useCallback, useRef, useState } from 'react'
import { scorePopLabel } from '../lib/gameFeel'

/**
 * Floating "+N" / "−N" score deltas that pop off the score pill the instant an
 * answer lands — the single biggest bit of moment-to-moment juice. Gains float
 * up in green; penalties drop in red. Each pop removes itself after the
 * animation, so the layer is self-cleaning.
 *
 * Usage:
 *   const { pops, pushPop } = useScorePops()
 *   ...pushPop(gained)        // on correct
 *   ...pushPop(-penalty)      // on wrong
 *   <div className="relative"><Pill .../><ScorePops pops={pops} /></div>
 *
 * The wrapper that holds <ScorePops> must be `position: relative` — pops are
 * absolutely positioned and centred over it.
 */
export function useScorePops() {
  const [pops, setPops] = useState([])
  const idRef = useRef(0)

  const pushPop = useCallback((delta) => {
    const { text, tone } = scorePopLabel(delta)
    if (!text) return
    const id = ++idRef.current
    setPops((xs) => [...xs, { id, text, tone }])
    // Drop the pop a touch after the 900ms float so it never lingers.
    setTimeout(() => {
      setPops((xs) => xs.filter((p) => p.id !== id))
    }, 1000)
  }, [])

  return { pops, pushPop }
}

export default function ScorePops({ pops }) {
  if (!pops?.length) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 -top-1 z-20 flex justify-center">
      {pops.map((p) => (
        <span
          key={p.id}
          className={`zx-anim-pop absolute font-display text-2xl font-black tabular-nums drop-shadow-sm ${
            p.tone === 'gain' ? 'text-emerald-600' : 'text-rose-600'
          }`}
        >
          {p.text}
        </span>
      ))}
    </div>
  )
}
