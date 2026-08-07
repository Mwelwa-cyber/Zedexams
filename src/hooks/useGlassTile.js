/**
 * Glass-tile interaction wiring for the Teacher Workspace cards.
 *
 * Every behaviour here is caused by user input (cursor, finger, scroll) —
 * there are deliberately no timers and no randomness. All three hooks write
 * to the DOM node directly (CSS vars / classes) so a mousemove never causes
 * a React re-render.
 *
 *  - useSpecular(ref)      cursor-following highlight: writes --mx/--my as
 *                          percentages of the tile's box, mouse pointers only.
 *  - usePressFeedback(ref) instant press-down class for touch/pen pointers
 *                          (mouse gets the hover treatment instead).
 *  - useSheenOnce(ref)     adds `is-inview` the FIRST time the tile scrolls
 *                          into view, then unobserves — the CSS sweep runs
 *                          once per tile per page load, never loops.
 *
 * useGlassTile() composes all three and returns the ref to put on the tile.
 */
import { useEffect, useRef } from 'react'

export const PRESSED_CLASS = 'is-pressed'
export const INVIEW_CLASS = 'is-inview'

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function useSpecular(ref, { enabled = true } = {}) {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return undefined
    const onMove = (e) => {
      if (e.pointerType !== 'mouse') return
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      el.style.setProperty('--mx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`)
      el.style.setProperty('--my', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`)
    }
    el.addEventListener('pointermove', onMove)
    return () => el.removeEventListener('pointermove', onMove)
  }, [ref, enabled])
}

export function usePressFeedback(ref, { enabled = true } = {}) {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return undefined
    const down = (e) => {
      if (e.pointerType === 'mouse') return
      el.classList.add(PRESSED_CLASS)
    }
    const up = () => el.classList.remove(PRESSED_CLASS)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('pointerleave', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('pointerleave', up)
    }
  }, [ref, enabled])
}

export function useSheenOnce(ref, { enabled = true } = {}) {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return undefined
    // No observer at all under reduced motion or where the API is missing —
    // the class never lands, so the sweep simply never plays.
    if (reducedMotion() || typeof IntersectionObserver !== 'function') return undefined
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add(INVIEW_CLASS)
            io.unobserve(el)
          }
        }
      },
      { threshold: 0.45 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, enabled])
}

/**
 * Options let quieter surfaces opt out of a behaviour (the AI cards take
 * no sheen; list rows take press only) while everything still runs through
 * this one hook — never a re-implementation.
 */
export default function useGlassTile({ specular = true, press = true, sheen = true } = {}) {
  const ref = useRef(null)
  useSpecular(ref, { enabled: specular })
  usePressFeedback(ref, { enabled: press })
  useSheenOnce(ref, { enabled: sheen })
  return ref
}
