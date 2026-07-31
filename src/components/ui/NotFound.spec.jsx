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
vi.mock('../seo/SeoHelmet', () => ({
  default: (props) => {
    seoProps.push(props)
    return null
  },
}))
vi.mock('../../utils/analytics', () => ({ capture: vi.fn() }))

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
})

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
