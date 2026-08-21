import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { saveBlob } from './saveBlob.js'
import { isNativePlatform, isMobileBrowser } from './runtime.js'
import { saveBlobNative } from './nativeDownload.js'
import { saveViaStampedUrl } from './stampedDownload.js'
import { reportClientError } from './clientErrorReporting.js'

vi.mock('./clientErrorReporting.js', () => ({ reportClientError: vi.fn() }))

// Force the dynamic `file-saver` import to throw so the tests exercise saveBlob's
// own blob:-URL anchor fallback (file-saver internally does the same blob:-URL
// download, so asserting the fallback covers the real path too). Hoisted by Vitest.
vi.mock('file-saver', () => { throw new Error('not available') })

// isNativePlatform() / isMobileBrowser() are the switches between download
// routes, so we mock them per-test to exercise each path independently.
vi.mock('./runtime.js', () => ({
  isNativePlatform: vi.fn(() => false),
  isMobileBrowser: vi.fn(() => false),
}))

// The native save is covered by nativeDownload.spec.js; here we mock it to drive
// saveBlob's native success vs. fallback branches.
vi.mock('./nativeDownload.js', () => ({ saveBlobNative: vi.fn() }))

// The Storage-stamped download is covered by stampedDownload.spec.js; here we
// mock it to drive the mobile-browser branches. Default: it declines (returns
// false) so the local blob-URL fallback runs.
vi.mock('./stampedDownload.js', () => ({ saveViaStampedUrl: vi.fn(() => false) }))

/**
 * The regressions these cover:
 *
 * 1. DOWNLOAD NEVER OPENS A SHARE SHEET. Both mobile routes used to hand the
 *    file to the OS share sheet — `navigator.share` in the browser, the
 *    Capacitor share plugin in the app — so tapping "Download" on a lesson plan
 *    offered a grid of WhatsApp contacts and saved nothing to the phone. The
 *    load-bearing assertions below are therefore that navigator.share is NOT
 *    called on a mobile browser, however available it looks.
 * 2. MOBILE BROWSERS save through the Storage-stamped URL first: the download
 *    manager reads the real name from Content-Disposition, so the file lands in
 *    Downloads correctly named even on browsers that ignore `<a download>`.
 * 3. DESKTOP BROWSERS honour `download`, so they stay on file-saver / the
 *    blob:-URL anchor with the filename preserved, and never pay for an upload.
 * 4. THE NATIVE CAPACITOR SHELL writes into the phone's public Downloads folder.
 * 5. Every route falls back gracefully rather than losing the file.
 */

function stubAnchor() {
  const a = {
    href: '',
    download: '',
    rel: '',
    click: vi.fn(),
    setAttribute(k, v) { this[k] = v },
  }
  vi.spyOn(document, 'createElement').mockReturnValue(a)
  vi.spyOn(document.body, 'appendChild').mockImplementation(() => {})
  vi.spyOn(document.body, 'removeChild').mockImplementation(() => {})
  return a
}

/** Stub URL.createObjectURL so the blob:-URL fallback is observable. */
function stubObjectUrl() {
  const createObjectURL = vi.fn(() => 'blob:fake-url')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
}

/** Install navigator.share + navigator.canShare so a test can prove they go unused. */
function stubWebShare({ canShare = true, shareImpl } = {}) {
  const share = vi.fn(shareImpl || (() => Promise.resolve()))
  Object.defineProperty(window.navigator, 'share', { value: share, configurable: true })
  Object.defineProperty(window.navigator, 'canShare', {
    value: vi.fn(() => canShare),
    configurable: true,
  })
  return share
}

function clearWebShare() {
  try { delete window.navigator.share } catch { /* noop */ }
  try { delete window.navigator.canShare } catch { /* noop */ }
}

