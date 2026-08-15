import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import AssignmentFormModal from './AssignmentFormModal'

// Mock the syllabi-catalog hooks the embedded StudioCurriculumSelector uses so
// the cascade is deterministic in jsdom (no firebase/fetch). The mock catalog
// deliberately differs per curriculum + grade — that difference IS what's
// under test.
vi.mock('../../../../shared/hooks/useAvailableGrades.js', () => ({
  useAvailableGrades: (candidates) => ({ available: candidates, loading: false }),
}))
vi.mock('../../../../shared/hooks/useSubjectsForGrade.js', () => ({
  useSubjectsForGrade: (grade, mode) => {
    const catalog = {
      'cbc|Grade 4': ['Mathematics Syllabus (Grades 4-6)', 'Home Economics Syllabus (Grades 4-6)'],
      // The Commerce & PoA workbook holds two independently-numbered syllabi, so
      // getSubjectsForGrade offers one entry per subject rather than the
      // combined document (which would mean "one of these two" and could not be
      // saved). The '::' suffix is the same section-scoping the ECE/Lower-Primary
      // strand bundles use.
      'cbc|Form 3': [
        'Commerce & Principles of Accounts Syllabus (Forms 1-4)::Commerce',
        'Commerce & Principles of Accounts Syllabus (Forms 1-4)::Principles of Accounts',
      ],
      'previous|Grade 4': ['Mathematics Syllabus (Grades 1-7, 2013)', 'English Language Syllabus (Grades 2-7, 2013)'],
      'previous|Grade 12': ['Mathematics Syllabus (Grades 10-12, 2013)'],
      // 'cbc|Grade 6' intentionally absent → exercises the configured-empty state.
    }
    return { subjects: catalog[`${mode}|${grade}`] || [], loading: false, error: null }
  },
}))
vi.mock('../../../../shared/hooks/useSubjectTopics.js', () => ({
  useSubjectTopics: () => ({ topics: [], loading: false, error: null }),
}))
vi.mock('../../../../shared/hooks/useSubtopicDetail.js', () => ({
  useSubtopicDetail: () => ({ subtopicRow: null, loading: false, error: null }),
}))

function openModal(props = {}) {
  const onSubmit = vi.fn().mockResolvedValue()
  const onClose = vi.fn()
  render(
    <AssignmentFormModal open mode="add" existing={[]} onSubmit={onSubmit} onClose={onClose} {...props} />,
  )
  return { onSubmit, onClose }
}

const gradeSelect = () => screen.getByRole('combobox', { name: /grade or form/i })
const subjectSelect = () => screen.getByRole('combobox', { name: /^subject/i })
const pickCbc = () => fireEvent.click(screen.getByRole('radio', { name: /Competency-Based Curriculum/i }))
const pickObc = () => fireEvent.click(screen.getByRole('radio', { name: /Previous Curriculum/i }))

// Selectable option values of a select (skips the '' placeholder).
const optionValues = (select) =>
  within(select).getAllByRole('option').map((o) => o.value).filter(Boolean)

describe('AssignmentFormModal — Curriculum → Grade/Form → Subject dependency order', () => {
  it('disables Grade/Form until a curriculum is chosen, and Subject until a grade is chosen', () => {
    openModal()
    expect(gradeSelect()).toBeDisabled()
    expect(subjectSelect()).toBeDisabled()
    pickCbc()
    expect(gradeSelect()).not.toBeDisabled()
    expect(subjectSelect()).toBeDisabled()
    fireEvent.change(gradeSelect(), { target: { value: 'Grade 4' } })
    expect(subjectSelect()).not.toBeDisabled()
  })

  it('offers each curriculum its OWN grade structure — never a shared generic list', () => {
    openModal()
    pickCbc()
    const cbcGrades = optionValues(gradeSelect())
    expect(cbcGrades).toContain('Nursery')
    expect(cbcGrades).toContain('Form 1')
    expect(cbcGrades).not.toContain('Grade 7')
    expect(cbcGrades).not.toContain('Grade 12')

    pickObc()
    const obcGrades = optionValues(gradeSelect())
    expect(obcGrades).toContain('Grade 7')
    expect(obcGrades).toContain('Grade 12')
    expect(obcGrades).not.toContain('Nursery')
    expect(obcGrades).not.toContain('Form 1')
  })

  it('renders stage headings as non-selectable optgroup labels, not options', () => {
    openModal()
    pickCbc()
    const groups = within(gradeSelect()).getAllByRole('group')
    expect(groups.length).toBeGreaterThan(0)
    const optionLabels = within(gradeSelect()).getAllByRole('option').map((o) => o.textContent)
    for (const g of groups) {
      expect(optionLabels).not.toContain(g.label)
    }
  })
})

describe('AssignmentFormModal — curriculum + grade scoped subjects', () => {
  it('shows only the syllabus-catalog subjects for the exact curriculum + grade', () => {
    openModal()
    pickCbc()
    fireEvent.change(gradeSelect(), { target: { value: 'Grade 4' } })
    expect(optionValues(subjectSelect())).toEqual([
      'Mathematics Syllabus (Grades 4-6)',
      'Home Economics Syllabus (Grades 4-6)',
    ])
    pickObc()
    fireEvent.change(gradeSelect(), { target: { value: 'Grade 4' } })
    expect(optionValues(subjectSelect())).toEqual([
      'Mathematics Syllabus (Grades 1-7, 2013)',
      'English Language Syllabus (Grades 2-7, 2013)',
    ])
  })

  it('shows the configured-empty message with admin diagnostics instead of a generic all-subject list', () => {
    openModal()
    pickCbc()
    fireEvent.change(gradeSelect(), { target: { value: 'Grade 6' } })
    expect(optionValues(subjectSelect())).toEqual([])
    expect(screen.getByText(/No subjects have been configured for this curriculum and grade/i)).toBeInTheDocument()
    expect(screen.getByText(/curriculum “cbc”, grade “Grade 6”/i)).toBeInTheDocument()
  })
})

