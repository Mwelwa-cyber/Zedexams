import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { saveBlob } from './saveBlob.js'
import { isNativePlatform, isMobileBrowser } from './runtime.js'
import { saveBlobNative } from './nativeDownload.js'
import { saveViaStampedUrl } from './stampedDownload.js'

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

// The native filesystem+share save is covered by nativeDownload.spec.js; here we
// mock it to drive saveBlob's native success vs. fallback branches.
vi.mock('./nativeDownload.js', () => ({ saveBlobNative: vi.fn() }))

// The Storage-stamped universal fallback is covered by stampedDownload.spec.js;
// here we mock it to drive saveBlob's "Web Share unavailable" branch. Default:
// it declines (returns false) so the legacy anchor fallback still runs.
vi.mock('./stampedDownload.js', () => ({ saveViaStampedUrl: vi.fn(() => false) }))

/**
 * The regressions these cover:
 *
 * 1. MOBILE BROWSERS (Android Chrome / iOS Safari) must save via the Web Share
 *    API, handing the OS a `File` whose `.name` is the real filename. An
 *    <a download> click on a blob: URL does NOT keep the name there — Android
 *    saves it under the blob's UUID ("acc6d3a8-….docx"). The key assertion is
 *    therefore on the File handed to navigator.share, NOT on an anchor's
 *    `download` attribute (which the browser ignores on mobile anyway).
 * 2. DESKTOP BROWSERS honour `download`, so they stay on file-saver / the
 *    blob:-URL anchor with the filename preserved.
 * 3. THE NATIVE CAPACITOR SHELL writes the full bytes to disk + shares them.
 * 4. Every route falls back gracefully and never dumps a misnamed copy after the
 *    user cancels a share sheet.
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

/**
 * Install navigator.share + navigator.canShare. `shareImpl` lets a test resolve
 * (saved), reject with AbortError (user cancelled), or reject with a real error.
 */
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

  // ── Mobile browsers: Web Share API with the real filename ──────────────────

  it('shares a mobile-browser download as a File carrying the real filename', async () => {
    // THE regression: Android Chrome saved blob: downloads under a random UUID
    // ("acc6d3a8-….docx"). The fix hands the OS a File whose .name is the human
    // name, so "Save to Files"/Drive/Word keep it. We assert exactly that File.
    vi.mocked(isMobileBrowser).mockReturnValue(true)
    const share = stubWebShare()
    const a = stubAnchor()

    await saveBlob(
      new Blob(['hello'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      'Grade 1 Mathematics Lesson Plan.docx',
    )

    expect(share).toHaveBeenCalledOnce()
    const arg = share.mock.calls[0][0]
    expect(Array.isArray(arg.files)).toBe(true)
    expect(arg.files[0]).toBeInstanceOf(File)
    // The contract that actually matters: the OS receives the real name.
    expect(arg.files[0].name).toBe('Grade 1 Mathematics Lesson Plan.docx')
    // And we must NOT also trigger the UUID-prone anchor download.
    expect(a.click).not.toHaveBeenCalled()
  })

  it('does NOT fall back to an anchor download when the user cancels the share sheet', async () => {
    // Dismissing the sheet is a deliberate "no". Re-downloading via the anchor
    // would drop a misnamed UUID copy into Downloads — the very bug we fixed.
    vi.mocked(isMobileBrowser).mockReturnValue(true)
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    const share = stubWebShare({ shareImpl: () => Promise.reject(abort) })
    const a = stubAnchor()
    stubObjectUrl()

    await saveBlob(new Blob(['x']), 'Grade 4 Science Notes.docx')

    expect(share).toHaveBeenCalledOnce()
    expect(a.click).not.toHaveBeenCalled()
  })

  it('falls back to the blob:-URL download when the mobile browser cannot share files', async () => {
    // Older mobile browsers without Web Share Level 2: canShare({files}) is
    // false. We must still save the file rather than do nothing.
    vi.mocked(isMobileBrowser).mockReturnValue(true)
    const share = stubWebShare({ canShare: false })
    const a = stubAnchor()
    stubObjectUrl()

    await saveBlob(new Blob(['x']), 'Grade 4 Science Notes.docx')

    expect(share).not.toHaveBeenCalled()
    expect(a.download).toBe('Grade 4 Science Notes.docx')
    expect(a.href.startsWith('blob:')).toBe(true)
    expect(a.click).toHaveBeenCalledOnce()
  })

  it('falls back to the blob:-URL download when a real share error occurs', async () => {
    vi.mocked(isMobileBrowser).mockReturnValue(true)
    const share = stubWebShare({ shareImpl: () => Promise.reject(new Error('NotAllowedError')) })
    const a = stubAnchor()
    stubObjectUrl()

    await saveBlob(new Blob(['x']), 'Grade 4 Science Notes.docx')

    expect(share).toHaveBeenCalledOnce()
    // Web Share failed → we try the stamped fallback (which declined here) before
    // the anchor. The anchor still saves the file so nothing is lost.
    expect(saveViaStampedUrl).toHaveBeenCalledOnce()
    expect(a.click).toHaveBeenCalledOnce()
    expect(a.download).toBe('Grade 4 Science Notes.docx')
  })

  it('uses the Storage-stamped fallback when the mobile browser has no Web Share', async () => {
    // DuckDuckGo / WebViews: no navigator.share at all. We must NOT drop a
    // UUID-named anchor download — the stamped fallback names it correctly.
    vi.mocked(isMobileBrowser).mockReturnValue(true)
    vi.mocked(saveViaStampedUrl).mockResolvedValue(true)
    const a = stubAnchor()
    stubObjectUrl()
    // No stubWebShare(): navigator.share is absent on this browser.

    const blob = new Blob(['x'])
    await saveBlob(blob, 'Grade 4 Science Notes.docx')

    expect(saveViaStampedUrl).toHaveBeenCalledWith(blob, 'Grade 4 Science Notes.docx')
    expect(a.click).not.toHaveBeenCalled()
  })

  // ── Desktop browsers: blob: URL, name honoured ─────────────────────────────

  it('keeps the filename on the desktop blob-URL fallback (no share sheet)', async () => {
    // Desktop browsers honour the download attribute, so we deliberately do NOT
    // route them through the share sheet (worse UX than a direct download).
    vi.mocked(isMobileBrowser).mockReturnValue(false)
    const share = stubWebShare() // available, but must be ignored on desktop
    const a = stubAnchor()
    stubObjectUrl()

    await saveBlob(new Blob(['x']), 'Worksheet (Answer Key).docx')

    expect(share).not.toHaveBeenCalled()
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

  // ── Native Capacitor shell ────────────────────────────────────────────────

  it('uses the native filesystem save in the Capacitor shell (no data: URL)', async () => {
    vi.mocked(isNativePlatform).mockReturnValue(true)
    vi.mocked(saveBlobNative).mockResolvedValue(true)
    const a = stubAnchor()
    const blob = new Blob(['hello'], { type: 'text/plain' })

    await saveBlob(blob, 'Grade 5 English Notes.docx')

    expect(saveBlobNative).toHaveBeenCalledWith(blob, 'Grade 5 English Notes.docx')
    expect(a.click).not.toHaveBeenCalled()
  })

  it('falls back to a data: URL when the native save fails', async () => {
    vi.mocked(isNativePlatform).mockReturnValue(true)
    vi.mocked(saveBlobNative).mockRejectedValue(new Error('plugin not available'))
    const a = stubAnchor()

    await saveBlob(new Blob(['hello']), 'Grade 5 English Notes.docx')

    expect(a.download).toBe('Grade 5 English Notes.docx')
    expect(a.href.startsWith('data:')).toBe(true)
    expect(a.click).toHaveBeenCalledOnce()
  })
})
