import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import StudioGate, { freeAllowanceFor } from './StudioGate'
import { useAuth } from '../../contexts/AuthContext'
import { resolveTeacherPlan } from '../../engines/payment-engine/teacherPlans'

// StudioGate is the route-level gate for the teacher generator studios.
// Capability-based since the free-preview phase: a Free teacher opens any
// studio whose tool has a Free allowance (PLAN_LIMITS.free[tool] > 0); tools
// still at 0 render <LockedStudio> (sample + paywall) so the real studio and
// its paid generation calls never mount. Pro/Max/admin get every studio
// unchanged. A regression either exposes a locked studio to a free teacher
// or blocks a paying one. useAuth + the resolver are mocked; PLAN_LIMITS is
// a fixture so the spec pins gate BEHAVIOUR, not the live catalogue numbers.

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../engines/payment-engine/teacherPlans', () => ({
  resolveTeacherPlan: vi.fn(),
  PLAN_LIMITS: {
    free: { lesson_plan: 8, worksheet: 4, homework: 4, assessment: 2, scheme_of_work: 2, exam_paper: 0, rubric: 0 },
  },
}))
vi.mock('./LockedStudio', () => ({
  default: (props) => <div data-testid="locked-studio" data-tool={props.tool} />,
}))
// The soft usage reminder needs router + usage-meter context — its own spec
// covers it; here it's a marker so the gate's contract stays the focus.
vi.mock('../../features/subscription', () => ({
  UsageReminderBanner: (props) => <div data-testid="usage-reminder" data-tool={props.tool} />,
}))

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.mockReturnValue({ userProfile: { role: 'teacher' } })
})

describe('StudioGate', () => {
  it('renders the real studio for a Pro teacher', () => {
    resolveTeacherPlan.mockReturnValue('pro')
    render(<StudioGate tool="rubric"><div data-testid="studio" /></StudioGate>)
    expect(screen.getByTestId('studio')).toBeInTheDocument()
    expect(screen.queryByTestId('locked-studio')).not.toBeInTheDocument()
  })

  it('renders the real studio for a Max teacher', () => {
    resolveTeacherPlan.mockReturnValue('max')
    render(<StudioGate tool="exam-paper"><div data-testid="studio" /></StudioGate>)
    expect(screen.getByTestId('studio')).toBeInTheDocument()
  })

  it('opens studios with a Free allowance for Free teachers (limited preview)', () => {
    resolveTeacherPlan.mockReturnValue('free')
    for (const tool of ['assessment', 'scheme_of_work', 'worksheet', 'homework']) {
      const { unmount } = render(
        <StudioGate tool={tool}><div data-testid={`studio-${tool}`} /></StudioGate>,
      )
      expect(screen.getByTestId(`studio-${tool}`)).toBeInTheDocument()
      expect(screen.queryByTestId('locked-studio')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('locks zero-allowance studios for a Free teacher and passes the tool through', async () => {
    resolveTeacherPlan.mockReturnValue('free')
    render(<StudioGate tool="exam-paper"><div data-testid="studio" /></StudioGate>)

    const locked = await screen.findByTestId('locked-studio')
    expect(locked).toHaveAttribute('data-tool', 'exam-paper')
    // The real studio must NOT mount (no paid generation calls fire).
    expect(screen.queryByTestId('studio')).not.toBeInTheDocument()
  })

  it('locks tools absent from the catalogue (client-side Pro utilities)', async () => {
    resolveTeacherPlan.mockReturnValue('free')
    render(<StudioGate tool="weekly_forecast"><div data-testid="studio" /></StudioGate>)
    expect(await screen.findByTestId('locked-studio')).toBeInTheDocument()
  })

  it('maps route slugs to catalogue keys', () => {
    expect(freeAllowanceFor('exam-paper')).toBe(0)
    expect(freeAllowanceFor('scheme_of_work')).toBe(2)
    expect(freeAllowanceFor('assessment')).toBe(2)
    expect(freeAllowanceFor('nonexistent-tool')).toBe(0)
  })

  it('passes the resolved profile to the plan resolver', () => {
    const userProfile = { role: 'teacher', teacherPlan: 'pro' }
    useAuth.mockReturnValue({ userProfile })
    resolveTeacherPlan.mockReturnValue('pro')
    render(<StudioGate tool="rubric"><div data-testid="studio" /></StudioGate>)
    expect(resolveTeacherPlan).toHaveBeenCalledWith(userProfile)
  })
})
