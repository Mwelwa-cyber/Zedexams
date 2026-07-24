import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

import SchemeTermPreview from './SchemeTermPreview'

// An ordered Science outline longer than one term (the classic "restart" case).
const TOPICS = [
  { label: 'Human Body', subtopics: ['Parts', 'Senses', 'Hygiene'] },
  { label: 'Plants', subtopics: ['Roots', 'Leaves'] },
  { label: 'Matter', subtopics: ['Solids', 'Liquids'] },
  { label: 'Energy', subtopics: ['Heat', 'Light', 'Sound'] },
  { label: 'Forces', subtopics: ['Push', 'Pull'] },
  { label: 'Electricity', subtopics: ['Circuits'] },
  { label: 'Earth', subtopics: ['Soil'] },
  { label: 'Water', subtopics: ['Cycle', 'Sources'] },
]

const WEEKS = { 1: 4, 2: 4, 3: 4 }
const META = {
  1: { totalWeeks: 5, deliveryWeeks: 4, hasExam: true, hasRevision: false },
  2: { totalWeeks: 5, deliveryWeeks: 4, hasExam: true, hasRevision: false },
  3: { totalWeeks: 5, deliveryWeeks: 4, hasExam: true, hasRevision: false },
}

function renderPreview(props = {}) {
  return render(
    <SchemeTermPreview
      topics={TOPICS}
      focusTerm={props.focusTerm ?? 1}
      scope={props.scope ?? 'single'}
      onScopeChange={props.onScopeChange ?? (() => {})}
      weeksByTerm={WEEKS}
      termMeta={META}
      gradeLabel="Grade 4"
      subjectLabel="Integrated Science"
      curriculumLabel="CBC"
      onApprove={props.onApprove ?? (() => {})}
      onBack={props.onBack ?? (() => {})}
    />,
  )
}

describe('SchemeTermPreview', () => {
  it('shows Term 1 starting at the first syllabus topic', () => {
    renderPreview({ focusTerm: 1 })
    expect(screen.getByText('Human Body')).toBeInTheDocument()
  })

  it('does NOT restart Term 2 at the first topic', () => {
    renderPreview({ focusTerm: 2 })
    // Term 2 must continue the syllabus, so "Human Body" is not one of its
    // topic CARDS (it may still appear in the syllabus dropdown — scope to span).
    expect(screen.queryByText('Human Body', { selector: 'span' })).not.toBeInTheDocument()
  })

  it('lets the teacher remove a topic and restore it', () => {
    renderPreview({ focusTerm: 1 })
    expect(screen.getByText('Human Body', { selector: 'span' })).toBeInTheDocument()
    const removeBtns = screen.getAllByRole('button', { name: 'Remove topic' })
    fireEvent.click(removeBtns[0])
    // Removed from the plan (the card is gone — the dropdown option is a <option>)…
    expect(screen.queryByText(/^Human Body$/, { selector: 'span' })).not.toBeInTheDocument()
    // …and offered in the removed bin for restore.
    const restore = screen.getByRole('button', { name: /↩ Human Body/ })
    fireEvent.click(restore)
    expect(screen.getByText('Human Body', { selector: 'span' })).toBeInTheDocument()
  })

  it('approves with the edited ordered topic selection', () => {
    const onApprove = vi.fn()
    renderPreview({ focusTerm: 1, onApprove })
    fireEvent.click(screen.getByRole('button', { name: /Approve & Generate Term 1/ }))
    expect(onApprove).toHaveBeenCalledTimes(1)
    const [term, items] = onApprove.mock.calls[0]
    expect(term).toBe(1)
    expect(items[0].topic).toBe('Human Body')
    expect(Array.isArray(items)).toBe(true)
  })

  it('lets the teacher add a topic manually', () => {
    const onApprove = vi.fn()
    renderPreview({ focusTerm: 1, onApprove })
    const input = screen.getByPlaceholderText('Add a topic manually…')
    fireEvent.change(input, { target: { value: 'Local Case Study' } })
    fireEvent.click(screen.getByRole('button', { name: /Add topic/ }))
    expect(screen.getByText('Local Case Study')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Approve & Generate Term 1/ }))
    const items = onApprove.mock.calls[0][1]
    expect(items.some((i) => i.topic === 'Local Case Study' && i.source === 'teacher')).toBe(true)
  })

  it('offers every subject topic in the syllabus dropdown', () => {
    renderPreview({ focusTerm: 2 })
    const dropdown = screen.getAllByLabelText('Add a topic from the syllabus')[0]
    // Even a topic that lives in another term (e.g. Term 1's "Human Body") is
    // selectable, so the dropdown lists the WHOLE subject syllabus.
    const optionLabels = within(dropdown).getAllByRole('option').map((o) => o.textContent)
    for (const t of TOPICS) {
      expect(optionLabels.some((l) => l.startsWith(t.label))).toBe(true)
    }
  })

  it('adds a topic (with its sub-topics) chosen from the syllabus dropdown', () => {
    const onApprove = vi.fn()
    renderPreview({ focusTerm: 2, onApprove })
    const dropdown = screen.getAllByLabelText('Add a topic from the syllabus')[0]
    // "Human Body" is index 0 in the ordered outline and normally sits in Term 1.
    fireEvent.change(dropdown, { target: { value: '0' } })
    expect(screen.getByText('Human Body', { selector: 'span' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Approve & Generate Term 2/ }))
    const items = onApprove.mock.calls[0][1]
    const added = items.find((i) => i.topic === 'Human Body')
    expect(added).toBeTruthy()
    expect(added.subtopics).toEqual(['Parts', 'Senses', 'Hygiene'])
  })

  it('shows all three terms in all-terms scope', () => {
    renderPreview({ scope: 'all' })
    expect(screen.getByRole('button', { name: /Approve & Generate Term 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Approve & Generate Term 2/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Approve & Generate Term 3/ })).toBeInTheDocument()
  })

  it('flags a term with no topics as a blocking error and disables approve', () => {
    renderPreview({ focusTerm: 1 })
    // Remove every topic in Term 1.
    let removeBtns = screen.getAllByRole('button', { name: 'Remove topic' })
    while (removeBtns.length) {
      fireEvent.click(removeBtns[0])
      removeBtns = screen.queryAllByRole('button', { name: 'Remove topic' })
    }
    const approve = screen.getByRole('button', { name: /Approve & Generate Term 1/ })
    expect(approve).toBeDisabled()
  })
})
