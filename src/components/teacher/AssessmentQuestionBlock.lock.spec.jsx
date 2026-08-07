import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QuestionBlock } from './AssessmentQuestionBlock.jsx'

// The card pulls in the picture bank, the diagram library and the AI helpers,
// none of which this suite is about — stub them so the test stays about the lock
// and the rewrite control.
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'test-uid' }, userProfile: {} }),
}))
// These two reach firebase/config at import time; the card only calls them from
// the AI popovers, which this suite never opens.
vi.mock('../../utils/suggestAnswer', () => ({ suggestAnswer: vi.fn() }))
vi.mock('../../utils/reviseQuestion', () => ({ reviseQuestion: vi.fn() }))
vi.mock('./PictureBankPicker', () => ({ default: () => null }))

function renderCard({ locked = false, rewriting = false, ...props } = {}) {
  const onToggleLock = vi.fn()
  const onRewriteQuestion = vi.fn()
  const section = {
    id: 's1',
    kind: 'standalone',
    question: {
      localId: 'q-1',
      type: 'mcq',
      text: 'Q1 stem',
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 0,
      marks: 2,
      locked,
    },
  }
  render(
    <QuestionBlock
      section={section}
      sectionIndex={0}
      parts={[]}
      questionNumbers={{ 'q-1': 1 }}
      paperMeta={{}}
      onEditQuestion={vi.fn()}
      onMoveSection={vi.fn()}
      onRemoveSection={vi.fn()}
      onDuplicateSection={vi.fn()}
      onUpdateQuestion={vi.fn()}
      onUploadImage={vi.fn()}
      onRemoveImage={vi.fn()}
      onUploadOptionImage={vi.fn()}
      onRemoveOptionImage={vi.fn()}
      onAssignSectionToPart={vi.fn()}
      onToggleLock={onToggleLock}
      onRewriteQuestion={onRewriteQuestion}
      rewriting={rewriting}
      {...props}
    />,
  )
  return { onToggleLock, onRewriteQuestion }
}

// The eight-icon header row became a grip plus two ActionMenus (#2.4), so every
// control below is now one click deeper. The BEHAVIOUR asserted is unchanged —
// that is the point of re-pointing these rather than rewriting them.
function openOverflowMenu() {
  fireEvent.click(screen.getByRole('button', { name: /more actions for question 1/i }))
  return screen.getByRole('menu')
}
function openAiMenu() {
  fireEvent.click(screen.getByRole('button', { name: /^(ai|thinking)/i }))
  return screen.getByRole('menu')
}

describe('QuestionBlock — lock and single-question rewrite', () => {
  it('offers to rewrite just this question, not the paper', () => {
    const { onRewriteQuestion } = renderCard()
    const item = within(openAiMenu()).getByRole('menuitem', { name: /rewrite just this question/i })
    fireEvent.click(item)
    expect(onRewriteQuestion).toHaveBeenCalledWith('q-1')
  })

  it('locks a question on request', () => {
    const { onToggleLock } = renderCard()
    fireEvent.click(within(openOverflowMenu()).getByRole('menuitem', { name: /lock this question/i }))
    expect(onToggleLock).toHaveBeenCalledWith('q-1', true)
  })

  it('a locked question says so and cannot be rewritten', () => {
    const { onRewriteQuestion } = renderCard({ locked: true })
    expect(screen.getByText('Locked')).toBeInTheDocument()
    const item = within(openAiMenu()).getByRole('menuitem', { name: /unlock to rewrite/i })
    expect(item).toBeDisabled()
    fireEvent.click(item)
    expect(onRewriteQuestion).not.toHaveBeenCalled()
  })

  it('unlocking is the same control, pressed', () => {
    const { onToggleLock } = renderCard({ locked: true })
    fireEvent.click(within(openOverflowMenu()).getByRole('menuitem', { name: /unlock this question/i }))
    expect(onToggleLock).toHaveBeenCalledWith('q-1', false)
  })

  it('the rewrite control is disabled while a rewrite is in flight', () => {
    const { onRewriteQuestion } = renderCard({ rewriting: true })
    const item = within(openAiMenu()).getByRole('menuitem', { name: /rewrite just this question/i })
    expect(item).toBeDisabled()
    fireEvent.click(item)
    expect(onRewriteQuestion).not.toHaveBeenCalled()
  })

  it('a studio that has not wired the controls shows neither', () => {
    // The card is shared; a caller that passes no handlers must not render dead
    // menu rows either.
    renderCard({ onToggleLock: undefined, onRewriteQuestion: undefined })
    expect(within(openAiMenu()).queryByRole('menuitem', { name: /rewrite just this question/i })).toBeNull()
    // Close the AI menu before opening the other, so only one is in the tree.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(within(openOverflowMenu()).queryByRole('menuitem', { name: /lock this question/i })).toBeNull()
  })
})

describe('QuestionBlock — the header carries a grip, not two arrows', () => {
  it('the grip moves the block with the arrow keys', () => {
    const onMoveSection = vi.fn()
    renderCard({ onMoveSection })
    const grip = screen.getByRole('button', { name: /reorder question 1/i })
    fireEvent.keyDown(grip, { key: 'ArrowUp' })
    expect(onMoveSection).toHaveBeenCalledWith(0, -1)
    fireEvent.keyDown(grip, { key: 'ArrowDown' })
    expect(onMoveSection).toHaveBeenCalledWith(0, 1)
  })

  it('the type is stated once — the dropdown, not a badge repeating it', () => {
    renderCard()
    expect(screen.queryByText('MULTIPLE CHOICE')).toBeNull()
    expect(screen.getByRole('combobox', { name: '' })).toBeTruthy()
  })

  it('deleting asks first, and only then removes the question', () => {
    const onRemoveSection = vi.fn()
    renderCard({ onRemoveSection })
    fireEvent.click(within(openOverflowMenu()).getByRole('menuitem', { name: /^delete$/i }))
    // The menu row opens the dialog; the dialog does the removing.
    expect(onRemoveSection).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Delete question 1?')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(onRemoveSection).toHaveBeenCalledWith(0)
  })
})