describe('AssignmentFormModal — reset rules', () => {
  it('clears grade AND subject when the curriculum changes', () => {
    openModal()
    pickCbc()
    fireEvent.change(gradeSelect(), { target: { value: 'Grade 4' } })
    fireEvent.change(subjectSelect(), { target: { value: 'Mathematics Syllabus (Grades 4-6)' } })
    expect(subjectSelect().value).toBe('Mathematics Syllabus (Grades 4-6)')
    pickObc()
    expect(gradeSelect().value).toBe('')
    expect(subjectSelect().value).toBe('')
  })

  it('clears the subject when the grade changes', () => {
    openModal()
    pickCbc()
    fireEvent.change(gradeSelect(), { target: { value: 'Grade 4' } })
    fireEvent.change(subjectSelect(), { target: { value: 'Home Economics Syllabus (Grades 4-6)' } })
    fireEvent.change(gradeSelect(), { target: { value: 'Grade 1' } })
    expect(subjectSelect().value).toBe('')
  })

  it('never carries periods-per-week over from a previously selected subject', () => {
    openModal()
    pickCbc()
    fireEvent.change(gradeSelect(), { target: { value: 'Grade 4' } })
    fireEvent.change(subjectSelect(), { target: { value: 'Mathematics Syllabus (Grades 4-6)' } })
    const periods = screen.getByLabelText(/periods per week/i)
    fireEvent.change(periods, { target: { value: '33' } })
    expect(periods.value).toBe('33')
    fireEvent.change(subjectSelect(), { target: { value: 'Home Economics Syllabus (Grades 4-6)' } })
    expect(screen.getByLabelText(/periods per week/i).value).not.toBe('33')
  })
})

describe('AssignmentFormModal — save validation', () => {
  it('blocks saving until the Curriculum → Grade → Subject cascade is complete', async () => {
    const { onSubmit } = openModal()
    fireEvent.click(screen.getByRole('button', { name: /save assignment/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/choose a curriculum/i)
    expect(onSubmit).not.toHaveBeenCalled()

    pickCbc()
    fireEvent.click(screen.getByRole('button', { name: /save assignment/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/grade or form/i)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('saves canonical codes — CBC Form 3 folds to G10 with the canonical subject slug', async () => {
    const { onSubmit } = openModal()
    pickCbc()
    fireEvent.change(gradeSelect(), { target: { value: 'Form 3' } })
    fireEvent.change(subjectSelect(), {
      target: { value: 'Commerce & Principles of Accounts Syllabus (Forms 1-4)::Commerce' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save assignment/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      curriculumType: 'cbc',
      grade: 'G10',
      // One of the two subjects the workbook contains — never the combined key.
      subject: 'commerce',
    }))
  })

  it('offers Commerce and Principles of Accounts as separate, saveable subjects', async () => {
    const { onSubmit } = openModal()
    pickCbc()
    fireEvent.change(gradeSelect(), { target: { value: 'Form 3' } })
    // Both appear under their own names, not as one combined workbook entry.
    const labels = [...subjectSelect().querySelectorAll('option')].map((o) => o.textContent)
    expect(labels).toContain('Commerce')
    expect(labels).toContain('Principles of Accounts')
    expect(labels.join('|')).not.toMatch(/Commerce & Principles of Accounts/)

    fireEvent.change(subjectSelect(), {
      target: { value: 'Commerce & Principles of Accounts Syllabus (Forms 1-4)::Principles of Accounts' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save assignment/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ subject: 'principles_of_accounts' }))
  })

  it('a saved assignment still on the retired combined key is forced to be re-picked', () => {
    const { onSubmit } = openModal({
      mode: 'edit',
      initial: {
        id: 'a2', grade: 'G10', subject: 'commerce_and_principles_of_accounts', curriculumType: 'cbc',
      },
    })
    expect(screen.getByText(/needs review/i)).toBeInTheDocument()
    // Saving without choosing one of the two is refused — never auto-assigned.
    fireEvent.click(screen.getByRole('button', { name: /save assignment/i }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('flags a stale invalid saved combination for review and forces a re-selection', () => {
    // Principles of Accounts under the CBC is impossible (2013-only subject) —
    // e.g. old saved data from the generic-list era.
    const { onSubmit } = openModal({
      mode: 'edit',
      initial: { id: 'a1', grade: 'G12', subject: 'accounts', curriculumType: 'cbc' },
    })
    expect(screen.getByText(/needs review/i)).toBeInTheDocument()
    // The original values are shown to the teacher, never silently rewritten.
    expect(screen.getByText(/Principles of Accounts/i)).toBeInTheDocument()
    // The invalid seed is cleared, so saving without a valid re-selection fails.
    fireEvent.click(screen.getByRole('button', { name: /save assignment/i }))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('AssignmentFormModal — editing a valid assignment', () => {
  it('seeds the cascade from the stored assignment (CBC secondary shown as its Form)', async () => {
    openModal({
      mode: 'edit',
      initial: { id: 'a2', grade: 'G4', subject: 'mathematics', curriculumType: 'cbc', periodsPerWeek: 6 },
    })
    await waitFor(() => expect(gradeSelect().value).toBe('Grade 4'))
    // The stored canonical slug is resolved back onto the catalog key.
    await waitFor(() => expect(subjectSelect().value).toBe('Mathematics Syllabus (Grades 4-6)'))
    expect(screen.getByLabelText(/periods per week/i).value).toBe('6')
    expect(screen.queryByText(/needs review/i)).not.toBeInTheDocument()
  })
})
