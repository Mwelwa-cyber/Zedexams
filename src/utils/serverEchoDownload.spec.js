import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { saveViaServerEcho } from './serverEchoDownload.js'

// apiUrl returns the path unchanged on the web (same-origin /api/download).
vi.mock('./runtime.js', () => ({ apiUrl: (p) => p }))
vi.mock('./nativeDownload.js', () => ({ blobToBase64: vi.fn(() => Promise.resolve('QkFTRTY0')) }))
vi.mock('./clientErrorReporting.js', () => ({ reportClientError: vi.fn() }))

describe('saveViaServerEcho', () => {
  let submitted

  beforeEach(() => {
    submitted = null
    // Capture the form that gets submitted without navigating jsdom.
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function () {
      submitted = this
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('POSTs the base64 to /api/download with the name + type, targeting a hidden iframe', async () => {
    const blob = new Blob(['x'], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    const ok = await saveViaServerEcho(blob, 'Grade 4 Integrated Science Lesson Plan - The Eye.docx')

    expect(ok).toBe(true)
    expect(submitted).toBeInstanceOf(HTMLFormElement)
    expect(submitted.method.toUpperCase()).toBe('POST')
    // Name + type ride as query params; the body carries only the base64.
    expect(submitted.action).toContain('/api/download?')
    expect(submitted.action).toContain(
      `name=${encodeURIComponent('Grade 4 Integrated Science Lesson Plan - The Eye.docx')}`,
    )
    expect(submitted.action).toContain(
      `type=${encodeURIComponent(blob.type)}`,
    )
    const field = submitted.querySelector('input[name="data"]')
    expect(field).not.toBeNull()
    expect(field.value).toBe('QkFTRTY0')
    // Targets a hidden iframe so the attachment response never navigates the page.
    const iframe = document.querySelector(`iframe[name="${submitted.target}"]`)
    expect(iframe).not.toBeNull()
  })

  it('declines (returns false) for an oversized blob so the caller can fall back', async () => {
    const big = { size: 30 * 1024 * 1024, type: 'application/pdf' }

    const ok = await saveViaServerEcho(big, 'Huge.pdf')

    expect(ok).toBe(false)
    expect(submitted).toBeNull()
  })
})
