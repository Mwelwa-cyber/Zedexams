/**
 * ListTextarea — a controlled textarea for "one item per line" list fields.
 *
 * The parent owns a clean string array; the DOM value is kept as raw text so
 * newlines and trailing spaces survive while the teacher is typing. Contract:
 *
 *   value     – string[] (the canonical list; [] on first render is fine)
 *   onChange  – (list: string[]) => void; receives the parsed array on every
 *               keystroke so parent state stays clean and live previews update
 *   ...rest   – forwarded to <textarea>: placeholder, rows, className,
 *               disabled, aria-label, etc.
 *
 * Resync policy
 *   Raw text is only overwritten when the incoming value array differs from
 *   the last list this component itself emitted. A mismatch means something
 *   outside the component changed the list (ResourceAssistant appending an
 *   item, AI generation or "build from scheme" replacing it wholesale) and
 *   the textarea must reflect it. When the arrays match our last emit the
 *   user is mid-typing — we leave the raw text alone so Enter and spaces are
 *   never eaten.
 */

import { useEffect, useRef, useState } from 'react'

function parseList(raw) {
  return String(raw || '').split('\n').map((s) => s.trim()).filter(Boolean)
}

function listsEqual(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export default function ListTextarea({ value, onChange, ...rest }) {
  const list = Array.isArray(value) ? value : []

  const [raw, setRaw] = useState(() => list.join('\n'))

  // Tracks the last parsed list we emitted so external mutations can be
  // distinguished from the parent echoing back our own last emit.
  const lastEmittedRef = useRef(list)

  useEffect(() => {
    const incoming = Array.isArray(value) ? value : []
    // Only resync when the incoming array genuinely differs from our last emit.
    // Matches mean the parent is echoing back what we typed — don't overwrite.
    if (!listsEqual(incoming, lastEmittedRef.current)) {
      setRaw(incoming.join('\n'))
      lastEmittedRef.current = [...incoming]
    }
  }, [value])

  function handleChange(e) {
    const nextRaw = e.target.value
    setRaw(nextRaw)
    const parsed = parseList(nextRaw)
    lastEmittedRef.current = parsed
    onChange?.(parsed)
  }

  return <textarea {...rest} value={raw} onChange={handleChange} />
}
