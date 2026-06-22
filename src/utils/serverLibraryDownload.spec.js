import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { downloadLibraryItemViaServer } from './serverLibraryDownload.js'
import { isNativePlatform } from './runtime.js'

const { mockCallable } = vi.hoisted(() => ({ mockCallable: vi.fn() }))

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => mockCallable),
}))
vi.mock('../firebase/config.js', () => ({ default: {} }))
vi.mock('./runtime.js', () => ({
  apiUrl: (p) => p,
  isNativePlatform: vi.fn(() => false),
}))
vi.mock('./clientErrorReporting.js', () => ({ reportClientError: vi.fn() }))

describe('downloadLibraryItemViaServer', () => {
  let anchor

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isNativePlatform).mockReturnValue(false)
    anchor = { href: '', rel: '', click: vi.fn() }
    vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => {})
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('navigates to the ticketed GET endpoint when a ticket is minted', async () => {
    mockCallable.mockResolvedValue({ data: { ticket: 'tkt_123' } })

    const ok = await downloadLibraryItemViaServer({
      generationId: 'gen_1',
      filename: 'Grade 4 Integrated Science Lesson Plan - The Eye.docx',
    })

    expect(ok).toBe(true)
    expect(mockCallable).toHaveBeenCalledWith({
      generationId: 'gen_1',
      format: 'docx',
      filename: 'Grade 4 Integrated Science Lesson Plan - The Eye.docx',
      attribution: false,
    })
    expect(anchor.href).toBe('/api/teacher/download?ticket=tkt_123')
    expect(anchor.click).toHaveBeenCalledOnce()
  })

  it('returns false (→ caller falls back) when the callable fails', async () => {
    mockCallable.mockRejectedValue(new Error('permission-denied'))

    const ok = await downloadLibraryItemViaServer({ generationId: 'gen_1', filename: 'x.docx' })

    expect(ok).toBe(false)
    expect(anchor.click).not.toHaveBeenCalled()
  })

  it('returns false without calling the server in the native shell', async () => {
    vi.mocked(isNativePlatform).mockReturnValue(true)

    const ok = await downloadLibraryItemViaServer({ generationId: 'gen_1', filename: 'x.docx' })

    expect(ok).toBe(false)
    expect(mockCallable).not.toHaveBeenCalled()
  })

  it('returns false when there is no generationId (unsaved item)', async () => {
    const ok = await downloadLibraryItemViaServer({ filename: 'x.docx' })

    expect(ok).toBe(false)
    expect(mockCallable).not.toHaveBeenCalled()
  })
})
