/**
 * The builder toolbar, after the two rows of nine chips became one row.
 *
 * What is worth pinning here is not the layout but the two SAFETY properties
 * the consolidation was for: "Clear all" no longer sits on the surface beside
 * Save (it needs the overflow opened, and it still asks to confirm), and every
 * tool the old rows offered is still reachable — a tidier bar that quietly
 * dropped a tool would be a worse bar.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BuilderView, SmartWarningsBanner, timingWarning } from './AssessmentBuilderView.jsx'

vi.mock('./AssessmentBlocks', () => ({
  HeaderBlock: () => null,
  InstructionsBlock: () => null,
  SectionBlock: () => null,
  FooterBlock: () => null,
}))
vi.mock('../AssessmentQuestionEditors', () => ({ toEditableText: (v) => (typeof v === 'string' ? v : '') }))
vi.mock('../MathsRichField.jsx', () => ({ MathsEditingProvider: ({ children }) => children }))
vi.mock('../../quiz/documentQuizImporter', () => ({ QUIZ_DOCUMENT_ACCEPT: '.doc,.pdf' }))
vi.mock('../assessmentStudioMeta', () => ({ SECTION_LETTERS: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') }))

const FORM = { grade: '4', subject: 'English', ungroupedOrder: 0 }

function renderBuilder(props = {}) {
  const handlers = {
    onClearAll: vi.fn(), onSave: vi.fn(), onShowTemplates: vi.fn(), onCreatePaper: vi.fn(),
    onOpenBank: vi.fn(), onVerifyPaper: vi.fn(), onOpenDiagramFix: vi.fn(), onOpenAi: vi.fn(),
    onUndo: vi.fn(), onRedo: vi.fn(), onImportDocument: vi.fn(), changeView: vi.fn(),
    onAddBlock: vi.fn(), onToggleHeader: vi.fn(),
  }
  render(
    <BuilderView
      form={FORM}
      setF={vi.fn()}
      sections={[{ id: 's1', kind: 'standalone', question: { localId: 'q1', text: 'A question' } }]}
      parts={[]}
      questionNumbers={{ q1: 1 }}
      questionCount={1}
      totalMarks={2}
      canUndo
      canRedo
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

const openTools = () => fireEvent.click(screen.getByRole('button', { name: /^tools$/i }))
const openOverflow = () => fireEvent.click(screen.getByRole('button', { name: /more paper actions/i }))

describe('BuilderView toolbar — one row', () => {
  it('Clear all is NOT on the surface — it takes opening the overflow', () => {
    renderBuilder()
    expect(screen.queryByRole('button', { name: /clear all/i })).toBeNull()
    openOverflow()
    expect(screen.getByRole('menuitem', { name: /clear all questions/i })).toBeInTheDocument()
  })

  it('choosing Clear all hands off to the confirm step rather than clearing', () => {
    // The menu item opens the studio's ConfirmDialog; it must never be the
    // thing that empties the paper.
    const { onClearAll } = renderBuilder()
    openOverflow()
    const item = screen.getByRole('menuitem', { name: /clear all questions/i })
    expect(item).toHaveTextContent(/asks you to confirm first/i)
    fireEvent.click(item)
    expect(onClearAll).toHaveBeenCalledTimes(1)
  })

  it('Clear all is refused on a paper that has nothing to clear', () => {
    renderBuilder({
      sections: [{ id: 's1', kind: 'standalone', question: { localId: 'q1', text: '', correctAnswer: 0 } }],
    })
    openOverflow()
    expect(screen.getByRole('menuitem', { name: /clear all questions/i })).toBeDisabled()
  })

  it('every tool the two chip rows offered is still reachable under Tools', () => {
    renderBuilder()
    openTools()
    for (const name of [/templates/i, /create with ai/i, /question bank/i, /import paper/i, /check paper/i, /diagrams/i, /more ai/i]) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument()
    }
  })

  it('Save stays visible, on the surface, at all times', () => {
    const { onSave } = renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalled()
  })

  it('the four views are one segmented control', () => {
    const { changeView } = renderBuilder()
    expect(screen.getByRole('button', { name: /builder/i })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('button', { name: /preview/i }))
    expect(changeView).toHaveBeenCalledWith('preview')
    fireEvent.click(screen.getByRole('button', { name: /^key$/i }))
    expect(changeView).toHaveBeenCalledWith('marking-key')
    fireEvent.click(screen.getByRole('button', { name: /^spec$/i }))
    expect(changeView).toHaveBeenCalledWith('tos')
  })

  it('undo and redo moved here from the app bar, shortcuts intact', () => {
    const { onUndo, onRedo } = renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /undo/i }))
    fireEvent.click(screen.getByRole('button', { name: /redo/i }))
    expect(onUndo).toHaveBeenCalled()
    expect(onRedo).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /undo/i })).toHaveAttribute('title', expect.stringMatching(/Ctrl\+Z/))
  })
})

describe('SmartWarningsBanner — timing is a fact, not a fix', () => {
  const TIMING = { key: 'timing-under', severity: 'info', message: 'Estimated ~1 min — well under the 60 min allowed.' }
  const REAL = { key: 'no-answer', severity: 'error', message: 'Question 2 has no correct answer.' }

  it('leaves the timing row to the header summary card', () => {
    render(<SmartWarningsBanner warnings={[TIMING, REAL]} />)
    expect(screen.queryByText(/Estimated ~1 min/)).toBeNull()
    expect(screen.getByText(/no correct answer/)).toBeInTheDocument()
  })

  it('renders nothing at all when timing was the only warning', () => {
    const { container } = render(<SmartWarningsBanner warnings={[TIMING]} />)
    expect(container.querySelector('.sv-warnings')).toBeNull()
  })

  it('timingWarning finds either timing verdict, and nothing else', () => {
    expect(timingWarning([REAL, TIMING])).toBe(TIMING)
    const over = { key: 'timing-over', message: 'x' }
    expect(timingWarning([over])).toBe(over)
    expect(timingWarning([REAL])).toBeNull()
    expect(timingWarning()).toBeNull()
  })
})
