/**
 * Behaviour tests for GradeHub.jsx — the primary learner dashboard.
 *
 * GradeHub is the highest-traffic learner surface and had no component-level
 * coverage. These tests guard the parts most likely to regress silently:
 *   - the personalised greeting,
 *   - the grade-gated "My Grade" panel vs. the "set your grade" prompt,
 *   - tab switching (My Grade ⇄ Next Level),
 *   - the recent-activity empty state vs. populated rows,
 *   - the badges empty state.
 *
 * Every context/hook and the firebase-touching child components are stubbed;
 * the real curriculum config (SUBJECTS/GRADE_META) and streak maths are kept
 * so the subject grid and greeting exercise genuine wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

let mockAuth = {
  currentUser: { uid: 'learner-1', emailVerified: true },
  userProfile: { id: 'learner-1', displayName: 'Amara Banda', grade: '5' },
  logout: vi.fn(),
  isAdmin: false,
  isTeacher: false,
}
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))

vi.mock('../../contexts/PlatformSettingsContext', () => ({
  usePlatformSettings: () => ({ settings: {} }),
}))

vi.mock('../../contexts/DataSaverContext', () => ({
  useDataSaver: () => ({ dataSaver: false }),
}))

const mockGetUserResults = vi.fn()
const mockGetWeaknessAnalysis = vi.fn()
const mockGetQuizzes = vi.fn()
vi.mock('../../hooks/useFirestore', () => ({
  useFirestore: () => ({
    getUserResults: mockGetUserResults,
    getWeaknessAnalysis: mockGetWeaknessAnalysis,
    getQuizzes: mockGetQuizzes,
  }),
}))

let mockBadges = { earned: [], loading: false }
vi.mock('../../hooks/useBadges', () => ({ useBadges: () => mockBadges }))

vi.mock('../../hooks/useSubscription', () => ({
  useSubscription: () => ({ accessBadge: null, isDemoOnly: false }),
}))

vi.mock('../../hooks/useHideOnScroll', () => ({ default: () => false }))

// examService.js touches firebase functions at import time.
vi.mock('../../utils/examService', () => ({
  getTodaysExamsBySubject: vi.fn().mockResolvedValue([]),
  checkTodaysLocks: vi.fn().mockResolvedValue({}),
}))

// Firebase-touching / heavy child components — render nothing so the test
// exercises GradeHub's own JSX in isolation. (vi.mock is hoisted above any
// local const, so each factory is inlined.)
vi.mock('../ui/ProfessorPako', () => ({ default: () => null }))
vi.mock('../ui/DataSaverToggle', () => ({ default: () => null }))
vi.mock('../ui/BadgeCard', () => ({ default: () => null }))
vi.mock('../ui/Logo', () => ({ default: () => null }))
vi.mock('../ui/OnboardingOverlay', () => ({ default: () => null }))
vi.mock('../ui/PushPermissionPrompt', () => ({ default: () => null }))
vi.mock('../ui/VerifyEmailBanner', () => ({ default: () => null }))
vi.mock('../subscription/SubscriptionReminderCard', () => ({ default: () => null }))
vi.mock('./StudyPlanCard', () => ({ default: () => null }))
vi.mock('../ui/ThemeSelector', () => ({ default: () => null }))
vi.mock('../ui/LanguageToggle', () => ({ default: () => null }))
vi.mock('../ui/AnalyticsConsentToggle', () => ({ default: () => null }))
vi.mock('../ui/ReplayTourCard', () => ({ default: () => null }))
vi.mock('../layout/MobileBottomNav', () => ({ default: () => null }))
vi.mock('../../features/feedback', () => ({ SuggestionNudge: () => null }))
vi.mock('../games/GameStickerStyles', () => ({ default: () => null }))
vi.mock('../seo/SeoHelmet', () => ({ default: () => null }))
// Light structural primitives — render enough to keep labels/children visible.
vi.mock('../ui/Icon', () => ({ default: () => null }))
vi.mock('../ui/Skeleton', () => ({ default: () => <div data-testid="skeleton" /> }))
vi.mock('../ui/Button', () => ({ default: ({ children, ...p }) => <button {...p}>{children}</button> }))
vi.mock('../ui/HeaderIconButton', () => ({
  HeaderIconLink: ({ children }) => <span>{children}</span>,
  HeaderIconButton: ({ children, ...p }) => <button {...p}>{children}</button>,
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mockNavigate }
})

import GradeHub from './GradeHub'

function renderHub() {
  return render(
    <MemoryRouter>
      <GradeHub />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth = {
    currentUser: { uid: 'learner-1', emailVerified: true },
    userProfile: { id: 'learner-1', displayName: 'Amara Banda', grade: '5' },
    logout: vi.fn(),
    isAdmin: false,
    isTeacher: false,
  }
  mockBadges = { earned: [], loading: false }
  mockGetUserResults.mockResolvedValue([])
  mockGetWeaknessAnalysis.mockResolvedValue([])
  mockGetQuizzes.mockResolvedValue([])
})

describe('GradeHub — personalised hero', () => {
  it("greets the learner by first name", async () => {
    renderHub()
    expect(await screen.findByText('Amara!')).toBeInTheDocument()
  })

  it('falls back to "Learner" when the profile has no display name', async () => {
    mockAuth.userProfile = { id: 'learner-1', grade: '5' }
    renderHub()
    expect(await screen.findByText('Learner!')).toBeInTheDocument()
  })
})

describe('GradeHub — grade gating', () => {
  it('shows the My Grade panel with subject cards for a graded learner', async () => {
    renderHub()
    expect(await screen.findByText('My Grade 5')).toBeInTheDocument()
    expect(screen.getByText('Current')).toBeInTheDocument()
    // the tab advertises the resolved grade
    expect(screen.getByText('My Grade (5)')).toBeInTheDocument()
  })

  it('prompts an ungraded learner to set their grade', async () => {
    mockAuth.userProfile = { id: 'learner-1', displayName: 'No Grade' }
    renderHub()
    expect(
      await screen.findByText('Set your grade to personalise your hub'),
    ).toBeInTheDocument()
  })
})

describe('GradeHub — tab switching', () => {
  it('switches from My Grade to the Next Level preview', async () => {
    renderHub()
    await screen.findByText('My Grade 5')
    fireEvent.click(screen.getByText('Next Level'))
    // The My Grade panel ("Current" badge) gives way to the grade-6 preview
    // panel, whose heading ends in a standalone "Preview" text node.
    await waitFor(() => expect(screen.queryByText('Current')).not.toBeInTheDocument())
    expect(screen.getByText('Preview')).toBeInTheDocument()
  })
})

describe('GradeHub — recent activity', () => {
  it('renders the empty state when the learner has no results', async () => {
    renderHub()
    expect(await screen.findByText('No quizzes yet!')).toBeInTheDocument()
  })

  it('renders recent result rows when results exist', async () => {
    mockGetUserResults.mockResolvedValue([
      { id: 'r1', subject: 'Mathematics', percentage: 82, completedAt: Date.now() },
    ])
    renderHub()
    // Wait for the ROW, not for the empty state to disappear. While the panel
    // is loading it renders skeletons — neither "No quizzes yet!" nor the
    // subject — so waiting on the empty state's absence was satisfied by the
    // loading state, and the assertion below then ran before the results
    // arrived. It passed on a fast machine and failed on a busy CI runner.
    expect(await screen.findByText(/Mathematics/)).toBeInTheDocument()
    expect(screen.queryByText('No quizzes yet!')).not.toBeInTheDocument()
  })
})

describe('GradeHub — badges', () => {
  it('shows the empty badge prompt when none are earned', async () => {
    renderHub()
    expect(await screen.findByText('No badges yet — go earn one!')).toBeInTheDocument()
  })
})

describe('GradeHub — subject cards', () => {
  // SubjectCardRich is wrapped in React.memo. This guards that memoisation
  // didn't break the prop→render path: a memoised card must still show the
  // per-subject score fed to it (memo must re-render, not cache a stale 0%).
  it('renders the per-subject score on the (memoised) subject card', async () => {
    mockAuth.userProfile = {
      id: 'learner-1', displayName: 'Amara Banda', grade: '5',
      performance: { Mathematics: 88 },
    }
    renderHub()
    await screen.findByText('My Grade 5')
    expect(screen.getByText('88%')).toBeInTheDocument()
  })
})
