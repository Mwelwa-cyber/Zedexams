import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import AssignmentFormModal from './AssignmentFormModal'

// Subject values (skip the placeholder) currently offered by the Subject select.
function subjectValues() {
  const select = screen.getByLabelText('Subject')
  return within(select)
    .queryAllByRole('option')
    .map((o) => o.value)
    .filter(Boolean)
}

function openModal() {
  const onSubmit = vi.fn().mockResolvedValue()
  const onClose = vi.fn()
  render(
    <AssignmentFormModal open mode="add" existing={[]} onSubmit={onSubmit} onClose={onClose} />,
  )
  return { onSubmit, onClose }
}

describe('AssignmentFormModal — curriculum-aware subject list', () => {
  it('changes the Subject list when the Curriculum selector switches OBC ⇄ CBC', () => {
    openModal()
    fireEvent.change(screen.getByLabelText('Grade or Form'), { target: { value: 'G4' } })

    fireEvent.change(screen.getByLabelText('Curriculum'), { target: { value: 'cbc' } })
    const cbc = subjectValues()
    fireEvent.change(screen.getByLabelText('Curriculum'), { target: { value: 'previous' } })
    const obc = subjectValues()

    // The combined "Mathematics and Science" learning area is CBC-only.
    expect(cbc).toContain('numeracy')
    expect(obc).not.toContain('numeracy')
    expect(cbc).not.toEqual(obc)
  })

  it('resets a now-invalid subject when the curriculum changes', () => {
    openModal()
    fireEvent.change(screen.getByLabelText('Grade or Form'), { target: { value: 'G12' } })
    // Old Curriculum (OBC) offers Principles of Accounts…
    fireEvent.change(screen.getByLabelText('Curriculum'), { target: { value: 'previous' } })
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'accounts' } })
    expect(screen.getByLabelText('Subject').value).toBe('accounts')

    // …which does not exist in the CBC, so switching curriculum must drop it and
    // fall back to a subject that IS valid for Grade 12 under the CBC.
    fireEvent.change(screen.getByLabelText('Curriculum'), { target: { value: 'cbc' } })
    const subject = screen.getByLabelText('Subject').value
    expect(subject).not.toBe('accounts')
    expect(subjectValues()).toContain(subject)
  })
})
