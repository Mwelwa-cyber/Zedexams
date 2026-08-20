/**
 * §3's celebration: a 14-piece confetti burst and a "3 in a row!" pop.
 *
 * ── Two constraints shape the whole thing ────────────────────────────────
 *
 * 1. "transform + opacity only — these are cheap Android phones". No box
 *    shadows, no filters, no width/height animation, nothing that touches
 *    layout or paint. Fourteen pieces, not fifty: the burst has to feel like a
 *    reward on a device where fifty would feel like a stutter.
 * 2. "Nothing negative ever animates." There is no counterpart to this
 *    component. A wrong answer shakes its option once, in CSS, and stops.
 *
 * The stylesheet also honours `prefers-reduced-motion`, where the confetti is
 * removed outright rather than sped up — a learner who asked their phone to
 * stop moving things gets a phone that stops moving things.
 */

import { useEffect, useState } from 'react'

const PIECES = 14
const COLOURS = ['#5b4be8', '#ff6b4a', '#f5b315', '#12a150', '#8b5cf6']

/**
 * A burst keyed on `token`. The parent bumps the token on each correct answer;
 * a changed key remounts, which is what restarts a CSS animation without
 * touching the DOM by hand.
 */
export function Confetti({ token }) {
  const [pieces, setPieces] = useState([])

  useEffect(() => {
    if (!token) { setPieces([]); return undefined }
    setPieces(Array.from({ length: PIECES }, (_, i) => ({
      id: `${token}-${i}`,
      background: COLOURS[i % COLOURS.length],
      left: `${18 + Math.random() * 64}%`,
      top: `${24 + Math.random() * 10}%`,
      '--pq-dx': `${Math.random() * 220 - 110}px`,
      '--pq-rot': `${Math.random() * 720 - 360}deg`,
      animationDelay: `${Math.random() * 0.14}s`,
    })))
    // Removed after the animation rather than left in the tree: fourteen
    // absolutely-positioned elements per correct answer, over sixty questions,
    // is 840 nodes on a phone that has better things to do.
    const t = setTimeout(() => setPieces([]), 1400)
    return () => clearTimeout(t)
  }, [token])

  if (pieces.length === 0) return null
  return (
    <div className="pq-confetti" aria-hidden="true">
      {pieces.map(({ id, ...style }) => <i key={id} style={style} />)}
    </div>
  )
}

/** "3 in a row!" — every third consecutive correct answer. */
export function StreakPop({ streak, token }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!token) return undefined
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 1600)
    return () => clearTimeout(t)
  }, [token])
  if (!visible || !streak) return null
  return (
    <div className="pq-streak" role="status">
      <b>{`${streak} in a row!`}</b>
      <span>Keep it going</span>
    </div>
  )
}
