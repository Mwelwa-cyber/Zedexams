/**
 * The question card after the 8-icon header row became a handle and an
 * overflow (§2.4).
 *
 * The three claims worth a test, because each is a thing a later refactor could
 * quietly undo:
 *   • reordering still works from the keyboard — a drag handle that only
 *     answers a pointer takes a capability away from the teachers who had ↑↓;
 *   • Delete asks first, and the ⋯ item is not the thing that deletes;
 *   • the type is stated ONCE (the dropdown), not twice.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuestionBlock } from './AssessmentQuestionBlock.jsx'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'test-uid' }, userProfile: {} }),
}))
vi.mock('../../utils/suggestAnswer', () => ({ suggestAnswer: vi.fn() }))
vi.mock('../../utils/reviseQuestion', () => ({ reviseQuestion: vi.fn() }))
vi.mock('./PictureBankPicker', () => ({ default: () => null }))

function renderCard(props = {}) {
  const handlers = {
    onEditQuestion: vi.fn(), onMoveSection: vi.fn(), onRemoveSection: vi.fn(),
    onDuplicateSection: vi.fn(), onUpdateQuestion: vi.fn(), onUploadImage: vi.fn(),
    onRemoveImage: vi.fn(), onUploadOptionImage: vi.fn(), onRemoveOptionImage: vi.fn(),
    onAssignSectionToPart: vi.fn(), onSaveToBank: vi.fn(), onReorderSection: vi.fn(),
    onDragStateChange: vi.fn(),
  }
  const section = {
    id: 's1',
    kind: 'standalone',
    question: {
      localId: 'q-1', type: 'mcq', text: 'Name three states of matter.',
      options: ['Solid', 'Liquid', 'Gas', 'Plasma'], correctAnswer: 0, marks: 2,
    },
  }
  render(
    <QuestionBlock
      section={section}
      sectionIndex={3}
      parts={[]}
      questionNumbers={{ 'q-1': 4 }}
      paperMeta={{}}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

const handle = () => screen.getByRole('button', { name: /reorder question 4/i })
const openOverflow = () => fireEvent.click(screen.getByRole('button', { name: /more actions for question 4/i }))

describe('QuestionBlock — the header row', () => {
  it('reorders from the keyboard, exactly as the ↑↓ buttons did', () => {
    const { onMoveSection } = renderCard()
    fireEvent.keyDown(handle(), { key: 'ArrowUp' })
    expect(onMoveSection).toHaveBeenCalledWith(3, -1)
    fireEvent.keyDown(handle(), { key: 'ArrowDown' })
    expect(onMoveSection).toHaveBeenCalledWith(3, 1)
  })

  it('ignores keys that are not a reorder', () => {
    const { onMoveSection } = renderCard()
    fireEvent.keyDown(handle(), { key: 'a' })
    fireEvent.keyDown(handle(), { key: 'Enter' })
    expect(onMoveSection).not.toHaveBeenCalled()
  })

  it('the ↑↓ buttons are gone — the handle is the one reorder control', () => {
    renderCard()
    expect(screen.queryByRole('button', { name: /^move up$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^move down$/i })).toBeNull()
  })

  it('Delete asks before it deletes', () => {
    const { onRemoveSection } = renderCard()
    openOverflow()
    fireEvent.click(screen.getByRole('menuitem', { name: /delete this question/i }))
    // Choosing the menu item raises the confirm; it does not remove anything.
    expect(onRemoveSection).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/delete question 4/i)
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(onRemoveSection).toHaveBeenCalledWith(3)
  })

  it('backing out of the confirm leaves the question alone', () => {
    const { onRemoveSection } = renderCard()
    openOverflow()
    fireEvent.click(screen.getByRole('menuitem', { name: /delete this question/i }))
    fireEvent.click(screen.getByRole('button', { name: /keep it/i }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onRemoveSection).not.toHaveBeenCalled()
  })

  it('duplicate and save-to-bank moved into the overflow, not out of the product', () => {
    const { onDuplicateSection, onSaveToBank } = renderCard()
    openOverflow()
    fireEvent.click(screen.getByRole('menuitem', { name: /^duplicate$/i }))
    expect(onDuplicateSection).toHaveBeenCalledWith(3)
    openOverflow()
    fireEvent.click(screen.getByRole('menuitem', { name: /save to your question bank/i }))
    expect(onSaveToBank).toHaveBeenCalled()
  })
})

describe('QuestionBlock — the question type is stated once', () => {
  it('neither the block label nor a badge repeats the type dropdown', () => {
    renderCard()
    expect(document.querySelector('.sv-q-type-tag')).toBeNull()
    // The type appeared three times: the block-head label, a badge beside the
    // dropdown, and the dropdown. Only the dropdown — the one place it can
    // also be CHANGED — says it now.
    expect(screen.queryByText(/multiple choice/i, { selector: '.sv-block-head *' })).toBeNull()
    expect(screen.getByDisplayValue(/multiple choice/i)).toBeInTheDocument()
  })
})

describe('QuestionBlock — one AI entry, and one image affordance per option', () => {
  it('the three AI buttons are one menu', () => {
    renderCard()
    expect(screen.queryByRole('button', { name: /^improve$/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /ai actions for question 4/i }))
    expect(screen.getByRole('menuitem', { name: /suggest the answer/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /improve the wording/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /revise for another grade/i })).toBeInTheDocument()
  })

  it('each option offers ONE "+ img", with the three sources inside it', () => {
    renderCard()
    const perOption = screen.getAllByRole('button', { name: /add a picture to option/i })
    expect(perOption).toHaveLength(4)
    fireEvent.click(perOption[0])
    expect(screen.getByRole('menuitem', { name: /upload an image/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /picture bank/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /shape/i })).toBeInTheDocument()
  })

  it('picking a source for an option does not also mark that option correct', () => {
    // The option ROW is a click target for "this is the answer"; the picture
    // control sits inside it, so its click must not reach the row.
    const { onUpdateQuestion } = renderCard()
    fireEvent.click(screen.getAllByRole('button', { name: /add a picture to option/i })[2])
    expect(onUpdateQuestion).not.toHaveBeenCalledWith('correctAnswer', 2)
  })

  it('the stem keeps one figure row, with the sources behind it', () => {
    renderCard()
    expect(screen.getByText(/add a diagram or image/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^camera$/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /pick a figure source for question 4/i }))
    expect(screen.getByRole('menuitem', { name: /camera/i })).toBeInTheDocument()
  })
})
