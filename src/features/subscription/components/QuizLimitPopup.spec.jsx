import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import QuizLimitPopup from './QuizLimitPopup'
import { paywall } from '../../../utils/paywall'
import { capture } from '../../../utils/analytics'

vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../utils/runtime', () => ({ isNativePlatform: vi.fn(() => false) }))
// The upgrade checkout is a lazy import we don't exercise here.
vi.mock('./UpgradeModal', () => ({
  default: (props) => <div data-testid="upgrade-modal" data-plan={props.defaultPlanId} />,
}))

describe('QuizLimitPopup', () => {
  beforeEach(() => {
    act(() => paywall.hide())
    capture.mockClear()
  })

  it('stays hidden until the quiz-preview-limit reason fires', () => {
    render(<QuizLimitPopup />)
    expect(screen.queryByText(/Great Job/i)).toBeNull()

    // An unrelated (teacher) paywall reason must NOT open this popup.
    act(() => paywall.show('monthly-limit', { feature: 'lesson plans' }))
    expect(screen.queryByText(/Great Job/i)).toBeNull()
  })

  it('celebrates the completed free quota and shows the pricing cards', () => {
    render(<QuizLimitPopup />)
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
    render(<QuizLimitPopup />)
    act(() => paywall.show('quiz-preview-limit', { limit: 30 }))

    fireEvent.click(screen.getByText('Continue Learning'))
    // UpgradeModal is a lazy import — wait for the Suspense boundary to resolve.
    const modal = await screen.findByTestId('upgrade-modal')
    expect(modal).toHaveAttribute('data-plan', 'monthly')
    expect(capture).toHaveBeenCalledWith('paywall_upgrade_clicked', expect.objectContaining({ via: 'primary' }))
  })
})
