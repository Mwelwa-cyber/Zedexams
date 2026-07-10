import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AiReviewPanel from './AiReviewPanel.jsx'

const QUESTIONS = [
  { type: 'mcq', text: 'What is 2 + 2?', options: ['3', '4'], correctAnswer: 1, marks: 1 },
  { type: 'short_answer', text: 'Define osmosis.', correctAnswer: 'Movement of water', marks: 2 },
  { type: 'mcq', text: 'Capital of Zambia?', options: ['Lusaka', 'Ndola'], correctAnswer: 0, marks: 1 },
]

function renderPanel(overrides = {}) {
  const onConfirm = vi.fn()
  const onDiscard = vi.fn()
  const review = { questions: QUESTIONS, droppedCount: 2, titleTopic: 'Numbers', ...overrides }
  const utils = render(<AiReviewPanel review={review} onConfirm={onConfirm} onDiscard={onDiscard} />)
  return { onConfirm, onDiscard, ...utils }
}

describe('AiReviewPanel — accept/discard pass for quick-generated questions', () => {
  it('reports the generated count AND the incomplete-dropped count explicitly', () => {
    renderPanel()
    expect(screen.getByText('3 questions generated')).toBeInTheDocument()
    expect(screen.getByText(/2 incomplete and dropped/)).toBeInTheDocument()
  })

  it('omits the dropped strip when nothing was dropped', () => {
    renderPanel({ droppedCount: 0 })
    expect(screen.queryByText(/incomplete and dropped/)).not.toBeInTheDocument()
  })

  it('previews each question with its stem and options', () => {
    renderPanel()
    expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument()
    expect(screen.getByText('Define osmosis.')).toBeInTheDocument()
    expect(screen.getByText(/A\.\s*Lusaka/)).toBeInTheDocument()
  })

  it('defaults every question to accepted — Add carries the full count', () => {
    const { onConfirm } = renderPanel()
    const addBtn = screen.getByRole('button', { name: /Add 3 questions/ })
    fireEvent.click(addBtn)
    expect(onConfirm).toHaveBeenCalledWith(QUESTIONS)
  })

  it('unticking a question removes it from the Add count and payload', () => {
    const { onConfirm } = renderPanel()
    fireEvent.click(screen.getByLabelText('Keep question 2'))
    const addBtn = screen.getByRole('button', { name: /Add 2 questions/ })
    fireEvent.click(addBtn)
    expect(onConfirm).toHaveBeenCalledWith([QUESTIONS[0], QUESTIONS[2]])
  })

  it('disables Add when every question is unticked', () => {
    renderPanel()
    fireEvent.click(screen.getByLabelText('Keep question 1'))
    fireEvent.click(screen.getByLabelText('Keep question 2'))
    fireEvent.click(screen.getByLabelText('Keep question 3'))
    expect(screen.getByRole('button', { name: /Add 0 questions/ })).toBeDisabled()
  })

  it('Discard all hands control back without inserting anything', () => {
    const { onConfirm, onDiscard } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Discard all/ }))
    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
