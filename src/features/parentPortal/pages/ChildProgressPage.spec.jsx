/**
 * ChildProgressPage — /family/child/:childUid. Loads the link-gated per-child
 * payload and renders it, with friendly loading / not-linked / error states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, db: {} }))

const mockGetChildProgress = vi.fn()
vi.mock('../services/familyPortal', () => ({
  getChildProgress: (...a) => mockGetChildProgress(...a),
}))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))
vi.mock('../../../components/seo/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../components/ui/Skeleton', () => ({ default: () => <div data-testid="skeleton" /> }))
vi.mock('../../../components/ui/SubjectIcon', () => ({ default: () => null }))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useParams: () => ({ childUid: 'c1' }) }
})

import ChildProgressPage from './ChildProgressPage'

function renderPage() {
  return render(<MemoryRouter><ChildProgressPage /></MemoryRouter>)
}

beforeEach(() => vi.clearAllMocks())

describe('ChildProgressPage', () => {
  it('shows skeletons while loading', () => {
    mockGetChildProgress.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0)
  })

  it('renders the child name + progress once loaded', async () => {
    mockGetChildProgress.mockResolvedValue({
      learnerUid: 'c1', learnerDisplayName: 'Amara', learnerGrade: '5',
      summary: { totalAttempts: 3, averagePercentage: 70, currentStreak: 1, windowDays: 30 },
      subjectBreakdown: [], recentResults: [],
    })
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Amara' })).toBeInTheDocument()
    expect(screen.getByText('Quizzes done')).toBeInTheDocument()
  })

  it('shows a not-linked message when the server denies access', async () => {
    mockGetChildProgress.mockRejectedValue(new Error('You are not linked to this child.'))
    renderPage()
    expect(await screen.findByText(/not linked to this child/i)).toBeInTheDocument()
  })

  it('shows a generic error on any other failure', async () => {
    mockGetChildProgress.mockRejectedValue(new Error('network'))
    renderPage()
    expect(await screen.findByText(/could not load this child/i)).toBeInTheDocument()
  })
})
