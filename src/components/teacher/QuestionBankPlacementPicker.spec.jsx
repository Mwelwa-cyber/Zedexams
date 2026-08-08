/**
 * The step that stops an insert from being silent.
 *
 * The rules under test are all "what the teacher is TOLD" rules: an
 * incompatible position is visible and disabled with its reason rather than
 * quietly absent, a paper with nowhere to put the question says so and offers
 * to add the section, and an A–E question going into an A–D paper is reported
 * before anything is inserted.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import QuestionBankPlacementPicker from './QuestionBankPlacementPicker.jsx'
import { buildPlacementPlan } from '../../utils/questionBankPlacement.js'

vi.mock('../../utils/quizRichText', () => ({ extractRichTextPlain: (v) => (typeof v === 'string' ? v : '') }))

let seed = 0
function standalone(type, partId = null) {
  seed += 1
  return {
    id: `s-${seed}`,
    kind: 'standalone',
    question: { localId: `q-${seed}`, text: `Q${seed}`, type, options: type === 'mcq' ? ['a', 'b'] : [], partId },
  }
}

const MCQ = { text: 'Add 1/2 and 1/4', type: 'mcq', options: ['3/4', '1/2', '2/6', '1/8'] }

function renderPicker({ sections, parts, question = MCQ, ...rest }) {
  const plan = buildPlacementPlan({ sections, parts }, { type: question.type })
  const props = {
    open: true,
    plan,
    question,
    row: { id: 'row-1', type: question.type },
    onConfirm: vi.fn(),
    onAddSection: vi.fn(),
    onCancel: vi.fn(),
    ...rest,
  }
  render(<QuestionBankPlacementPicker {...props} />)
  return props
}

describe('QuestionBankPlacementPicker', () => {
  it('lists every position by question number and defaults to the end of the matching section', () => {
    const parts = [{ id: 'p-a', title: 'Multiple choice', order: 0 }]
    renderPicker({
      sections: [standalone('mcq', 'p-a'), standalone('mcq', 'p-a'), standalone('mcq', 'p-a')],
      parts,
    })
    expect(screen.getByText(/Section A — Multiple choice/)).toBeInTheDocument()
    for (const label of ['as Q1', 'as Q2', 'as Q3']) {
      expect(screen.getByRole('button', { name: label })).toBeEnabled()
    }
    // The default is highlighted, and it is the end of the section.
    const end = screen.getByRole('button', { name: 'as Q4 (end of section)' })
    expect(end.className).toMatch(/bg-orange-500/)
  })

  it('confirming reports the chosen position back, and nothing before that', () => {
    const parts = [{ id: 'p-a', title: 'Multiple choice', order: 0 }]
    const props = renderPicker({
      sections: [standalone('mcq', 'p-a'), standalone('mcq', 'p-a')],
      parts,
    })
    expect(props.onConfirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'as Q1' }))
    fireEvent.click(screen.getByRole('button', { name: /^Insert as Q1$/ }))

    expect(props.onConfirm).toHaveBeenCalledTimes(1)
    const [option, opts] = props.onConfirm.mock.calls[0]
    expect(option.number).toBe(1)
    expect(option.mode).toBe('before')
    expect(option.partId).toBe('p-a')
    expect(opts.openEditor).toBe(false)
  })

  it('"Insert and edit" is the same placement, plus the editor', () => {
    const props = renderPicker({ sections: [standalone('mcq')], parts: [] })
    fireEvent.click(screen.getByRole('button', { name: /Insert and edit/ }))
    expect(props.onConfirm.mock.calls[0][1]).toEqual({ openEditor: true })
  })

  it('an incompatible position is SHOWN and disabled, with the reason', () => {
    const parts = [
      { id: 'p-a', title: 'Multiple choice', order: 0 },
      { id: 'p-b', title: 'Structured', order: 1 },
    ]
    renderPicker({
      sections: [standalone('mcq', 'p-a'), standalone('diagram', 'p-b'), standalone('diagram', 'p-b')],
      parts,
    })
    // The structured section's positions exist — a teacher looking for Q2 finds
    // out why it is not on offer instead of wondering where it went.
    const q2 = screen.getByRole('button', { name: /as Q2 — Q2 is in Section B — Structured/ })
    expect(q2).toBeDisabled()
    expect(q2).toHaveAttribute('title', expect.stringContaining('multiple choice question'))
    // The compatible section's own positions are still offered.
    expect(screen.getByRole('button', { name: 'as Q1' })).toBeEnabled()
  })

  it('no compatible section: it says so and offers to add one, instead of placing anyway', () => {
    const parts = [{ id: 'p-a', title: 'Structured', order: 0 }]
    const props = renderPicker({
      sections: [standalone('diagram', 'p-a'), standalone('diagram', 'p-a')],
      parts,
    })
    expect(screen.getByText(/nowhere to put a multiple choice question/i)).toBeInTheDocument()
    // No position may be confirmed.
    expect(screen.queryByRole('button', { name: /^Insert as/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Add a Multiple choice section/i }))
    expect(props.onAddSection).toHaveBeenCalledWith('mcq')
    expect(props.onConfirm).not.toHaveBeenCalled()
  })

  it('True/False never lands in a multiple-choice section', () => {
    const parts = [{ id: 'p-a', title: 'Multiple choice', order: 0 }]
    renderPicker({
      sections: [standalone('mcq', 'p-a')],
      parts,
      question: { text: 'The sun is a star.', type: 'tf', options: ['True', 'False'] },
    })
    expect(screen.getByText(/nowhere to put a true \/ false question/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add a True \/ False section/i })).toBeInTheDocument()
  })

  it('an A–E question into an A–D paper is reported, and nothing is dropped', () => {
    renderPicker({
      sections: [standalone('mcq')],
      parts: [],
      question: { text: 'Pick one', type: 'mcq', options: ['a', 'b', 'c', 'd', 'e'] },
      optionConflict: { have: 5, allowed: 4 },
    })
    const warning = screen.getByText(/has 5 answer options; this paper prints 4/i)
    expect(warning).toBeInTheDocument()
    expect(within(warning.parentElement).getByText(/nothing is dropped/i)).toBeInTheDocument()
    // It is a warning, not a block — the teacher still chooses a position.
    expect(screen.getByRole('button', { name: /^Insert as Q2$/ })).toBeEnabled()
  })

  it('an empty paper offers its one position rather than refusing the question', () => {
    renderPicker({ sections: [], parts: [] })
    expect(screen.getByRole('button', { name: 'as Q1' })).toBeEnabled()
    expect(screen.queryByText(/nowhere to put/i)).not.toBeInTheDocument()
  })

  it('renders nothing until it is opened', () => {
    const { container } = render(
      <QuestionBankPlacementPicker open={false} plan={buildPlacementPlan({ sections: [], parts: [] }, { type: 'mcq' })} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
