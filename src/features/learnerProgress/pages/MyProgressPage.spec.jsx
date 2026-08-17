/**
 * My Progress + Study Plan. The rules are unit-tested under plain node
 * (scripts/test-progress-core.mjs); what needs a DOM is the promise these
 * screens make — that every number on them is one the app actually
 * records, and that a learner with no data yet is told so rather than
 * shown a confident zero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))

let mockDash
vi.mock('../../learnerHome', async () => {
  const actual = await vi.importActual('../../learnerHome/components/LearnerPrimitives')
  const icon = await vi.importActual('../../learnerHome/components/LearnerIcon')
  return {
    useLearnerDashboard: () => mockDash,
    LearnerIcon: icon.default,
    subjectIconName: icon.subjectIconName,
    EmptyState: actual.EmptyState,
    ErrorState: actual.ErrorState,
    SectionSkeleton: actual.SectionSkeleton,
  }
})

import MyProgressPage from './MyProgressPage'
import StudyPlanPage from './StudyPlanPage'

const HOUR = 60 * 60 * 1000

function mount(ui, at) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/progress" element={ui} />
        <Route path="/study-plan" element={<StudyPlanPage />} />
        {/* The practise course map (/practise/:grade/:subjectId) was retired;
            Practise now goes to the quiz library. */}
        <Route path="/quizzes" element={<div>QUIZZES ROUTE</div>} />
        <Route path="/papers" element={<div>PAPERS ROUTE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const base = {
  activeTerm: { term: 2 },
  subjects: [
    { id: 'science', label: 'Integrated Science', percent: 62, started: true },
    { id: 'english', label: 'English', percent: 48, started: true },
  ],
  weakTopics: [
    { subject: 'english', subjectLabel: 'English', topic: 'Spelling', correct: 6, total: 10, percent: 60 },
    { subject: 'mathematics', subjectLabel: 'Mathematics', topic: 'Fractions', correct: 2, total: 10, percent: 20 },
  ],
  recentActivity: [
    { type: 'quiz_completed', completedAt: Date.now() - 2 * HOUR },
    { type: 'quiz_completed', completedAt: Date.now() - 3 * HOUR },
  ],
  streak: 12,
  learningResume: { id: 'n1', title: 'Conjunctions' },
}

beforeEach(() => {
  mockDash = { loading: false, error: null, data: base, grade: '7', timetables: { active: null }, refresh: vi.fn() }
})

describe('MyProgressPage', () => {
  it('shows readiness as the mean of the subject rows beneath it', () => {
    mount(<MyProgressPage />, '/progress')
    // (62 + 48) / 2
    expect(screen.getByText('55%')).toBeInTheDocument()
  })

  it('never claims minutes, because the app records no time', () => {
    // The prototype says "3h 20m this week" and captions the chart
    // "Minutes learned each day". There is no session timer anywhere in
    // this app, so both would be invented numbers shown to a child.
    mount(<MyProgressPage />, '/progress')
    expect(screen.queryByText(/\d+\s*h\s*\d+\s*m/i)).toBeNull()
    expect(screen.queryByText(/minutes/i)).toBeNull()
    expect(screen.getByText(/finished each day/i)).toBeInTheDocument()
  })

  it('reports the streak and what was actually finished this week', () => {
    mount(<MyProgressPage />, '/progress')
    expect(screen.getByText(/12-day streak/)).toBeInTheDocument()
    expect(screen.getByText(/2 finished this week/)).toBeInTheDocument()
  })

  it('says so instead of printing 0% when nothing has been started', () => {
    mockDash.data = { ...base, subjects: [], weakTopics: [], recentActivity: [] }
    mount(<MyProgressPage />, '/progress')
    expect(screen.queryByText('0%')).toBeNull()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText(/fills in as you go/i)).toBeInTheDocument()
  })

  it('offers the plan button when there is something to practise', () => {
    mount(<MyProgressPage />, '/progress')
    expect(screen.getByRole('button', { name: /Practise these/ })).toBeInTheDocument()
  })

  it('withholds the plan button when there is not', () => {
    // A plan button that opens an empty plan is a dead end.
    mockDash.data = { ...base, weakTopics: [] }
    mount(<MyProgressPage />, '/progress')
    expect(screen.queryByRole('button', { name: /Practise these/ })).toBeNull()
    expect(screen.getByText(/Nothing flagged yet/)).toBeInTheDocument()
  })
})

describe('StudyPlanPage', () => {
  it('lists weak topics worst-first and sends Practise to the quiz library', () => {
    mount(<StudyPlanPage />, '/study-plan')
    const cards = screen.getAllByRole('listitem').filter((li) => li.className.includes('lhx-sp-topic'))
    expect(within(cards[0]).getByText('Fractions')).toBeInTheDocument()
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'Practise' }))
    // Was the retired /practise/:grade/:subjectId course map.
    expect(screen.getByText('QUIZZES ROUTE')).toBeInTheDocument()
  })

  it('says what was counted, never a judgement', () => {
    mount(<StudyPlanPage />, '/study-plan')
    expect(screen.getByText('Mathematics · missed 8 recently')).toBeInTheDocument()
    expect(screen.queryByText(/needs work/i)).toBeNull()
  })

  it('ticks today’s checklist from recorded activity, not from a stored plan', () => {
    mount(<StudyPlanPage />, '/study-plan')
    // A quiz was completed today; no note and no paper were.
    const done = document.querySelectorAll('.lhx-sp-check.is-done')
    expect(done).toHaveLength(1)
    expect(done[0].textContent).toMatch(/Practise: Fractions/)
  })

  it('hides the countdown when no timetable is published', () => {
    mount(<StudyPlanPage />, '/study-plan')
    expect(screen.queryByText(/to go/)).toBeNull()
  })

  it('shows an honest empty plan rather than invented homework', () => {
    mockDash.data = { ...base, weakTopics: [], recentActivity: [] }
    mount(<StudyPlanPage />, '/study-plan')
    expect(screen.getByText(/Nothing to focus on yet/)).toBeInTheDocument()
  })
})
