/**
 * NotFound — the catch-all 404 page.
 *
 * The SEO half is the load-bearing part here. SeoHelmet falls back to the bare
 * origin when it isn't handed a `path`, so this page used to emit
 * <link rel="canonical" href="https://zedexams.com/"> alongside
 * <meta name="robots" content="noindex"> for EVERY unknown URL — a
 * contradictory pair (don't index this, but the indexing signal belongs to the
 * homepage) that Google's documentation warns against. It must self-canonical
 * so the noindex is unambiguous.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const seoProps = []
vi.mock('../../shared/components/SeoHelmet', () => ({
  default: (props) => {
    seoProps.push(props)
    return null
  },
}))
const capture = vi.fn()
vi.mock('../../utils/analytics', () => ({ capture: (...a) => capture(...a) }))

const reportClientError = vi.fn()
vi.mock('../../utils/clientErrorReporting', () => ({
  reportClientError: (...a) => reportClientError(...a),
}))

let mockAuth = { userProfile: null }
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))

import NotFound from './NotFound'

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotFound />
    </MemoryRouter>
  )
}

beforeEach(() => {
  seoProps.length = 0
  mockAuth = { userProfile: null }
  capture.mockClear()
  reportClientError.mockClear()
})

/** The single route_not_found payload this render emitted. */
function captured() {
  const call = capture.mock.calls.find(([event]) => event === 'route_not_found')
  return call?.[1]
}

describe('NotFound', () => {
  it('renders the 404 message', () => {
    renderAt('/definitely-not-a-real-path-xyz123')
    expect(screen.getByText(/404 — Page not found/)).toBeInTheDocument()
  })

  it('marks the page noindex', () => {
    renderAt('/definitely-not-a-real-path-xyz123')
    expect(seoProps[0].noIndex).toBe(true)
  })

  it('self-canonicals instead of pointing every unknown URL at the homepage', () => {
    renderAt('/definitely-not-a-real-path-xyz123')
    // The regression: an absent `path` makes SeoHelmet emit canonical="/".
    expect(seoProps[0].path).toBe('/definitely-not-a-real-path-xyz123')
  })

  it('carries the canonical through for any unknown path', () => {
    renderAt('/teacher/some/deep/typo')
    expect(seoProps[0].path).toBe('/teacher/some/deep/typo')
  })

  it('sends a signed-out visitor to sign in', () => {
    renderAt('/nope')
    expect(screen.getByRole('link', { name: /Go to Sign In/ })).toBeInTheDocument()
  })

  it('sends a teacher back to their own landing page', () => {
    mockAuth = { userProfile: { role: 'teacher' } }
    renderAt('/nope')
    expect(screen.getByRole('link', { name: /Back to Teacher Home/ })).toBeInTheDocument()
  })
})

/**
 * The escalation wiring. The RULE itself is pinned under plain node in
 * scripts/test-route-not-found-severity.mjs; what these cover is that the page
 * actually reaches for it and forwards the verdict — a correct rule nobody
 * calls reports exactly as much as no rule at all, which is how /subscription
 * sat at 4 hits for 30 days without anyone seeing it.
 */
describe('NotFound — learner 404s are escalated', () => {
  it('tags a learner 404 high severity', () => {
    mockAuth = { userProfile: { role: 'learner' } }
    renderAt('/subscription')
    expect(captured()).toMatchObject({
      path: '/subscription',
      role: 'learner',
      severity: 'high',
      is_learner: true,
    })
  })

  it('escalates the legacy "student" role spelling too', () => {
    mockAuth = { userProfile: { role: 'student' } }
    renderAt('/subscription')
    expect(captured().severity).toBe('high')
  })

  it('also files a learner 404 to the client-error sink', () => {
    mockAuth = { userProfile: { role: 'learner' } }
    renderAt('/subscription')
    expect(reportClientError).toHaveBeenCalledTimes(1)
    const [err, context, opts] = reportClientError.mock.calls[0]
    expect(err.message).toContain('/subscription')
    expect(context).toBe('route_not_found_learner')
    // force: a broken learner link must survive the per-session budget.
    expect(opts).toMatchObject({ force: true })
  })

  it('leaves a teacher 404 at normal severity and files no error report', () => {
    mockAuth = { userProfile: { role: 'teacher' } }
    renderAt('/teacher/typo')
    expect(captured().severity).toBe('normal')
    expect(reportClientError).not.toHaveBeenCalled()
  })

  it('does not escalate a signed-out visitor', () => {
    renderAt('/nope')
    expect(captured().severity).toBe('normal')
    expect(reportClientError).not.toHaveBeenCalled()
  })

  it('still records the funnel event unchanged for every role', () => {
    // route_not_found keeps its existing shape so the 30-day counts that
    // surfaced this bug keep working — severity is an addition, not a move.
    mockAuth = { userProfile: { role: 'learner' } }
    renderAt('/subscription?x=1')
    expect(captured()).toMatchObject({ path: '/subscription?x=1', role: 'learner' })
  })
})
