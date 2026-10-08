/**
 * /pricing — the under-18 gate.
 *
 * The rule depends on the platform. In the ANDROID BUILD an under-18 learner is
 * never shown a price or a pay button (Play's Families policy). On the WEB they
 * are shown the price, because a parent pays: the checkout asks for the
 * parent's mobile-money number. `useUnlockFlow` applies the same split to
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

describe('/pricing — under-18 learners see no price in the Android build', () => {
  beforeEach(() => { mockNative = true })

  it('shows a minor the guardian notice instead of the pricing page', () => {
    mockAuth = { currentUser: signedIn, isTeacher: false, userProfile: { role: 'learner', isMinor: true } }
    renderPage()
    expect(screen.getByRole('heading', { name: /Ask a parent or guardian/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Get Weekly/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Go Pro/i })).not.toBeInTheDocument()
  })

  it('renders NO kwacha figure anywhere for a minor', () => {
    mockAuth = { currentUser: signedIn, isTeacher: false, userProfile: { role: 'learner', isMinor: true } }
    renderPage()
    // Covers all four sources at once: learner rungs, teacher cards, the
    // "Or K590 / year" notes, and the FAQ's K25 answer.
    expect(kwachaOnPage()).toEqual([])
  })

  it('fails CLOSED — a learner whose age we do not know is treated as a minor', () => {
    // isMinor absent. resolveAgeBand only calls a learner an adult on an
    // explicit `isMinor === false`; not knowing must not show a price.
    mockAuth = { currentUser: signedIn, isTeacher: false, userProfile: { role: 'learner' } }
    renderPage()
    expect(screen.getByRole('heading', { name: /Ask a parent or guardian/i })).toBeInTheDocument()
    expect(kwachaOnPage()).toEqual([])
  })

  it('never offers a minor a route to a checkout', () => {
    // /my-subscription opens UpgradeModal with no age check of its own, so a
    // link to it here would relocate the leak rather than close it.
    mockAuth = { currentUser: signedIn, isTeacher: false, userProfile: { role: 'learner', isMinor: true } }
    renderPage()
    const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).not.toContain('/my-subscription')
    expect(hrefs).not.toContain('/pricing')
  })

  it('still describes what Premium gives, so the page is worth showing', () => {
    mockAuth = { currentUser: signedIn, isTeacher: false, userProfile: { role: 'learner', isMinor: true } }
    renderPage()
    expect(screen.getByText(/Unlimited quizzes/i)).toBeInTheDocument()
    expect(screen.getByText(/Exam mode/i)).toBeInTheDocument()
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
    expect(navigate).toHaveBeenCalledWith('/my-subscription')
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
