import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { saveBlob } from './saveBlob.js'

/**
 * The regression these cover: on Android, a bare `blob:` URL download ignores
 * the anchor `download` attribute and saves the file under the blob's random
 * UUID — the "gibberish filename" teachers reported. saveBlob must convert to a
 * `data:` URL on Android so the chosen name sticks, and must always pass the
 * filename to the anchor's `download` attribute.
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

describe('saveBlob', () => {
  const originalUA = window.navigator.userAgent

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    setUserAgent(originalUA)
    vi.restoreAllMocks()
  })

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

  it('keeps the filename on the blob-URL fallback when file-saver is unavailable', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/120 Safari')
    const a = stubAnchor()
    const createObjectURL = vi.fn(() => 'blob:fake-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    // Force the file-saver import to fail so we exercise the anchor fallback.
    vi.mock('file-saver', () => { throw new Error('not available') })

    await saveBlob(new Blob(['x']), 'Worksheet (Answer Key).docx')

    expect(a.download).toBe('Worksheet (Answer Key).docx')
    expect(a.href).toBe('blob:fake-url')
    vi.unstubAllGlobals()
  })
})
