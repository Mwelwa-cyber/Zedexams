import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { STUDIO_BY_ID } from '../shared/constants/teacherStudios'
import { pushRecent, sanitizeIds } from '../shared/utils/teacherLauncherCore'

const CAP = 12

/**
 * Recently opened studios, tracked per teacher in localStorage only.
 *
 * Stores ONLY stable studio IDs and open timestamps (no document content,
 * no titles) — safe metadata. Device-local by design (a "recent on THIS
 * device" signal); favourites are the cross-device concept. Newest first,
 * capped to CAP entries.
 *
 * Persisted shape: { ids: string[], at: { [id]: ms } }. Legacy plain-array
 * values are still read.
 */
export default function useRecentStudios() {
  const { currentUser } = useAuth() || {}
  const uid = currentUser?.uid || null
  const storageKey = uid ? `zedexams:teacher-recents:${uid}` : 'zedexams:teacher-recents:anon'

  const read = useCallback(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return { ids: [], at: {} }
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return { ids: sanitizeIds(parsed, STUDIO_BY_ID), at: {} }
      const ids = sanitizeIds(parsed?.ids || [], STUDIO_BY_ID)
      // Null-prototype: the keys come straight out of this device's
      // localStorage, and a plain `{}` would let 'constructor' or '__proto__'
      // land somewhere other than as an own key. sanitizeIds now refuses both
      // as well; this is the second lock. (CodeQL #86.)
      const at = Object.create(null)
      for (const id of ids) {
        if (typeof parsed?.at?.[id] === 'number') at[id] = parsed.at[id]
      }
      return { ids, at }
    } catch {
      return { ids: [], at: {} }
    }
  }, [storageKey])

  const [state, setState] = useState(read)

  useEffect(() => {
    setState(read())
  }, [read])

  const record = useCallback((id) => {
    if (!id || !STUDIO_BY_ID[id]) return
    setState((prev) => {
      const ids = pushRecent(prev.ids, id, CAP)
      const at = { ...prev.at, [id]: Date.now() }
      // Drop timestamps for ids that fell off the end.
      const kept = new Set(ids)
      for (const key of Object.keys(at)) {
        if (!kept.has(key)) delete at[key]
      }
      const next = { ids, at }
      try {
        localStorage.setItem(storageKey, JSON.stringify(next))
      } catch { /* private mode / quota — non-fatal */ }
      return next
    })
  }, [storageKey])

  return { recents: state.ids, openedAt: state.at, record }
}
