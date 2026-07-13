import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  getTeachingProfile,
  listAssignments,
} from '../../../utils/teachingProfileService'
import {
  normalizeTeachingProfile,
  computeProfileCompletion,
  resolveDefaultAssignmentId,
} from '../../../utils/teachingProfileCore'
import { resolveTeachingContext } from '../../../utils/calendarResolver'

// Loads the teacher's profile + assignments once (best-effort, cancel-safe) and
// derives the calendar context + completion. A single load — no live listener —
// keeps the settings surface calm and avoids duplicate Firestore subscriptions
// (performance, section 33). Callers refresh via reload() after a mutation.
//
// Never throws: a failed read surfaces as `error` while leaving `profile`/
// `assignments` at safe empties, so one bad query can't blank the page.
export function useTeachingProfile() {
  const { currentUser, userProfile } = useAuth()
  const uid = currentUser?.uid || null

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState(null)
  const [assignments, setAssignments] = useState([])
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const load = useCallback(async () => {
    if (!uid) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [p, a] = await Promise.all([getTeachingProfile(uid), listAssignments(uid)])
      if (!mountedRef.current) return
      setProfile(p)
      setAssignments(a)
    } catch (err) {
      console.error('useTeachingProfile load failed:', err)
      if (mountedRef.current) setError('We could not load your Teaching Profile. Your data is still safe.')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [uid])

  useEffect(() => {
    load()
  }, [load])

  const normalizedProfile = normalizeTeachingProfile(profile || {})
  const hasProfile = !!profile
  const schoolName = typeof userProfile?.school === 'string' ? userProfile.school : ''

  // Calendar context is derived at read time (today) from the referenced
  // calendar; it is ALWAYS a structured object (never null) — callers branch on
  // context.status.
  const context = resolveTeachingContext({ calendarId: normalizedProfile.calendarId })

  const completion = computeProfileCompletion({
    profile: normalizedProfile,
    assignments,
    // Phase 3 does not yet detect a saved Class Timetable (Phase 7 wires this).
    timetableConnected: false,
    schoolName,
  })

  const effectiveDefaultId = resolveDefaultAssignmentId(normalizedProfile, assignments)

  return {
    uid,
    loading,
    error,
    hasProfile,
    profile: normalizedProfile,
    assignments,
    schoolName,
    context,
    completion,
    effectiveDefaultId,
    reload: load,
  }
}
