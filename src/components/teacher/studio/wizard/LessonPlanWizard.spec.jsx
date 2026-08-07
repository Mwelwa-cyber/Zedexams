import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { useStudioState } from '../hooks/useStudioState'
import { LessonPlanWizard } from './LessonPlanWizard'

// ── Data-hook mocks ───────────────────────────────────────────────────────────
// The reused section forms fetch the syllabus catalogue through these hooks;
// mock them with a tiny two-grade catalogue so the wizard spec can exercise
// REAL dependent-field behaviour (grade → subject → topic → subtopic).

// All mocked hook results are module-level constants so every render sees the
// SAME references — the real hooks keep results in useState, and fresh objects
// per render would re-fire consumer effects forever.
const GRADES = { available: ['Grade 3', 'Grade 4'], loading: false }
vi.mock('../hooks/useAvailableGrades.js', () => ({
  useAvailableGrades: vi.fn(() => GRADES),
}))

const SUBJECTS_G3 = { subjects: ['Grade3 Math'], loading: false }
const SUBJECTS_G4 = { subjects: ['Grade4 Math'], loading: false }
const SUBJECTS_NONE = { subjects: [], loading: false }
vi.mock('../hooks/useSubjectsForGrade.js', () => ({
  useSubjectsForGrade: vi.fn((grade) =>
    grade === 'Grade 3' ? SUBJECTS_G3 : grade === 'Grade 4' ? SUBJECTS_G4 : SUBJECTS_NONE),
}))

const TOPICS_G4 = {
  topics: [{ label: '4.1 Numbers', subtopics: ['4.1.1 Counting', '4.1.2 Place Value'] }],
  loading: false,
  error: null,
}
const TOPICS_G3 = {
  topics: [{ label: '3.1 Shapes', subtopics: ['3.1.1 Circles'] }],
  loading: false,
  error: null,
}
const TOPICS_NONE = { topics: [], loading: false, error: null }
vi.mock('../hooks/useSubjectTopics.js', () => ({
  useSubjectTopics: vi.fn((subject) =>
    subject === 'Grade4 Math' ? TOPICS_G4 : subject === 'Grade3 Math' ? TOPICS_G3 : TOPICS_NONE),
}))

// IMPORTANT: the row object must be referentially stable across renders (the
// real hook keeps it in useState) — a fresh object per call would re-trigger
// the onSubtopicRowLoaded effect forever.
const STABLE_ROW = {
  specificCompetence: 'Count objects up to 1000',
  learningActivities: ['Counting games', 'Number lines'],
  expectedStandard: 'Counts accurately to 1000',
}
vi.mock('../hooks/useSubtopicDetail.js', () => ({
  useSubtopicDetail: vi.fn((subject, grade, topic, subtopic) => ({
    subtopicRow: topic && subtopic ? STABLE_ROW : null,
  })),
}))

// The format preview renders a full sample document — irrelevant here.
vi.mock('../modals/FormatPreviewModal', () => ({
  FormatPreviewModal: () => null,
}))

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }) => <a href={to}>{children}</a>,
}))

// ── Harness — REAL useStudioState drives the wizard ───────────────────────────

let studioStateRef = null

function Harness({ onGenerate = vi.fn(), isValid = true, extra = {} }) {
  const studioState = useStudioState()
  studioStateRef = studioState
  return (
    <LessonPlanWizard
      studioState={studioState}
      aiState={{ recommendation: null, loading: false, error: null, fetchRecommendation: vi.fn() }}
      seriesState={{ completedCount: 0, completedLessons: [], seriesLoading: false }}
      onGenerate={onGenerate}
      onContinue={vi.fn()}
      onViewCompleted={vi.fn()}
      isValid={isValid}
      onSaveExit={extra.onSaveExit ?? vi.fn()}
      {...extra}
    />
  )
}

function renderWizard(props = {}) {
  return render(<Harness {...props} />)
}

// Fill Lesson Setup completely (CBC / Grade 4 / Grade4 Math / date).
function completeStep1() {
  fireEvent.click(screen.getByRole('radio', { name: /competency-based curriculum/i }))
  fireEvent.change(document.getElementById('ldf-grade'), { target: { value: 'Grade 4' } })
  fireEvent.change(document.getElementById('ldf-subject'), { target: { value: 'Grade4 Math' } })
  fireEvent.change(document.getElementById('ldf-date'), { target: { value: '2026-07-24' } })
}

