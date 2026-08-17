import { useCallback, useEffect, useState } from 'react'
import { listGuardianChildren } from '../services/parentApp'
import { reportClientError } from '../../../utils/clientErrorReporting'

/**
 * useGuardianChildren — the caller's linked children, each with the
 * caller's role over them.
 *
 * One fetch, shared by Home and the Children tab. `reload` is exposed so
 * a screen that changes the set (linking a child, accepting an invite)
 * can refresh without a remount.
 *
 * `error` is a message rather than a boolean: every screen that renders
 * this offers a retry, and a retry with no explanation of what failed is
 * a button a parent presses twice and then leaves.
 */
export default function useGuardianChildren() {
  const [state, setState] = useState({ loading: true, error: null, children: [] })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const children = await listGuardianChildren()
      setState({ loading: false, error: null, children })
    } catch (err) {
      reportClientError(err, 'parentApp.listGuardianChildren')
      setState({
        loading: false,
        error: err?.message || 'We could not load your children just now.',
        children: [],
      })
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { ...state, reload: load }
}
