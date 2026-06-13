/**
 * Paper-level undo / redo for the Assessment Studio.
 *
 * TipTap already gives every rich-text field its own Ctrl+Z history, but
 * structural edits — adding/removing/reordering questions and parts, header
 * field changes, type switches — had no way back. This hook keeps a bounded
 * snapshot stack of an arbitrary "content" value and restores it through a
 * caller-supplied `apply` function.
 *
 * The three transition helpers are pure (no React) so they can be unit
 * tested without a DOM. The hook itself holds the stack in a ref and bumps a
 * version counter only when `canUndo` / `canRedo` change, so typing doesn't
 * trigger extra renders.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react'

const DEFAULT_LIMIT = 40
const DEFAULT_DELAY = 600

function defaultIsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Record `snapshot` as the new present, pushing the old present onto `past`
 * and clearing `future`. No-op (returns the same object) when the snapshot is
 * equal to the current present, so identical re-renders never grow the stack.
 */
export function recordHistory(history, snapshot, limit = DEFAULT_LIMIT, isEqual = defaultIsEqual) {
  if (isEqual(history.present, snapshot)) return history
  const past = [...history.past, history.present]
  // Keep only the most recent `limit` entries.
  while (past.length > limit) past.shift()
  return { past, present: snapshot, future: [] }
}

/** Step back one snapshot. No-op when there's nothing to undo. */
export function undoHistory(history) {
  if (!history.past.length) return history
  const present = history.past[history.past.length - 1]
  return {
    past: history.past.slice(0, -1),
    present,
    future: [history.present, ...history.future],
  }
}

/** Step forward one snapshot. No-op when there's nothing to redo. */
export function redoHistory(history) {
  if (!history.future.length) return history
  const present = history.future[0]
  return {
    past: [...history.past, history.present],
    present,
    future: history.future.slice(1),
  }
}

/**
 * @param {*} value     Current content snapshot (any serialisable value).
 * @param {Function} apply  (snapshot) => void — restore the editor to a snapshot.
 * @param {object} [opts]   { delay, limit, isEqual }
 * @returns {{ undo, redo, canUndo, canRedo, reset }}
 */
export function useUndoRedo(value, apply, opts = {}) {
  const { delay = DEFAULT_DELAY, limit = DEFAULT_LIMIT, isEqual = defaultIsEqual } = opts
  const historyRef = useRef({ past: [], present: value, future: [] })
  // When true, the next value-change effect is the result of our own undo/redo
  // restore — record nothing and just resync the present pointer.
  const restoringRef = useRef(false)
  const applyRef = useRef(apply)
  applyRef.current = apply
  const [, bump] = useReducer((n) => n + 1, 0)

  // Debounced recorder: every settled change to `value` becomes a snapshot.
  useEffect(() => {
    if (restoringRef.current) {
      restoringRef.current = false
      historyRef.current = { ...historyRef.current, present: value }
      return
    }
    const timer = setTimeout(() => {
      const next = recordHistory(historyRef.current, value, limit, isEqual)
      if (next !== historyRef.current) {
        const hadUndo = historyRef.current.past.length > 0
        const hadRedo = historyRef.current.future.length > 0
        historyRef.current = next
        // Only re-render when the button-enabled state actually flips.
        if ((next.past.length > 0) !== hadUndo || (next.future.length > 0) !== hadRedo) bump()
      }
    }, delay)
    return () => clearTimeout(timer)
    // `apply`/`isEqual`/`limit`/`delay` are read from refs or are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const step = useCallback((transition) => {
    const next = transition(historyRef.current)
    if (next === historyRef.current) return
    historyRef.current = next
    restoringRef.current = true
    applyRef.current(next.present)
    bump()
  }, [])

  const undo = useCallback(() => step(undoHistory), [step])
  const redo = useCallback(() => step(redoHistory), [step])

  // Drop all history and re-seed the present (e.g. after a draft restore or a
  // fresh "create paper" so the first undo doesn't jump back to an empty page).
  const reset = useCallback((seed) => {
    historyRef.current = { past: [], present: seed, future: [] }
    bump()
  }, [])

  return {
    undo,
    redo,
    canUndo: historyRef.current.past.length > 0,
    canRedo: historyRef.current.future.length > 0,
    reset,
  }
}
