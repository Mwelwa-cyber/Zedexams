import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import NotesPagesPreview from './NotesPagesPreview.jsx'

// jsdom has no layout engine, so the real measurement cannot run here and this
// suite does not pretend otherwise. What it holds still is the behaviour AROUND
// the measurement — which is where the failure that matters lives:
//
//   • a measured document draws one sheet per measured page, each labelled;
//   • an UNMEASURED one draws one continuous sheet and says the count is
//     unavailable, rather than page boxes whose boundaries nobody verified;
//   • the answer page is always its own sheet, marked as a separate file.
//
// The measurement itself is verified against a real browser — see the
// pagination pipeline's own coverage — because a page count is only worth
// having if a printer agrees with it.

const measureNotesPages = vi.fn()
vi.mock('../lib/notesPagination.js', async () => {
  const actual = await vi.importActual('../lib/notesPagination.js')
  return { ...actual, measureNotesPages: (...args) => measureNotesPages(...args) }
})

const NOTES = {
  audience: 'learner',
  format: 'handout',
  paperSize: 'a4',
  header: { title: 'Digestion', grade: 'Grade 7', subject: 'integrated_science' },
  learningOutcomes: ['You will name the parts of your digestive system.'],
  sections: [
    { heading: 'Your mouth', body: ['Your teeth cut food up.'], definitions: [], recap: '' },
    { heading: 'Your stomach', body: ['Your stomach mixes food.'], definitions: [], recap: '' },
  ],
  workedExamples: [],
  dontMixThese: [],
  learnerQuestions: [],
  rememberBox: ['Digestion starts in your mouth.'],
  exercise: { instructions: 'Answer in your book.', questions: [{ number: 1, prompt: 'Name two parts.', marks: 2 }] },
  answerKey: { answers: [{ number: 1, answer: 'mouth, stomach', note: '' }], diagramLabels: [] },
  diagrams: [],
}

beforeEach(() => { measureNotesPages.mockReset() })

describe('NotesPagesPreview', () => {
  it('draws one labelled sheet per measured page', async () => {
    const { buildLearnerNotesBlocks } = await import('../../../utils/learnerNotesPrintable.js')
    const blocks = buildLearnerNotesBlocks(NOTES)
    const half = Math.ceil(blocks.length / 2)
    measureNotesPages.mockResolvedValue({
      status: 'ready',
      pageCount: 2,
      pages: [
        { pageNumber: 1, blockIds: blocks.slice(0, half).map((b) => b.id) },
        { pageNumber: 2, blockIds: blocks.slice(half).map((b) => b.id) },
      ],
      blocks,
    })

    render(<NotesPagesPreview notes={NOTES} paper="a4" />)
    await waitFor(() => expect(screen.getByText('Page 1 of 2 · A4 portrait')).toBeInTheDocument())
    expect(screen.getByText('Page 2 of 2 · A4 portrait')).toBeInTheDocument()
    expect(screen.getByText('2 pages · A4')).toBeInTheDocument()
  })

  it('says the count is unavailable rather than drawing unverified pages', async () => {
    measureNotesPages.mockResolvedValue({ status: 'failed', pageCount: 0, pages: [], issues: [] })
    render(<NotesPagesPreview notes={NOTES} paper="a4" />)
    await waitFor(() => expect(screen.getByText('Page count unavailable')).toBeInTheDocument())
    // The document is still readable — a failed measurement means we do not
    // know where the pages break, not that there is nothing to show.
    expect(screen.queryByText(/Page 1 of/)).toBeNull()
  })

  it('reflows when the paper changes', async () => {
    measureNotesPages.mockResolvedValue({ status: 'ready', pageCount: 3, pages: [], blocks: [] })
    const { rerender } = render(<NotesPagesPreview notes={NOTES} paper="a4" />)
    await waitFor(() => expect(measureNotesPages).toHaveBeenCalledWith(NOTES, 'a4'))
    rerender(<NotesPagesPreview notes={NOTES} paper="a5" />)
    await waitFor(() => expect(measureNotesPages).toHaveBeenCalledWith(NOTES, 'a5'))
  })

  it('shows the answer page as its own sheet, marked separate', async () => {
    const { buildAnswerPageBlocks } = await import('../../../utils/learnerNotesPrintable.js')
    measureNotesPages.mockResolvedValue({ status: 'failed', pageCount: 0, pages: [], blocks: [] })
    render(
      <NotesPagesPreview notes={NOTES} paper="a4" answerPageBlocks={buildAnswerPageBlocks(NOTES)} />,
    )
    await waitFor(() => {
      expect(screen.getByText("Teacher's answer page · separate file")).toBeInTheDocument()
    })
  })

  it('renders the board look only when asked, and only as a preview', async () => {
    measureNotesPages.mockResolvedValue({ status: 'failed', pageCount: 0, pages: [], blocks: [] })
    const { rerender } = render(<NotesPagesPreview notes={NOTES} paper="a4" />)
    expect(screen.getByTestId('notes-pages-preview').className).not.toContain('ln-board')
    rerender(<NotesPagesPreview notes={NOTES} paper="a4" boardPreview />)
    expect(screen.getByTestId('notes-pages-preview').className).toContain('ln-board')
  })
})
