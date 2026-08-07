import { useEffect, useState } from 'react'

/**
 * Is the caret currently inside an element matching `selector`?
 *
 * Exists for one job: the Paper Header collapses when the library autosave
 * lands, and that is a moment the teacher neither chooses nor sees coming. If
 * it lands while they are typing in the header, the form is replaced by a
 * one-line summary mid-keystroke. `shouldCollapsePaperHeader` defers the
 * collapse while this returns true.
 *
 * Why `focusin`/`focusout` and not `:focus-within` in CSS: the decision is
 * about which COMPONENT renders, not how one is painted. And not
 * `document.activeElement` read during render either — that is a live DOM read
 * in a function React may call at any time, so it neither triggers a re-render
 * when focus moves nor gives a stable answer under StrictMode's double render.
 *
 * The `focusout` handler reads `relatedTarget`, not `activeElement`. At the
 * moment `focusout` fires, focus has left the old element and not yet reached
 * the new one, so `document.activeElement` is `<body>` — a naive read reports
 * "focus left the header" for the split second between two fields INSIDE it,
 * which is exactly when a deferred collapse would fire and eat the next
 * keystroke. `relatedTarget` is where focus is going, so a move between two
 * fields in the same form never reads as leaving it. It is null when focus
 * leaves the document entirely (tabbing to browser chrome), which correctly
 * reads as "not inside".
 */
export default function useFocusWithin(selector) {
  const [inside, setInside] = useState(false)

  useEffect(() => {
    if (!selector || typeof document === 'undefined') return undefined
    const matches = (node) => Boolean(node && typeof node.closest === 'function' && node.closest(selector))
    const onFocusIn = (event) => setInside(matches(event.target))
    const onFocusOut = (event) => setInside(matches(event.relatedTarget))
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    // Focus may already be inside when this mounts (the header form re-renders
    // around a focused field), so seed from the live value rather than assuming
    // false and waiting for an event that has already happened.
    setInside(matches(document.activeElement))
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [selector])

  return inside
}
