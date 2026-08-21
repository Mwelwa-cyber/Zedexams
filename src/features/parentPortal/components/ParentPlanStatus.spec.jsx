/**
 * What a guardian who is ALREADY paying sees.
 *
 * These are four rows of the parent-billing test matrix, and each one is a
 * failure somebody would have to be refunded for:
 *
 *   • a Lenco payer opening Android must see status, never a Buy button —
 *     the rails cannot see each other, so a second purchase succeeds and,
 *     on Play, renews itself every month;
 *   • a Play payer must never see an in-app cancel — a Play subscription
 *     can only be cancelled in Play, so a button that appears to cancel
 *     one is a rejection reason and a refund dispute;
 *   • a one-time pass must be offered neither, because there is nothing
 *     to manage and Play will not list it;
 *   • and inside the Android app, a web-bought plan must be described
 *     without naming the payment method that bought it — that is steering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const isNativePlatform = vi.fn()
vi.mock('../../../utils/runtime', () => ({
  isNativePlatform: (...a) => isNativePlatform(...a),
}))

import ParentPlanStatus from './ParentPlanStatus'

const IN_20_DAYS = Date.now() + 20 * 24 * 3600 * 1000

const child = (over = {}) => ({
  childUid: 'c1',
  firstName: 'Mutinta',
  premium: true,
  premiumExpiresAt: IN_20_DAYS,
  ...over,
})

function renderStatus(props) {
  return render(<MemoryRouter><ParentPlanStatus child={props} /></MemoryRouter>)
}

afterEach(() => vi.clearAllMocks())

describe('a Play subscriber', () => {
  const playChild = child({
    subscriptionProvider: 'google_play', subscriptionPlan: 'monthly',
  })

  beforeEach(() => { isNativePlatform.mockReturnValue(true) })

  it('is sent to Google Play to manage it', () => {
    renderStatus(playChild)
    expect(screen.getByRole('button', { name: /Manage in Google Play/i })).toBeInTheDocument()
  })

  it('is never offered an in-app cancel', () => {
    renderStatus(playChild)
    expect(screen.queryByRole('button', { name: /^cancel/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/cancel (your|this) plan/i)).not.toBeInTheDocument()
  })

  it('is told when it renews, because it does', () => {
    renderStatus(playChild)
    expect(screen.getByText(/Renews on/i)).toBeInTheDocument()
  })

  it('reaches Play from the web too, where there is no plugin to call', () => {
    isNativePlatform.mockReturnValue(false)
    renderStatus(playChild)
    const link = screen.getByRole('link', { name: /Manage in Google Play/i })
    expect(link).toHaveAttribute('href', 'https://play.google.com/store/account/subscriptions')
  })
})

describe('a Play one-time pass', () => {
  const passChild = child({
    subscriptionProvider: 'google_play', subscriptionPlan: 'term_pass',
  })

  beforeEach(() => { isNativePlatform.mockReturnValue(true) })

  it('offers no manage link — Play will not list it', () => {
    renderStatus(passChild)
    expect(screen.queryByText(/Manage in Google Play/i)).not.toBeInTheDocument()
  })

  it('says plainly that it does not renew', () => {
    renderStatus(passChild)
    expect(screen.getByText(/does not renew/i)).toBeInTheDocument()
    expect(screen.queryByText(/Renews on/i)).not.toBeInTheDocument()
  })
})

describe('a web (Lenco) payer', () => {
  const webChild = child({ subscriptionProvider: 'lenco', subscriptionPlan: 'monthly' })

  it('on the web, is pointed at their receipts', () => {
    isNativePlatform.mockReturnValue(false)
    renderStatus(webChild)
    expect(screen.getByRole('link', { name: /payments and receipts/i })).toBeInTheDocument()
  })

  it('inside the Android app, gets no steering copy about how they paid', () => {
    isNativePlatform.mockReturnValue(true)
    const { container } = renderStatus(webChild)
    expect(container.textContent).not.toMatch(/lenco|mobile money|airtel|mtn|website|zedexams\.com/i)
    expect(container.textContent).toMatch(/set up outside the app/i)
  })

  it('is never offered a Google Play manage link for a plan Play did not sell', () => {
    isNativePlatform.mockReturnValue(true)
    renderStatus(webChild)
    expect(screen.queryByText(/Manage in Google Play/i)).not.toBeInTheDocument()
  })
})

describe('a child covered by a sibling’s plan', () => {
  it('is told where the plan came from, and offered no manage control', () => {
    isNativePlatform.mockReturnValue(false)
    const { container } = renderStatus(child({ subscriptionProvider: 'guardian_cascade' }))
    expect(screen.getByText(/another child in the family/i)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Manage in Google Play/i)
  })
})

describe('every case', () => {
  it('names the child and never renders a price', () => {
    isNativePlatform.mockReturnValue(true)
    const { container } = renderStatus(child({ subscriptionProvider: 'google_play', subscriptionPlan: 'monthly' }))
    expect(screen.getByText(/Mutinta is on Premium/i)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/K\d|ZMW/)
  })
})
