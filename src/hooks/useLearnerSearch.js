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
import { fetchLearnerNotes } from '../features/notes'
import { loadPublishedPapers } from '../utils/pastPapers'
import { listGames } from '../utils/gamesService'
import { buildResultItems, rankResults, groupByType } from '../utils/learnerSearch'
import { reportClientError } from '../utils/clientErrorReporting'
import { buildRequestKey } from '../utils/requestControl.js'
import { deduplicatedRequest } from '../utils/requestDeduplication.js'
import { useAbortableRequest } from './useAbortableRequest.js'

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
  const { run, cancel } = useAbortableRequest({ timeoutMs: 15_000 })

  useEffect(() => {
    setLoading(true)
    setError(null)
    // This is a public content catalogue (quizzes/notes/papers/games for a
    // grade), not per-user data, so sharing one in-flight fetch across every
    // learner browsing the same grade at once is safe and desirable.
    const key = buildRequestKey('learner-search-catalog', grade)
    run(({ signal }) => deduplicatedRequest(key, () => Promise.allSettled([
      getQuizzesRef.current({ grade }),
      fetchLearnerNotes({ grade }),
      loadPublishedPapers(),
      listGames({ grade }),
    ]), { signal, timeoutMs: 15_000 })).then((result) => {
      if (result.status === 'success') {
        const [q, n, p, g] = result.data
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
      } else if (result.status === 'error') {
        reportClientError(result.error, 'learnerSearch.load')
        setError(result.error)
        setLoading(false)
      }
      // 'stale' / 'aborted' — the grade changed (or we unmounted) before this
      // landed; a newer request (or nothing) owns loading/error/items now.
    }).catch(() => {}) // run() resolves a status object and never rejects; guards regardless
    return cancel
  }, [grade, run, cancel])

  const results = useMemo(() => rankResults(query, items), [query, items])
  const groups = useMemo(() => groupByType(results), [results])

  return { loading, error, results, groups, total: results.length }
}
