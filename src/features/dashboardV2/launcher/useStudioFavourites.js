import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { STUDIO_BY_ID } from '../../../components/teacher/dashboardV2/launcher/teacherStudios'
import { sanitizeIds, toggleFavourite } from '../../../components/teacher/dashboardV2/launcher/teacherLauncherCore'

/**
 * Per-teacher favourite studios.
 *
 * Source of truth is the teacher's own user doc field
 * `teacherFavouriteStudios` (an array of studio ids), so favourites
 * SYNCHRONISE across devices via the existing `users/{uid}` snapshot in
 * AuthContext. A localStorage mirror (`zedexams:teacher-favourites:{uid}`)
 * gives an instant, offline-tolerant first paint and absorbs writes while
 * the network round-trips. Only stable studio IDs are stored — never any
 * document content.
 *
 * Degrades safely: with no signed-in user (e.g. under test) it keeps
 * favourites in a local, in-memory + localStorage state and never writes to
 * Firestore.
 */
export default function useStudioFavourites() {
  const { currentUser, userProfile, updateProfileFields } = useAuth() || {}
  const uid = currentUser?.uid || null
  const storageKey = uid ? `zedexams:teacher-favourites:${uid}` : 'zedexams:teacher-favourites:anon'

  const readLocal = useCallback(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? sanitizeIds(JSON.parse(raw), STUDIO_BY_ID) : []
    } catch {
      return []
    }
  }, [storageKey])

  const [favourites, setFavourites] = useState(readLocal)

  // Reload the local mirror when the signed-in user changes.
  useEffect(() => {
    setFavourites(readLocal())
  }, [readLocal])

  // Adopt the server value whenever the profile snapshot carries one — this
  // is what brings a favourite set saved on another device onto this one.
  const serverFavs = userProfile?.teacherFavouriteStudios
  const serverKey = Array.isArray(serverFavs) ? serverFavs.join(',') : null
  useEffect(() => {
    if (!Array.isArray(serverFavs)) return
    const clean = sanitizeIds(serverFavs, STUDIO_BY_ID)
    setFavourites(clean)
    try {
      localStorage.setItem(storageKey, JSON.stringify(clean))
    } catch { /* private mode / quota — non-fatal */ }
    // serverKey collapses the array to a primitive so this only runs on a
    // real change, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey, storageKey])

  const persist = useRef()
  persist.current = (next) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch { /* non-fatal */ }
    if (uid && typeof updateProfileFields === 'function') {
      // Fire-and-forget: the snapshot listener reconciles the truth; a
      // failed write just leaves the optimistic local value in place.
      Promise.resolve(updateProfileFields({ teacherFavouriteStudios: next })).catch(() => {})
    }
  }

  const toggle = useCallback((id) => {
    setFavourites((prev) => {
      const next = toggleFavourite(prev, id)
      persist.current(next)
      return next
    })
  }, [])

  const isFavourite = useCallback((id) => favourites.includes(id), [favourites])
  const favouriteSet = useMemo(() => new Set(favourites), [favourites])

  return { favourites, favouriteSet, isFavourite, toggle }
}
