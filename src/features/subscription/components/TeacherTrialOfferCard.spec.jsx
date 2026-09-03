import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Never touches Firebase/network — the callable is mocked at its call site
// (activateExistingTeacherTrialOffer), and useAuth is a plain mock.
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../services/existingTeacherTrialOfferService', () => ({
  activateExistingTeacherTrialOffer: vi.fn(),
}))

const navigateMock = vi.fn()

import { useAuth } from '../../../contexts/AuthContext'
import { activateExistingTeacherTrialOffer } from '../services/existingTeacherTrialOfferService'
import TeacherTrialOfferCard from './TeacherTrialOfferCard.jsx'

function profile(overrides = {}) {
  return { role: 'teacher', displayName: 'Bwalya Chanda', ...overrides }
}

beforeEach(() => {
  navigateMock.mockClear()
  activateExistingTeacherTrialOffer.mockReset()
  try { sessionStorage.clear() } catch { /* ignore */ }
})

describe('TeacherTrialOfferCard — visibility', () => {
  it('an eligible existing teacher sees the offer', () => {
    useAuth.mockReturnValue({ userProfile: profile({ teacherTrialOffer: { status: 'available' } }) })
    render(<TeacherTrialOfferCard />)
    expect(screen.getByText('Enjoy 7 days free')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start Free Trial/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Maybe Later' })).toBeInTheDocument()
    expect(screen.getByText(/Your 7 days begin when you activate the trial\./)).toBeInTheDocument()
    // No countdown before activation.
    expect(screen.queryByText(/day.*left/i)).not.toBeInTheDocument()
  })

  it('an ineligible teacher (no offer on record) sees nothing', () => {
    useAuth.mockReturnValue({ userProfile: profile({ teacherTrialOffer: { status: 'ineligible' } }) })
    const { container } = render(<TeacherTrialOfferCard />)
    expect(container).toBeEmptyDOMElement()
  })

  it('a teacher with no teacherTrialOffer at all sees nothing', () => {
    useAuth.mockReturnValue({ userProfile: profile() })
    const { container } = render(<TeacherTrialOfferCard />)
    expect(container).toBeEmptyDOMElement()
  })

  it('a paid Pro subscriber never sees the offer, even with a stale available flag', () => {
    useAuth.mockReturnValue({
      userProfile: profile({
        teacherTrialOffer: { status: 'available' },
        teacherPlan: 'pro',
        teacherPlanExpiresAt: { toDate: () => new Date(Date.now() + 30 * 86400000) },
      }),
    })
    const { container } = render(<TeacherTrialOfferCard />)
    expect(container).toBeEmptyDOMElement()
  })

  it('learners and admins never see anything, whatever their profile carries', () => {
    useAuth.mockReturnValue({ userProfile: { role: 'learner', teacherTrialOffer: { status: 'available' } } })
    expect(render(<TeacherTrialOfferCard />).container).toBeEmptyDOMElement()
    useAuth.mockReturnValue({ userProfile: { role: 'admin', teacherTrialOffer: { status: 'available' } } })
    expect(render(<TeacherTrialOfferCard />).container).toBeEmptyDOMElement()
  })

  it('a teacher already on an active trial sees the active card, not the offer', () => {
    useAuth.mockReturnValue({
      userProfile: profile({
        teacherPlan: 'trial',
        teacherTrialEndsAt: { toDate: () => new Date(Date.now() + 3 * 86400000) },
      }),
    })
    render(<TeacherTrialOfferCard />)
    expect(screen.getByText('Teacher Pro Trial')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Start Free Trial/ })).not.toBeInTheDocument()
  })
})

describe('TeacherTrialOfferCard — Maybe Later', () => {
  it('dismisses the card without calling the activation callable', async () => {
    const user = userEvent.setup()
    useAuth.mockReturnValue({ userProfile: profile({ teacherTrialOffer: { status: 'available' } }) })
    const { rerender } = render(<TeacherTrialOfferCard />)
    await user.click(screen.getByRole('button', { name: 'Maybe Later' }))
    expect(activateExistingTeacherTrialOffer).not.toHaveBeenCalled()
    rerender(<TeacherTrialOfferCard />)
    expect(screen.queryByText('Enjoy 7 days free')).not.toBeInTheDocument()
  })

  it('is not dismissible on My Subscription (dismissible=false) — no Maybe Later button at all', () => {
    useAuth.mockReturnValue({ userProfile: profile({ teacherTrialOffer: { status: 'available' } }) })
    render(<TeacherTrialOfferCard dismissible={false} />)
    expect(screen.queryByRole('button', { name: 'Maybe Later' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start Free Trial/ })).toBeInTheDocument()
  })
})

