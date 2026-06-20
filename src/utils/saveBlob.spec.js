import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { saveBlob } from './saveBlob.js'
import { isNativePlatform } from './runtime.js'

// Force the dynamic `file-saver` import to throw so the tests exercise saveBlob's
// own blob:-URL anchor fallback (file-saver internally does the same blob:-URL
// download, so asserting the fallback covers the real path too). Hoisted by Vitest.
vi.mock('file-saver', () => { throw new Error('not available') })

// isNativePlatform() is the single switch between the two download routes, so we
// mock it per-test to exercise both the native shell and the browser path.
vi.mock('./runtime.js', () => ({ isNativePlatform: vi.fn(() => false) }))

/**
 * The regressions these cover:
 *
 * 1. REAL BROWSERS (including Android Chrome / iOS Safari) must download via a
 *    `blob:` URL, NOT a `data:` URL. Android Chrome truncates large `data:` URL
 *    downloads, which corrupted .docx files ("Word found unreadable content");
 *    blob: URLs stream the full bytes and are never truncated.
 * 2. THE NATIVE CAPACITOR SHELL must use the `data:` URL route, because its
 *    WebView has no download manager and a blob: URL click does nothing there.
 * 3. The chosen filename is preserved on every route; a missing name falls back
 *    to a sane default.
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

/** Stub URL.createObjectURL so the blob:-URL fallback is observable. */
function stubObjectUrl() {
  const createObjectURL = vi.fn(() => 'blob:fake-url')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
}

describe('saveBlob', () => {
  const originalUA = window.navigator.userAgent

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(isNativePlatform).mockReturnValue(false) // default: a real browser
  })

  afterEach(() => {
    setUserAgent(originalUA)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // ── Real browsers: blob: URL, never data: ─────────────────────────────────

  it('downloads an Android-browser file via a blob: URL (NOT data:) with the filename', async () => {
    // Regression: routing Android browsers through data: URLs truncated large
    // .docx files into corrupt ZIPs. A blob: URL streams the full bytes.
    vi.mocked(isNativePlatform).mockReturnValue(false)
    setUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile')
    const a = stubAnchor()
    stubObjectUrl()

    await saveBlob(new Blob(['hello'], { type: 'text/plain' }), 'Grade 5 English Notes.docx')

    expect(a.download).toBe('Grade 5 English Notes.docx')
    expect(a.href.startsWith('blob:')).toBe(true)
    expect(a.href.startsWith('data:')).toBe(false)
    expect(a.click).toHaveBeenCalledOnce()
  })

  it('downloads an iPhone-browser file via a blob: URL (NOT data:) with the filename', async () => {
    vi.mocked(isNativePlatform).mockReturnValue(false)
    setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    )
    const a = stubAnchor()
    stubObjectUrl()

    await saveBlob(
      new Blob(['x'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      'Grade 4 Integrated Science Lesson Plan.docx',
    )

    expect(a.download).toBe('Grade 4 Integrated Science Lesson Plan.docx')
    expect(a.href.startsWith('blob:')).toBe(true)
    expect(a.href.startsWith('data:')).toBe(false)
  })

  it('keeps the filename on the desktop blob-URL fallback', async () => {
    vi.mocked(isNativePlatform).mockReturnValue(false)
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/120 Safari')
    const a = stubAnchor()
    stubObjectUrl()

    await saveBlob(new Blob(['x']), 'Worksheet (Answer Key).docx')

    expect(a.download).toBe('Worksheet (Answer Key).docx')
    expect(a.href).toBe('blob:fake-url')
  })

  it('falls back to a default name when none is given', async () => {
    vi.mocked(isNativePlatform).mockReturnValue(false)
    setUserAgent('Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile')
    const a = stubAnchor()
    stubObjectUrl()

    await saveBlob(new Blob(['x']), '')

    expect(a.download).toBe('download')
  })

  // ── Native Capacitor shell: data: URL ─────────────────────────────────────

  it('downloads via a data: URL with the filename in the native Capacitor shell', async () => {
    // The native WebView has no download manager, so the data: URL route is the
    // only one that triggers a save there.
    vi.mocked(isNativePlatform).mockReturnValue(true)
    setUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile')
    const a = stubAnchor()

    await saveBlob(new Blob(['hello'], { type: 'text/plain' }), 'Grade 5 English Notes.docx')

    expect(a.download).toBe('Grade 5 English Notes.docx')
    expect(a.href.startsWith('data:')).toBe(true)
    expect(a.click).toHaveBeenCalledOnce()
  })
})
