/**
 * The Move-to-folder dialog's interaction contract.
 *
 * The rules it applies are pure and tested in ../lib/moveTarget.test.js. What
 * only a rendered dialog can show is the wiring around them: that Move stays
 * disabled until the teacher actually changes something, that the coords handed
 * to the service are the ones on screen, and — the one that matters most — that
 * a failed write leaves the dialog open. A dialog that closed on failure would
 * look exactly like a successful move until the teacher noticed the document
 * had not left the folder.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import MoveToFolderDialog from './MoveToFolderDialog'
import { LIBRARY_SECTION_BY_ID, LIBRARY_TYPES } from '../../../config/library'

const lessonPlans = LIBRARY_SECTION_BY_ID[LIBRARY_TYPES.LESSON_PLANS]

const row = (library) => ({ id: 'doc-1', tool: 'lesson_plan', __title: 'Tongue twisters', library })

function open(overrides = {}) {
  const onMove = overrides.onMove || vi.fn().mockResolvedValue(undefined)
  const onCancel = overrides.onCancel || vi.fn()
  render(
    <MoveToFolderDialog
      row={overrides.row || row({ syllabus: 'CBC', gradeForm: null, term: null, subject: 'English Language' })}
      section={lessonPlans}
      onCancel={onCancel}
      onMove={onMove}
    />,
  )
  return { onMove, onCancel }
}

const gradeSelect = () => screen.getByLabelText('Grade / Form')
const moveButton = () => screen.getByRole('button', { name: /^move$/i })

describe('MoveToFolderDialog', () => {
  it('offers the grades the library actually has, Nursery included', () => {
    open()
    const values = Array.from(gradeSelect().options).map((o) => o.value)
    expect(values).toContain('Nursery')
    expect(values).toContain('Reception')
    expect(values).toContain('Grade 4')
  })

  it('keeps Move disabled until something changes', () => {
    open()
    expect(moveButton()).toBeDisabled()
    fireEvent.change(gradeSelect(), { target: { value: 'Nursery' } })
    expect(moveButton()).toBeEnabled()
  })

  it('hands the service the coords shown on screen', async () => {
    const { onMove } = open()
    fireEvent.change(gradeSelect(), { target: { value: 'Nursery' } })
    fireEvent.click(moveButton())

    await waitFor(() => expect(onMove).toHaveBeenCalledTimes(1))
    const coords = onMove.mock.calls[0][0]
    expect(coords).toMatchObject({
      libraryType: LIBRARY_TYPES.LESSON_PLANS,
      syllabus: 'CBC',
      gradeForm: 'Nursery',
    })
    expect(coords.path).toContain('Nursery')
  })

  it('writes a cleared dimension as null rather than an empty string', async () => {
    const { onMove } = open({
      row: row({ syllabus: 'CBC', gradeForm: 'Grade 4', term: 'Term 2', subject: 'Mathematics' }),
    })
    fireEvent.change(screen.getByLabelText('Term'), { target: { value: '' } })
    fireEvent.click(moveButton())

    await waitFor(() => expect(onMove).toHaveBeenCalled())
    expect(onMove.mock.calls[0][0].term).toBeNull()
  })

  it('stays open with the teacher\'s choices intact when the write fails', async () => {
    const onMove = vi.fn().mockRejectedValue(new Error('Could not move this document.'))
    open({ onMove })

    fireEvent.change(gradeSelect(), { target: { value: 'Nursery' } })
    fireEvent.click(moveButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not move this document.')
    // Still on screen, still holding the choice, and retryable.
    expect(gradeSelect().value).toBe('Nursery')
    expect(moveButton()).toBeEnabled()
  })

  it('drops a subject the newly chosen grade does not have', () => {
    open({ row: row({ syllabus: 'CBC', gradeForm: 'Grade 4', term: null, subject: 'Integrated Science' }) })
    expect(screen.getByLabelText('Subject').value).toBe('Integrated Science')
    fireEvent.change(gradeSelect(), { target: { value: 'Nursery' } })
    expect(screen.getByLabelText('Subject').value).toBe('')
  })
})
