// src/features/learnerHome/hooks/useWeeklySummary.js
//
// The Profile page's "This week" tiles (prototype-v6): quizzes finished,
// games played, topics (notes) completed in the last 7 days. Three small
// owner-scoped reads, filtered client-side so no new composite index is
// needed:
//   - results:      userId == uid, ordered by completedAt (existing index —
//                   the same query getUserResults runs)
//   - scores:       userId == uid, ordered by playedAt (existing index —
//                   the same query the games hub's history uses)
//   - noteProgress: uid == uid (single-field equality, no index)
// Each read fails soft to 0 — a missing count must never break Profile.

import { useEffect, useState } from 'react'
import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { countThisWeek } from '../lib/learnerHomeCore'

async function safeDocs(q) {
  try {
    const snap = await getDocs(q)
    return snap.docs.map((d) => d.data())
  } catch {
    return []
  }
}

export default function useWeeklySummary(uid) {
  const [summary, setSummary] = useState({ quizzes: 0, games: 0, topics: 0, loading: true })

  useEffect(() => {
    if (!uid) { setSummary({ quizzes: 0, games: 0, topics: 0, loading: false }); return undefined }
    let alive = true
    ;(async () => {
      const [results, scores, notes] = await Promise.all([
        safeDocs(query(collection(db, 'results'), where('userId', '==', uid), orderBy('completedAt', 'desc'), limit(50))),
        safeDocs(query(collection(db, 'scores'), where('userId', '==', uid), orderBy('playedAt', 'desc'), limit(50))),
        safeDocs(query(collection(db, 'noteProgress'), where('uid', '==', uid), limit(100))),
      ])
      if (!alive) return
      setSummary({
        quizzes: countThisWeek(results, 'completedAt'),
        games: countThisWeek(scores, 'playedAt'),
        topics: countThisWeek(notes.filter((n) => n?.status === 'completed'), 'updatedAt'),
        loading: false,
      })
    })()
    return () => { alive = false }
  }, [uid])

  return summary
}
