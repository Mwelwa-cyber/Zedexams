/**
 * Shared-shell navigation guard — module-scope registry + a pure click predicate.
 *
 * The Class Register's unsaved-marks guard (registerUnsavedGuard.jsx) is a React
 * context scoped to ClassRegisterDetail's subtree. But every register route is
 * wrapped by TeacherLayout, whose sidebar / mobile drawer / bottom dock / account
 * menu are rendered ABOVE (outside) that provider — so a teacher clicking a shell
 * destination like Dashboard or Library performs an SPA navigation that unmounts
 * the grid and silently discards the marks, with no React path to intercept it
 * (a declarative <BrowserRouter> gives us no useBlocker).
 *
 * This bridges the gap without React context: the register registers its
 * confirm-gate into a module-scope slot, and the shell consults it synchronously
 * before letting a navigation proceed. No React, no DOM globals at module load,
 * so the whole thing is node-testable.
 *
 * Only one Class Register detail view is ever mounted at a time, so a single
 * active guard is sufficient; registering replaces any previous one and the
 * returned disposer clears it on unmount.
 */

let activeNavGuard = null

/**
 * Publish a confirm-gate as the active shell-nav guard. Returns a disposer that
 * clears it (only if it is still the active one — a later registrant wins).
 *
 * @param {() => boolean} fn returns true when navigation may proceed.
 */
export function setActiveShellNavGuard(fn) {
  activeNavGuard = typeof fn === 'function' ? fn : null
  return () => { if (activeNavGuard === fn) activeNavGuard = null }
}

/**
 * The shell calls this before a navigation it owns. True (proceed) when no guard
 * is registered — the common case for every non-register teacher page, so the
 * gate is a no-op everywhere else.
 */
export function confirmShellNavigation() {
  return activeNavGuard ? activeNavGuard() : true
}

/** Test-only: drop any registered guard so module state can't leak across tests. */
export function __resetShellNavGuard() { activeNavGuard = null }

/**
 * Should a click on an anchor be treated as an in-app SPA navigation this guard
 * is responsible for intercepting?
 *
 * Deliberately narrow — it returns false for every click the browser (or React
 * Router) will NOT turn into an in-place navigation that unmounts the grid, so
 * the guard never prompts spuriously:
 *   • a non-left click, or a modified click (cmd/ctrl/shift/alt) → a new tab or
 *     context menu; the current grid stays mounted, exactly as the in-panel
 *     guard already tolerates a cmd-click.
 *   • target="_blank"/named target → opens elsewhere, grid untouched.
 *   • an already-prevented event → something upstream handled it.
 *   • a fragment ("#…"), mailto:/tel:/javascript: → not an in-app route change.
 *   • a cross-origin href → a real document navigation; the browser's own
 *     beforeunload handler (which the grid also installs) covers that path.
 *
 * @param {{defaultPrevented?:boolean,button?:number,metaKey?:boolean,ctrlKey?:boolean,shiftKey?:boolean,altKey?:boolean}} event
 * @param {{target?:string, href?:string, getAttribute?:(n:string)=>?string}} anchor
 * @param {string} currentOrigin e.g. window.location.origin
 */
export function isPlainInAppLinkClick(event, anchor, currentOrigin) {
  if (!event || !anchor) return false
  if (event.defaultPrevented) return false
  if (event.button != null && event.button !== 0) return false
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false

  const target = anchor.target
  if (target && target !== '_self') return false

  const rawHref = typeof anchor.getAttribute === 'function'
    ? anchor.getAttribute('href')
    : anchor.href
  if (!rawHref || rawHref.startsWith('#')) return false
  if (/^(mailto:|tel:|javascript:)/i.test(rawHref)) return false

  try {
    const url = new URL(anchor.href || rawHref, currentOrigin)
    if (url.origin !== currentOrigin) return false
  } catch {
    return false
  }
  return true
}
