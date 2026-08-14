import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PaywallHost from './PaywallHost'
import { paywall } from '../../../utils/paywall'
import { topup } from '../../../utils/topup'
import { capture } from '../../../utils/analytics'
import { isNativePlatform } from '../../../utils/runtime'
import { peekPremiumAction } from '../lib/pendingPremiumAction'

// capture() is the funnel hook we're asserting on.
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
// Platform switchable per test: web (default) keeps the Lenco/K25 surfaces,
// native (Android) must route everything to Google Play Billing.
vi.mock('../../../utils/runtime', () => ({ isNativePlatform: vi.fn(() => false) }))
// Lazy modal markers — which one mounts is exactly what the native routing
// tests assert.
vi.mock('./UpgradeModal', () => ({
  default: (props) => <div data-testid="upgrade-modal" data-portal={props.portal} />,
}))
vi.mock('./TopUpModal', () => ({
  default: () => <div data-testid="topup-modal" />,
}))
// The host stamps the pending-premium-action with the owner's uid.
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'u1' } }),
}))

// The host navigates to /pricing from the "Compare plans" link, so it needs a
// router context.
function renderHost() {
  return render(
    <MemoryRouter>
      <PaywallHost />
    </MemoryRouter>,
  )
}

describe('PaywallHost conversion analytics', () => {
  beforeEach(() => {
    act(() => paywall.hide()) // reset the shared singleton between tests
    capture.mockClear()
  })

  it('fires paywall_shown with plan_target "max" for the Max upsell', () => {
    renderHost()
    act(() => paywall.show('max-feature', { feature: 'Exam papers' }))
    expect(capture).toHaveBeenCalledWith('paywall_shown', {
      reason: 'max-feature',
      feature: 'Exam papers',
      plan_target: 'max',
    })
  })

  it('segments Pro paywalls from the Max upsell via plan_target', () => {
    renderHost()
    act(() => paywall.show('monthly-limit', { feature: 'lesson plans' }))
    expect(capture).toHaveBeenCalledWith('paywall_shown', {
      reason: 'monthly-limit',
      feature: 'lesson plans',
      plan_target: 'pro',
    })
  })

  it('fires paywall_upgrade_clicked when the upgrade CTA is pressed', () => {
    renderHost()
    act(() => paywall.show('max-feature', { feature: 'Exam papers' }))
    capture.mockClear()
    act(() => screen.getByRole('button', { name: /Upgrade to Max/i }).click())
    expect(capture).toHaveBeenCalledWith(
      'paywall_upgrade_clicked',
      expect.objectContaining({ reason: 'max-feature', plan_target: 'max', via: 'primary' }),
    )
  })

  it('does not fire for an unknown reason', () => {
    renderHost()
    act(() => paywall.show('not-a-real-scenario', {}))
    expect(capture).not.toHaveBeenCalled()
  })
})

describe('PaywallHost pending-premium-action (return-after-payment)', () => {
  beforeEach(() => {
    act(() => paywall.hide())
    sessionStorage.clear()
    capture.mockClear()
  })

  it('remembers the interrupted route + tool when the paywall shows', () => {
    renderHost()
    act(() => paywall.show('monthly-limit', { feature: 'lesson plans', tool: 'lesson_plan' }))
    expect(peekPremiumAction()).toMatchObject({
      sourceRoute: '/',
      reason: 'monthly-limit',
      tool: 'lesson_plan',
      feature: 'lesson plans',
    })
  })

  it('clears the memory when the teacher dismisses without upgrading', () => {
    renderHost()
    act(() => paywall.show('monthly-limit', { feature: 'lesson plans', tool: 'lesson_plan' }))
    act(() => screen.getByRole('button', { name: 'Not now' }).click())
    expect(peekPremiumAction()).toBeNull()
  })

  it('keeps the memory when the teacher heads into the upgrade checkout', () => {
    renderHost()
    act(() => paywall.show('monthly-limit', { feature: 'lesson plans', tool: 'lesson_plan' }))
    act(() => screen.getByRole('button', { name: /Upgrade to Pro/ }).click())
    expect(peekPremiumAction()).toMatchObject({ tool: 'lesson_plan' })
  })
})

describe('PaywallHost web (Lenco) surfaces — regression lock', () => {
  beforeEach(() => {
    isNativePlatform.mockReturnValue(false)
    act(() => paywall.hide())
    act(() => topup.hide())
    capture.mockClear()
  })

  it('shows the K25 one-off secondary and ZMW price on web', () => {
    renderHost()
    act(() => paywall.show('monthly-limit', { feature: 'lesson plans' }))
    expect(screen.getByRole('button', { name: /Pay K25 — one extra now/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Upgrade to Pro · K59\/mo/i })).toBeInTheDocument()
    expect(screen.getByText('MoMo')).toBeInTheDocument()
    expect(screen.getByText('Airtel')).toBeInTheDocument()
  })

  it('topup bus opens the TopUpModal on web', async () => {
    renderHost()
    act(() => topup.show({ feature: 'Lesson plans' }))
    expect(await screen.findByTestId('topup-modal')).toBeInTheDocument()
    expect(screen.queryByTestId('upgrade-modal')).toBeNull()
  })
})

describe('PaywallHost native (Google Play) routing', () => {
  beforeEach(() => {
    isNativePlatform.mockReturnValue(true)
    act(() => paywall.hide())
    act(() => topup.hide())
    capture.mockClear()
  })

  it('hides the K25 one-off, price literals, and MoMo/Airtel badges', () => {
    renderHost()
    act(() => paywall.show('monthly-limit', { feature: 'lesson plans' }))
    expect(screen.queryByRole('button', { name: /Pay K25/i })).toBeNull()
    // Primary CTA keeps its intent but loses the ZMW price suffix.
    expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument()
    expect(screen.queryByText(/K59/)).toBeNull()
    expect(screen.queryByText(/K25/)).toBeNull()
    expect(screen.queryByText('MoMo')).toBeNull()
    expect(screen.queryByText('Airtel')).toBeNull()
    expect(screen.getByText(/Cancel anytime in the Play Store/i)).toBeInTheDocument()
  })

  it('strips the compare-table ZMW prices on native', () => {
    renderHost()
    act(() => paywall.show('max-feature', { feature: 'Exam papers' }))
    expect(screen.queryByText('K149')).toBeNull()
    expect(screen.queryByText('K59')).toBeNull()
  })

  it('topup bus routes to the Play upgrade flow instead of the Lenco top-up', async () => {
    renderHost()
    act(() => topup.show({ feature: 'Lesson plans' }))
    const modal = await screen.findByTestId('upgrade-modal')
    expect(modal).toBeInTheDocument()
    expect(modal.dataset.portal).toBe('teacher')
    expect(screen.queryByTestId('topup-modal')).toBeNull()
  })
})
