/**
 * Behaviour tests for /family/plan.
 *
 * The property that matters most here is a POLICY one, and it is
 * invisible from the web build: inside the Android shell this screen may
 * not print a kwacha figure, may not offer mobile money, and may not
 * point at any payment method other than Google Play. It did all three —
 * the page had no native branch at all, so the Capacitor build rendered
 * "K15", three mobile-money networks and a Lenco form, while Play's own
 * sheet would have quoted the buyer a figure in their own currency.
 *
 * A price is not something a test can check by eye once and trust: the
 * only build that shows it is one no required CI job compiles. So the
 * absence is asserted over the whole rendered document rather than
 * against a particular element.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))
vi.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => true }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
// ParentPrimitives pulls in the notification bell, which reaches
// AuthContext and through it the Functions SDK at module load.
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0 }),
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'parent-1' }, userProfile: {} }),
}))
vi.mock('../../../utils/lenco', () => ({
  OPERATORS: [
    { id: 'mtn', label: 'MTN MoMo', prefixes: ['096', '076'] },
    { id: 'airtel', label: 'Airtel Money', prefixes: ['097', '077'] },
    { id: 'zamtel', label: 'Zamtel Kwacha', prefixes: ['095', '075'] },
  ],
  detectOperator: () => null,
  looksLikeZambianPhone: () => true,
  initiateLencoPayment: vi.fn(),
  pollLencoStatus: vi.fn(),
  submitLencoOtp: vi.fn(),
}))

let native = false
vi.mock('../../../utils/runtime', () => ({ isNativePlatform: () => native }))

// The Play surface is lazy and reached through the subscription front
// door; the real one talks to @capgo/native-purchases, which has no
// business loading in jsdom.
vi.mock('../../subscription', () => ({
  UpgradeModal: ({ planIds }) => <div data-testid="play-panel">{(planIds || []).join(',')}</div>,
}))

let mockChildren
vi.mock('../hooks/useGuardianChildren', () => ({ default: () => mockChildren }))

import ParentPlan from './ParentPlan'

const lydia = {
  childUid: 'kid-1',
  displayName: 'Lydia Phiri',
  grade: '7',
  role: 'owner',
  capabilities: { manageBilling: true },
}

function renderPlan() {
  return render(<MemoryRouter><ParentPlan /></MemoryRouter>)
}

describe('ParentPlan', () => {
  beforeEach(() => {
    native = false
    mockChildren = { loading: false, error: null, children: [lydia], reload: vi.fn() }
  })

  describe('on the web', () => {
    it('prices in kwacha and takes mobile money', () => {
      renderPlan()
      expect(document.body.textContent).toMatch(/K50/)
      expect(screen.getByRole('radiogroup', { name: /network/i })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'MTN MoMo' })).toBeInTheDocument()
    })

    it('offers the one-off passes, which only Lenco sells', () => {
      renderPlan()
      expect(screen.getByText('Day pass')).toBeInTheDocument()
      expect(screen.getByText('Term Pass')).toBeInTheDocument()
    })
  })

  describe('inside the Android shell', () => {
    beforeEach(() => { native = true })

    it('prints no kwacha figure anywhere on the screen', () => {
      renderPlan()
      // Any "K" immediately followed by digits — K5, K15, K50, K120.
      expect(document.body.textContent).not.toMatch(/K\d/)
    })

    it('offers no mobile money and names no network', () => {
      renderPlan()
      expect(screen.queryByRole('radiogroup', { name: /network/i })).not.toBeInTheDocument()
      expect(document.body.textContent).not.toMatch(/mobile money|MTN|Airtel|Zamtel|Lenco/i)
    })

    it('sends the buyer to Google Play instead', () => {
      renderPlan()
      expect(screen.getByText('Via Google Play')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /Subscribe with Google Play/i }),
      ).toBeInTheDocument()
    })

    it('hides the passes Google Play has no product for', () => {
      // `PLAY_SUBS` carries weekly and monthly only. A rung a buyer can
      // tap and not buy is worse than a shorter list.
      renderPlan()
      expect(screen.queryByText('Day pass')).not.toBeInTheDocument()
      expect(screen.queryByText('Term Pass')).not.toBeInTheDocument()
    })

    it('says what a Play purchase actually does, which is not what the web one does', () => {
      // It activates on the guardian's own account and cascades to the
      // linked children — so the web sentence ("unlocks your child's
      // account, not yours") would be false here.
      renderPlan()
      expect(document.body.textContent).toMatch(/subscribes your own account/i)
      expect(document.body.textContent).not.toMatch(/not yours/)
    })

    it('does not ask which child the money is for', () => {
      // Play gives no way to name a beneficiary, so the question could
      // not be honoured.
      mockChildren = {
        loading: false,
        error: null,
        children: [lydia, { ...lydia, childUid: 'kid-2', displayName: 'Musonda Phiri' }],
        reload: vi.fn(),
      }
      renderPlan()
      expect(screen.queryByText(/Who is this for/i)).not.toBeInTheDocument()
    })
  })
})
