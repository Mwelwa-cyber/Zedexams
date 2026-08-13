import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import DiagramHandlingChooser from './DiagramHandlingChooser'

// Stub the Cloud Function wrapper so the component test never touches Firebase.
// Keep the real DIAGRAM_HANDLING_OPTIONS export so the five buttons render.
const mockRedraw = vi.fn()
const mockRebuildTable = vi.fn()
vi.mock('../../../../utils/testPaperDiagram', () => ({
  DIAGRAM_HANDLING_OPTIONS: [
    { id: 'keep_original', label: 'Keep original image', generates: false },
    { id: 'clean_original', label: 'Clean original drawing', generates: false },
    { id: 'convert_svg', label: 'Convert to editable SVG', generates: false, convertsSvg: true },
    { id: 'redraw', label: 'Redraw using AI', generates: true },
    { id: 'rebuild_as_table', label: 'Rebuild as table', generates: true, rebuildsTable: true },
    { id: 'replace', label: 'Replace with a better educational diagram', generates: true },
    { id: 'remove', label: 'Remove diagram and leave blank space', generates: false },
  ],
  redrawTestPaperDiagram: (...args) => mockRedraw(...args),
  rebuildTableFromImage: (...args) => mockRebuildTable(...args),
}))

// Stub the in-browser cleaning pipeline (real impl needs a canvas + pixels).
const mockClean = vi.fn(async () => ({
  dataUrl: 'data:image/png;base64,CLEAN',
  blob: new Blob(['clean'], { type: 'image/png' }),
  width: 10,
  height: 10,
  bounds: {},
}))
const mockSourceToBlob = vi.fn(async () => new Blob(['orig'], { type: 'image/png' }))
vi.mock('../../../../utils/diagramClean.js', () => ({
  isDiagramCleanSupported: () => true,
  cleanDiagramSource: (...args) => mockClean(...args),
  sourceToBlob: (...args) => mockSourceToBlob(...args),
}))

const detected = { kind: 'plant', caption: 'Flowering plant', labels: ['stem', 'roots'] }
const context = { subject: 'Science', grade: 'Grade 4' }

describe('DiagramHandlingChooser', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders all handling options and the figure caption', () => {
    render(<DiagramHandlingChooser detected={detected} context={context} onResolved={() => {}} />)
    expect(screen.getByText('Flowering plant')).toBeInTheDocument()
    expect(screen.getByText('Keep original image')).toBeInTheDocument()
    expect(screen.getByText('Clean original drawing')).toBeInTheDocument()
    expect(screen.getByText('Redraw using AI')).toBeInTheDocument()
    expect(screen.getByText('Rebuild as table')).toBeInTheDocument()
    expect(screen.getByText('Replace with a better educational diagram')).toBeInTheDocument()
    expect(screen.getByText('Remove diagram and leave blank space')).toBeInTheDocument()
  })

  it('auto-rebuilds a table figure into an editable table on mount (no click)', async () => {
    mockRebuildTable.mockResolvedValueOnce({
      action: 'rebuilt_table',
      tableData: { headers: ['Fruit', 'People'], rows: [['orange', '3'], ['mango', '5']] },
      caption: 'Fruit and People',
    })
    const onCleanUpload = vi.fn(async () => 'https://store/table-crop.png')
    const onResolved = vi.fn()
    render(
      <DiagramHandlingChooser
        detected={{ kind: 'pictograph', caption: 'Fruit and People' }}
        context={context}
        originalUrl="https://store/original.png"
        onCleanUpload={onCleanUpload}
        onResolved={onResolved}
      />,
    )

    // Table figures rebuild themselves automatically — the teacher never has to
    // find the right button, and is never routed into the flaky image generator.
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1))
    // The original crop is uploaded, then the vision rebuild runs on that URL.
    expect(mockSourceToBlob).toHaveBeenCalledTimes(1)
    expect(onCleanUpload).toHaveBeenCalledTimes(1)
    expect(mockRebuildTable).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: 'https://store/table-crop.png' }),
    )
    expect(mockRedraw).not.toHaveBeenCalled()
    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'rebuilt_table', handling: 'rebuild_as_table' }),
    )
    // The result panel previews the rebuilt table.
    expect(await screen.findByText('Rebuilt as table')).toBeInTheDocument()
    expect(screen.getByText('orange')).toBeInTheDocument()
    expect(screen.getByText('People')).toBeInTheDocument()
  })

  it('converts a shape figure to an editable SVG without any AI call', async () => {
    const onResolved = vi.fn()
    render(
      <DiagramHandlingChooser
        detected={{ kind: 'shape', caption: 'Triangle ABC' }}
        context={context}
        onResolved={onResolved}
      />,
    )
    fireEvent.click(screen.getByText('Convert to editable SVG'))
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1))
    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'converted_svg',
        source: 'library',
        imageDiagram: expect.objectContaining({ libraryKey: 'triangle' }),
      }),
    )
    expect(mockRedraw).not.toHaveBeenCalled()
    expect(await screen.findByText('Converted to SVG')).toBeInTheDocument()
  })

  it('refuses to fake an SVG for a figure that is not a library shape', async () => {
    const onError = vi.fn()
    render(
      <DiagramHandlingChooser
        detected={{ kind: 'plant', caption: 'A flowering plant' }}
        context={context}
        onResolved={() => {}}
        onError={onError}
      />,
    )
    fireEvent.click(screen.getByText('Convert to editable SVG'))
    await waitFor(() =>
      expect(screen.getByText(/doesn't match an editable library shape/i)).toBeInTheDocument(),
    )
    expect(mockRedraw).not.toHaveBeenCalled()
  })

  it('hides the image-generation options for a table figure and recommends Rebuild as table', () => {
    // No uploader/crop here, so nothing auto-runs — this is a pure render check.
    render(
      <DiagramHandlingChooser
        detected={{ kind: 'table', caption: 'Results table' }}
        context={context}
        onResolved={() => {}}
      />,
    )
    expect(screen.getByText('Rebuild as table (recommended)')).toBeInTheDocument()
    // The flaky AI image-generation options are not offered for a table.
    expect(screen.queryByText('Redraw using AI')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Replace with a better educational diagram'),
    ).not.toBeInTheDocument()
    // Non-generating fallbacks remain available.
    expect(screen.getByText('Keep original image')).toBeInTheDocument()
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

  it('reports failure through onError so the item can flip to Failed', async () => {
    mockRedraw.mockRejectedValueOnce(new Error('The diagram service hit an error.'))
    const onError = vi.fn()
    render(<DiagramHandlingChooser detected={detected} context={context} onResolved={() => {}} onError={onError} />)

    fireEvent.click(screen.getByText('Redraw using AI'))

    await waitFor(() => expect(onError).toHaveBeenCalledWith('The diagram service hit an error.'))
  })

  it('clears onError after a subsequent success', async () => {
    mockRedraw
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ action: 'redrawn', url: 'https://gen/x.png', source: 'generated' })
    const onError = vi.fn()
    render(<DiagramHandlingChooser detected={detected} context={context} onResolved={() => {}} onError={onError} />)

    fireEvent.click(screen.getByText('Redraw using AI'))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('boom'))
    fireEvent.click(screen.getByText('Replace with a better educational diagram'))
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith(null))
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
      await screen.findByText('no scanned figure here to work with', { exact: false }),
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
