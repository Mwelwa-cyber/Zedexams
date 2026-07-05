import { useEffect, useRef } from 'react'

/**
 * useFocusTrap — accessible modal focus management in one place.
 *
 * Before this hook, every `role="dialog"` surface reimplemented (or, worse,
 * omitted) the same three behaviours, so keyboard users hit modals they
 * couldn't close (no Escape) or tab straight out of into the page behind
 * (no trap). This is the single source of truth ConfirmDialog established,
 * lifted out so the rest of the modals share it.
 *
 * While `active` is true it:
 *   • moves focus into the panel on open (an explicit `initialFocusRef` if
 *     given, otherwise the first focusable element, otherwise the panel),
 *   • calls `onEscape` when Escape is pressed,
 *   • traps Tab / Shift+Tab within the panel,
 *   • restores focus to the previously-focused element on close/unmount.
 *
 * @param {import('react').RefObject<HTMLElement>} panelRef — ref on the dialog panel.
 * @param {object} [options]
 * @param {boolean} [options.active=true] — enable the trap. Pass a modal's
 *   `open` flag here; always-mounted-while-open modals can leave it defaulted.
 * @param {() => void} [options.onEscape] — called when Escape is pressed.
 * @param {import('react').RefObject<HTMLElement>} [options.initialFocusRef] —
 *   element to focus first (e.g. the Cancel button on a destructive dialog).
 */
// Matches ConfirmDialog's original selector so behaviour is identical.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function useFocusTrap(panelRef, options = {}) {
  const { active = true, onEscape, initialFocusRef } = options
  const previouslyFocused = useRef(null)

  // Move focus into the panel on open, restore it on close/unmount.
  useEffect(() => {
    if (!active) return undefined
    previouslyFocused.current = document.activeElement
    const raf = requestAnimationFrame(() => {
      const target =
        initialFocusRef?.current ||
        panelRef.current?.querySelector(FOCUSABLE_SELECTOR) ||
        panelRef.current
      target?.focus?.()
    })
    return () => {
      cancelAnimationFrame(raf)
      if (previouslyFocused.current instanceof HTMLElement) {
        previouslyFocused.current.focus()
      }
    }
  }, [active, panelRef, initialFocusRef])

  // Escape closes; Tab is trapped inside the panel.
  useEffect(() => {
    if (!active) return undefined
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onEscape?.()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusables = panelRef.current.querySelectorAll(FOCUSABLE_SELECTOR)
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, panelRef, onEscape])
}

export { FOCUSABLE_SELECTOR }
