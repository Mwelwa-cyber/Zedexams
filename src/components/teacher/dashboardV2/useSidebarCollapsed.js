import { useCallback, useEffect, useState } from 'react'
import {
  RAIL_DEFAULT_QUERY,
  readStoredCollapsed,
  resolveInitialCollapsed,
  writeStoredCollapsed,
} from './sidebarCollapseCore'

function safeStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    // Accessing localStorage itself throws in some privacy modes.
    return null
  }
}

function matchesRailDefault() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia(RAIL_DEFAULT_QUERY).matches
  } catch {
    return false
  }
}

/**
 * Whether the teacher sidebar is collapsed to its icon rail, plus the toggle.
 *
 * The state is resolved SYNCHRONOUSLY in the initial state, never in an
 * effect: TeacherLayout remounts on every navigation between teacher pages,
 * and a one-frame "expanded, then snap to collapsed" would make every page
 * change flash the panel open.
 *
 * Persisted in localStorage so the choice survives reloads and sessions.
 * Until a choice exists, the viewport decides and keeps deciding — a teacher
 * who has never touched the toggle gets the rail on a tablet and the full
 * panel on a desktop, including across a resize. The first toggle ends that:
 * from then on the stored choice holds at every width the sidebar renders at.
 */
export default function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(() =>
    resolveInitialCollapsed({
      stored: readStoredCollapsed(safeStorage()),
      railDefault: matchesRailDefault(),
    }),
  )

  useEffect(() => {
    // Only while nothing is stored. A remembered choice must not be undone by
    // a rotation or a window resize.
    if (readStoredCollapsed(safeStorage()) !== null) return undefined
    if (typeof window.matchMedia !== 'function') return undefined
    const mql = window.matchMedia(RAIL_DEFAULT_QUERY)
    setCollapsed(mql.matches)
    const onChange = (e) => {
      if (readStoredCollapsed(safeStorage()) !== null) return
      setCollapsed(e.matches)
    }
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    // Safari < 14 / older WebViews have only the legacy listener API; calling
    // addEventListener there throws and would take the whole shell down.
    if (typeof mql.addListener === 'function') {
      mql.addListener(onChange)
      return () => mql.removeListener(onChange)
    }
    return undefined
  }, [])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      writeStoredCollapsed(safeStorage(), next)
      return next
    })
  }, [])

  return { collapsed, toggleCollapsed }
}
