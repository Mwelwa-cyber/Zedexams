import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StudioCurriculumSelector from './StudioCurriculumSelector.jsx'

// Mock the four syllabi-backed hooks so the cascade is deterministic and we
// avoid the firebase/fetch chain in jsdom. They mirror the real hooks' return
// shapes; the component's own reset/emit glue is what's under test.
vi.mock('../studio/hooks/useAvailableGrades.js', () => ({
  useAvailableGrades: () => ({ available: null, loading: false }),
}))
vi.mock('../studio/hooks/useSubjectsForGrade.js', () => ({
  useSubjectsForGrade: (grade) => ({
    subjects: grade ? ['Mathematics Syllabus (Grades 4-6)'] : [],
    loading: false,
    error: null,
  }),
}))
vi.mock('../studio/hooks/useSubjectTopics.js', () => ({
  useSubjectTopics: (subject) => ({
    topics: subject ? [{ label: 'Fractions', subtopics: ['Adding Fractions'] }] : [],
    loading: false,
    error: null,
  }),
}))
vi.mock('../studio/hooks/useSubtopicDetail.js', () => ({
  useSubtopicDetail: () => ({ subtopicRow: null, loading: false, error: null }),
}))

const lastPayload = (onChange) => onChange.mock.calls.at(-1)[0]

describe('StudioCurriculumSelector — curriculum-type picker', () => {
  it('renders the CBC and Previous curriculum cards', () => {
    render(<StudioCurriculumSelector onChange={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /Competency-Based Curriculum/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Previous Curriculum/i })).toBeInTheDocument()
  })
})

describe('StudioCurriculumSelector — cascade gating', () => {
  it('disables grade until a curriculum is chosen, then enables it', () => {
    render(<StudioCurriculumSelector onChange={vi.fn()} />)
    const grade = screen.getByRole('combobox', { name: /class \/ grade/i })
    expect(grade).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: /Competency-Based Curriculum/i }))
    expect(screen.getByRole('combobox', { name: /class \/ grade/i })).not.toBeDisabled()
  })

  it('keeps subject disabled until a grade is chosen', () => {
    render(<StudioCurriculumSelector onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('radio', { name: /Competency-Based Curriculum/i }))
    expect(screen.getByRole('combobox', { name: /subject/i })).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox', { name: /class \/ grade/i }), {
      target: { value: 'Grade 4' },
    })
    expect(screen.getByRole('combobox', { name: /subject/i })).not.toBeDisabled()
  })
})

describe('StudioCurriculumSelector — emitted payload', () => {
  it('emits server-ready grade/subject/framework as the cascade fills in', () => {
    const onChange = vi.fn()
    render(<StudioCurriculumSelector onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: /Competency-Based Curriculum/i }))
    fireEvent.change(screen.getByRole('combobox', { name: /class \/ grade/i }), {
      target: { value: 'Grade 4' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: /subject/i }), {
      target: { value: 'Mathematics Syllabus (Grades 4-6)' },
    })
    const p = lastPayload(onChange)
    expect(p.curriculum).toBe('cbc')
    expect(p.framework).toBe('2023')
    expect(p.grade).toBe('G4')
    expect(p.subject).toBe('mathematics')
    expect(p.subjectLabel).toBe('Mathematics')
    expect(p.subjectKey).toBe('Mathematics Syllabus (Grades 4-6)')
  })

  it('emits the Previous framework when the Previous card is chosen', () => {
    const onChange = vi.fn()
    render(<StudioCurriculumSelector onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: /Previous Curriculum/i }))
    expect(lastPayload(onChange).framework).toBe('2013')
    expect(lastPayload(onChange).curriculum).toBe('previous')
  })
})

describe('StudioCurriculumSelector — reset on curriculum change', () => {
  it('clears grade + subject when the curriculum is switched', () => {
    const onChange = vi.fn()
    render(<StudioCurriculumSelector onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: /Competency-Based Curriculum/i }))
    fireEvent.change(screen.getByRole('combobox', { name: /class \/ grade/i }), {
      target: { value: 'Grade 4' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: /subject/i }), {
      target: { value: 'Mathematics Syllabus (Grades 4-6)' },
    })
    expect(lastPayload(onChange).subject).toBe('mathematics')
    // Switch curriculum → everything below resets.
    fireEvent.click(screen.getByRole('radio', { name: /Previous Curriculum/i }))
    const p = lastPayload(onChange)
    expect(p.gradeLabel).toBe('')
    expect(p.subjectKey).toBe('')
    expect(p.grade).toBe('')
    expect(p.subject).toBe('')
    expect(p.curriculum).toBe('previous')
    expect(screen.getByRole('combobox', { name: /class \/ grade/i })).toHaveValue('')
  })
})

describe('StudioCurriculumSelector — showTopicSubtopic', () => {
  it('hides the topic + subtopic selects when showTopicSubtopic is false', () => {
    render(<StudioCurriculumSelector onChange={vi.fn()} showTopicSubtopic={false} />)
    fireEvent.click(screen.getByRole('radio', { name: /Competency-Based Curriculum/i }))
    expect(screen.queryByRole('combobox', { name: /^topic$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /subtopic/i })).not.toBeInTheDocument()
    // grade + subject remain.
    expect(screen.getByRole('combobox', { name: /class \/ grade/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /subject/i })).toBeInTheDocument()
  })

  it('shows topic + subtopic by default', () => {
    render(<StudioCurriculumSelector onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('radio', { name: /Competency-Based Curriculum/i }))
    expect(screen.getByRole('combobox', { name: /^topic$/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /subtopic/i })).toBeInTheDocument()
  })
})
