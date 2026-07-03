/**
 * useOfflineContent — a cache-first data hook. Returns cached content instantly
 * (so a previously-viewed quiz/note opens with no spinner, Objective 1) and
 * transparently refreshes in the background when the server version changes
 * (Objective 2). The component only re-renders when fresh data actually lands.
 *
 *   const { data, loading, fromCache, error } = useOfflineContent({
 *     type: 'quiz', id: quizId, version: quiz?.updatedAt,
 *     fetcher: () => loadQuizFromFirestore(quizId),
 *   })
 */
import { useEffect, useRef, useState } from 'react'
import { getOrFetch } from './contentCache.js'

export function useOfflineContent({ type, id, version = null, fetcher, enabled = true }) {
  const [state, setState] = useState({ data: null, loading: true, fromCache: false, error: null })
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    if (!enabled || !type || !id) {
      setState({ data: null, loading: false, fromCache: false, error: null })
      return
    }
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))

    getOrFetch({
      type,
      id,
      version,
      fetcher: () => fetcherRef.current(),
      onFresh: (fresh) => { if (alive) setState({ data: fresh, loading: false, fromCache: false, error: null }) },
    })
      .then((data) => { if (alive) setState((s) => ({ data, loading: false, fromCache: s.loading ? true : s.fromCache, error: null })) })
      .catch((error) => { if (alive) setState((s) => ({ ...s, loading: false, error })) })

    return () => { alive = false }
    // version drives a re-check; fetcher is held in a ref so its identity
    // changing every render doesn't thrash the effect.
  }, [type, id, version, enabled])

  return state
}
