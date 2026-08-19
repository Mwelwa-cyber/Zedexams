/**
 * Nothing on /family/account navigates into the learner app.
 *
 * The bug: "Alerts you receive → Email and push alerts" went to
 * `/settings?section=notifications`. That route renders the learner shell
 * for anyone who is not a teacher or an admin, and `ZedExamsSettings`
 * coerces an unknown role to `learner` — so a guardian managing their own
 * email preferences got the learner top nav, a character-avatar picker
 * built for children, and the heading "Signed in as Learner."
 *
 * `ParentRouteGuard` now redirects a parent off those routes whatever put
 * them there, but a guard is a net, not a design: a row that has to be
 * caught by it is still a row pointing the wrong way. So this asserts the
 * destinations directly.
 *
 * `/child-safety` is the one deliberate exception and is asserted as such
 * — it is the PUBLISHED child-safety standards document (the URL named in
 * the Play Console declaration), it renders in the neutral legal layout,
 * and a second copy inside the family shell would fork a document a
 * regulator reads back to you.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0 }),
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'p1', email: 'paco@example.com' },
    userProfile: { displayName: 'Paco Mwansa', role: 'parent' },
    logout: vi.fn(),
  }),
}))
vi.mock('../hooks/useGuardianChildren', () => ({
  default: () => ({ loading: false, error: null, children: [], reload: () => {} }),
}))

import ParentAccount from './ParentAccount'

/** Routes the family app must never navigate into. */
const LEARNER_ROUTES = ['/settings', '/my-subscription', '/subscription', '/dashboard', '/profile']

function hrefs() {
  render(<MemoryRouter><ParentAccount /></MemoryRouter>)
  return [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
}

describe('/family/account', () => {
  it('never links into a learner route', () => {
    for (const href of hrefs()) {
      // tel: and mailto: are contact channels, not navigation.
      if (!href.startsWith('/')) continue
      for (const learner of LEARNER_ROUTES) {
        expect(
          href === learner || href.startsWith(`${learner}/`) || href.startsWith(`${learner}?`),
          `${href} points at the learner app`,
        ).toBe(false)
      }
    }
  })

  it('keeps every in-app destination inside /family, bar the published safety page', () => {
    for (const href of hrefs()) {
      if (!href.startsWith('/')) continue
      if (href === '/child-safety') continue
      expect(href.startsWith('/family'), `${href} leaves the family app`).toBe(true)
    }
  })

  it('carries the two rows the design called for and the app was missing', () => {
    render(<MemoryRouter><ParentAccount /></MemoryRouter>)
    // Family sharing existed but was reachable only from inside one
    // child's detail screen; guardian consent had no surface at all,
    // while /child-safety promised guardians could view and withdraw it.
    expect(screen.getByText('Family sharing')).toBeInTheDocument()
    expect(screen.getByText('Guardian consent')).toBeInTheDocument()
  })

  it('sends alerts and receipts to their family screens', () => {
    const found = hrefs()
    expect(found).toContain('/family/account/alerts')
    expect(found).toContain('/family/account/billing')
  })
})