function next() {
  fireEvent.click(screen.getByRole('button', { name: /^next/i }))
}

function completeStep2() {
  fireEvent.change(document.getElementById('tsf-topic'), { target: { value: '4.1 Numbers' } })
  fireEvent.change(document.getElementById('tsf-subtopic'), { target: { value: '4.1.1 Counting' } })
}

function completeStep3() {
  fireEvent.click(screen.getByRole('button', { name: /natural environment/i }))
}

// Walk the whole wizard to the Review step.
function walkToReview() {
  completeStep1(); next()
  completeStep2(); next()
  completeStep3(); next()
  next() // Format & Options is valid by default
}

beforeEach(() => {
  studioStateRef = null
  // jsdom's scrollTo is a noisy "not implemented" stub — the wizard scrolls to
  // the top of each new step, which is irrelevant here.
  window.scrollTo = vi.fn()
})

// ── Structure ─────────────────────────────────────────────────────────────────

describe('LessonPlanWizard — one step at a time', () => {
  it('starts on Step 1 of 5: Lesson Setup', () => {
    renderWizard()
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Lesson Setup' })).toBeInTheDocument()
  })

  it('renders ONLY the active step content (no topic picker or format cards on step 1)', () => {
    renderWizard()
    expect(document.getElementById('tsf-topic')).toBeNull()
    expect(screen.queryByText('Lesson Plan Detail')).not.toBeInTheDocument()
    expect(screen.queryByText(/learning environment/i)).not.toBeInTheDocument()
  })

  it('never shows a Generate button before the Review step', () => {
    renderWizard()
    expect(screen.queryByRole('button', { name: /generate lesson plan/i })).not.toBeInTheDocument()
    completeStep1(); next()
    expect(screen.queryByRole('button', { name: /generate lesson plan/i })).not.toBeInTheDocument()
  })

  it('shows Save & exit on step 1 and calls onSaveExit', () => {
    const onSaveExit = vi.fn()
    renderWizard({ extra: { onSaveExit } })
    fireEvent.click(screen.getByRole('button', { name: /save & exit/i }))
    expect(onSaveExit).toHaveBeenCalledTimes(1)
  })
})

// ── Step 1 → curriculum collapse ─────────────────────────────────────────────

describe('LessonPlanWizard — curriculum cards collapse after selection', () => {
  it('shows both large curriculum cards before a choice', () => {
    renderWizard()
    expect(screen.getByRole('radio', { name: /competency-based curriculum/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /previous curriculum/i })).toBeInTheDocument()
  })

  it('collapses to a compact row with a Change action once picked', () => {
    renderWizard()
    fireEvent.click(screen.getByRole('radio', { name: /competency-based curriculum/i }))
    expect(screen.queryByRole('radio', { name: /previous curriculum/i })).not.toBeInTheDocument()
    expect(screen.getByText('CBC — Competency-Based Curriculum')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /change curriculum/i })).toBeInTheDocument()
  })

  it('Change re-opens the full picker', () => {
    renderWizard()
    fireEvent.click(screen.getByRole('radio', { name: /competency-based curriculum/i }))
    fireEvent.click(screen.getByRole('button', { name: /change curriculum/i }))
    expect(screen.getByRole('radio', { name: /previous curriculum/i })).toBeInTheDocument()
  })
})

// ── Validation gating ─────────────────────────────────────────────────────────

