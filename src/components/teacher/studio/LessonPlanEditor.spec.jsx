import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// Mock the client wrapper so the editor never touches firebase/config and we
// can assert exactly what it asks the AI to do.
const { mockRevise } = vi.hoisted(() => ({ mockRevise: vi.fn() }))
vi.mock('../../../utils/reviseLessonSection', () => ({
  reviseLessonSection: mockRevise,
  messageFromReviseError: (e) => e?.message || 'failed',
}))
// The AI edit now routes through useAiOperationLock. Mock it to a deterministic
// passthrough (runs the action with a fixed key, returns {ok,data}) so these
// tests stay about the editor, not the module-level lock's cross-test state.
// mockRevise still receives the payload (+ the fixed idempotencyKey).
vi.mock('../../../hooks/useAiOperationLock', () => ({
  useAiOperationLock: () => ({
    run: async ({ action }) => {
      try {
        return { ok: true, data: await action('11111111-1111-4111-8111-111111111111') }
      } catch (error) {
        return { ok: false, reason: 'error', error }
      }
    },
    isRunning: false,
    otherTabRunning: false,
    clear: () => {},
  }),
}))

import LessonPlanEditor from './LessonPlanEditor'

function samplePlan() {
  return {
    generalCompetences: ['Communication', 'Critical Thinking'],
    specificCompetence: '4.3.1 Manage resources',
    lessonGoal: 'Identify the parts of a plant.',
    rationale: 'This lesson matters because...',
    references: ['Syllabus p. 12'],
    learningEnvironment: { natural: 'garden', artificial: 'classroom', technological: 'tablet' },
    materials: ['chart', 'real leaves'],
    stages: [
      {
        name: 'INTRODUCTION',
        durationMinutes: 5,
        teacherActivities: ['Ask learners about plants'],
        learnerActivities: ['Share what they know'],
        assessmentCriteria: ['Names one plant'],
      },
    ],
    remedialWork: 'Revisit with simpler examples.',
  }
}

describe('LessonPlanEditor — manual editing', () => {
  beforeEach(() => mockRevise.mockReset())

  it('renders the plan body fields and stage editor', () => {
    render(<LessonPlanEditor planJson={samplePlan()} curriculumMode="cbc" context={{}} onChange={() => {}} />)
    expect(screen.getByDisplayValue('Identify the parts of a plant.')).toBeInTheDocument()
    expect(screen.getByDisplayValue('INTRODUCTION')).toBeInTheDocument()
    expect(screen.getByText('Lesson Progression')).toBeInTheDocument()
    // Learner column label follows CBC terminology.
    expect(screen.getByText("Learners' Activities")).toBeInTheDocument()
  })

  it('uses "Pupils" terminology for the previous curriculum', () => {
    render(<LessonPlanEditor planJson={samplePlan()} curriculumMode="previous" context={{}} onChange={() => {}} />)
    expect(screen.getByText("Pupils' Activities")).toBeInTheDocument()
  })

  it('propagates a manual prose edit through onChange', () => {
    const onChange = vi.fn()
    render(<LessonPlanEditor planJson={samplePlan()} curriculumMode="cbc" context={{}} onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('Identify the parts of a plant.'), {
      target: { value: 'Describe the parts of a plant.' },
    })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ lessonGoal: 'Describe the parts of a plant.' }))
  })

  it('omits fields the plan does not contain', () => {
    const plan = { lessonGoal: 'Goal only', stages: [] }
    render(<LessonPlanEditor planJson={plan} curriculumMode="cbc" context={{}} onChange={() => {}} />)
    expect(screen.queryByText('Rationale')).not.toBeInTheDocument()
    // Lesson Goal is a core field, always shown.
    expect(screen.getByDisplayValue('Goal only')).toBeInTheDocument()
  })

  it('writes both stage field families when a stage activity changes', () => {
    const onChange = vi.fn()
    render(<LessonPlanEditor planJson={samplePlan()} curriculumMode="cbc" context={{}} onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('Ask learners about plants'), {
      target: { value: 'Ask learners to name plants' },
    })
    const next = onChange.mock.calls.at(-1)[0]
    const stage = next.stages[0]
    expect(stage.teacherActivities).toEqual(['Ask learners to name plants'])
    // String mirror kept in sync for the preview renderer.
    expect(stage.teacher).toBe('Ask learners to name plants')
  })
})

describe('LessonPlanEditor — AI editing', () => {
  beforeEach(() => mockRevise.mockReset())

  it('calls reviseLessonSection with the section + modifier and applies returned text', async () => {
    mockRevise.mockResolvedValue({ text: 'Polished goal.' })
    const onChange = vi.fn()
    render(<LessonPlanEditor planJson={{ lessonGoal: 'rough goal', stages: [] }}
      curriculumMode="cbc" context={{ grade: 'Grade 4' }} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /edit with ai/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Polish' }))

    await waitFor(() => expect(mockRevise).toHaveBeenCalledTimes(1))
    expect(mockRevise).toHaveBeenCalledWith(expect.objectContaining({
      sectionLabel: 'Lesson Goal',
      kind: 'text',
      curriculumMode: 'cbc',
      modifier: 'polish',
      current: 'rough goal',
    }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ lessonGoal: 'Polished goal.' })))
  })

  it('applies an AI list rewrite to a stage activity list', async () => {
    mockRevise.mockResolvedValue({ items: ['Ask a hook question', 'Show a picture'] })
    const onChange = vi.fn()
    render(<LessonPlanEditor planJson={samplePlan()} curriculumMode="cbc" context={{}} onChange={onChange} />)

    // Open AI on the first list (General Competences) and rewrite it.
    const aiButtons = screen.getAllByRole('button', { name: /edit with ai/i })
    fireEvent.click(aiButtons[0])
    // The just-opened panel is the only one with quick-action chips visible.
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }))

    await waitFor(() => expect(mockRevise).toHaveBeenCalledTimes(1))
    expect(mockRevise.mock.calls[0][0]).toEqual(expect.objectContaining({ kind: 'list', modifier: 'rewrite' }))
    await waitFor(() => {
      const next = onChange.mock.calls.at(-1)[0]
      expect(next.generalCompetences).toEqual(['Ask a hook question', 'Show a picture'])
    })
  })

  it('shows a message and does not call onChange when the AI returns nothing', async () => {
    mockRevise.mockResolvedValue({ text: '' })
    const onChange = vi.fn()
    render(<LessonPlanEditor planJson={{ lessonGoal: 'g', stages: [] }} curriculumMode="cbc" context={{}} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /edit with ai/i }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }))
    })
    await waitFor(() => expect(screen.getByText(/returned nothing/i)).toBeInTheDocument())
    expect(onChange).not.toHaveBeenCalled()
  })
})
