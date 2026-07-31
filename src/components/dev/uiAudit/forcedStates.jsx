import { useEffect, useRef } from 'react'
import { hoverClassesFrom } from './forcedStates.js'

/**
 * Showing an interactive state without interacting with it — the React half.
 * The reasoning, and the safelist that makes it work, are in forcedStates.js.
 */

/** Read a class attribute off any element, SVG included (where `className`
 *  is an SVGAnimatedString rather than a string). */
function classOf(el) {
  const raw = el.getAttribute?.('class')
  return typeof raw === 'string' ? raw : ''
}

/**
 * Render children with their hover state pinned open.
 *
 * `display: contents` on the wrapper so it adds no box of its own — the
 * specimen must sit in the grid exactly where the un-forced one does, or the
 * comparison picks up a layout difference that is not real.
 *
 * The effect runs on every render and undoes itself, because the classes it
 * adds would otherwise be read back as the element's own on the next pass and
 * accumulate.
 */
export function ForceHover({ children }) {
  const ref = useRef(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return undefined
    const touched = []
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const extra = hoverClassesFrom(classOf(el))
      if (!extra.length) continue
      el.classList.add(...extra)
      touched.push([el, extra])
    }
    return () => {
      for (const [el, extra] of touched) el.classList.remove(...extra)
    }
  })

  return (
    <span ref={ref} className="contents">
      {children}
    </span>
  )
}

/**
 * Render children with the global focus ring pinned open.
 *
 * Unlike hover this cannot be derived: the ring is not a utility on the
 * element, it is a global `*:focus-visible` rule in index.css, and there is no
 * way to make a rule apply without its pseudo-class. `.ui-audit-force-focus`
 * in uiAudit.css therefore repeats that one declaration — through the SAME
 * tokens, so what is being audited (does the ring survive this theme) is still
 * read from the theme. `test:ui-audit-forced-states` fails if the two
 * declarations stop matching.
 */
export function ForceFocus({ children }) {
  return <span className="contents ui-audit-force-focus">{children}</span>
}
