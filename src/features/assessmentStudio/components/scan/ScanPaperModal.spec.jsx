import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import ScanPaperModal from './ScanPaperModal'

// jsdom can't decode images or run canvas/IndexedDB, so stub the browser-only
// edges. The behaviour under test — pages accumulate in order and convert
// together — lives entirely in the component's state machine.
vi.mock('../../../../utils/imageCompression', () => ({
  // Return the file unchanged so blobToDataUrl gets a real Blob to read.
  compressImage: vi.fn(async (file) => file),
}))
vi.mock('../../lib/scanImageQuality', () => ({
  measureBlurFromDataUrl: vi.fn(async () => ({ variance: 999, blurry: false })),
}))
vi.mock('../../lib/scanSessionStore', () => ({
  loadScanSession: vi.fn(async () => []),
  saveScanSession: vi.fn(async () => {}),
  clearScanSession: vi.fn(async () => {}),
}))

function captureInput() {
  return document.querySelector('input[capture]')
}

function fakePhoto(name) {
  return new File([name], name, { type: 'image/jpeg' })
}

describe('ScanPaperModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens on the Start New Test Scan screen', async () => {
    render(<ScanPaperModal open onClose={() => {}} onConvert={() => {}} />)
    expect(await screen.findByText('Start New Test Scan', { exact: false })).toBeInTheDocument()
  })

  it('adds each capture as the next page instead of replacing the previous one', async () => {
    render(<ScanPaperModal open onClose={() => {}} onConvert={() => {}} />)
    await screen.findByText('Start New Test Scan', { exact: false })

    fireEvent.change(captureInput(), { target: { files: [fakePhoto('page-a.jpg')] } })
    expect(await screen.findByText('Page captured. What would you like to do next?')).toBeInTheDocument()
    expect(screen.getByText('Saved as Page 1 of 1.')).toBeInTheDocument()

    // Second capture must become Page 2, not overwrite Page 1.
    fireEvent.change(captureInput(), { target: { files: [fakePhoto('page-b.jpg')] } })
    expect(await screen.findByText('Saved as Page 2 of 2.')).toBeInTheDocument()

    // Progress indicator reflects both pages (chip text includes a ✓ prefix).
    expect(screen.getByText(/Page 1 captured/)).toBeInTheDocument()
    expect(screen.getByText(/Page 2 captured/)).toBeInTheDocument()
  })

  it('converts all captured pages together in order', async () => {
    const onConvert = vi.fn(async () => {})
    const onClose = vi.fn()
    render(<ScanPaperModal open onClose={onClose} onConvert={onConvert} />)
    await screen.findByText('Start New Test Scan', { exact: false })

    fireEvent.change(captureInput(), { target: { files: [fakePhoto('p1.jpg')] } })
    await screen.findByText('Saved as Page 1 of 1.')
    fireEvent.change(captureInput(), { target: { files: [fakePhoto('p2.jpg')] } })
    await screen.findByText('Saved as Page 2 of 2.')

    fireEvent.click(screen.getByText('Finish & Convert to Assessment', { exact: false }))

    await waitFor(() => expect(onConvert).toHaveBeenCalledTimes(1))
    const files = onConvert.mock.calls[0][0]
    expect(files).toHaveLength(2)
    expect(files[0].name).toBe('scan-page-01.jpg')
    expect(files[1].name).toBe('scan-page-02.jpg')
    files.forEach(f => expect(f).toBeInstanceOf(File))
    // Pages handed off → modal closes.
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('keeps the captured pages when conversion fails', async () => {
    const onConvert = vi.fn(async () => false)
    const onClose = vi.fn()
    render(<ScanPaperModal open onClose={onClose} onConvert={onConvert} />)
    await screen.findByText('Start New Test Scan', { exact: false })

    fireEvent.change(captureInput(), { target: { files: [fakePhoto('p1.jpg')] } })
    await screen.findByText('Saved as Page 1 of 1.')

    fireEvent.click(screen.getByText('Finish & Convert to Assessment', { exact: false }))

    await waitFor(() => expect(onConvert).toHaveBeenCalled())
    // Failure → modal stays open, page is preserved, teacher is told.
    expect(await screen.findByText(/Your pages are kept/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('1 page captured', { exact: false })).toBeInTheDocument()
  })

  it('lets the teacher delete a captured page from the preview', async () => {
    render(<ScanPaperModal open onClose={() => {}} onConvert={() => {}} />)
    await screen.findByText('Start New Test Scan', { exact: false })

    fireEvent.change(captureInput(), { target: { files: [fakePhoto('only.jpg')] } })
    await screen.findByText('Saved as Page 1 of 1.')

    fireEvent.click(screen.getByText('Preview Captured Pages', { exact: false }))
    expect(await screen.findByText('Captured pages')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Delete', { exact: false }))
    // Last page removed → back to the start screen.
    await waitFor(() => expect(screen.getByText('Start New Test Scan', { exact: false })).toBeInTheDocument())
  })

  it('renders nothing when closed', () => {
    const { container } = render(<ScanPaperModal open={false} onClose={() => {}} onConvert={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
