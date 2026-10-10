/**
 * /pricing — the under-18 gate.
 *
 * The same page for every learner. In the ANDROID BUILD it prints no Kwacha at
 * all (Google Play's sheet owns the price) and the CTA goes to /my-subscription;
 * on the WEB it shows the price, because a parent pays: the checkout asks for
 * the parent's mobile-money number. There is no guardian-notice page any more. `useUnlockFlow` applies the same split to
 * in-app locks; /pricing is a marketing page that holds four separate sets of
 * figures (learner rungs, teacher cards, the "Or K590 / year" notes, the FAQ's
 * K25 answer), so the Android half is asserted on the whole rendered page.
 *
 * These assert on the RENDERED TREE rather than on which branch was taken,
 * because "no price reached the child" is the actual guarantee and a branch
 * test would still pass if a fifth figure were added somewhere new.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => navigate,
}))

let mockAuth = { currentUser: null, isTeacher: false, userProfile: null }
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))
let mockNative = false
vi.mock('../../../utils/runtime', () => ({ isNativePlatform: () => mockNative }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))

import Plans from './Plans'

function renderPage() {
  return render(
    <MemoryRouter>
      <Plans />
    </MemoryRouter>
  )
}

/** Any Kwacha figure anywhere in the rendered page. */
function kwachaOnPage() {
  return (document.body.textContent || '').match(/K\s?\d[\d,]*/g) || []
}

const signedIn = { uid: 'u1' }

beforeEach(() => {
  navigate.mockClear()
  mockNative = false
  mockAuth = { currentUser: null, isTeacher: false, userProfile: null }
})

describe('/pricing — inside the Android build every learner sees the same page, with no Kwacha', () => {
  beforeEach(() => { mockNative = true })

  it('no longer swaps a minor onto a guardian notice', () => {
    mockAuth = { currentUser: signedIn, isTeacher: false, userProfile: { role: 'learner', isMinor: true } }
    renderPage()
    expect(screen.queryByRole('heading', { name: /Ask a parent or guardian/i })).toBeNull()
    // The learner CTA is the one every other learner gets.
    expect(screen.getByRole('button', { name: /Get Weekly/i })).toBeInTheDocument()
  })

  it('renders NO kwacha figure anywhere — Google Play owns the price in the Android build', () => {
    // Covers every source on the page at once: learner rungs, teacher cards,
    // the "Or K590 / year" notes, and the FAQ's K25 answer.
    for (const profile of [{ role: 'learner', isMinor: true }, { role: 'learner' }, { role: 'learner', isMinor: false }]) {
      mockAuth = { currentUser: signedIn, isTeacher: false, userProfile: profile }
      const { unmount } = renderPage()
      expect(kwachaOnPage()).toEqual([])
      unmount()
    }
  })

  it('sends a minor\'s learner CTA to /my-subscription, where Google Play\'s sheet opens', () => {
    mockAuth = { currentUser: signedIn, isTeacher: false, userProfile: { role: 'learner', isMinor: true } }
    renderPage()
    screen.getByRole('button', { name: /Get Weekly/i }).click()
    expect(navigate).toHaveBeenCalledWith('/my-subscription', { state: { planId: 'weekly' } })
  })

  it('still describes what Premium gives', () => {
    mockAuth = { currentUser: signedIn, isTeacher: false, userProfile: { role: 'learner', isMinor: true } }
    renderPage()
    expect(screen.getAllByText(/Unlimited quizzes/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Exam mode/i).length).toBeGreaterThan(0)
  })
})

