/**
 * Unsaved-changes guard for the Class Register detail shell.
 *
 * MarkEntryGrid keeps typed-but-unsaved marks in local state and only persists
 * them on Save. Its own "← Back to mark schedules" button and a `beforeunload`
 * handler already guard the two paths it owns (in-panel back, tab close/reload).
 * But the grid is mounted three levels below ClassRegisterDetail, which renders
 * the tab links, the "← Class List" / "Edit" links and the Archive button —
 * SPA navigations that unmount the grid and silently discard the marks, because
 * a declarative <BrowserRouter> gives us no useBlocker to intercept them.
 *
 * This lifts the grid's dirty flag to the parent via context so those controls
 * can confirm before navigating. A child that produces unsaved changes calls
 * useMarkUnsaved(dirty); the parent wraps every navigation in
 * confirmDiscardIfDirty(), which prompts once and returns whether it's safe to
 * proceed. The flag is a ref (not state) so reading it in a click handler is
 * synchronous and never one render stale.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { setActiveShellNavGuard } from '../../../shared/utils/shellNavGuardCore'

export const UNSAVED_MARKS_MESSAGE = 'You have unsaved marks. Leave without saving?'

const RegisterUnsavedGuardContext = createContext(null)

/**
 * Owns the dirty flag + the confirm gate. Call from the shell (ClassRegisterDetail),
 * spread `guard.provider` around the subtree that can go dirty, and call
 * `guard.confirmDiscardIfDirty()` in every navigation handler.
 *
 * @param {(message?: string) => boolean} [confirmFn] injectable for tests;
 *   defaults to window.confirm.
 */
export function useRegisterUnsavedGuard(confirmFn) {
  const dirtyRef = useRef(false)

  const setDirty = useCallback((dirty) => { dirtyRef.current = !!dirty }, [])

  const confirmDiscardIfDirty = useCallback(() => {
    if (!dirtyRef.current) return true
    const ask = confirmFn || (typeof window !== 'undefined' ? window.confirm : null)
    // No confirm available (SSR / non-browser) → fail SAFE: block the discard
    // rather than silently drop unsaved marks.
    return ask ? ask(UNSAVED_MARKS_MESSAGE) : false
    // Intentionally NOT clearing dirtyRef here on a positive answer. The flag is
    // owned by the publisher's lifecycle: useMarkUnsaved's cleanup resets it
    // when the grid actually unmounts (i.e. the navigation truly committed).
    // Clearing on the answer alone would drop the guard for callers that prompt
    // but do NOT navigate — Archive opens a *second* dialog the user may cancel,
    // a cmd/ctrl-click opens a new tab without unmounting, clicking the active
    // tab re-renders in place — leaving the dirty grid mounted with the guard
    // silently disarmed for the next real navigation.
  }, [confirmFn])

  // Publish the same gate to the module-scope registry so the shared shell nav
  // (TeacherLayout's sidebar / drawer / dock / account menu / logout), which
  // renders OUTSIDE this React context, can consult it before navigating away.
  // The disposer clears it when the register detail view unmounts.
  useEffect(() => setActiveShellNavGuard(confirmDiscardIfDirty), [confirmDiscardIfDirty])

  const contextValue = useMemo(() => ({ setDirty }), [setDirty])

  return useMemo(
    () => ({ confirmDiscardIfDirty, contextValue }),
    [confirmDiscardIfDirty, contextValue],
  )
}

/** Provider — wrap the subtree whose descendants can produce unsaved changes. */
export function RegisterUnsavedGuardProvider({ value, children }) {
  return (
    <RegisterUnsavedGuardContext.Provider value={value}>
      {children}
    </RegisterUnsavedGuardContext.Provider>
  )
}

/**
 * Publish a child's dirty state into the guard. No-op when rendered outside a
 * provider (e.g. the grid opened standalone in a test), so consumers stay
 * decoupled from the shell.
 */
export function useMarkUnsaved(dirty) {
  const ctx = useContext(RegisterUnsavedGuardContext)
  useEffect(() => {
    if (!ctx) return undefined
    ctx.setDirty(dirty)
    // Leaving the subtree (unmount) clears the flag so a stale "dirty" can't
    // outlive the grid and block an unrelated navigation later.
    return () => ctx.setDirty(false)
  }, [ctx, dirty])
}
