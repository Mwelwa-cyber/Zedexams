import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SubtopicLessonsPanel } from './SubtopicLessonsPanel.jsx'

function lesson(n, extra = {}) {
  return {
    id: `L${n}`,
    lessonNumber: n,
    title: `Lesson ${n} title`,
    status: 'draft',
    teachingStatus: 'planned',
    ...extra,
  }
}

describe('SubtopicLessonsPanel', () => {
  it('renders nothing until a subtopic is selected', () => {
    const { container } = render(<SubtopicLessonsPanel subtopicName="" lessons={[]} expectedCount={1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows created/expected progress and the subtopic label with code', () => {
    render(
      <SubtopicLessonsPanel
        subtopicName="The External Human Body Parts"
        subtopicCode="O.1.2.1"
        lessons={[lesson(1)]}
        expectedCount={4}
      />,
    )
    // Header badge.
    expect(screen.getByText('1/4')).toBeInTheDocument()
    // Created summary mentions the code + name.
    expect(screen.getByText(/O\.1\.2\.1 The External Human Body Parts/)).toBeInTheDocument()
    expect(screen.getByText(/1 of 4/)).toBeInTheDocument()
  })

  it('renders a Create button for missing lessons and fires onCreateLesson', () => {
    const onCreateLesson = vi.fn()
    render(
      <SubtopicLessonsPanel
        subtopicName="Parts"
        lessons={[lesson(1)]}
        expectedCount={3}
        onCreateLesson={onCreateLesson}
      />,
    )
    const createButtons = screen.getAllByRole('button', { name: 'Create' })
    // Lessons 2 and 3 are missing → two Create buttons.
    expect(createButtons).toHaveLength(2)
    fireEvent.click(createButtons[0])
    expect(onCreateLesson).toHaveBeenCalledWith(2)
  })

  it('shows Edit for a saved (linked) lesson and Continue otherwise', () => {
    render(
      <SubtopicLessonsPanel
        subtopicName="Parts"
        lessons={[lesson(1, { generationId: 'gen-1' }), lesson(2)]}
        expectedCount={2}
      />,
    )
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
  })

  it('fires onSetTeachingStatus when the status dropdown changes', () => {
    const onSetTeachingStatus = vi.fn()
    render(
      <SubtopicLessonsPanel
        subtopicName="Parts"
        lessons={[lesson(1)]}
        expectedCount={1}
        onSetTeachingStatus={onSetTeachingStatus}
      />,
    )
    fireEvent.change(screen.getByLabelText('Teaching status for lesson 1'), {
      target: { value: 'taught' },
    })
    expect(onSetTeachingStatus).toHaveBeenCalledWith('L1', 'taught')
  })

  it('shows the smart recommendation for an empty subtopic', () => {
    render(<SubtopicLessonsPanel subtopicName="Parts" lessons={[]} expectedCount={4} />)
    expect(screen.getByText(/no lesson plan yet/i)).toBeInTheDocument()
  })

  it('reports teaching progress (X of N taught)', () => {
    render(
      <SubtopicLessonsPanel
        subtopicName="Parts"
        lessons={[lesson(1, { teachingStatus: 'taught' }), lesson(2)]}
        expectedCount={2}
      />,
    )
    expect(screen.getByText('1 of 2 lessons taught')).toBeInTheDocument()
  })
})
