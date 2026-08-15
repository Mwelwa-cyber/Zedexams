import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StudioCurriculumSelector from './StudioCurriculumSelector.jsx'

// 2013-mode mocks: the subtopic detail row carries an already-split
// specificOutcomes[] (the canonical parser's output), so the opt-in
// per-outcome dropdown can be exercised end-to-end.
vi.mock('../hooks/useAvailableGrades.js', () => ({
  useAvailableGrades: () => ({ available: null, loading: false }),
}))
vi.mock('../hooks/useSubjectsForGrade.js', () => ({
  useSubjectsForGrade: (grade) => ({
    subjects: grade === 'Grade 5' ? ['Integrated Science Syllabus (Grades 1-7, 2013)'] : [],
    loading: false,
    error: null,
  }),
}))
vi.mock('../hooks/useSubjectTopics.js', () => ({
  useSubjectTopics: (subject) => ({
    topics: subject ? [{ label: '5.2.0 Health', subtopics: ['5.2.3 Malaria'] }] : [],
    loading: false,
    error: null,
  }),
}))
vi.mock('../hooks/useSubtopicDetail.js', () => ({
  useSubtopicDetail: (subject, grade, topic, subtopic) => ({
    subtopicRow: subtopic === '5.2.3 Malaria'
      ? {
          topic: '5.2.0 Health',
          subtopic: '5.2.3 Malaria',
          specificOutcomes: [
            '5.2.3.1 Identify causes of malaria',
            '5.2.3.2 State the symptoms of malaria',
            '5.2.3.3 Describe ways of preventing and treating malaria',
          ],
        }
      : null,
    loading: false,
    error: null,
  }),
}))

const lastPayload = (onChange) => onChange.mock.calls.at(-1)[0]

function drillToSubtopic(onChange) {
  render(<StudioCurriculumSelector onChange={onChange} showSpecificOutcome />)
  fireEvent.click(screen.getByRole('radio', { name: /Previous Curriculum/i }))
  fireEvent.change(screen.getByRole('combobox', { name: /class \/ grade/i }), {
    target: { value: 'Grade 5' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: /subject/i }), {
    target: { value: 'Integrated Science Syllabus (Grades 1-7, 2013)' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: /^topic$/i }), {
    target: { value: '5.2.0 Health' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: /subtopic/i }), {
    target: { value: '5.2.3 Malaria' },
  })
}

describe('StudioCurriculumSelector — independent specific-outcome selection (2013)', () => {
  it('offers each split outcome as its own option', () => {
    drillToSubtopic(vi.fn())
    const outcome = screen.getByRole('combobox', { name: /specific outcome/i })
    expect(outcome).not.toBeDisabled()
    const labels = Array.from(outcome.querySelectorAll('option')).map((o) => o.textContent)
    expect(labels).toContain('5.2.3.1 Identify causes of malaria')
    expect(labels).toContain('5.2.3.2 State the symptoms of malaria')
    expect(labels).toContain('5.2.3.3 Describe ways of preventing and treating malaria')
  })

  it('selecting one outcome emits only that outcome — never its siblings', () => {
    const onChange = vi.fn()
    drillToSubtopic(onChange)
    fireEvent.change(screen.getByRole('combobox', { name: /specific outcome/i }), {
      target: { value: '5.2.3.2 State the symptoms of malaria' },
    })
    const p = lastPayload(onChange)
    expect(p.specificOutcome).toBe('5.2.3.2 State the symptoms of malaria')
    expect(p.specificOutcome).not.toMatch(/5\.2\.3\.1/)
    expect(p.specificOutcome).not.toMatch(/5\.2\.3\.3/)
    // The whole-subtopic row is still available for hosts that want all three.
    expect(p.subtopicRow.specificOutcomes).toHaveLength(3)
  })

  it('changing the subtopic clears a previously chosen outcome', () => {
    const onChange = vi.fn()
    drillToSubtopic(onChange)
    fireEvent.change(screen.getByRole('combobox', { name: /specific outcome/i }), {
      target: { value: '5.2.3.1 Identify causes of malaria' },
    })
    expect(lastPayload(onChange).specificOutcome).toBe('5.2.3.1 Identify causes of malaria')
    fireEvent.change(screen.getByRole('combobox', { name: /subtopic/i }), {
      target: { value: '' },
    })
    expect(lastPayload(onChange).specificOutcome).toBe('')
  })

  it('is hidden by default so existing studios are unchanged', () => {
    render(<StudioCurriculumSelector onChange={vi.fn()} />)
    expect(screen.queryByRole('combobox', { name: /specific outcome/i })).toBeNull()
  })
})
