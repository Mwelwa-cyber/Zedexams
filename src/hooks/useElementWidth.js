/**
 * Live width of a ref'd element, in CSS pixels, or null before the first
 * measurement.
 *
 * Titles that shorten by dropping facts (see `src/utils/responsiveTitle.js`)
 * need the width of their OWN container, not the viewport: a bar's back
 * button, status chip and Save button — or a card row's subject tile, quiz
 * button and bookmark — take room the viewport width says nothing about.
 *
 * Extracted from `components/teacher/studio/DocTitle.jsx` when the past-paper
 * archive needed the same measurement. A hook duplicated into a second feature
 * is a hook that will grow a second ResizeObserver cleanup bug; that file now
 * re-exports this one.
 */

import { useEffect, useState } from 'react'

export function useElementWidth(ref) {
  const [width, setWidth] = useState(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const read = () => setWidth(el.getBoundingClientRect().width || el.offsetWidth || 0)
    read()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(read)
      observer.observe(el)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [ref])
  return width
}

export default useElementWidth
