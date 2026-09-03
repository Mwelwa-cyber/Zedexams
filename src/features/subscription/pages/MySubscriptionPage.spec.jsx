import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// MySubscriptionPage renders the plan card (status, payment, renews/expires)
// and — for teachers on Pro — a "Upgrade to Max" upsell. The two promises
// pinned here: (1) the "Renews / expires" value shows the real date + days
// left when one exists, and a plain "Lifetime" (never the old ambiguous
// "Active") for access with no expiry; (2) the Pro→Max upsell shows ONLY for
// a teacher on Pro, never for Max teachers or learners.
//
// The reminder hook + auth are mocked; the SEO + payment modal are stubbed so
// no Firebase/network is touched.

vi.mock('../../../hooks/useSubscriptionReminder', () => ({ useSubscriptionReminder: vi.fn() }))
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../components/UpgradeModal', () => ({ default: () => null }))
vi.mock('../../../utils/runtime', () => ({ isNativePlatform: vi.fn(() => false) }))
// Own spec (TeacherTrialOfferCard.spec.jsx); stubbed here so this file never
// touches its Functions-SDK-importing service module (no Firebase/network).
vi.mock('../components/TeacherTrialOfferCard', () => ({ default: () => null }))

import { useSubscriptionReminder } from '../../../hooks/useSubscriptionReminder'
import { useAuth } from '../../../contexts/AuthContext'
import { isNativePlatform } from '../../../utils/runtime'
import MySubscriptionPage from './MySubscriptionPage.jsx'

const BASE = {
  status: 'pro',
  audience: 'learner',
  isPro: true,
  isTrial: false,
  planType: 'free',
  benefits: ['Full quizzes and timed tests'],
  expiry: null,
  daysLeft: null,
}

function setView(overrides = {}) {
  useSubscriptionReminder.mockReturnValue({ ...BASE, ...overrides })
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.mockReturnValue({ userProfile: {} })
})

describe('renews / expires line', () => {
  it('shows the formatted date and days-left when an expiry exists', () => {
    const expiry = new Date('2026-07-19T00:00:00Z')
    setView({ expiry, daysLeft: 30 })
    render(<MySubscriptionPage />)
    expect(screen.getByText('Renews / expires')).toBeInTheDocument()
    expect(screen.getByText(/19 July 2026 · 30 days left/)).toBeInTheDocument()
  })

  it('uses singular "day" when one day is left', () => {
    setView({ expiry: new Date('2026-06-20T00:00:00Z'), daysLeft: 1 })
    render(<MySubscriptionPage />)
    expect(screen.getByText(/· 1 day left/)).toBeInTheDocument()
  })

  it('shows "Lifetime" for access with no expiry date', () => {
    setView({ expiry: null, daysLeft: null })
    render(<MySubscriptionPage />)
    // The renews/expires value reads "Lifetime" — not the old ambiguous
    // "Active" — and its label switches to the calmer "Access".
    expect(screen.getByText('Lifetime')).toBeInTheDocument()
    expect(screen.getByText('Access')).toBeInTheDocument()
    expect(screen.queryByText('Renews / expires')).not.toBeInTheDocument()
    // "Active" still appears once — as the separate PAYMENT STATUS value.
    expect(screen.getByText('Payment status')).toBeInTheDocument()
  })

  it('shows the free-tier access copy when there is no plan', () => {
    setView({ status: 'free', isPro: false, expiry: null })
    render(<MySubscriptionPage />)
    expect(screen.getByText('Demo / free content only')).toBeInTheDocument()
  })
})

describe('Pro → Max upsell', () => {
  it('shows for a teacher on Pro', () => {
    setView({ audience: 'teacher', planType: 'pro' })
    render(<MySubscriptionPage />)
    expect(screen.getByRole('button', { name: 'Upgrade to Max' })).toBeInTheDocument()
  })

  it('does not show for a teacher already on Max', () => {
    setView({ audience: 'teacher', planType: 'max' })
    render(<MySubscriptionPage />)
    expect(screen.queryByRole('button', { name: 'Upgrade to Max' })).not.toBeInTheDocument()
  })

  it('does not show for a learner (no Pro→Max ladder)', () => {
    setView({ audience: 'learner', planType: 'pro' })
    render(<MySubscriptionPage />)
    expect(screen.queryByRole('button', { name: 'Upgrade to Max' })).not.toBeInTheDocument()
  })

  it('does not show for a teacher with no active plan', () => {
    setView({ audience: 'teacher', status: 'free', isPro: false, planType: 'free' })
    render(<MySubscriptionPage />)
    expect(screen.queryByRole('button', { name: 'Upgrade to Max' })).not.toBeInTheDocument()
  })
})

describe('Manage Google Play Subscription button', () => {
  const playProfile = {
    subscriptionProvider: 'google_play',
    googlePlayProductId: 'learner_premium_monthly',
  }

  it('shows on Android for a Play-billed subscription', () => {
    isNativePlatform.mockReturnValue(true)
    useAuth.mockReturnValue({ userProfile: playProfile })
    setView({ expiry: new Date('2026-08-01T00:00:00Z'), daysLeft: 29 })
    render(<MySubscriptionPage />)
    expect(screen.getByRole('button', { name: 'Manage Google Play Subscription' })).toBeInTheDocument()
  })

  it('hidden on the web even for a Play-billed subscription', () => {
    isNativePlatform.mockReturnValue(false)
    useAuth.mockReturnValue({ userProfile: playProfile })
    setView({ expiry: new Date('2026-08-01T00:00:00Z'), daysLeft: 29 })
    render(<MySubscriptionPage />)
    expect(screen.queryByRole('button', { name: 'Manage Google Play Subscription' })).not.toBeInTheDocument()
  })

  it('hidden on Android for a web (Lenco) subscription — never steer web billing to Play', () => {
    isNativePlatform.mockReturnValue(true)
    useAuth.mockReturnValue({ userProfile: { subscriptionProvider: 'lenco' } })
    setView({ expiry: new Date('2026-08-01T00:00:00Z'), daysLeft: 29 })
    render(<MySubscriptionPage />)
    expect(screen.queryByRole('button', { name: 'Manage Google Play Subscription' })).not.toBeInTheDocument()
  })

  it('hidden for a null/absent provider (fresh signups, manual grants)', () => {
    isNativePlatform.mockReturnValue(true)
    useAuth.mockReturnValue({ userProfile: {} })
    setView({})
    render(<MySubscriptionPage />)
    expect(screen.queryByRole('button', { name: 'Manage Google Play Subscription' })).not.toBeInTheDocument()
  })
})
