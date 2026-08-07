import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

// Both controls now live behind a grouped menu on the block header (#2.4): the
// ⋯ overflow owns lock/duplicate/delete, the ✦ AI entry owns everything that
// hands the question to a model. Open the right one, then act.
function openOverflow() {
  fireEvent.click(screen.getByRole('button', { name: /more actions for question 1/i }))
}
function openAiMenu() {
  fireEvent.click(screen.getByRole('button', { name: /ai actions for question 1/i }))
}
const lockItem = () => screen.getByRole('menuitem', { name: /lock this question/i })
const rewriteItem = () => screen.getByRole('menuitem', { name: /rewrite this question/i })

describe('QuestionBlock — lock and single-question rewrite', () => {
  it('offers to rewrite just this question, not the paper', () => {
    const { onRewriteQuestion } = renderCard()
    openAiMenu()
    const item = rewriteItem()
    expect(item).toHaveTextContent(/the rest of the paper is untouched/i)
    fireEvent.click(item)
    expect(onRewriteQuestion).toHaveBeenCalledWith('q-1')
  })

  it('locks a question on request', () => {
    const { onToggleLock } = renderCard()
    openOverflow()
    expect(lockItem()).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(lockItem())
    expect(onToggleLock).toHaveBeenCalledWith('q-1', true)
  })

  it('a locked question says so and cannot be rewritten', () => {
    const { onRewriteQuestion } = renderCard({ locked: true })
    expect(screen.getByText('Locked')).toBeInTheDocument()
    openAiMenu()
    const item = rewriteItem()
    expect(item).toBeDisabled()
    expect(item).toHaveAttribute('title', expect.stringMatching(/unlock this question first/i))
    fireEvent.click(item)
    expect(onRewriteQuestion).not.toHaveBeenCalled()
  })

  it('unlocking is the same control, pressed', () => {
    const { onToggleLock } = renderCard({ locked: true })
    openOverflow()
    const item = screen.getByRole('menuitem', { name: /unlock this question/i })
    expect(item).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(item)
    expect(onToggleLock).toHaveBeenCalledWith('q-1', false)
  })

  it('the rewrite control is disabled while a rewrite is in flight', () => {
    const { onRewriteQuestion } = renderCard({ rewriting: true })
    openAiMenu()
    expect(rewriteItem()).toBeDisabled()
    fireEvent.click(rewriteItem())
    expect(onRewriteQuestion).not.toHaveBeenCalled()
  })

  it('a studio that has not wired the controls shows neither', () => {
    // The card is shared; a caller that passes no handlers must not render dead
    // menu items.
    renderCard({ onToggleLock: undefined, onRewriteQuestion: undefined })
    openOverflow()
    expect(screen.queryByRole('menuitem', { name: /lock this question/i })).toBeNull()
    openAiMenu()
    expect(screen.queryByRole('menuitem', { name: /rewrite this question/i })).toBeNull()
  })
})
