import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import StudioGate from './StudioGate'
import { useAuth } from '../../contexts/AuthContext'
import { resolveTeacherPlan } from '../../utils/teacherPlans'

// StudioGate is the route-level gate for the teacher generator studios: a
// Free-plan teacher gets <LockedStudio> (sample + paywall) instead of the
// real studio, so the studio and its paid generation calls never mount;
// Pro/Max/admin teachers get the studio unchanged. A regression either
// exposes a paid studio to a free teacher or blocks a paying one. useAuth and
// the plan resolver are mocked; LockedStudio (lazy) is a marker.

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../utils/teacherPlans', () => ({ resolveTeacherPlan: vi.fn() }))
vi.mock('./LockedStudio', () => ({
  default: (props) => <div data-testid="locked-studio" data-tool={props.tool} />,
}))
// The soft usage reminder needs router + usage-meter context — its own spec
// covers it; here it's a marker so the gate's contract stays the focus.
vi.mock('../subscription/UsageReminderBanner', () => ({
  default: (props) => <div data-testid="usage-reminder" data-tool={props.tool} />,
}))

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.mockReturnValue({ userProfile: { role: 'teacher' } })
})

describe('StudioGate', () => {
  it('renders the real studio for a Pro teacher', () => {
    resolveTeacherPlan.mockReturnValue('pro')
    render(<StudioGate tool="assessment"><div data-testid="studio" /></StudioGate>)
    expect(screen.getByTestId('studio')).toBeInTheDocument()
    expect(screen.queryByTestId('locked-studio')).not.toBeInTheDocument()
  })

  it('renders the real studio for a Max teacher', () => {
    resolveTeacherPlan.mockReturnValue('max')
    render(<StudioGate tool="exam-paper"><div data-testid="studio" /></StudioGate>)
    expect(screen.getByTestId('studio')).toBeInTheDocument()
  })

  it('locks the studio for a Free teacher and passes the tool through', async () => {
    resolveTeacherPlan.mockReturnValue('free')
    render(<StudioGate tool="assessment"><div data-testid="studio" /></StudioGate>)

    const locked = await screen.findByTestId('locked-studio')
    expect(locked).toHaveAttribute('data-tool', 'assessment')
    // The real studio must NOT mount (no paid generation calls fire).
    expect(screen.queryByTestId('studio')).not.toBeInTheDocument()
  })

  it('passes the resolved profile to the plan resolver', () => {
    const userProfile = { role: 'teacher', teacherPlan: 'pro' }
    useAuth.mockReturnValue({ userProfile })
    resolveTeacherPlan.mockReturnValue('pro')
    render(<StudioGate tool="rubric"><div data-testid="studio" /></StudioGate>)
    expect(resolveTeacherPlan).toHaveBeenCalledWith(userProfile)
  })
})