describe('saveBlob', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks() // reset call history on the vi.mock() factory fns too
    vi.mocked(isNativePlatform).mockReturnValue(false)
    vi.mocked(isMobileBrowser).mockReturnValue(false)
    vi.mocked(saveViaStampedUrl).mockResolvedValue(false)
    clearWebShare()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    clearWebShare()
  })

  // ── Mobile browsers: a download, never a share sheet ───────────────────────

  it('saves a mobile-browser download through the stamped URL, never the share sheet', async () => {
    // THE regression. navigator.share is fully available here and must still go
    // untouched: a share sheet is not a download, and picking WhatsApp is not
    // "saving to the phone".
    vi.mocked(isMobileBrowser).mockReturnValue(true)
    vi.mocked(saveViaStampedUrl).mockResolvedValue(true)
    const share = stubWebShare()
    const a = stubAnchor()
    stubObjectUrl()

    const blob = new Blob(['hello'], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    await saveBlob(blob, 'Grade 1 Mathematics Lesson Plan.docx')

    expect(share).not.toHaveBeenCalled()
    expect(saveViaStampedUrl).toHaveBeenCalledWith(blob, 'Grade 1 Mathematics Lesson Plan.docx')
    // The stamped route triggers its own download, so nothing else should fire.
    expect(a.click).not.toHaveBeenCalled()
  })

  it('falls back to the local blob:-URL save when the stamped route declines', async () => {
    // Signed out, upload failed or offline. A file in Downloads under an
    // imperfect name still beats a share sheet or no file at all.
    vi.mocked(isMobileBrowser).mockReturnValue(true)
    vi.mocked(saveViaStampedUrl).mockResolvedValue(false)
    const share = stubWebShare()
    const a = stubAnchor()
    stubObjectUrl()

    await saveBlob(new Blob(['x']), 'Grade 4 Science Notes.docx')

    expect(share).not.toHaveBeenCalled()
    expect(a.download).toBe('Grade 4 Science Notes.docx')
    expect(a.href.startsWith('blob:')).toBe(true)
    expect(a.click).toHaveBeenCalledOnce()
  })

  it('still saves when the stamped route throws outright', async () => {
    vi.mocked(isMobileBrowser).mockReturnValue(true)
    vi.mocked(saveViaStampedUrl).mockRejectedValue(new Error('boom'))
    const a = stubAnchor()
    stubObjectUrl()

    await saveBlob(new Blob(['x']), 'Grade 4 Science Notes.docx')

    expect(a.click).toHaveBeenCalledOnce()
    expect(a.download).toBe('Grade 4 Science Notes.docx')
  })

  // ── Desktop browsers: blob: URL, name honoured, no upload ─────────────────

  it('keeps the filename on the desktop blob-URL fallback (no share sheet, no upload)', async () => {
    vi.mocked(isMobileBrowser).mockReturnValue(false)
    const share = stubWebShare() // available, but must be ignored
    const a = stubAnchor()
    stubObjectUrl()

    await saveBlob(new Blob(['x']), 'Worksheet (Answer Key).docx')

    expect(share).not.toHaveBeenCalled()
    // Desktop honours `download`, so it must never pay for the stamped upload.
    expect(saveViaStampedUrl).not.toHaveBeenCalled()
    expect(a.download).toBe('Worksheet (Answer Key).docx')
    expect(a.href).toBe('blob:fake-url')
  })

  it('falls back to a default name when none is given', async () => {
    vi.mocked(isMobileBrowser).mockReturnValue(false)
    const a = stubAnchor()
    stubObjectUrl()

    await saveBlob(new Blob(['x']), '')

    expect(a.download).toBe('download')
  })

  it('reports a junk filename without blocking the save', async () => {
    vi.mocked(isMobileBrowser).mockReturnValue(false)
    const a = stubAnchor()
    stubObjectUrl()

    await saveBlob(new Blob(['x']), 'acc6d3a8-4f1e-4a51-9b2e-2f6c1d0e7a55.docx')

    expect(reportClientError).toHaveBeenCalled()
    expect(a.click).toHaveBeenCalledOnce()
  })

  // ── Native Capacitor shell ────────────────────────────────────────────────

  it('saves to the phone in the Capacitor shell (no data: URL)', async () => {
    vi.mocked(isNativePlatform).mockReturnValue(true)
    vi.mocked(saveBlobNative).mockResolvedValue(true)
    const a = stubAnchor()
    const blob = new Blob(['hello'], { type: 'text/plain' })

    await saveBlob(blob, 'Grade 5 English Notes.docx')

    expect(saveBlobNative).toHaveBeenCalledWith(blob, 'Grade 5 English Notes.docx')
    expect(a.click).not.toHaveBeenCalled()
  })

  it('falls back to a data: URL when every native route fails', async () => {
    vi.mocked(isNativePlatform).mockReturnValue(true)
    vi.mocked(saveBlobNative).mockRejectedValue(new Error('plugin not available'))
    const a = stubAnchor()

    await saveBlob(new Blob(['hello']), 'Grade 5 English Notes.docx')

    expect(a.download).toBe('Grade 5 English Notes.docx')
    expect(a.href.startsWith('data:')).toBe(true)
    expect(a.click).toHaveBeenCalledOnce()
  })
})
