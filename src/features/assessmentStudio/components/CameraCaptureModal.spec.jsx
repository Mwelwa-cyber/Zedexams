/**
 * Regression: object-URL cleanup effect was deps-scoped ([original, enhanced]),
 * so setting `enhanced` fired the cleanup for the previous commit — revoking
 * `original.url` while it was still mounted. Fix: unmount-only [] effect that
 * reads from a render-assigned ref holding the latest URLs.
 *
 * Test contract:
 *   1. Setting enhanced state does NOT revoke the still-current original URL.
 *   2. Unmounting revokes both the original and enhanced URLs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import CameraCaptureModal from './CameraCaptureModal.jsx'

// Stub URL.createObjectURL / revokeObjectURL (jsdom does not implement Blob URLs).
// Both are assigned directly so they're accessible as plain fns below.
let urlCount = 0
const mockCreateObjectURL = vi.fn(() => `blob:test/${++urlCount}`)
const mockRevokeObjectURL = vi.fn()
URL.createObjectURL = mockCreateObjectURL
URL.revokeObjectURL = mockRevokeObjectURL

// jsdom doesn't provide navigator.mediaDevices; the component checks for its
// absence and falls back to the file-input path synchronously — no async needed.

// Mock the image-enhancement module so runEnhance completes without a canvas.
const enhancedBlob = new Blob(['e'], { type: 'image/jpeg' })
vi.mock('../../../utils/imageEnhance', () => ({
  enhanceImageFile: vi.fn(async () => ({ blob: enhancedBlob, blurScore: 5 })),
  blobToFile: vi.fn((blob, name) => new File([blob], name, { type: 'image/jpeg' })),
  isBlurry: vi.fn(() => false),
}))

describe('CameraCaptureModal — URL lifecycle', () => {
  beforeEach(() => {
    urlCount = 0
    mockCreateObjectURL.mockClear()
    mockRevokeObjectURL.mockClear()
  })

  afterEach(() => {
    mockRevokeObjectURL.mockClear()
  })

  /** Helper: render, wait for the camera-fallback UI, pick a file, and wait
   *  for the review stage (enhanced available). Returns unmount fn + url map. */
  async function renderAndCapture() {
    const view = render(<CameraCaptureModal onConfirm={vi.fn()} onClose={vi.fn()} />)

    // Wait for the "no-camera" fallback to appear (camera not available in jsdom).
    await screen.findByText(/couldn't open a live camera/i)

    const input = document.querySelector('input[type="file"]')
    const file = new File(['jpg'], 'photo.jpg', { type: 'image/jpeg' })

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })

    // Wait for the review stage — the "Use enhanced" button only appears once
    // runEnhance has set the enhanced state.
    await waitFor(() => expect(screen.getByRole('button', { name: /use enhanced/i })).toBeInTheDocument())

    // First createObjectURL call = original, second = enhanced.
    const originalUrl = mockCreateObjectURL.mock.results[0].value
    const enhancedUrl = mockCreateObjectURL.mock.results[1].value
    return { unmount: view.unmount, originalUrl, enhancedUrl }
  }

  it('setting enhanced state does not revoke the current original URL', async () => {
    const { originalUrl, unmount } = await renderAndCapture()

    // The old buggy code revoked originalUrl during the deps-cleanup that fired
    // when enhanced was set. With the fix, no revocation should have occurred yet.
    expect(mockRevokeObjectURL).not.toHaveBeenCalledWith(originalUrl)

    unmount()
  })

  it('unmount revokes both the original and enhanced URLs', async () => {
    const { originalUrl, enhancedUrl, unmount } = await renderAndCapture()

    // Clear any replacement-time revocations (e.g. from a retake) that might
    // have fired before the unmount so we only assert the unmount cleanup.
    mockRevokeObjectURL.mockClear()

    unmount()

    expect(mockRevokeObjectURL).toHaveBeenCalledWith(originalUrl)
    expect(mockRevokeObjectURL).toHaveBeenCalledWith(enhancedUrl)
  })
})
