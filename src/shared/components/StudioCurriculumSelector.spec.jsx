import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StudioCurriculumSelector from './StudioCurriculumSelector.jsx'

// Mock the four syllabi-backed hooks so the cascade is deterministic and we
// avoid the firebase/fetch chain in jsdom. They mirror the real hooks' return
// shapes; the component's own reset/emit glue is what's under test.
vi.mock('../hooks/useAvailableGrades.js', () => ({
  useAvailableGrades: () => ({ available: null, loading: false }),
}))
vi.mock('../hooks/useSubjectsForGrade.js', () => ({
  // Subjects exist only for Grade 4 — other grades (e.g. a host-supplied
  // "Baby Class") resolve to an empty list, exercising the fallback path.
  useSubjectsForGrade: (grade) => ({
    subjects: grade === 'Grade 4' ? ['Mathematics Syllabus (Grades 4-6)'] : [],
    loading: false,
    error: null,
  }),
}))
vi.mock('../hooks/useSubjectTopics.js', () => ({
  useSubjectTopics: (subject) => ({
    topics: subject ? [{ label: 'Fractions', subtopics: ['Adding Fractions'] }] : [],
    loading: false,
    error: null,
  }),
}))
vi.mock('../hooks/useSubtopicDetail.js', () => ({
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

describe('StudioCurriculumSelector — configured-empty subject state', () => {
  it('shows the no-subjects message with admin diagnostics instead of a generic list', () => {
    render(<StudioCurriculumSelector onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('radio', { name: /Competency-Based Curriculum/i }))
    // The mock catalog carries subjects only for Grade 4 — Grade 1 is empty.
    fireEvent.change(screen.getByRole('combobox', { name: /class \/ grade/i }), {
      target: { value: 'Grade 1' },
    })
    expect(screen.getByText(/No subjects have been configured for this curriculum and grade/i)).toBeInTheDocument()
    expect(screen.getByText(/curriculum “cbc”, grade “Grade 1”/i)).toBeInTheDocument()
  })

  it('renders custom field labels when the host overrides them', () => {
    render(<StudioCurriculumSelector onChange={vi.fn()} gradeFieldLabel="Grade or Form" />)
    expect(screen.getByRole('combobox', { name: /grade or form/i })).toBeInTheDocument()
  })
})

describe('StudioCurriculumSelector — seeding (deep links / edited records)', () => {
  it('normalizes a legacy KB-shaped seed and defaults the curriculum to CBC', () => {
    const onChange = vi.fn()
    render(
      <StudioCurriculumSelector
        onChange={onChange}
        value={{ grade: 'G4', subject: 'mathematics', topic: 'Fractions' }}
      />,
    )
    const p = lastPayload(onChange)
    expect(p.curriculumMode).toBe('cbc')
    expect(p.gradeLabel).toBe('Grade 4')
    // The slug seed resolves to the matching syllabi key once subjects load.
    expect(p.subjectKey).toBe('Mathematics Syllabus (Grades 4-6)')
    expect(p.subject).toBe('mathematics')
    expect(p.topic).toBe('Fractions')
  })

  it('keeps a seeded raw syllabi subject key as-is', () => {
    const onChange = vi.fn()
    render(
      <StudioCurriculumSelector
        onChange={onChange}
        value={{
          curriculumMode: 'cbc',
          gradeLabel: 'Grade 4',
          subjectKey: 'Mathematics Syllabus (Grades 4-6)',
        }}
      />,
    )
    expect(lastPayload(onChange).subjectKey).toBe('Mathematics Syllabus (Grades 4-6)')
  })
})

describe('StudioCurriculumSelector — gradeOptions override + subjectFallback', () => {
  it('offers the host grade list verbatim and does not clear off-list grades', () => {
    const onChange = vi.fn()
    render(
      <StudioCurriculumSelector
        onChange={onChange}
        value={{ curriculumMode: 'cbc', gradeLabel: 'Baby Class' }}
        gradeOptions={[
          { group: 'ECE', value: 'Baby Class', label: 'Baby Class' },
          { group: 'Primary', value: 'Grade 9', label: 'Grade 9' },
        ]}
      />,
    )
    const grade = screen.getByRole('combobox', { name: /class \/ grade/i })
    expect(grade).toHaveValue('Baby Class')
    expect(screen.getByRole('option', { name: 'Grade 9' })).toBeInTheDocument()
    expect(lastPayload(onChange).gradeLabel).toBe('Baby Class')
  })

  it('falls back to host subjects when the syllabi have none for the grade', () => {
    const onChange = vi.fn()
    render(
      <StudioCurriculumSelector
        onChange={onChange}
        value={{ curriculumMode: 'cbc', gradeLabel: 'Baby Class' }}
        gradeOptions={[{ group: 'ECE', value: 'Baby Class', label: 'Baby Class' }]}
        subjectFallback={['Mathematics', 'English']}
      />,
    )
    // The mock resolves no syllabi subjects for "Baby Class", so the host's
    // fallback subjects are offered and selectable.
    fireEvent.change(screen.getByRole('combobox', { name: /subject/i }), {
      target: { value: 'Mathematics' },
    })
    const p = lastPayload(onChange)
    expect(p.subjectKey).toBe('Mathematics')
    expect(p.subjectLabel).toBe('Mathematics')
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
