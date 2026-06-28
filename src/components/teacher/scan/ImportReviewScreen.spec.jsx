import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import ImportReviewScreen from './ImportReviewScreen'

// Stub the diagram chooser (its real impl pulls in Firebase). Expose a button
// that fires onResolved so we can assert the screen wires the result back.
vi.mock('./DiagramHandlingChooser', () => ({
  default: ({ onResolved }) => (
    <button onClick={() => onResolved({ action: 'redrawn', url: 'https://gen/x.png', source: 'generated' })}>
      stub-redraw
    </button>
  ),
}))

// Stub the crop modal (canvas/DOM heavy). Expose a button that returns a blob.
vi.mock('../../quiz/ImageCropModal', () => ({
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
})
