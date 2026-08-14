import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PremiumGate, { AccessBadge, UpgradeBanner } from './PremiumGate'
import { useSubscription } from '../../../hooks/useSubscription'
import { lockedFeature } from '../lib/lockedFeature'
import { isNativePlatform } from '../../../utils/runtime'

// PremiumGate is the client-side access gate for premium learner features:
// allowed → render the real children; blocked → an overlay that opens the
// shared locked-feature modal. A regression here either leaks a paid feature
// to a free learner or locks it away from someone who paid. useSubscription
// (the entitlement source) and the side-effect helpers are mocked; the real
// PLANS config runs so the banner price can't drift from checkout.

vi.mock('../../../hooks/useSubscription', () => ({ useSubscription: vi.fn() }))
vi.mock('../lib/lockedFeature', () => ({ lockedFeature: { show: vi.fn() } }))
vi.mock('../../../utils/runtime', () => ({ isNativePlatform: vi.fn(() => false) }))

// Sensible all-locked defaults; each test overrides what it needs.
function setSub(overrides = {}) {
  useSubscription.mockReturnValue({
    canAccessFullContent: false,
    canUseExamMode: false,
    canUseWeaknessAnalysis: false,
    accessBadge: { label: 'Demo Access', color: 'gray' },
    isDemoOnly: true,
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setSub()
})

describe('PremiumGate — gating', () => {
  it('renders children directly when full access is granted', () => {
    setSub({ canAccessFullContent: true })
    render(<PremiumGate feature="other"><p>secret</p></PremiumGate>)
    expect(screen.getByText('secret')).toBeInTheDocument()
    // No lock overlay when allowed.
    expect(screen.queryByText('Upgrade to unlock')).not.toBeInTheDocument()
  })

  it('shows the lock overlay when access is denied', () => {
    render(<PremiumGate feature="other"><p>secret</p></PremiumGate>)
    expect(screen.getByText('ZedExams Pro')).toBeInTheDocument()
    expect(screen.getByText('Upgrade to unlock')).toBeInTheDocument()
  })

  it('opens the locked-feature modal with a friendly label on click', () => {
    render(<PremiumGate feature="examMode"><p>exam</p></PremiumGate>)
    fireEvent.click(screen.getByText('Upgrade to unlock'))
    expect(lockedFeature.show).toHaveBeenCalledWith({ feature: 'Exam mode' })
  })

  it('gates examMode on canUseExamMode specifically', () => {
    // Full content is off, but the exam-mode entitlement is on → allowed.
    setSub({ canUseExamMode: true })
    render(<PremiumGate feature="examMode"><p>exam</p></PremiumGate>)
    expect(screen.getByText('exam')).toBeInTheDocument()
    expect(screen.queryByText('Upgrade to unlock')).not.toBeInTheDocument()
  })

  it('gates weaknessAnalysis on canUseWeaknessAnalysis specifically', () => {
    setSub({ canUseWeaknessAnalysis: true })
    render(<PremiumGate feature="weaknessAnalysis"><p>weak</p></PremiumGate>)
    expect(screen.getByText('weak')).toBeInTheDocument()
  })

  it('does not leak examMode to a learner who only has weaknessAnalysis', () => {
    setSub({ canUseWeaknessAnalysis: true, canUseExamMode: false })
    render(<PremiumGate feature="examMode"><p>exam</p></PremiumGate>)
    expect(screen.getByText('Upgrade to unlock')).toBeInTheDocument()
  })
})

describe('AccessBadge', () => {
  it('shows the demo tag + upgrade button for a demo-only user', () => {
    const onUpgradeClick = vi.fn()
    render(<AccessBadge onUpgradeClick={onUpgradeClick} />)
    expect(screen.getByText('Demo Access')).toBeInTheDocument()
    expect(screen.getByText(/Demo quizzes only/)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/Upgrade/))
    expect(onUpgradeClick).toHaveBeenCalledTimes(1)
  })

  it('hides the upgrade affordance for a full-access user', () => {
    setSub({ isDemoOnly: false, accessBadge: { label: 'Premium', color: 'yellow' } })
    render(<AccessBadge onUpgradeClick={vi.fn()} />)
    expect(screen.getByText('Premium')).toBeInTheDocument()
    expect(screen.queryByText(/Demo quizzes only/)).not.toBeInTheDocument()
  })
})

describe('UpgradeBanner', () => {
  it('renders nothing when the user already has full access', () => {
    setSub({ canAccessFullContent: true })
    const { container } = render(<UpgradeBanner onUpgradeClick={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the config-driven entry price on web and fires the upgrade handler', () => {
    const onUpgradeClick = vi.fn()
    render(<UpgradeBanner onUpgradeClick={onUpgradeClick} />)
    // grade7_monthly.priceZMW === 75 in subscriptionConfig.
    expect(screen.getByText(/From K75\/mo/)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/From K75\/mo/))
    expect(onUpgradeClick).toHaveBeenCalledTimes(1)
  })

  it('shows a price-free CTA on native (Android/Play Billing)', () => {
    isNativePlatform.mockReturnValue(true)
    render(<UpgradeBanner onUpgradeClick={vi.fn()} />)
    expect(screen.getByText('Go Premium')).toBeInTheDocument()
    expect(screen.queryByText(/K75/)).not.toBeInTheDocument()
  })

  it('can be dismissed', () => {
    render(<UpgradeBanner onUpgradeClick={vi.fn()} />)
    expect(screen.getByText('Unlock Full Access')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(screen.queryByText('Unlock Full Access')).not.toBeInTheDocument()
  })
})
