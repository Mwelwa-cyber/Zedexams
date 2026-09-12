/**
 * Behaviour tests for GuardianUnlock — /guardian-unlock?t=…
 *
 * The property that matters most here: paying no longer requires the
 * visitor to be signed in as a `parent`-role account with a confirmed
 * family-code link. Any signed-in, verified account reaches the checkout
 * directly (guardianBillingAuth's rule 4 authorises the payment from the
 * request token itself). These tests pin the four branches a visitor can
 * land in — signed out, unverified, verified, and no-plan-on-record — so a
 * regression back to the old `isParent` gate fails a test rather than
 * shipping quietly.
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

  it('a signed-out visitor is asked to sign in — no parent-account wording', async () => {
    useAuthMock.mockReturnValue({ currentUser: null, needsEmailVerification: false })
    renderPage()
    await screen.findByText(/asked you to unlock ZedExams/i)
    expect(screen.getByRole('button', { name: /sign in or create an account/i })).toBeTruthy()
    // The old copy specifically demanded a PARENT account; that requirement
    // is gone, and the button must not still say so.
    expect(screen.queryByText(/parent account/i)).toBeNull()
    expect(screen.queryByTestId('guardian-checkout')).toBeNull()
  })

  it('a signed-in, verified account goes straight to checkout — no isParent, no family-code link required', async () => {
    useAuthMock.mockReturnValue({ currentUser: { uid: 'u1' }, needsEmailVerification: false })
    renderPage()
    const checkout = await screen.findByTestId('guardian-checkout')
    expect(checkout.textContent).toMatch(/Milton/)
    expect(checkout.textContent).toMatch(/Term Pass/)
    expect(checkout.textContent).toMatch(/request=req-1/)
  })

  it('a signed-in but unverified account is asked to verify before paying, not refused outright', async () => {
    useAuthMock.mockReturnValue({ currentUser: { uid: 'u1' }, needsEmailVerification: true })
    renderPage()
    await screen.findByText(/verify your email to pay/i)
    expect(screen.queryByTestId('guardian-checkout')).toBeNull()
    expect(screen.getByRole('button', { name: /verify my email/i })).toBeTruthy()
  })

  it('a request with no resolvable checkout plan falls back to the fuller flow rather than a dead end', async () => {
    useAuthMock.mockReturnValue({ currentUser: { uid: 'u1' }, needsEmailVerification: false })
    resolveGuardianPayLink.mockResolvedValue({ ...VALID_LINK, planId: 'not-a-real-plan' })
    renderPage()
    await waitFor(() => expect(screen.queryByTestId('guardian-checkout')).toBeNull())
    expect(screen.getByRole('button', { name: /choose a plan/i })).toBeTruthy()
  })

  it('reaching successful payment hides the pre-payment upsell copy', async () => {
    useAuthMock.mockReturnValue({ currentUser: { uid: 'u1' }, needsEmailVerification: false })
    renderPage()
    await screen.findByTestId('guardian-checkout')
    expect(screen.getByText(/what unlocking gives them/i)).toBeTruthy()
    act(() => { onPaidRef.current?.() })
    await waitFor(() => expect(screen.queryByText(/what unlocking gives them/i)).toBeNull())
  })

  it('an invalid link never renders a checkout regardless of auth state', async () => {
    useAuthMock.mockReturnValue({ currentUser: { uid: 'u1' }, needsEmailVerification: false })
    resolveGuardianPayLink.mockResolvedValue({ valid: false, reason: 'expired' })
    renderPage()
    await screen.findByText(/this link is not open/i)
    expect(screen.queryByTestId('guardian-checkout')).toBeNull()
  })
})
