import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { saveBlob } from './saveBlob.js'

// `vi.mock` is hoisted to the top of the module by Vitest, so it must live at
// the top level. It forces the dynamic `file-saver` import to throw, which lets
// the desktop test below exercise saveBlob's anchor fallback. The Android and
// iOS tests never reach the file-saver branch (they take the data:-URL path),
// so they are unaffected.
vi.mock('file-saver', () => { throw new Error('not available') })

/**
 * The regression these cover:
 *
 * On Android AND iOS Safari, a bare `blob:` URL download ignores the anchor
 * `download` attribute and saves the file under the blob's random UUID — the
 * "gibberish filename" (e.g. "5fee66fe-1c3a-4b9d-….docx") teachers reported.
 * saveBlob must convert to a `data:` URL on these platforms so the chosen name
 * sticks. Desktop browsers honour `download` on blob: URLs and stay on the
 * faster file-saver / blob-URL path.
 *
 * iOS-specific note: iPhones report "iPhone" in their UA. iPadOS 13+ spoofs as
 * "Macintosh" for desktop-site compat — we detect it via maxTouchPoints > 1.
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

function setUserAgent(ua) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
}

function setMaxTouchPoints(n) {
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: n, configurable: true })
}

describe('saveBlob', () => {
  const originalUA = window.navigator.userAgent
  const originalMTP = window.navigator.maxTouchPoints

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    setUserAgent(originalUA)
    setMaxTouchPoints(originalMTP ?? 0)
    vi.restoreAllMocks()
  })

  // ── Android ──────────────────────────────────────────────────────────────

  it('downloads via a data: URL with the given filename on Android', async () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile')
    const a = stubAnchor()
    const blob = new Blob(['hello'], { type: 'text/plain' })

    await saveBlob(blob, 'Grade 5 English Notes.docx')

    expect(a.download).toBe('Grade 5 English Notes.docx')
    expect(a.href.startsWith('data:')).toBe(true)
    expect(a.click).toHaveBeenCalledOnce()
  })

  it('falls back to a default name when none is given', async () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile')
    const a = stubAnchor()
    await saveBlob(new Blob(['x']), '')
    expect(a.download).toBe('download')
  })

  // ── iOS Safari (iPhone) ──────────────────────────────────────────────────
  // Root-cause regression: iOS was previously falling through to the
  // file-saver / blob-URL path, which produced random UUID filenames.

  it('downloads via a data: URL with the given filename on iOS Safari (iPhone UA)', async () => {
    setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    )
    const a = stubAnchor()
    const blob = new Blob(['hello'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })

    await saveBlob(blob, 'Grade 4 Integrated Science Lesson Plan.docx')

    expect(a.download).toBe('Grade 4 Integrated Science Lesson Plan.docx')
    expect(a.href.startsWith('data:')).toBe(true)
    expect(a.click).toHaveBeenCalledOnce()
  })

  it('downloads via a data: URL with the given filename on iPad (explicit iPad UA)', async () => {
    setUserAgent(
      'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    )
    const a = stubAnchor()

    await saveBlob(new Blob(['x']), 'Grade 7 Mathematics Worksheet.docx')

    expect(a.download).toBe('Grade 7 Mathematics Worksheet.docx')
    expect(a.href.startsWith('data:')).toBe(true)
    expect(a.click).toHaveBeenCalledOnce()
  })

  it('downloads via a data: URL on iPadOS 13+ spoofing a Mac UA (Macintosh + maxTouchPoints > 1)', async () => {
    // iPadOS 13+ sends a desktop Macintosh UA by default. The only reliable
    // runtime signal is maxTouchPoints > 1 on a "Macintosh" platform.
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    )
    setMaxTouchPoints(5)
    const a = stubAnchor()

    await saveBlob(new Blob(['y']), 'Grade 4 Integrated Science Lesson Plan.docx')

    expect(a.download).toBe('Grade 4 Integrated Science Lesson Plan.docx')
    expect(a.href.startsWith('data:')).toBe(true)
    expect(a.click).toHaveBeenCalledOnce()
  })

  // ── Desktop ───────────────────────────────────────────────────────────────

  it('keeps the filename on the blob-URL fallback when file-saver is unavailable (desktop)', async () => {
    // A real Intel Mac has maxTouchPoints === 0 — must NOT be treated as iOS.
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/120 Safari')
    setMaxTouchPoints(0)
    const a = stubAnchor()
    const createObjectURL = vi.fn(() => 'blob:fake-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })

    await saveBlob(new Blob(['x']), 'Worksheet (Answer Key).docx')

    expect(a.download).toBe('Worksheet (Answer Key).docx')
    expect(a.href).toBe('blob:fake-url')
    vi.unstubAllGlobals()
  })
})