describe('/pricing — on the web an under-18 learner sees the plans, because a parent pays', () => {
  it('shows a minor the learner rungs and their prices, not the guardian notice', () => {
    mockAuth = { currentUser: signedIn, isTeacher: false, userProfile: { role: 'learner', isMinor: true } }
    renderPage()
    expect(screen.queryByRole('heading', { name: /Ask a parent or guardian/i })).toBeNull()
    expect(screen.getByRole('button', { name: /Get Weekly/i })).toBeInTheDocument()
    expect(kwachaOnPage().length).toBeGreaterThan(0)
  })

  it('treats a learner whose age we do not know the same way — they are routed to a parent-paid checkout', () => {
    mockAuth = { currentUser: signedIn, isTeacher: false, userProfile: { role: 'learner' } }
    renderPage()
    expect(screen.getByRole('button', { name: /Get Weekly/i })).toBeInTheDocument()
  })

  it('sends a minor\'s learner CTA to the same checkout page an adult uses', () => {
    mockAuth = { currentUser: signedIn, isTeacher: false, userProfile: { role: 'learner', isMinor: true } }
    renderPage()
    screen.getByRole('button', { name: /Get Weekly/i }).click()
    expect(navigate).toHaveBeenCalledWith('/my-subscription', { state: { planId: 'weekly' } })
  })
})

describe('/pricing — everyone else still sees prices', () => {
  it('an adult learner sees the learner rungs', () => {
    mockAuth = { currentUser: signedIn, isTeacher: false, userProfile: { role: 'learner', isMinor: false } }
    renderPage()
    expect(screen.getByRole('button', { name: /Get Weekly/i })).toBeInTheDocument()
    expect(kwachaOnPage().length).toBeGreaterThan(0)
  })

  it('a teacher is unaffected — resolveAgeBand calls non-learner roles adult', () => {
    mockAuth = { currentUser: signedIn, isTeacher: true, userProfile: { role: 'teacher' } }
    renderPage()
    expect(screen.getByRole('button', { name: /Go Pro/i })).toBeInTheDocument()
  })

  it('a parent is unaffected, which is the account that actually pays', () => {
    mockAuth = { currentUser: signedIn, isTeacher: false, userProfile: { role: 'parent' } }
    renderPage()
    expect(screen.getByRole('button', { name: /Get Weekly/i })).toBeInTheDocument()
  })

  it('a SIGNED-OUT visitor sees the normal page', () => {
    // The gate is deliberately not "resolveAgeBand alone": that resolver fails
    // closed and reads a null profile as under-18, which would blank the
    // public pricing page for every parent and teacher arriving from search —
    // most of its audience. No account means no child to protect here.
    mockAuth = { currentUser: null, isTeacher: false, userProfile: null }
    renderPage()
    expect(screen.getByRole('button', { name: /Get Weekly/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Go Pro/i })).toBeInTheDocument()
    expect(kwachaOnPage().length).toBeGreaterThan(0)
  })
})

describe('/pricing — a signed-in learner is never offered the teacher tiers', () => {
  it('hides Go Pro / Go Max from a learner, in the Android build and on the web', () => {
    for (const native of [true, false]) {
      mockNative = native
      mockAuth = { currentUser: signedIn, isTeacher: false, userProfile: { role: 'learner', isMinor: true } }
      const { unmount } = renderPage()
      expect(screen.queryByRole('button', { name: /Go Pro/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /Go Max/i })).toBeNull()
      unmount()
    }
  })

  it('still shows them to a teacher and to a signed-out visitor', () => {
    mockAuth = { currentUser: signedIn, isTeacher: true, userProfile: { role: 'teacher' } }
    const { unmount } = renderPage()
    expect(screen.getByRole('button', { name: /Go Pro/i })).toBeInTheDocument()
    unmount()
    mockAuth = { currentUser: null, isTeacher: false, userProfile: null }
    renderPage()
    expect(screen.getByRole('button', { name: /Go Pro/i })).toBeInTheDocument()
  })

  it('carries the chosen rung: Monthly goes to the checkout as monthly, not the default', () => {
    mockAuth = { currentUser: signedIn, isTeacher: false, userProfile: { role: 'learner', isMinor: false } }
    renderPage()
    screen.getByRole('button', { name: /Get Monthly/i }).click()
    expect(navigate).toHaveBeenCalledWith('/my-subscription', { state: { planId: 'monthly' } })
  })
})