describe('LessonPlanWizard — per-step validation', () => {
  it('Next is disabled with a reason before the step is complete', () => {
    renderWizard()
    const nextBtn = screen.getByRole('button', { name: /^next/i })
    expect(nextBtn).toBeDisabled()
    expect(screen.getByText('Choose a curriculum to continue.')).toBeInTheDocument()
  })

  it('surfaces the next missing field as the teacher progresses', () => {
    renderWizard()
    fireEvent.click(screen.getByRole('radio', { name: /competency-based curriculum/i }))
    expect(screen.getByText('Select a class to continue.')).toBeInTheDocument()
    fireEvent.change(document.getElementById('ldf-grade'), { target: { value: 'Grade 4' } })
    expect(screen.getByText('Select a subject to continue.')).toBeInTheDocument()
    fireEvent.change(document.getElementById('ldf-subject'), { target: { value: 'Grade4 Math' } })
    expect(screen.getByText('Pick the lesson date to continue.')).toBeInTheDocument()
  })

  it('does not advance while the active step is invalid', () => {
    renderWizard()
    next()
    expect(screen.getByRole('heading', { name: 'Lesson Setup' })).toBeInTheDocument()
  })

  it('advances to Topic & Curriculum once step 1 is valid', () => {
    renderWizard()
    completeStep1()
    next()
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Topic & Curriculum' })).toBeInTheDocument()
  })

  it('subtopic picker stays disabled until a topic is chosen', () => {
    renderWizard()
    completeStep1(); next()
    expect(document.getElementById('tsf-subtopic')).toBeDisabled()
    fireEvent.change(document.getElementById('tsf-topic'), { target: { value: '4.1 Numbers' } })
    expect(document.getElementById('tsf-subtopic')).not.toBeDisabled()
  })

  it('shows the auto-filled curriculum summary once a subtopic is picked', () => {
    renderWizard()
    completeStep1(); next()
    completeStep2()
    expect(screen.getByText('Curriculum Summary')).toBeInTheDocument()
    expect(screen.getByText('Count objects up to 1000')).toBeInTheDocument()
    expect(screen.getByText('Counting games')).toBeInTheDocument()
    expect(screen.getByText('Counts accurately to 1000')).toBeInTheDocument()
  })

  it('step 3 requires a learning environment (CBC)', () => {
    renderWizard()
    completeStep1(); next()
    completeStep2(); next()
    expect(screen.getByRole('heading', { name: 'Lesson Context' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^next/i })).toBeDisabled()
    expect(screen.getByText('Choose at least one learning environment.')).toBeInTheDocument()
    completeStep3()
    expect(screen.getByRole('button', { name: /^next/i })).not.toBeDisabled()
  })

  it('learning environments stay multi-select', () => {
    renderWizard()
    completeStep1(); next()
    completeStep2(); next()
    const natural = screen.getByRole('button', { name: /natural environment/i })
    const tech = screen.getByRole('button', { name: /technological environment/i })
    fireEvent.click(natural)
    fireEvent.click(tech)
    expect(natural).toHaveAttribute('aria-pressed', 'true')
    expect(tech).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(natural)
    expect(natural).toHaveAttribute('aria-pressed', 'false')
    expect(tech).toHaveAttribute('aria-pressed', 'true')
  })
})

// ── Dependent-field clearing across steps ─────────────────────────────────────

describe('LessonPlanWizard — changing class clears incompatible topic', () => {
  it('clears the dependent topic/subtopic synchronously on grade change', () => {
    renderWizard()
    completeStep1(); next()
    completeStep2()
    // Back to setup, switch to Grade 3 — its catalogue has different subjects.
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
    fireEvent.change(document.getElementById('ldf-grade'), { target: { value: 'Grade 3' } })
    // Subject cleared (Grade4 Math is not offered for Grade 3) AND the old
    // topic/subtopic cleared SYNCHRONOUSLY — no stale combination survives
    // even though the topic step is unmounted right now.
    expect(document.getElementById('ldf-subject').value).toBe('')
    expect(studioStateRef.topicData.topic).toBe('')
    expect(studioStateRef.topicData.subtopic).toBe('')
    fireEvent.change(document.getElementById('ldf-subject'), { target: { value: 'Grade3 Math' } })
    next()
    expect(document.getElementById('tsf-topic').value).toBe('')
  })

  it('withdraws the Back to Review shortcut after a setup edit invalidates later steps', () => {
    renderWizard()
    walkToReview()
    // Review → Edit Lesson Setup, then change the class.
    fireEvent.click(screen.getByRole('button', { name: /edit lesson setup/i }))
    expect(screen.getByRole('heading', { name: 'Lesson Setup' })).toBeInTheDocument()
    fireEvent.change(document.getElementById('ldf-grade'), { target: { value: 'Grade 3' } })
    // Topic state was reset, so the fast path back to Review must be gone —
    // the teacher walks forward through the (now invalid) steps instead.
    expect(screen.queryByRole('button', { name: /back to review/i })).not.toBeInTheDocument()
    expect(studioStateRef.topicData.topic).toBe('')
  })
})

