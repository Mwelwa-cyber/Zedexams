import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import QuizLimitPopup from './QuizLimitPopup'
import { paywall } from '../../../engines/payment-engine/paywall'
import { capture } from '../../../utils/analytics'

// `isMinor: false` is what makes this an ADULT. resolveAgeBand fails closed,
// so a learner profile silent about age is a child. On the web a child sees
// the plan cards and a parent pays; in the Android build they get no plan
// cards and no checkout — see the under-18 blocks at the bottom.
let mockProfile
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: mockProfile, currentUser: { uid: 'u1' } }),
}))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
let mockNative = false
vi.mock('../../../utils/runtime', () => ({ isNativePlatform: () => mockNative }))
// The upgrade checkout is a lazy import we don't exercise here.
vi.mock('./UpgradeModal', () => ({
  default: (props) => <div data-testid="upgrade-modal" data-plan={props.defaultPlanId} />,
}))

describe('QuizLimitPopup', () => {
  beforeEach(() => {
    act(() => paywall.hide())
    capture.mockClear()
    mockProfile = { role: 'learner', isMinor: false }
    mockNative = false
  })

  it('stays hidden until the quiz-preview-limit reason fires', () => {
    render(<MemoryRouter><QuizLimitPopup /></MemoryRouter>)
    expect(screen.queryByText(/Great Job/i)).toBeNull()

    // An unrelated (teacher) paywall reason must NOT open this popup.
    act(() => paywall.show('monthly-limit', { feature: 'lesson plans' }))
    expect(screen.queryByText(/Great Job/i)).toBeNull()
  })

  it('celebrates the completed free quota and shows the pricing cards', () => {
    render(<MemoryRouter><QuizLimitPopup /></MemoryRouter>)
    act(() => paywall.show('quiz-preview-limit', { paperId: 'p1', paperTitle: 'ECZ 2023', limit: 30 }))

    expect(screen.getByText('🎉 Great Job!')).toBeInTheDocument()
    expect(screen.getByText(/30 FREE questions/i)).toBeInTheDocument()
    // Full progress ring label.
    expect(screen.getByText('30/30')).toBeInTheDocument()
    // Weekly + Monthly plan cards read live prices from config.
    expect(screen.getByText('K15')).toBeInTheDocument()
    expect(screen.getByText('K50')).toBeInTheDocument()
    expect(screen.getByText('⭐ Most Popular')).toBeInTheDocument()
    expect(capture).toHaveBeenCalledWith('paywall_shown', expect.objectContaining({ reason: 'quiz-preview-limit' }))
  })

  it('opens the learner checkout on the monthly plan from the primary CTA', async () => {
    render(<MemoryRouter><QuizLimitPopup /></MemoryRouter>)
    act(() => paywall.show('quiz-preview-limit', { limit: 30 }))

    fireEvent.click(screen.getByText('Continue Learning'))
    // UpgradeModal is a lazy import — wait for the Suspense boundary to resolve.
    const modal = await screen.findByTestId('upgrade-modal')
    expect(modal).toHaveAttribute('data-plan', 'monthly')
    expect(capture).toHaveBeenCalledWith('paywall_upgrade_clicked', expect.objectContaining({ via: 'primary' }))
  })

  // The compliance half. This popup hard-coded plan_target:'learner' and
  // recorded no age_band at all, which is how 24 learner accounts could be
  // seen hitting a paywall over 90 days with no way to tell if any were
  // children.
  describe('under-18 learners on the web — a parent pays', () => {
    for (const [label, profile] of [
      ['a known minor', { role: 'learner', isMinor: true }],
      ['an unknown age (fails closed)', { role: 'learner' }],
    ]) {
      it(`shows the plan cards and the price to ${label}`, () => {
        mockProfile = profile
        render(<MemoryRouter><QuizLimitPopup /></MemoryRouter>)
        act(() => paywall.show('quiz-preview-limit', { limit: 30 }))
        expect(document.body.textContent).toMatch(/K\s?\d/)
        expect(screen.queryByText(/Ask a grown-up/i)).toBeNull()
      })
    }

    it('records age_band and priced:true on the paywall event', () => {
      mockProfile = { role: 'learner', isMinor: true }
      render(<MemoryRouter><QuizLimitPopup /></MemoryRouter>)
      act(() => paywall.show('quiz-preview-limit', { limit: 30 }))
      const shown = capture.mock.calls.find(([name]) => name === 'paywall_shown')
      expect(shown[1].age_band).toBe('under18')
      expect(shown[1].priced).toBe(true)
    })

    it('opens the checkout from the primary CTA', () => {
      mockProfile = { role: 'learner', isMinor: true }
      render(<MemoryRouter><QuizLimitPopup /></MemoryRouter>)
      act(() => paywall.show('quiz-preview-limit', { limit: 30 }))
      fireEvent.click(screen.getByRole('button', { name: /monthly|unlock|upgrade/i }))
      expect(screen.getByTestId('upgrade-modal')).toBeTruthy()
    })
  })

  describe('under-18 learners in the Android build', () => {
    beforeEach(() => { mockNative = true })

    it('are offered the same checkout as everyone — Google Play owns the sheet', () => {
      mockProfile = { role: 'learner', isMinor: true }
      render(<MemoryRouter><QuizLimitPopup /></MemoryRouter>)
      act(() => paywall.show('quiz-preview-limit', { limit: 30 }))
      expect(screen.queryByText(/Ask a grown-up/i)).toBeNull()
      const shown = capture.mock.calls.find(([name]) => name === 'paywall_shown')
      expect(shown[1].age_band).toBe('under18')
      expect(shown[1].priced).toBe(true)
    })
  })
})
