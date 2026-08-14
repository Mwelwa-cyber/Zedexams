import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import UsageReminderBanner from './UsageReminderBanner'
import { useTeacherUsage } from '../../../hooks/useTeacherUsage'
import { capture } from '../../../utils/analytics'

// The soft reminder: fires near a limit, never blocks, dismiss sticks for
// the session, and "View plans" leads to the pricing page.

vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'u1' } }),
}))
// useTeacherUsage imports firebase/config — mock the hook, keep the real
// pure maps in sync by redefining only what the banner reads.
vi.mock('../../../hooks/useTeacherUsage', () => ({
  useTeacherUsage: vi.fn(),
  TOOL_TO_FEATURE: { lesson_plan: 'plans', worksheet: 'worksheets' },
  FEATURE_LABELS: { plans: 'lesson plans', worksheets: 'worksheets' },
}))

const navigateSpy = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigateSpy,
}))

function setUsage(overrides = {}) {
  useTeacherUsage.mockReturnValue({
    data: {
      plan: 'free',
      used: { plans: 0, worksheets: 0 },
      caps: { plans: 2, worksheets: 25 },
      daily: 2,
      today: 0,
      credits: 0,
      resetDays: 9,
      ...overrides,
    },
  })
}

function renderBanner(props = {}) {
  return render(
    <MemoryRouter>
      <UsageReminderBanner {...props} />
    </MemoryRouter>,
  )
}

describe('UsageReminderBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  it('renders nothing below the threshold', () => {
    setUsage()
    renderBanner()
    expect(screen.queryByRole('status')).toBeNull()
    expect(capture).not.toHaveBeenCalled()
  })

  it('shows the near-limit reminder with View plans and a labelled dismiss', () => {
    setUsage({ used: { plans: 1, worksheets: 0 }, daily: 10 })
    renderBanner()
    expect(screen.getByText('Almost out of lesson plans — 1 left this month')).toBeInTheDocument()
    expect(screen.getByText(/without interruption/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View plans' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss reminder' })).toBeInTheDocument()
    expect(capture).toHaveBeenCalledWith('usage_reminder_shown', {
      scope: 'monthly:plans',
      tool: null,
      remaining: 1,
    })
  })

  it('View plans navigates to /pricing', () => {
    setUsage({ used: { plans: 1, worksheets: 0 }, daily: 10 })
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'View plans' }))
    expect(navigateSpy).toHaveBeenCalledWith('/pricing')
    expect(capture).toHaveBeenCalledWith('usage_reminder_view_plans', expect.anything())
  })

  it('dismissal sticks for the session — no repeat nagging', () => {
    setUsage({ used: { plans: 1, worksheets: 0 }, daily: 10 })
    const { unmount } = renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss reminder' }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(capture).toHaveBeenCalledWith('usage_reminder_dismissed', expect.anything())
    unmount()
    renderBanner() // fresh mount, same session
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a different binding constraint may still appear after a dismissal', () => {
    setUsage({ used: { plans: 1, worksheets: 0 }, daily: 10 })
    const { unmount } = renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss reminder' }))
    unmount()
    setUsage({ used: { plans: 1, worksheets: 24 }, daily: 10 }) // worksheets now at 96%
    renderBanner()
    expect(screen.getByText(/Almost out of worksheets/)).toBeInTheDocument()
  })

  it('studio variant watches only its own tool', () => {
    setUsage({ used: { plans: 0, worksheets: 24 }, daily: 10 })
    renderBanner({ tool: 'lesson_plan' })
    expect(screen.queryByRole('status')).toBeNull()
    renderBanner({ tool: 'worksheet' })
    expect(screen.getByText(/Almost out of worksheets/)).toBeInTheDocument()
  })

  it('renders nothing while usage has not loaded', () => {
    useTeacherUsage.mockReturnValue({ data: null })
    renderBanner()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