// ── Review step ───────────────────────────────────────────────────────────────

describe('LessonPlanWizard — Review & Generate', () => {
  it('reaches Review with a grouped summary of every choice', () => {
    renderWizard()
    walkToReview()
    expect(screen.getByText('Step 5 of 5')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Review & Generate' })).toBeInTheDocument()
    expect(screen.getByText('Grade 4')).toBeInTheDocument()
    expect(screen.getByText('4.1 Numbers')).toBeInTheDocument()
    expect(screen.getByText('4.1.1 Counting')).toBeInTheDocument()
    expect(screen.getByText('Natural')).toBeInTheDocument()
    expect(screen.getByText('Single Lesson')).toBeInTheDocument()
    expect(screen.getByText('Modern Clean')).toBeInTheDocument()
  })

  it('Edit jumps back to the owning step and keeps every value', () => {
    renderWizard()
    walkToReview()
    fireEvent.click(screen.getByRole('button', { name: /edit topic & curriculum/i }))
    expect(screen.getByRole('heading', { name: 'Topic & Curriculum' })).toBeInTheDocument()
    // Values kept
    expect(document.getElementById('tsf-topic').value).toBe('4.1 Numbers')
    expect(document.getElementById('tsf-subtopic').value).toBe('4.1.1 Counting')
    // Fast path back to the summary
    fireEvent.click(screen.getByRole('button', { name: /back to review/i }))
    expect(screen.getByRole('heading', { name: 'Review & Generate' })).toBeInTheDocument()
  })

  it('calls onGenerate exactly once and blocks repeat taps while generating', () => {
    const onGenerate = vi.fn(() => {
      act(() => studioStateRef.setGenerationStatus('loading'))
    })
    renderWizard({ onGenerate })
    walkToReview()
    const btn = screen.getByRole('button', { name: /generate lesson plan/i })
    fireEvent.click(btn)
    expect(onGenerate).toHaveBeenCalledTimes(1)
    // Loading state: label swaps and the button is disabled — a second tap is a no-op.
    const busy = screen.getByRole('button', { name: /generating lesson plan/i })
    expect(busy).toBeDisabled()
    fireEvent.click(busy)
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('navigates to the first invalid step instead of generating when something is missing', () => {
    const onGenerate = vi.fn()
    renderWizard({ onGenerate })
    walkToReview()
    // Invalidate step 3 by removing the environment choice.
    act(() => studioStateRef.setLearningEnvironments([]))
    fireEvent.click(screen.getByRole('button', { name: /generate lesson plan/i }))
    expect(onGenerate).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Lesson Context' })).toBeInTheDocument()
    expect(screen.getAllByText('Choose at least one learning environment.').length).toBeGreaterThan(0)
  })
})

// ── Wizard-step persistence / restore ─────────────────────────────────────────

describe('LessonPlanWizard — step restore', () => {
  it('renders the step held in studioState.wizardStep (draft restore path)', () => {
    renderWizard()
    act(() => studioStateRef.setWizardStep(3))
    expect(screen.getByRole('heading', { name: 'Format & Options' })).toBeInTheDocument()
    expect(screen.getByText('Step 4 of 5')).toBeInTheDocument()
  })

  it('clamps a corrupt restored step instead of blanking the wizard', () => {
    renderWizard()
    act(() => studioStateRef.setWizardStep(99))
    expect(screen.getByRole('heading', { name: 'Review & Generate' })).toBeInTheDocument()
  })
})

// ── Saved-lessons overlay (opened from "My lessons") ─────────────────────────

describe('LessonPlanWizard — My lessons panel', () => {
  it('is closed by default and opens from the header button', () => {
    renderWizard()
    expect(screen.queryByRole('dialog', { name: /your progress/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /my lessons/i }))
    expect(screen.getByRole('dialog', { name: /your progress/i })).toBeInTheDocument()
  })

  it('explains what to do when no class/subject is chosen yet', () => {
    renderWizard()
    fireEvent.click(screen.getByRole('button', { name: /my lessons/i }))
    expect(screen.getByText(/pick a class and subject/i)).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    renderWizard()
    fireEvent.click(screen.getByRole('button', { name: /my lessons/i }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /your progress/i })).not.toBeInTheDocument()
  })
})

// ── Horizontal stepper (StudioStepper) ────────────────────────────────────────

describe('LessonPlanWizard — horizontal stepper', () => {
  const stepper = () => screen.getByRole('navigation', { name: /lesson plan steps/i })

  it('renders one StudioStepper with all five short labels', () => {
    renderWizard()
    const nav = stepper()
    for (const label of ['Setup', 'Topic', 'Context', 'Format', 'Review']) {
      expect(within(nav).getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('marks the active step and disables unreachable steps', () => {
    renderWizard()
    const nav = stepper()
    expect(within(nav).getByRole('button', { name: 'Setup' })).toHaveAttribute('aria-current', 'step')
    expect(within(nav).getByRole('button', { name: 'Review' })).toBeDisabled()
  })

  it('navigates back to a visited step on click', () => {
    renderWizard()
    completeStep1(); next()
    expect(screen.getByRole('heading', { name: 'Topic & Curriculum' })).toBeInTheDocument()
    fireEvent.click(within(stepper()).getByRole('button', { name: 'Setup' }))
    expect(screen.getByRole('heading', { name: 'Lesson Setup' })).toBeInTheDocument()
  })
})

// ── "Set up for you" card (single-source rule) ───────────────────────────────

describe('LessonPlanWizard — Set up for you card', () => {
  const chipLabels = () => [...document.querySelectorAll('.zx-chip')].map((el) => el.textContent)

  it('derives its chips from the LIVE form state, so a changed subject updates the card', () => {
    renderWizard({ extra: { appliedContext: true, appliedWeekNumber: 11 } })
    completeStep1()
    expect(chipLabels()).toEqual(['Week 11', 'Grade 4', 'Grade4 Math', '✓ CBC curriculum'])
    // Change the class in the form — subject clears, then pick the Grade 3 one.
    fireEvent.change(document.getElementById('ldf-grade'), { target: { value: 'Grade 3' } })
    fireEvent.change(document.getElementById('ldf-subject'), { target: { value: 'Grade3 Math' } })
    // The card followed the form: no stale "Grade 4 / Grade4 Math" chips.
    expect(chipLabels()).toEqual(['Week 11', 'Grade 3', 'Grade3 Math', '✓ CBC curriculum'])
  })

  it('does not render when no context was applied', () => {
    renderWizard()
    completeStep1()
    expect(screen.queryByText(/set up for you/i)).not.toBeInTheDocument()
  })

  it('only renders on the setup step', () => {
    renderWizard({ extra: { appliedContext: true, appliedWeekNumber: 11 } })
    completeStep1(); next()
    expect(screen.queryByText(/set up for you/i)).not.toBeInTheDocument()
  })

  it('dismisses via the × button', () => {
    const onDismissPlanContext = vi.fn()
    renderWizard({ extra: { appliedContext: true, onDismissPlanContext } })
    completeStep1()
    fireEvent.click(screen.getByRole('button', { name: /dismiss suggestion/i }))
    expect(onDismissPlanContext).toHaveBeenCalledTimes(1)
  })

  it('Change focuses the Class picker', () => {
    renderWizard({ extra: { appliedContext: true } })
    completeStep1()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(document.activeElement).toBe(document.getElementById('ldf-grade'))
  })
})

// ── Teaching Profile mapping notice ──────────────────────────────────────────

describe('LessonPlanWizard — mapping notice', () => {
  it('renders the amber warning line with the Teaching Profile link on step 1', () => {
    renderWizard({ extra: { mappingNotice: 'Grade "Baby Class" could not be matched.' } })
    expect(screen.getByText(/could not be selected automatically/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /review teaching profile/i })).toHaveAttribute(
      'href',
      '/settings/teaching-profile',
    )
  })
})

// ── Focus management ──────────────────────────────────────────────────────────

describe('LessonPlanWizard — focus moves to the step heading on navigation', () => {
  it('focuses the new step heading after Next', () => {
    renderWizard()
    completeStep1()
    next()
    const heading = screen.getByRole('heading', { name: 'Topic & Curriculum' })
    expect(document.activeElement).toBe(heading)
  })
})
