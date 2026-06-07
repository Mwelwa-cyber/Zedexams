// src/features/notes/hooks/useActiveSection.js
//
// Tracks which section heading is currently in view, for TOC highlighting.
// Pass the memoized TOC entries ([{ key, id }]); returns the active section
// `key` (or null). Uses IntersectionObserver and no-ops safely when there are
// no sections or the DOM isn't ready.

import { useEffect, useState } from 'react'

export function useActiveSection(toc) {
  const [activeKey, setActiveKey] = useState(null)

  useEffect(() => {
    if (!Array.isArray(toc) || toc.length === 0) return
    if (typeof IntersectionObserver === 'undefined') return

    const els = toc.map(e => document.getElementById(e.id)).filter(Boolean)
    if (els.length === 0) return

    const keyById = new Map(toc.map(e => [e.id, e.key]))
    const visible = new Set()

    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) visible.add(en.target.id)
          else visible.delete(en.target.id)
        }
        // The active section is the top-most heading currently in the band.
        const top = els.find(el => visible.has(el.id))
        if (top) setActiveKey(keyById.get(top.id))
      },
      // Band sits just under the sticky controls; -65% bottom margin means a
      // heading is "active" once it reaches the upper third of the viewport.
      { rootMargin: '-72px 0px -65% 0px', threshold: [0, 1] },
    )

    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [toc])

  return activeKey
}
