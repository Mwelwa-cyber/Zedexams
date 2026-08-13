import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mock the cleaning engine so the component's pixel pipeline is deterministic
// and runs without a real canvas. cleanDiagramSource resolves to a fixed raster.
const FAKE_RESULT = {
  dataUrl: 'data:image/png;base64,AAAA',
  blob: new Blob(['x'], { type: 'image/png' }),
  width: 10,
  height: 10,
  bounds: {},
}

vi.mock('../../../utils/diagramClean.js', () => ({
  isDiagramCleanSupported: vi.fn(() => true),
  cleanDiagramSource: vi.fn(() => Promise.resolve(FAKE_RESULT)),
}))

import DiagramScanner from './DiagramScanner.jsx'
import { cleanDiagramSource } from '../../../utils/diagramClean.js'

// Drive the file <input> into the edit stage. The component reads the file with
// FileReader; jsdom provides one, so a small real PNG-ish blob is enough.
function selectFile() {
  const input = screen.getByLabelText('Capture or upload a diagram')
  const file = new File(['fake-bytes'], 'leaf.png', { type: 'image/png' })
  fireEvent.change(input, { target: { files: [file] } })
}

describe('DiagramScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanDiagramSource.mockResolvedValue(FAKE_RESULT)
  })

  it('renders the capture state with a file input', () => {
    render(<DiagramScanner />)
    const input = screen.getByLabelText('Capture or upload a diagram')
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('accept', 'image/*')
    expect(input).toHaveAttribute('capture', 'environment')
  })

  it('renders a close button with an aria-label', () => {
    render(<DiagramScanner />)
    expect(screen.getByRole('button', { name: 'Close diagram scanner' })).toBeInTheDocument()
  })

  it('transitions to edit state and calls cleanDiagramSource after a file is chosen', async () => {
    render(<DiagramScanner onInsertIntoQuestion={() => {}} />)
    selectFile()

    // Edit-state controls appear once the file is read.
    expect(await screen.findByRole('switch', { name: 'Clean black & white' })).toBeInTheDocument()
    await waitFor(() => expect(cleanDiagramSource).toHaveBeenCalled())
  })

  it('insert button calls onInsertIntoQuestion with a payload containing dataUrl, then closes', async () => {
    const onInsertIntoQuestion = vi.fn()
    const onClose = vi.fn()
    render(<DiagramScanner onInsertIntoQuestion={onInsertIntoQuestion} onClose={onClose} />)
    selectFile()

    const insertBtn = await screen.findByRole('button', { name: 'Insert the cleaned diagram into the question' })
    await waitFor(() => expect(insertBtn).not.toBeDisabled())
    fireEvent.click(insertBtn)

    expect(onInsertIntoQuestion).toHaveBeenCalledTimes(1)
    expect(onInsertIntoQuestion.mock.calls[0][0]).toEqual(
      expect.objectContaining({ dataUrl: FAKE_RESULT.dataUrl }),
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('create button calls onCreateQuestion with the cleaned dataUrl', async () => {
    const onCreateQuestion = vi.fn()
    render(<DiagramScanner onCreateQuestion={onCreateQuestion} onClose={() => {}} />)
    selectFile()

    const createBtn = await screen.findByRole('button', { name: 'Create a new question with the cleaned diagram' })
    await waitFor(() => expect(createBtn).not.toBeDisabled())
    fireEvent.click(createBtn)

    expect(onCreateQuestion).toHaveBeenCalledTimes(1)
    expect(onCreateQuestion.mock.calls[0][0]).toEqual(
      expect.objectContaining({ dataUrl: FAKE_RESULT.dataUrl }),
    )
  })

  it('save-to-bank passes a name derived from the alt/caption', async () => {
    const onSaveToBank = vi.fn()
    render(<DiagramScanner onSaveToBank={onSaveToBank} onClose={() => {}} />)
    selectFile()

    const caption = await screen.findByLabelText('Diagram label or caption')
    fireEvent.change(caption, { target: { value: 'Leaf cross-section' } })

    const saveBtn = screen.getByRole('button', { name: 'Save the cleaned diagram to the diagram bank' })
    await waitFor(() => expect(saveBtn).not.toBeDisabled())
    fireEvent.click(saveBtn)

    expect(onSaveToBank).toHaveBeenCalledTimes(1)
    expect(onSaveToBank.mock.calls[0][0]).toEqual(
      expect.objectContaining({ dataUrl: FAKE_RESULT.dataUrl, alt: 'Leaf cross-section', name: 'Leaf cross-section' }),
    )
  })

  it('only renders action buttons whose props are provided', async () => {
    render(<DiagramScanner onInsertIntoQuestion={() => {}} />)
    selectFile()

    await screen.findByRole('button', { name: 'Insert the cleaned diagram into the question' })
    expect(screen.queryByRole('button', { name: 'Create a new question with the cleaned diagram' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save the cleaned diagram to the diagram bank' })).not.toBeInTheDocument()
  })

  it('toggling an option re-runs the clean', async () => {
    render(<DiagramScanner onInsertIntoQuestion={() => {}} />)
    selectFile()

    const toggle = await screen.findByRole('switch', { name: 'Auto-crop background' })
    await waitFor(() => expect(cleanDiagramSource).toHaveBeenCalled())
    const before = cleanDiagramSource.mock.calls.length
    fireEvent.click(toggle)
    await waitFor(() => expect(cleanDiagramSource.mock.calls.length).toBeGreaterThan(before))
  })
})
