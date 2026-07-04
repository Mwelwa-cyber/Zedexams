import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import LiveLessonPlanPreview from './LiveLessonPlanPreview'

// A realistic render meta + a small finished plan.
const META = {
  school: 'Twalumba Primary',
  teacherName: 'Mr. Banda',
  grade: 'Grade 5',
  subject: 'Science',
  topic: 'Living Things',
  subtopic: 'Plants',
  date: '2026-07-04',
  duration: 40,
}
const PLAN = {
  lessonGoal: 'Name the parts of a plant',
  specificCompetence: 'Identify parts of a plant',
  stages: [
    { name: 'INTRODUCTION', teacher: 'Show a plant', pupils: 'Observe', assessment: 'Q&A' },
    { name: 'CONCLUSION', teacher: 'Summarise', pupils: 'Recap', assessment: 'Exit' },
  ],
}

describe('LiveLessonPlanPreview — generating phase', () => {
  it('renders the document header from the form immediately (no spinner)', () => {
    render(<LiveLessonPlanPreview meta={META} curriculumMode="cbc" planJson={null} />)
    const root = screen.getByTestId('live-lesson-preview')
    expect(root).toHaveAttribute('data-phase', 'generating')
    // The real lesson-plan document is on screen with the school name typed in.
    expect(screen.getByText('Twalumba Primary')).toBeInTheDocument()
  })

  it('shows a live "writing" status, not a bare loading message', () => {
    render(<LiveLessonPlanPreview meta={META} curriculumMode="cbc" planJson={null} />)
    expect(screen.getByText(/writing your lesson plan/i)).toBeInTheDocument()
  })

  it('renders a Stop control wired to onStop', () => {
    const onStop = vi.fn()
    render(<LiveLessonPlanPreview meta={META} curriculumMode="cbc" planJson={null} onStop={onStop} />)
    act(() => { screen.getByRole('button', { name: /stop/i }).click() })
    expect(onStop).toHaveBeenCalledTimes(1)
  })
})

describe('LiveLessonPlanPreview — revealing phase', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('reveals the body and eventually calls onComplete', async () => {
    const onComplete = vi.fn()
    render(
      <LiveLessonPlanPreview
        meta={META}
        curriculumMode="cbc"
        planJson={PLAN}
        onComplete={onComplete}
        bodyStepMs={10}
      />,
    )
    expect(screen.getByTestId('live-lesson-preview')).toHaveAttribute('data-phase', 'revealing')
    // Drive the reveal in small steps so React 18 flushes the effect-scheduled
    // state update (and re-arms the next tick) between each fake-timer advance.
    for (let i = 0; i < 40 && onComplete.mock.calls.length === 0; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    }
    expect(onComplete).toHaveBeenCalledTimes(1)
    // The finished frame shows real revealed content.
    expect(screen.getByText(/name the parts of a plant/i)).toBeInTheDocument()
  })
})

describe('LiveLessonPlanPreview — reduced motion', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((q) => ({
      matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }))
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    delete window.matchMedia
  })

  it('jumps straight to the finished plan and completes', async () => {
    const onComplete = vi.fn()
    render(<LiveLessonPlanPreview meta={META} curriculumMode="cbc" planJson={PLAN} onComplete={onComplete} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/identify parts of a plant/i)).toBeInTheDocument()
  })
})
