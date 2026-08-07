/**
 * Pure logic for the teacher sidebar's collapsed/expanded state.
 *
 * No React, no DOM: the storage object is passed in, so this file is testable
 * under plain `node` (sidebarCollapseCore.test.js) and the hook around it
 * (useSidebarCollapsed.js) stays a thin wiring layer.
 *
 * Two states only — expanded (the full 248px panel) and collapsed (the icon
 * rail). Which one a teacher STARTS in depends on the viewport, but only until
 * they choose: a stored choice wins at every width ≥768px. Below 768px the
 * sidebar is unmounted entirely (TeacherLayout/useIsMobile) and none of this
 * is consulted, so collapsing can never affect the phone layout.
 */

export const SIDEBAR_COLLAPSE_KEY = 'zedexams:teacher-sidebar-collapsed'

/* 768–1023px — the width the sidebar has always rendered as an icon rail, so
   it stays the DEFAULT there. It is a default, not a lock: on a tablet the
   toggle expands the panel and that choice is remembered like any other. */
export const RAIL_DEFAULT_QUERY = '(max-width: 1023px)'

export const STORED_COLLAPSED = 'collapsed'
export const STORED_EXPANDED = 'expanded'

/**
 * Read a stored preference back.
 *
 * Returns `true`/`false` for a recognised value and `null` for "the teacher
 * has never chosen" — which is NOT the same as "expanded". Collapsing the
 * distinction is how a tablet's rail default would silently become the
 * desktop's full panel on first visit.
 */
export function parseStoredCollapsed(raw) {
  if (raw === STORED_COLLAPSED) return true
  if (raw === STORED_EXPANDED) return false
  return null
}

export function serializeCollapsed(collapsed) {
  return collapsed ? STORED_COLLAPSED : STORED_EXPANDED
}

/** The state to mount in: a remembered choice, else the width's default. */
export function resolveInitialCollapsed({ stored = null, railDefault = false } = {}) {
  const remembered = parseStoredCollapsed(stored)
  if (remembered !== null) return remembered
  return Boolean(railDefault)
}

/**
 * localStorage is unavailable in private mode / disabled-cookie browsers and
 * THROWS on access rather than returning null. A sidebar that refuses to
 * render because it could not read a layout preference would be a far worse
 * failure than forgetting the preference, so both directions swallow.
 */
export function readStoredCollapsed(storage) {
  try {
    return storage?.getItem(SIDEBAR_COLLAPSE_KEY) ?? null
  } catch {
    return null
  }
}

export function writeStoredCollapsed(storage, collapsed) {
  // `storage?.setItem(...)` would short-circuit on a missing storage and still
  // report success — "the preference is saved" when nothing was written.
  if (!storage || typeof storage.setItem !== 'function') return false
  try {
    storage.setItem(SIDEBAR_COLLAPSE_KEY, serializeCollapsed(collapsed))
    return true
  } catch {
    return false
  }
}
