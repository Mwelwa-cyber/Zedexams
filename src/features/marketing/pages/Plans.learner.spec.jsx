/**
 * /pricing — the learner half.
 *
 * The page shipped as three teacher tiers and nothing else, so a learner (or
 * the parent paying for one) who followed a "see plans" link found Free / Pro /
 * Max and no way to buy the thing they came for. These pin the two properties
 * that make the new section correct rather than merely present: the prices are
 * the LADDER's (not literals typed onto a marketing page), and the CTA does
 * not become a second checkout entry point that could put a price in front of
 * a minor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => navigate,
}))

let mockAuth = { currentUser: null, isTeacher: false }
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))

let mockNative = false
vi.mock('../../../utils/runtime', () => ({ isNativePlatform: () => mockNative }))

vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))

import Plans from './Plans'
import { getPlan } from '../../../config/plans'

function renderPage() {
  return render(
    <MemoryRouter>
      <Plans />
    </MemoryRouter>
  )
}

/** The "For learners" section, located by its heading rather than a test id. */
function learnerSection() {
  return screen.getByRole('heading', { name: /Studying for an exam/i }).closest('section')
}

beforeEach(() => {
  navigate.mockClear()
  mockAuth = { currentUser: null, isTeacher: false, userProfile: null }
  mockNative = false
})

describe('/pricing — learner plans', () => {
  it('offers the weekly and monthly rungs', () => {
    renderPage()
    const section = learnerSection()
    expect(within(section).getByText('Weekly')).toBeInTheDocument()
    expect(within(section).getByText('Monthly')).toBeInTheDocument()
  })

  it('prints the prices the ladder declares, not hard-coded ones', () => {
    renderPage()
    const section = learnerSection()
    // K15/week and K50/month — read from src/config/plans.js so this test
    // fails if the page and the checkout catalogue ever disagree.
    expect(getPlan('week').price).toBe(15)
    expect(getPlan('month').price).toBe(50)
    expect(within(section).getByText(String(getPlan('week').price))).toBeInTheDocument()
    expect(within(section).getByText(String(getPlan('month').price))).toBeInTheDocument()
    expect(within(section).getByText('/week')).toBeInTheDocument()
    expect(within(section).getByText('/month')).toBeInTheDocument()
  })

  it('sends a signed-out visitor to register rather than to a checkout', async () => {
    renderPage()
    await userEvent.click(within(learnerSection()).getByRole('button', { name: /Get Weekly/i }))
    expect(navigate).toHaveBeenCalledWith('/register?intent=upgrade&tier=learner')
  })

  it('hands a signed-in ADULT learner to /my-subscription, never to an inline price modal', async () => {
    // `isMinor: false` is load-bearing, not decoration. The page now gates on
    // resolveAgeBand, which fails closed — a signed-in learner with no stated
    // age is treated as a minor and shown the guardian notice instead of any
    // price. Only an adult learner reaches this CTA at all.
    mockAuth = { currentUser: { uid: 'u1' }, isTeacher: false, userProfile: { role: 'learner', isMinor: false } }
    renderPage()
    await userEvent.click(within(learnerSection()).getByRole('button', { name: /Get Monthly/i }))
    expect(navigate).toHaveBeenCalledWith('/my-subscription')
    expect(screen.queryByText(/Unlock Premium Learning/i)).not.toBeInTheDocument()
  })

  it('keeps ZMW figures off the Android build (Play policy)', () => {
    // The learner rungs are real Play products (learner_premium_weekly /
    // _monthly), so Play's own sheet shows the authoritative localized price.
    mockNative = true
    renderPage()
    const section = learnerSection()
    expect(within(section).getAllByText(/Via Google Play/i).length).toBe(2)
    expect(within(section).queryByText(String(getPlan('week').price))).not.toBeInTheDocument()
  })

  it('still shows the teacher tiers', () => {
    renderPage()
    // "Pro"/"Max" appear on the plan card AND in the comparison table header,
    // so assert on the CTA buttons, which only the cards render.
    expect(screen.getByRole('button', { name: /^Go Pro$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Go Max$/ })).toBeInTheDocument()
  })

  it('scopes the comparison table to the teacher plans now that the page is shared', () => {
    renderPage()
    expect(screen.getByText(/The Free, Pro and Max teacher plans\./)).toBeInTheDocument()
  })
})
