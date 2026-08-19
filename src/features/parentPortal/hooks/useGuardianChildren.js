import { createContext, createElement, useCallback, useContext, useEffect, useState } from 'react'
import { listGuardianChildren } from '../services/parentApp'
import { reportClientError } from '../../../utils/clientErrorReporting'

/**
 * useGuardianChildren — the caller's linked children, each with the
 * caller's role over them.
 *
 * `error` is a message rather than a boolean: every screen that renders
 * this offers a retry, and a retry with no explanation of what failed is
 * a button a parent presses twice and then leaves.
 *
 * ── One fetch per visit to the family app ───────────────────────────
 *
 * `GuardianChildrenProvider` is mounted by ParentShell, so the whole
 * section shares ONE `listGuardianChildren` call. That mattered the
 * moment the plan banner moved into the shell: the banner needs to know
 * whether a child is already paid for, and a hook with its own state
 * would have made every /family page cost two calls — the page's and the
 * chrome's — for the same answer.
 *
 * The hook still fetches for itself when no provider is above it, so a
 * screen rendered outside the shell (or a spec that mounts one page on
 * its own) keeps working rather than reading an empty list — which is
 * the failure mode that looks like "this parent has no children"
 * instead of like a missing provider. `enabled` is what keeps that
 * fallback from ALSO firing under the provider: hooks cannot be called
 * conditionally, so the call is always made and the request is what gets
 * skipped.
 */

const GuardianChildrenContext = createContext(null)

const IDLE = { loading: true, error: null, children: [] }

function useGuardianChildrenFetch(enabled) {
  const [state, setState] = useState(IDLE)

  const load = useCallback(async () => {
    if (!enabled) return
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
  }, [enabled])

  useEffect(() => { load() }, [load])

  return { ...state, reload: load }
}

/**
 * Shares one children fetch with everything below it. `reload` is
 * exposed through the context so the screen that changes the set
 * (linking a child, accepting an invite) refreshes the chrome as well as
 * itself — before this, linking a child left the shell's banner showing
 * the state from before the link.
 */
export function GuardianChildrenProvider({ children }) {
  const value = useGuardianChildrenFetch(true)
  return createElement(GuardianChildrenContext.Provider, { value }, children)
}

export default function useGuardianChildren() {
  const shared = useContext(GuardianChildrenContext)
  const own = useGuardianChildrenFetch(!shared)
  return shared || own
}
