// src/hooks/useLearnerSearch.js
//
// Data layer for global learner search. There's no server-side full-text index,
// so this fetches the four learner content sources ONCE per grade (in parallel,
// fault-tolerant) into a normalised item list, then re-ranks that list
// client-side on every keystroke — instant filtering with no extra reads.
//
// Sources reuse the exact services the hub pages already use:
//   quizzes → useFirestore().getQuizzes   notes → fetchLearnerNotes
//   papers  → loadPublishedPapers          games → listGames

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFirestore } from './useFirestore'
import { fetchLearnerNotes } from '../features/notes/lib/firestore'
import { loadPublishedPapers } from '../utils/pastPapers'
import { listGames } from '../utils/gamesService'
import { buildResultItems, rankResults, groupByType } from '../utils/learnerSearch'
import { reportClientError } from '../utils/clientErrorReporting'

const settledValue = (r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : [])

export function useLearnerSearch(query, grade) {
  const { getQuizzes } = useFirestore()
  // getQuizzes identity changes each render; hold it in a ref so the fetch
  // effect keys only on `grade`.
  const getQuizzesRef = useRef(getQuizzes)
  getQuizzesRef.current = getQuizzes

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    Promise.allSettled([
      getQuizzesRef.current({ grade }),
      fetchLearnerNotes({ grade }),
      loadPublishedPapers(),
      listGames({ grade }),
    ])
      .then(([q, n, p, g]) => {
        if (!alive) return
        setItems(buildResultItems({
          quizzes: settledValue(q),
          notes: settledValue(n),
          papers: settledValue(p),
          games: settledValue(g),
        }))
        // A source that rejected just contributes nothing — search still works
        // over the rest. Surface it for observability, not as a hard error.
        for (const r of [q, n, p, g]) {
          if (r.status === 'rejected') reportClientError(r.reason, 'learnerSearch.source')
        }
        setLoading(false)
      })
      .catch((err) => {
        if (!alive) return
        reportClientError(err, 'learnerSearch.load')
        setError(err)
        setLoading(false)
      })
    return () => { alive = false }
  }, [grade])

  const results = useMemo(() => rankResults(query, items), [query, items])
  const groups = useMemo(() => groupByType(results), [results])

  return { loading, error, results, groups, total: results.length }
}
