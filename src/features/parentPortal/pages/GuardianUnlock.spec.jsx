/**
 * Behaviour tests for GuardianUnlock — /guardian-unlock?t=…
 *
 * The property that matters most: on the web the page needs NO account. A
 * guardian who opens the link goes straight to a checkout bound to the
 * link's own token, signed in or not — `/register` no longer offers a parent
 * role, so any sign-in step would demand an account that cannot be made.
 *
 * The other property is the Android one: inside the Capacitor shell the page
 * must never render the mobile-money checkout or name any payment method,
 * because Play Billing is the only one allowed there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../../shared/styles/learnerTheme.css', () => ({}))
vi.mock('../styles/parentApp.css', () => ({}))
vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => true }))
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0 }),
}))

const isNativePlatform = vi.fn(() => false)
vi.mock('../../../utils/runtime', () => ({ isNativePlatform: () => isNativePlatform() }))

const useAuthMock = vi.fn()
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }))

const LINK_API = { marker: 'link-api' }
const makeGuardianLinkApi = vi.fn(() => LINK_API)
vi.mock('../services/guardianLinkPay', () => ({
  makeGuardianLinkApi: (...a) => makeGuardianLinkApi(...a),
}))

const resolveGuardianPayLink = vi.fn()
vi.mock('../services/parentApp', () => ({
  resolveGuardianPayLink: (...a) => resolveGuardianPayLink(...a),
}))

// GuardianCheckout is a full payment flow with its own suite
// (GuardianCheckout.spec.jsx) — stubbed here so this file stays about
// GuardianUnlock's own branching, not the checkout's internals.
const onPaidRef = { current: null }
vi.mock('../components/GuardianCheckout', () => ({
  default: (props) => {
    onPaidRef.current = props.onPaid
    return (
      <div data-testid="guardian-checkout">
        checkout for {props.childName} · {props.plan?.name} · request={props.guardianRequestId}
        · api={props.api?.marker}
      </div>
    )
  },
}))

import GuardianUnlock from './GuardianUnlock'

const VALID_LINK = {
  valid: true,
  requestId: 'req-1',
  childUid: 'kid-1',
  childFirstName: 'Milton',
  planId: 'term_pass',
  priceZMW: 120,
  feature: 'PAPER_CONTINUE',
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/guardian-unlock?t=tok123']}>
      <Routes>
        <Route path="/guardian-unlock" element={<GuardianUnlock />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('GuardianUnlock', () => {
  beforeEach(() => {
    isNativePlatform.mockReturnValue(false)
    resolveGuardianPayLink.mockReset()
    resolveGuardianPayLink.mockResolvedValue(VALID_LINK)
    onPaidRef.current = null
  })

  it('a signed-out visitor goes STRAIGHT to the checkout — no sign-in, no account wording', async () => {
    useAuthMock.mockReturnValue({ currentUser: null })
    renderPage()
    const checkout = await screen.findByTestId('guardian-checkout')
    expect(checkout.textContent).toMatch(/Milton/)
    expect(checkout.textContent).toMatch(/Term Pass/)
    expect(checkout.textContent).toMatch(/request=req-1/)
    expect(screen.queryByRole('button', { name: /sign in|create an account/i })).toBeNull()
    expect(screen.queryByText(/parent account|any zedexams account/i)).toBeNull()
    expect(screen.getByText(/do not need a ZedExams account/i)).toBeTruthy()
  })

  it('the checkout is bound to the link token, not to a signed-in user', async () => {
    useAuthMock.mockReturnValue({ currentUser: null })
    renderPage()
    const checkout = await screen.findByTestId('guardian-checkout')
    expect(makeGuardianLinkApi).toHaveBeenCalledWith('tok123')
    expect(checkout.textContent).toMatch(/api=link-api/)
  })

  it('a signed-in visitor sees the same page — being signed in changes nothing', async () => {
    useAuthMock.mockReturnValue({ currentUser: { uid: 'u1' } })
    renderPage()
    expect((await screen.findByTestId('guardian-checkout')).textContent).toMatch(/api=link-api/)
  })

  it('a request with no resolvable checkout plan says so rather than showing a dead checkout', async () => {
    useAuthMock.mockReturnValue({ currentUser: null })
    resolveGuardianPayLink.mockResolvedValue({ ...VALID_LINK, planId: 'not-a-real-plan' })
    renderPage()
    await screen.findByText(/we cannot take this payment/i)
    expect(screen.queryByTestId('guardian-checkout')).toBeNull()
  })

  it('reaching successful payment hides the pre-payment upsell copy', async () => {
    useAuthMock.mockReturnValue({ currentUser: null })
    renderPage()
    await screen.findByTestId('guardian-checkout')
    expect(screen.getByText(/what unlocking gives them/i)).toBeTruthy()
    act(() => { onPaidRef.current?.() })
    await waitFor(() => expect(screen.queryByText(/what unlocking gives them/i)).toBeNull())
  })

  it('an invalid link never renders a checkout regardless of auth state', async () => {
    useAuthMock.mockReturnValue({ currentUser: { uid: 'u1' } })
    resolveGuardianPayLink.mockResolvedValue({ valid: false, reason: 'expired' })
    renderPage()
    await screen.findByText(/this link is not open/i)
    expect(screen.queryByTestId('guardian-checkout')).toBeNull()
  })

  describe('inside the Android app', () => {
    beforeEach(() => isNativePlatform.mockReturnValue(true))

    it('never renders the mobile-money checkout or names a payment method', async () => {
      const { container } = renderPage()
      await screen.findByText(/asked you to unlock ZedExams/i)
      expect(screen.queryByTestId('guardian-checkout')).toBeNull()
      expect(container.textContent).not.toMatch(/mobile money|airtel|mtn|zamtel|lenco/i)
    })

    it('points at the browser rather than a retired family screen', async () => {
      const { container } = renderPage()
      await screen.findByText(/open this link in your phone's web browser/i)
      expect(screen.queryByRole('button', { name: /choose a plan|sign in/i })).toBeNull()
      expect(container.innerHTML).not.toMatch(/\/family/)
    })
  })
})
