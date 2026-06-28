import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import DiagramHandlingChooser from './DiagramHandlingChooser'

// Stub the Cloud Function wrapper so the component test never touches Firebase.
// Keep the real DIAGRAM_HANDLING_OPTIONS export so the five buttons render.
const mockRedraw = vi.fn()
vi.mock('../../../utils/testPaperDiagram', () => ({
  DIAGRAM_HANDLING_OPTIONS: [
    { id: 'keep_original', label: 'Keep original image', generates: false },
    { id: 'clean_original', label: 'Clean original drawing', generates: false },
    { id: 'redraw', label: 'Redraw using AI', generates: true },
    { id: 'replace', label: 'Replace with a better educational diagram', generates: true },
    { id: 'remove', label: 'Remove diagram and leave blank space', generates: false },
  ],
  redrawTestPaperDiagram: (...args) => mockRedraw(...args),
}))

// Stub the in-browser cleaning pipeline (real impl needs a canvas + pixels).
const mockClean = vi.fn(async () => ({
  dataUrl: 'data:image/png;base64,CLEAN',
  blob: new Blob(['clean'], { type: 'image/png' }),
  width: 10,
  height: 10,
  bounds: {},
}))
vi.mock('../../../utils/diagramClean.js', () => ({
  isDiagramCleanSupported: () => true,
  cleanDiagramSource: (...args) => mockClean(...args),
}))

const detected = { kind: 'plant', caption: 'Flowering plant', labels: ['stem', 'roots'] }
const context = { subject: 'Science', grade: 'Grade 4' }

describe('DiagramHandlingChooser', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders all five handling options and the figure caption', () => {
    render(<DiagramHandlingChooser detected={detected} context={context} onResolved={() => {}} />)
    expect(screen.getByText('Flowering plant')).toBeInTheDocument()
    expect(screen.getByText('Keep original image')).toBeInTheDocument()
    expect(screen.getByText('Clean original drawing')).toBeInTheDocument()
    expect(screen.getByText('Redraw using AI')).toBeInTheDocument()
    expect(screen.getByText('Replace with a better educational diagram')).toBeInTheDocument()
    expect(screen.getByText('Remove diagram and leave blank space')).toBeInTheDocument()
  })

  it('calls the redraw wrapper and surfaces a reused-from-library result', async () => {
    mockRedraw.mockResolvedValueOnce({
      action: 'reused', url: 'https://lib/plant.png', source: 'library',
    })
    const onResolved = vi.fn()
    render(<DiagramHandlingChooser detected={detected} context={context} onResolved={onResolved} />)

    fireEvent.click(screen.getByText('Redraw using AI'))

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1))
    expect(mockRedraw).toHaveBeenCalledWith(
      expect.objectContaining({ detected, handling: 'redraw', context }),
    )
    expect(await screen.findByText('Reused from library')).toBeInTheDocument()
  })

  it('shows a blank-space result when the teacher removes the diagram', async () => {
    mockRedraw.mockResolvedValueOnce({ action: 'removed', url: null, source: 'none' })
    render(<DiagramHandlingChooser detected={detected} context={context} onResolved={() => {}} />)

    fireEvent.click(screen.getByText('Remove diagram and leave blank space'))

    expect(await screen.findByText('Blank space')).toBeInTheDocument()
  })

  it('surfaces an error when the wrapper rejects', async () => {
    mockRedraw.mockRejectedValueOnce(new Error('Monthly diagram limit reached.'))
    render(<DiagramHandlingChooser detected={detected} context={context} onResolved={() => {}} />)

    fireEvent.click(screen.getByText('Replace with a better educational diagram'))

    expect(await screen.findByText('Monthly diagram limit reached.')).toBeInTheDocument()
  })

  it('cleans the original in-browser and uploads the result (no server call)', async () => {
    const onCleanUpload = vi.fn(async () => 'https://store/clean.png')
    const onResolved = vi.fn()
    render(
      <DiagramHandlingChooser
        detected={detected}
        context={context}
        originalUrl="https://store/original.png"
        onCleanUpload={onCleanUpload}
        onResolved={onResolved}
      />,
    )

    fireEvent.click(screen.getByText('Clean original drawing'))

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1))
    // The clean path runs locally — the Cloud Function wrapper is never called.
    expect(mockRedraw).not.toHaveBeenCalled()
    expect(mockClean).toHaveBeenCalledWith(
      'https://store/original.png',
      expect.objectContaining({ blackAndWhite: true, autoCrop: true }),
    )
    expect(onCleanUpload).toHaveBeenCalledTimes(1)
    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cleaned', url: 'https://store/clean.png' }),
    )
    expect(await screen.findByText('Cleaned')).toBeInTheDocument()
  })

  it('keeps the Original preview pinned to the pristine scan after cleaning', async () => {
    const onResolved = vi.fn()
    const { rerender } = render(
      <DiagramHandlingChooser
        detected={detected}
        context={context}
        originalUrl="https://store/original.png"
        onCleanUpload={async () => 'https://store/clean.png'}
        onResolved={onResolved}
      />,
    )

    fireEvent.click(screen.getByText('Clean original drawing'))
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1))

    // Simulate the parent patching ref.imageUrl to the cleaned URL (the bug:
    // this used to drag the "Original" preview to the cleaned image too).
    rerender(
      <DiagramHandlingChooser
        detected={detected}
        context={context}
        originalUrl="https://store/clean.png"
        onCleanUpload={async () => 'https://store/clean.png'}
        onResolved={onResolved}
      />,
    )

    // Original stays on the pristine scan; only Result shows the cleaned image.
    expect(screen.getByAltText('Original scanned figure')).toHaveAttribute(
      'src',
      'https://store/original.png',
    )
    expect(screen.getByAltText('Resulting figure')).toHaveAttribute(
      'src',
      'https://store/clean.png',
    )
  })

  it('shows a friendly message when in-browser cleaning fails', async () => {
    mockClean.mockRejectedValueOnce(new Error('tainted canvas'))
    render(
      <DiagramHandlingChooser
        detected={detected}
        context={context}
        originalUrl="https://store/original.png"
        onCleanUpload={async () => 'x'}
        onResolved={() => {}}
      />,
    )

    fireEvent.click(screen.getByText('Clean original drawing'))

    expect(
      await screen.findByText('Could not clean this figure automatically.', { exact: false }),
    ).toBeInTheDocument()
  })

  it('refuses to clean when there is no scanned crop (no silent server no-op)', async () => {
    const onResolved = vi.fn()
    render(
      <DiagramHandlingChooser
        detected={detected}
        context={context}
        originalUrl={null}
        onCleanUpload={async () => 'x'}
        onResolved={onResolved}
      />,
    )

    fireEvent.click(screen.getByText('Clean original drawing'))

    expect(
      await screen.findByText('no scanned figure to clean', { exact: false }),
    ).toBeInTheDocument()
    expect(mockClean).not.toHaveBeenCalled()
    expect(mockRedraw).not.toHaveBeenCalled()
    expect(onResolved).not.toHaveBeenCalled()
  })

  it('fails loudly instead of persisting a data URL when the upload returns nothing', async () => {
    const onResolved = vi.fn()
    render(
      <DiagramHandlingChooser
        detected={detected}
        context={context}
        originalUrl="https://store/original.png"
        onCleanUpload={async () => null}
        onResolved={onResolved}
      />,
    )

    fireEvent.click(screen.getByText('Clean original drawing'))

    expect(
      await screen.findByText('Could not save the cleaned figure', { exact: false }),
    ).toBeInTheDocument()
    expect(onResolved).not.toHaveBeenCalled()
  })
})
