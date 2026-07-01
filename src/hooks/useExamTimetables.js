/**
 * useExamTimetables — loads the exam timetables for one grade.
 *
 * Reads every examTimetables doc for the grade in a single single-field
 * query (no composite index needed), validates each doc through
 * validateTimetable, and resolves:
 *   - active:   the doc flagged active === true, else the newest year
 *   - archived: every other year, newest first ("Past Exam Timetables")
 *
 * If the query fails or returns no valid doc (rules not deployed yet, seed
 * script not run, malformed data), the hook silently falls back to the
 * bundled FALLBACK_TIMETABLES so /timetable always renders. Offline reads
 * come free from Firestore's persistentLocalCache (firebase/config.js).
 */

import { useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { FALLBACK_TIMETABLES } from '../config/examTimetable2026'
import { validateTimetable } from '../utils/examTimetableLogic'

export default function useExamTimetables(grade) {
  const gradeNum = parseInt(grade, 10)
  const [state, setState] = useState({
    active: null,
    archived: [],
    loading: true,
    error: null,
    usedFallback: false,
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      let timetables = []
      let error = null
      if (Number.isFinite(gradeNum)) {
        try {
          const snap = await getDocs(
            query(collection(db, 'examTimetables'), where('grade', '==', gradeNum)),
          )
          timetables = snap.docs
            .map((d) => validateTimetable({ ...d.data(), id: d.id }))
            .filter(Boolean)
        } catch (err) {
          console.error('useExamTimetables load:', err)
          error = err
        }
      }

      let usedFallback = false
      if (timetables.length === 0) {
        timetables = FALLBACK_TIMETABLES.map(validateTimetable).filter(
          (t) => t && t.grade === gradeNum,
        )
        usedFallback = true
      }

      timetables.sort((a, b) => b.year - a.year)
      const active = timetables.find((t) => t.active) || timetables[0] || null
      const archived = timetables.filter((t) => t !== active)

      if (!cancelled) setState({ active, archived, loading: false, error, usedFallback })
    }

    load()
    return () => {
      cancelled = true
    }
  }, [gradeNum])

  return state
}
