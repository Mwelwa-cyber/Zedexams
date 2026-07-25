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

const lockButton = () => screen.getByRole('button', { name: /lock this question/i })
const rewriteButton = () => screen.getByRole('button', { name: /rewrite just this question|unlock this question first/i })

describe('QuestionBlock — lock and single-question rewrite', () => {
  it('offers to rewrite just this question, not the paper', () => {
    const { onRewriteQuestion } = renderCard()
    const btn = rewriteButton()
    expect(btn).toHaveAttribute('title', expect.stringMatching(/the rest of the paper is untouched/i))
    fireEvent.click(btn)
    expect(onRewriteQuestion).toHaveBeenCalledWith('q-1')
  })

  it('locks a question on request', () => {
    const { onToggleLock } = renderCard()
    expect(lockButton()).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(lockButton())
    expect(onToggleLock).toHaveBeenCalledWith('q-1', true)
  })

  it('a locked question says so and cannot be rewritten', () => {
    const { onRewriteQuestion } = renderCard({ locked: true })
    expect(screen.getByText('Locked')).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: /unlock this question first/i })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onRewriteQuestion).not.toHaveBeenCalled()
  })

  it('unlocking is the same control, pressed', () => {
    const { onToggleLock } = renderCard({ locked: true })
    const btn = screen.getByRole('button', { name: /unlock this question$/i })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(btn)
    expect(onToggleLock).toHaveBeenCalledWith('q-1', false)
  })

  it('the rewrite control is disabled while a rewrite is in flight', () => {
    const { onRewriteQuestion } = renderCard({ rewriting: true })
    const btn = rewriteButton()
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onRewriteQuestion).not.toHaveBeenCalled()
  })

  it('a studio that has not wired the controls shows neither', () => {
    // The card is shared; a caller that passes no handlers must not render dead
    // buttons.
    renderCard({ onToggleLock: undefined, onRewriteQuestion: undefined })
    expect(screen.queryByRole('button', { name: /lock this question/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /rewrite just this question/i })).toBeNull()
  })
})
