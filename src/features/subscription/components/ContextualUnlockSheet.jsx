/**
 * ContextualUnlockSheet — Tier 2. A bottom sheet that opens ONLY from a tap.
 *
 * Not on mount, not on a route change, not on sign-in, not on a timer. The
 * only thing that opens it is `unlockSheet.open`, and the only thing that
 * calls that is `useUnlockFlow.requestUnlock`, which is only ever wired to a
 * lock the user pressed. That is the whole of the contract, and
 * `ContextualUnlockSheet.spec.jsx` asserts a bare mount renders nothing.
 *
 */

import { useEffect, useRef } from 'react'
import useFocusTrap from '../../../hooks/useFocusTrap'
import AdultUnlockSheet from './AdultUnlockSheet'

/**
 * @param {object} props
 * @param {string} props.gate
 * @param {'checkout'} props.route
 * @param {object} [props.context]
 * @param {() => void} props.onClose
 */
// eslint-disable-next-line no-unused-vars
export default function ContextualUnlockSheet({ gate, route, context = {}, onClose }) {
  const panelRef = useRef(null)
  useFocusTrap(panelRef, { active: true, onEscape: onClose })

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  if (!gate) return null

  const Variant = AdultUnlockSheet

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Unlock this feature"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div ref={panelRef} className="relative w-full max-w-sm animate-scale-in">
        <Variant gate={gate} context={context} onClose={onClose} />
      </div>
    </div>
  )
}
