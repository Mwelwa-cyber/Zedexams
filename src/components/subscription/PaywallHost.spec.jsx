import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import PaywallHost from './PaywallHost'
import { paywall } from '../../utils/paywall'
import { capture } from '../../utils/analytics'

// capture() is the funnel hook we're asserting on; ensureProFonts touches the
// document <head>, which we don't care about here.
vi.mock('../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../utils/proFonts', () => ({ ensureProFonts: vi.fn() }))

describe('PaywallHost conversion analytics', () => {
  beforeEach(() => {
    act(() => paywall.hide()) // reset the shared singleton between tests
    capture.mockClear()
  })

  it('fires paywall_shown with plan_target "max" for the Max upsell', () => {
    render(<PaywallHost />)
    act(() => paywall.show('max-feature', { feature: 'Exam papers' }))
    expect(capture).toHaveBeenCalledWith('paywall_shown', {
      reason: 'max-feature',
      feature: 'Exam papers',
      plan_target: 'max',
    })
  })

  it('segments Pro paywalls from the Max upsell via plan_target', () => {
    render(<PaywallHost />)
    act(() => paywall.show('monthly-limit', { feature: 'lesson plans' }))
    expect(capture).toHaveBeenCalledWith('paywall_shown', {
      reason: 'monthly-limit',
      feature: 'lesson plans',
      plan_target: 'pro',
    })
  })

  it('fires paywall_upgrade_clicked when the upgrade CTA is pressed', () => {
    render(<PaywallHost />)
    act(() => paywall.show('max-feature', { feature: 'Exam papers' }))
    capture.mockClear()
    act(() => screen.getByRole('button', { name: /Upgrade to Max/i }).click())
    expect(capture).toHaveBeenCalledWith(
      'paywall_upgrade_clicked',
      expect.objectContaining({ reason: 'max-feature', plan_target: 'max', via: 'primary' }),
    )
  })

  it('does not fire for an unknown reason', () => {
    render(<PaywallHost />)
    act(() => paywall.show('not-a-real-scenario', {}))
    expect(capture).not.toHaveBeenCalled()
  })
})
