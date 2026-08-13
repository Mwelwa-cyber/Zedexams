import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import ImportReviewScreen from './ImportReviewScreen'

// Stub the diagram chooser (its real impl pulls in Firebase). Expose buttons
// that fire onResolved / onError so we can assert the screen wires them back.
vi.mock('./DiagramHandlingChooser', () => ({
  default: ({ onResolved, onError }) => (
    <>
      <button onClick={() => onResolved({ action: 'redrawn', url: 'https://gen/x.png', source: 'generated' })}>
        stub-redraw
      </button>
      <button onClick={() => onError && onError('Could not rebuild this item automatically.')}>
        stub-fail
      </button>
    </>
  ),
}))

// Stub the crop modal (canvas/DOM heavy). Expose a button that returns a blob.
vi.mock('../../../../components/quiz/ImageCropModal', () => ({
  default: ({ onCropped }) => (
    <button onClick={() => onCropped(new Blob(['x'], { type: 'image/png' }))}>stub-crop-done</button>
  ),
}))

const sections = [
  { kind: 'standalone', question: { text: '<p>What is 2+2?</p>', type: 'mcq', options: ['3', '4', '5', '6'], correctAnswer: '', sourceQuestionNumber: 1, sourcePage: 1, requiresReview: true } },
  { kind: 'standalone', question: { text: 'Study the figure', type: 'mcq', options: ['a', 'b'], correctAnswer: '', sourceQuestionNumber: 2, sourcePage: 1, hasDiagram: true } },
]

