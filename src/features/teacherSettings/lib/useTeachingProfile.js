import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  getTeachingProfile,
  listAssignments,
} from '../../../utils/teachingProfileService'
import { hasGenerationOfTool } from '../../../utils/teacherLibraryService'
import {
  normalizeTeachingProfile,
  computeProfileCompletion,
  resolveDefaultAssignmentId,
  academicYearMismatch,
} from '../../../utils/teachingProfileCore'
import { resolveTeachingContext } from '../../../utils/calendarResolver'

// Loads the teacher's profile + assignments once (best-effort, cancel-safe) and
// derives the calendar context + completion. A single load — no live listener —
// keeps the settings surface calm and avoids duplicate Firestore subscriptions
// (performance, section 33). Callers refresh via reload() after a mutation.
//
// Never throws: a failed read surfaces as `error` while leaving `profile`/
// `assignments` at safe empties, so one bad query can't blank the page.
//
// `detectConnections` (opt-in, panel-only): probe whether the teacher has a
// saved Scheme of Work / Class Timetable so the completion checklist's
// recommended items can show "Done". Two limit(1) existence queries — at most
// two document reads, once per mount — and only the surface that RENDERS the
// checklist pays for them. Other consumers (dashboard, top bar, studios) pass
// nothing and read nothing extra.
export function useTeachingProfile({ detectConnections = false } = {}) {
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

  // Optional connection probes (see JSDoc above). Best-effort and cancel-safe:
  // a failed probe leaves the item at its safe default ("Optional", not done).
  const [connections, setConnections] = useState({ timetable: false, scheme: false })
  useEffect(() => {
    if (!detectConnections || !uid) return undefined
    let cancelled = false
    Promise.all([
      hasGenerationOfTool(uid, 'class_timetable'),
      hasGenerationOfTool(uid, 'scheme_of_work'),
    ]).then(([timetable, scheme]) => {
      if (!cancelled) setConnections({ timetable, scheme })
    }).catch(() => { /* keep safe defaults */ })
    return () => { cancelled = true }
  }, [detectConnections, uid])

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
    teachingPeriodResolved: context.status === 'ok',
    // Detected only when the caller opted in (detectConnections); otherwise
    // the safe defaults keep these recommended items at "Optional".
    timetableConnected: connections.timetable,
    schemeConnected: connections.scheme,
  })

  // Non-blocking: stored academic year vs the year the calendar resolved today.
  const yearMismatch = academicYearMismatch(
    normalizedProfile,
    context.status === 'ok' ? context.academicYear : null,
  )

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
    yearMismatch,
    effectiveDefaultId,
    reload: load,
  }
}
