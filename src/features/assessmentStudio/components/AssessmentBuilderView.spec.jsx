/**
 * The builder's toolbar.
 *
 * It was two rows of chips — four view links plus nine tools, every one the
 * same size and weight, with the destructive "Clear all" sitting immediately
 * beside "Save to library". These tests pin the three things that change makes
 * true: one row, the tools behind one menu, and Clear all reachable only by
 * opening the overflow AND confirming.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { BuilderView } from './AssessmentBuilderView.jsx'

// The canvas below the toolbar drags in the whole editor stack; this spec is
// about the bar, so the blocks are stubbed out.
vi.mock('./AssessmentBlocks', () => ({
  HeaderBlock: () => <div data-testid="header-block" />,
  InstructionsBlock: () => null,
  SectionBlock: () => null,
  FooterBlock: () => null,
}))
vi.mock('./MathsRichField.jsx', () => ({
  MathsEditingProvider: ({ children }) => children,
  default: () => null,
}))
vi.mock('./AssessmentQuestionEditors', () => ({ toEditableText: (v) => (typeof v === 'string' ? v : '') }))
vi.mock('../../../components/quiz/documentQuizImporter', () => ({ QUIZ_DOCUMENT_ACCEPT: '.doc,.pdf' }))
vi.mock('./studioIcons', () => ({ default: () => null }))

const form = { grade: '4', subject: 'Mathematics', ungroupedOrder: 0 }

function renderBar(props = {}) {
  const handlers = {
    changeView: vi.fn(),
    onClearAll: vi.fn(),
    onShowTemplates: vi.fn(),
    onCreatePaper: vi.fn(),
    onOpenBank: vi.fn(),
    onVerifyPaper: vi.fn(),
    onOpenDiagramFix: vi.fn(),
    onOpenAi: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onImportDocument: vi.fn(),
  }
  render(
    <BuilderView
      form={form}
      setF={vi.fn()}
      sections={[{ id: 's1', kind: 'standalone', question: { localId: 'q1', text: 'Hello', marks: 1 } }]}
      parts={[]}
      questionNumbers={{ q1: 1 }}
      questionCount={1}
      totalMarks={1}
      pagination={{ label: '2 pages', status: 'ready', pageCount: 2 }}
      canUndo
      canRedo
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

const openTools = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Tools' }))
  return screen.getByRole('menu')
}
const openOverflow = () => {
  fireEvent.click(screen.getByRole('button', { name: /more paper actions/i }))
  return screen.getByRole('menu')
}

describe('BuilderView — one toolbar row', () => {
  it('navigation is one segmented control, not four loose chips', () => {
    const { changeView } = renderBar()
    const nav = screen.getByRole('group', { name: 'Paper view' })
    const buttons = within(nav).getAllByRole('button')
    expect(buttons.map(b => b.textContent.trim())).toEqual(['Builder', 'Preview', 'Key', 'Spec'])
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(buttons[1])
    expect(changeView).toHaveBeenCalledWith('preview')
  })

  it('the nine tool chips are one menu', () => {
    const { onShowTemplates } = renderBar()
    const menu = openTools()
    const labels = within(menu).getAllByRole('menuitem').map(i => i.textContent.trim())
    expect(labels).toEqual([
      'Templates', 'Create with AI', 'Question bank', 'Import paper',
      'Check paper', 'Diagrams', 'More AI',
    ])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Templates' }))
    expect(onShowTemplates).toHaveBeenCalled()
  })

  it('undo and redo live here now, not in the app bar', () => {
    const { onUndo, onRedo } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(onUndo).toHaveBeenCalled()
    expect(onRedo).toHaveBeenCalled()
  })

  it('Clear all is not a control on the surface any more', () => {
    // It used to be a chip one position away from "Save to library".
    const { onClearAll } = renderBar()
    expect(screen.queryByRole('button', { name: /^Clear all$/ })).toBeNull()
    expect(onClearAll).not.toHaveBeenCalled()
  })

  it('reaching Clear all takes the overflow, and then it only ASKS', () => {
    const { onClearAll } = renderBar()
    const menu = openOverflow()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /clear all questions/i }))
    // The ellipsis in the label is the promise: this opens the studio's
    // confirm dialog, it does not clear anything. That is the pattern
    // ActionMenu documents for every danger item — the caller owns the confirm.
    expect(onClearAll).toHaveBeenCalledTimes(1)
  })

  it('an empty paper cannot clear itself', () => {
    renderBar({
      sections: [{ id: 's1', kind: 'standalone', question: { localId: 'q1', text: '', correctAnswer: 0 } }],
    })
    const menu = openOverflow()
    expect(within(menu).getByRole('menuitem', { name: /clear all questions/i })).toBeDisabled()
  })

  it('the page count is reported as measured, never guessed', () => {
    renderBar({ pagination: null })
    expect(screen.getByText(/Calculating pages…/)).toBeInTheDocument()
  })

  it('the timing note is handed to the header, not stacked with the warnings', () => {
    // Two renderers for one fact is how it ends up on screen twice, or lost
    // when the header collapses.
    renderBar({
      warnings: [
        { key: 'timing-under', severity: 'info', message: 'Estimated ~1 min — well under the 60 min allowed.' },
        { key: 'marks-mismatch', severity: 'warn', message: 'Section A marks do not add up.' },
      ],
    })
    expect(screen.getByText('Section A marks do not add up.')).toBeInTheDocument()
    expect(screen.queryByText(/Estimated ~1 min/)).toBeNull()
  })
})
