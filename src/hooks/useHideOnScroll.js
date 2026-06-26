import { useEffect, useRef, useState } from 'react'

/**
 * LinkedIn-style auto-hide on scroll.
 *
 * Returns `true` when the app chrome (top header / bottom nav) should be
 * hidden — i.e. the user is scrolling DOWN and is past a small threshold —
 * and `false` when scrolling UP or near the top of the page. Consumers slide
 * the header up / bottom nav down (see `.zx-nav-autohide` in index.css) so the
 * content goes full-screen while reading.
 *
 * The window/body is the scroll container in this app (no inner overflow div),
 * so we listen on `window`. The handler is rAF-throttled and ignores sub-`delta`
 * jitter so elastic/overscroll bounce on mobile doesn't flicker the chrome.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.threshold=64] px from top below which the chrome is
 *                                       always shown (so it never hides over the
 *                                       hero/first screen).
 * @param {number}  [opts.delta=6]       minimum px of travel before a direction
 *                                       change is honoured.
 * @returns {boolean} whether the chrome should be hidden.
 */
export default function useHideOnScroll({ threshold = 64, delta = 6 } = {}) {
  const [hidden, setHidden] = useState(false)
  const lastY = useRef(0)
  const ticking = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    lastY.current = window.scrollY || 0

    const update = () => {
      ticking.current = false
      const y = window.scrollY || 0

      // Always reveal near the very top of the page.
      if (y <= threshold) {
        setHidden(false)
        lastY.current = y
        return
      }

      const diff = y - lastY.current
      if (Math.abs(diff) < delta) return
      // Scrolling down → hide; scrolling up → show.
      setHidden(diff > 0)
      lastY.current = y
    }

    const onScroll = () => {
      if (ticking.current) return
      ticking.current = true
      window.requestAnimationFrame(update)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold, delta])

  return hidden
}
