import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import UsageMeter from './UsageMeter.jsx'
import { recoverMyPendingPayments } from '../../utils/lenco'

// Every teacher navigation surface now asks studioAvailability which studios
// are on offer, and that reads settings/global. Stubbed to the LAUNCH state
// (no flags set → Worksheet Studio withdrawn, Rubric Studio retired).
vi.mock('../../contexts/PlatformSettingsContext', () => ({
  usePlatformSettings: () => ({ settings: { featureFlags: {} }, loaded: true, live: true }),
}))

// The dashboard usage widget reads usage + the purchased K25 top-up balance.
// We mock the hook so each test drives an exact state without Firebase.
const usageState = { loading: false, data: null }

// Fully mock the hook (no importActual — that would pull in firebase/config,
// which needs env the jsdom run doesn't have). The component also imports the
// static TOOL_TO_FEATURE + FEATURE_LABELS maps from here, so re-export them.
vi.mock('../../hooks/useTeacherUsage', () => ({
  useTeacherUsage: () => usageState,
  TOOL_TO_FEATURE: {
    lesson_plan: 'plans',
    worksheet: 'worksheets',
    flashcards: 'flashcards',
    notes: 'notes',
    homework: 'homework',
    rubric: 'rubric',
    scheme_of_work: 'schemes',
    assessment: 'assessments',
    exam_paper: 'exams',
    sba_task: 'sba',
  },
  FEATURE_LABELS: {
    plans: 'lesson plans',
    worksheets: 'worksheets',
    flashcards: 'flashcards',
    notes: 'teacher notes',
    homework: 'homework',
    rubric: 'rubrics',
    assessments: 'test papers',
    exams: 'exam papers',
    schemes: 'schemes of work',
    sba: 'SBA tasks',
  },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'test-uid' } }),
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../utils/proFonts', () => ({ ensureProFonts: vi.fn() }))
// utils/lenco pulls in firebase/config; stub the one function the widget uses.
vi.mock('../../utils/lenco', () => ({ recoverMyPendingPayments: vi.fn() }))

// A teacher who has hit their exam-paper cap (1 of 1) on the Free plan.
function cappedData(overrides = {}) {
  return {
    plan: 'free',
    planLabel: 'Free',
    used: { exams: 1 },
    caps: { exams: 1 },
    credits: 0,
    daily: 2,
    today: 0,
    resetDays: 5,
    ...overrides,
  }
}

describe('UsageMeter — K25 top-up credit acknowledgement', () => {
  beforeEach(() => {
    usageState.loading = false
    usageState.data = null
  })

  it('shows the Pay K25 banner when capped and holding no credit', () => {
    usageState.data = cappedData({ credits: 0 })
    render(<UsageMeter />)
    expect(screen.getByText(/hit your exam papers limit/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Pay K25/i })).toBeInTheDocument()
  })

  it('acknowledges a purchased credit and hides the Pay K25 nag', () => {
    // After a successful K25 payment the credit lands on the profile and
    // reaches this widget live. The teacher must SEE it (and be told to press
    // Generate in a studio), not the unchanged "Pay K25" banner — otherwise it
    // looks like the payment did nothing.
    usageState.data = cappedData({ credits: 1 })
    render(<UsageMeter />)
    expect(screen.getByText(/1 extra generation ready/i)).toBeInTheDocument()
    // Deep-links straight to the capped studio so the teacher isn't stranded
    // on the dashboard after paying.
    expect(screen.getByRole('button', { name: /Open exam papers/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pay K25/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/hit your exam papers limit/i)).not.toBeInTheDocument()
  })

  it('pluralises the credit count', () => {
    usageState.data = cappedData({ credits: 3 })
    render(<UsageMeter />)
    expect(screen.getByText(/3 extra generations ready/i)).toBeInTheDocument()
  })

  it('offers on-demand recovery when capped, and reports a restored payment', async () => {
    recoverMyPendingPayments.mockResolvedValueOnce({ recovered: 1, stillPending: 0 })
    usageState.data = cappedData({ credits: 0 })
    render(<UsageMeter />)
    const btn = screen.getByRole('button', { name: /Already paid\? Restore my credit/i })
    fireEvent.click(btn)
    await waitFor(() =>
      expect(screen.getByText(/your credit has been restored/i)).toBeInTheDocument()
    )
    expect(recoverMyPendingPayments).toHaveBeenCalledTimes(1)
  })

  it('tells the teacher when no pending payment is found', async () => {
    recoverMyPendingPayments.mockResolvedValueOnce({ recovered: 0, stillPending: 0 })
    usageState.data = cappedData({ credits: 0 })
    render(<UsageMeter />)
    fireEvent.click(screen.getByRole('button', { name: /Already paid\?/i }))
    await waitFor(() =>
      expect(screen.getByText(/No pending payment found/i)).toBeInTheDocument()
    )
  })
})
