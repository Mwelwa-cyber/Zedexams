import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Regression: the hero "Current plan" badge must reflect the *teacher* plan
 * tier (the same source the UsageMeter reads — usageMeters doc plan, mirrored
 * from users.teacherPlan), NOT the learner `isPremium` gate. A teacher can
 * hold a learner premium subscription (isPremium=true) while their teacher
 * studio tier is still Free, which used to paint "Pro" up top while the meter
 * below correctly showed "Free".
 */

// vi.hoisted so the mock factories (which are hoisted above the imports) can
// share these mutable holders. Each test rewrites .value before rendering.
const mocks = vi.hoisted(() => ({
  usage: { loading: false, data: null, error: null },
  subscription: { isPremium: false },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'teacher-1' } }),
}))
vi.mock('../../hooks/useFirestore', () => ({
  useFirestore: () => ({ getMyQuizzes: vi.fn().mockResolvedValue([]) }),
}))
vi.mock('../../hooks/useSubscription', () => ({
  useSubscription: () => mocks.subscription,
}))
vi.mock('../../hooks/useTeacherUsage', () => ({
  useTeacherUsage: () => mocks.usage,
}))
vi.mock('../../utils/teacherLibraryService', () => ({
  listMyGenerations: vi.fn().mockResolvedValue([]),
  titleForGeneration: (g) => g.title || 'Untitled',
  formatDate: () => '1 Jan 2026',
}))
// Heavy children stubbed so the test stays off Firebase / paywall / helmet.
vi.mock('../subscription/UpgradeModal', () => ({ default: () => null }))
vi.mock('./UsageMeter', () => ({ default: () => <div data-testid="usage-meter" /> }))
vi.mock('../seo/SeoHelmet', () => ({ default: () => null }))
vi.mock('./TeacherOnboardingTour', () => ({ default: () => null }))

import TeacherDashboard from './TeacherDashboard.jsx'

function renderDashboard() {
  return render(
    <MemoryRouter>
      <TeacherDashboard />
    </MemoryRouter>,
  )
}

// Renders the dashboard and returns the badge — the <span> immediately
// before the "Current plan" caption.
async function currentPlanBadge() {
  renderDashboard()
  const caption = await screen.findByText('Current plan')
  return caption.previousElementSibling
}

describe('TeacherDashboard — Current plan badge', () => {
  beforeEach(() => {
    mocks.subscription = { isPremium: false }
    mocks.usage = { loading: false, data: null, error: null }
  })

  it('shows the teacher plan label from useTeacherUsage, not the learner isPremium gate', async () => {
    // Learner premium is active but the teacher studio tier is still Free.
    mocks.subscription = { isPremium: true }
    mocks.usage = { loading: false, data: { plan: 'free', planLabel: 'Free' }, error: null }
    const badge = await currentPlanBadge()
    expect(badge).toHaveTextContent('Free')
    expect(badge).not.toHaveTextContent('Pro')
  })

  it('shows "Pro" when the teacher plan tier is Pro', async () => {
    mocks.subscription = { isPremium: true }
    mocks.usage = { loading: false, data: { plan: 'pro', planLabel: 'Pro' }, error: null }
    expect(await currentPlanBadge()).toHaveTextContent('Pro')
  })

  it('shows "Max" when the teacher plan tier is Max', async () => {
    mocks.subscription = { isPremium: true }
    mocks.usage = { loading: false, data: { plan: 'max', planLabel: 'Max' }, error: null }
    expect(await currentPlanBadge()).toHaveTextContent('Max')
  })

  it('shows a placeholder dash while usage is still loading', async () => {
    mocks.subscription = { isPremium: true }
    mocks.usage = { loading: true, data: null, error: null }
    expect(await currentPlanBadge()).toHaveTextContent('—')
  })
})