describe('ImportReviewScreen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders nothing when closed', () => {
    const { container } = render(<ImportReviewScreen open={false} sections={sections} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the review tally and page grouping', () => {
    render(<ImportReviewScreen open sections={sections} onPatchItem={() => {}} onClose={() => {}} onDone={() => {}} />)
    expect(screen.getByText('Review imported paper')).toBeInTheDocument()
    expect(screen.getByText('Page 1')).toBeInTheDocument()
    // Both questions need an answer → "No answer" badges present.
    expect(screen.getAllByText('No answer').length).toBe(2)
    // The figure question shows the missing-diagram flag.
    expect(screen.getByText('Missing diagram')).toBeInTheDocument()
  })

  it('shows a Ready status chip for a clean question and Needs review otherwise', () => {
    const mixed = [
      { kind: 'standalone', question: { text: 'Clean Q', type: 'mcq', options: ['a', 'b'], correctAnswer: 1, sourceQuestionNumber: 1, sourcePage: 1 } },
      { kind: 'standalone', question: { text: 'Needs Q', type: 'mcq', options: ['a', 'b'], correctAnswer: '', sourceQuestionNumber: 2, sourcePage: 1, requiresReview: true } },
    ]
    render(<ImportReviewScreen open sections={mixed} onPatchItem={() => {}} onClose={() => {}} onDone={() => {}} />)
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Needs review')).toBeInTheDocument()
  })

  it('shows the figure detection confidence as a percentage', () => {
    const withConfidence = [
      { kind: 'standalone', question: { text: 'Figure Q', type: 'mcq', options: ['a', 'b'], correctAnswer: 0, sourceQuestionNumber: 1, sourcePage: 1, imageUrl: 'blob:f', diagramMeta: { confidence: 0.82 } } },
    ]
    render(<ImportReviewScreen open sections={withConfidence} onPatchItem={() => {}} onClose={() => {}} onDone={() => {}} />)
    expect(screen.getByText('82% confidence')).toBeInTheDocument()
  })

  it('flips the item to a Failed status when a figure action errors', () => {
    const withFigure = [
      { kind: 'standalone', question: { text: 'Study the figure', type: 'mcq', options: ['a', 'b'], correctAnswer: 0, sourceQuestionNumber: 1, sourcePage: 1, imageUrl: 'blob:f' } },
    ]
    render(<ImportReviewScreen open sections={withFigure} onPatchItem={() => {}} onClose={() => {}} onDone={() => {}} />)
    expect(screen.queryByText('Failed')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('stub-fail'))
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('patches the correct answer when an option is picked', () => {
    const onPatchItem = vi.fn()
    render(<ImportReviewScreen open sections={sections} onPatchItem={onPatchItem} onClose={() => {}} onDone={() => {}} />)
    // Q1 option "4" (index 1).
    fireEvent.click(screen.getByLabelText('B. 4'))
    expect(onPatchItem).toHaveBeenCalledWith(
      expect.objectContaining({ sectionIndex: 0, questionIndex: null }),
      expect.objectContaining({ correctAnswer: 1, requiresReview: false }),
    )
  })

  it('wires a resolved diagram back into the item image', () => {
    const onPatchItem = vi.fn()
    render(<ImportReviewScreen open sections={sections} onPatchItem={onPatchItem} onClose={() => {}} onDone={() => {}} />)
    fireEvent.click(screen.getByText('stub-redraw'))
    expect(onPatchItem).toHaveBeenCalledWith(
      expect.objectContaining({ sectionIndex: 1 }),
      expect.objectContaining({ imageUrl: 'https://gen/x.png', imageAssetId: '' }),
    )
  })

  it('shows the original page image when a page url is provided', () => {
    render(
      <ImportReviewScreen
        open
        sections={sections}
        pageImageUrls={{ 1: 'blob:page-1' }}
        onPatchItem={() => {}}
        onClose={() => {}}
        onDone={() => {}}
      />,
    )
    const img = screen.getByAltText('Original page 1')
    expect(img).toHaveAttribute('src', 'blob:page-1')
  })

  it('falls back to a notice when no original page image is available', () => {
    render(<ImportReviewScreen open sections={sections} onPatchItem={() => {}} onClose={() => {}} onDone={() => {}} />)
    expect(screen.getByText('Original page preview not available', { exact: false })).toBeInTheDocument()
  })

  it('adds a missing question via the callback', () => {
    const onAddQuestion = vi.fn()
    render(<ImportReviewScreen open sections={sections} onPatchItem={() => {}} onAddQuestion={onAddQuestion} onClose={() => {}} onDone={() => {}} />)
    fireEvent.click(screen.getByText('+ Add a missing question'))
    expect(onAddQuestion).toHaveBeenCalledTimes(1)
  })

  it('crops a figure through the modal and hands the blob back', async () => {
    const onCropFigure = vi.fn()
    const withFigure = [
      { kind: 'standalone', question: { text: 'Study the figure', type: 'mcq', options: ['a', 'b'], correctAnswer: 0, sourceQuestionNumber: 1, sourcePage: 1, imageUrl: 'blob:fig1' } },
    ]
    render(<ImportReviewScreen open sections={withFigure} onPatchItem={() => {}} onCropFigure={onCropFigure} onClose={() => {}} onDone={() => {}} />)
    fireEvent.click(screen.getByText('Crop figure'))
    fireEvent.click(await screen.findByText('stub-crop-done'))
    expect(onCropFigure).toHaveBeenCalledTimes(1)
    expect(onCropFigure.mock.calls[0][1]).toBeInstanceOf(Blob)
  })

  it('shows a "Missing labels" badge for an identify diagram with no labels', () => {
    const labelQ = [
      { kind: 'standalone', question: { text: 'Label the plant', type: 'diagram', diagramMode: 'identify', diagramLabels: [], imageUrl: 'blob:p', sourceQuestionNumber: 1, sourcePage: 1 } },
    ]
    render(<ImportReviewScreen open sections={labelQ} onPatchItem={() => {}} onClose={() => {}} onDone={() => {}} />)
    expect(screen.getByText('Missing labels')).toBeInTheDocument()
  })

  it('approving every page is required before the gate reads complete', () => {
    const onDone = vi.fn()
    render(<ImportReviewScreen open sections={sections} onPatchItem={() => {}} onClose={() => {}} onDone={onDone} />)
    // Before approval the CTA says "anyway".
    expect(screen.getByText('Open in builder anyway')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Approve this page'))
    expect(screen.getByText('Open in builder')).toBeInTheDocument()
  })

  // ── Bug [0] regression: textarea is seeded with the full un-truncated text ──
  it('editing a long passage writes back the full re-encoded text, not a 280-char truncation', () => {
    const longText = 'A'.repeat(400)
    const passageSections = [
      {
        kind: 'passage',
        passage: {
          title: 'Long Passage',
          passageText: `<p>${longText}</p>`,
          sourcePage: 1,
          questions: [
            { text: 'Q1', type: 'mcq', options: ['a', 'b'], correctAnswer: 0, sourcePage: 1 },
          ],
        },
      },
    ]
    const onPatchItem = vi.fn()
    render(
      <ImportReviewScreen
        open
        sections={passageSections}
        onPatchItem={onPatchItem}
        onClose={() => {}}
        onDone={() => {}}
      />,
    )
    const textarea = screen.getByLabelText('Long Passage text')
    // Seed is the full text, not truncated at 280.
    expect(textarea.value.length).toBeGreaterThan(280)
    // Editing writes back re-encoded rich HTML, not a flat truncated string.
    fireEvent.change(textarea, { target: { value: 'Corrected passage text' } })
    fireEvent.blur(textarea)
    expect(onPatchItem).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'passage' }),
      expect.objectContaining({ passageText: '<p>Corrected passage text</p>' }),
    )
  })

  // ── Bug [9] regression: unanswered MCQ radio state ──────────────────────────
  it('an unanswered MCQ renders no radio checked, and clicking option A patches correctAnswer to 0', () => {
    const onPatchItem = vi.fn()
    const unansweredSections = [
      {
        kind: 'standalone',
        question: {
          text: 'Which is correct?',
          type: 'mcq',
          options: ['Alpha', 'Beta'],
          correctAnswer: '',
          sourceQuestionNumber: 1,
          sourcePage: 1,
        },
      },
    ]
    render(
      <ImportReviewScreen
        open
        sections={unansweredSections}
        onPatchItem={onPatchItem}
        onClose={() => {}}
        onDone={() => {}}
      />,
    )
    // No radio may be checked when correctAnswer is '' (unanswered).
    const radios = screen.getAllByRole('radio')
    radios.forEach((radio) => expect(radio).not.toBeChecked())
    // Clicking option A (index 0) must fire onChange and patch correctAnswer=0.
    fireEvent.click(screen.getByLabelText('A. Alpha'))
    expect(onPatchItem).toHaveBeenCalledWith(
      expect.objectContaining({ sectionIndex: 0 }),
      expect.objectContaining({ correctAnswer: 0 }),
    )
  })
})