describe('TeacherTrialOfferCard — activation', () => {
  it('disables the button, shows a loading state, then a success confirmation', async () => {
    const user = userEvent.setup()
    useAuth.mockReturnValue({ userProfile: profile({ teacherTrialOffer: { status: 'available' } }) })
    let resolveCall
    activateExistingTeacherTrialOffer.mockReturnValue(new Promise((resolve) => { resolveCall = resolve }))

    render(<TeacherTrialOfferCard />)
    const btn = screen.getByRole('button', { name: /Start Free Trial/ })
    await user.click(btn)

    expect(screen.getByRole('button', { name: /Starting trial/ })).toBeDisabled()
    expect(activateExistingTeacherTrialOffer).toHaveBeenCalledTimes(1)

    resolveCall({
      ok: true, alreadyActive: false, teacherPlan: 'trial',
      teacherTrialEndsAtMs: Date.now() + 7 * 86400000,
    })

    await waitFor(() => expect(screen.getByText('Your Teacher Pro trial is active!')).toBeInTheDocument())
    expect(screen.getByText('Teacher Pro Trial')).toBeInTheDocument()
    expect(screen.getByText('7 days left')).toBeInTheDocument()
  })

  it('a failed activation shows an error and never displays a false active state', async () => {
    const user = userEvent.setup()
    useAuth.mockReturnValue({ userProfile: profile({ teacherTrialOffer: { status: 'available' } }) })
    activateExistingTeacherTrialOffer.mockRejectedValue(
      Object.assign(new Error("You've already used a Teacher Pro trial on this account."), { code: 'failed-precondition' }),
    )

    render(<TeacherTrialOfferCard />)
    await user.click(screen.getByRole('button', { name: /Start Free Trial/ }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/already used a Teacher Pro trial/))
    expect(screen.queryByText('Teacher Pro Trial')).not.toBeInTheDocument()
    // The button is re-enabled for a retry, never stuck disabled.
    expect(screen.getByRole('button', { name: /Start Free Trial/ })).toBeEnabled()
  })

  it('repeated/concurrent taps only call the backend once (button disables synchronously)', async () => {
    const user = userEvent.setup()
    useAuth.mockReturnValue({ userProfile: profile({ teacherTrialOffer: { status: 'available' } }) })
    activateExistingTeacherTrialOffer.mockReturnValue(new Promise(() => {})) // never resolves within the test

    render(<TeacherTrialOfferCard />)
    const btn = screen.getByRole('button', { name: /Start Free Trial/ })
    await user.click(btn)
    // Button is now disabled — a second click cannot fire a second call.
    expect(btn).toBeDisabled()
    expect(activateExistingTeacherTrialOffer).toHaveBeenCalledTimes(1)
  })
})

describe('TeacherTrialOfferCard — active-trial display', () => {
  it('shows the correct days remaining and expiry date from the exact server timestamp', () => {
    const expiresAt = new Date(Date.now() + 4.4 * 86400000) // rounds up to 5 days
    useAuth.mockReturnValue({
      userProfile: profile({ teacherPlan: 'trial', teacherTrialEndsAt: { toDate: () => expiresAt } }),
    })
    render(<TeacherTrialOfferCard />)
    expect(screen.getByText('5 days left')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Explore Pro tools/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Upgrade to Teacher Pro/ })).toBeInTheDocument()
  })

  it('a lapsed trial (server has already moved teacherPlan on) shows nothing here', () => {
    useAuth.mockReturnValue({
      userProfile: profile({
        teacherPlan: 'trial',
        teacherTrialEndsAt: { toDate: () => new Date(Date.now() - 86400000) },
      }),
    })
    const { container } = render(<TeacherTrialOfferCard />)
    expect(container).toBeEmptyDOMElement()
  })

  it('hideActive suppresses the active body (My Subscription already shows it elsewhere)', () => {
    useAuth.mockReturnValue({
      userProfile: profile({ teacherPlan: 'trial', teacherTrialEndsAt: { toDate: () => new Date(Date.now() + 86400000) } }),
    })
    const { container } = render(<TeacherTrialOfferCard hideActive />)
    expect(container).toBeEmptyDOMElement()
  })
})
