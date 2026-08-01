import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { contentDispositionFor, saveViaStampedUrl } from './stampedDownload.js'
import { auth } from '../firebase/config.js'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'

vi.mock('../firebase/config.js', () => ({
  storage: { __type: 'storage' },
  auth: { currentUser: { uid: 'teacher-1' } },
  // Storage writes go through the attested wrappers (App Check enforcement);
  // an attested device is the default for these tests.
  assertStorageWriteAttested: vi.fn(() => Promise.resolve({ ok: true, reason: 'attested' })),
}))

vi.mock('firebase/storage', () => ({
  ref: vi.fn((_storage, path) => ({ path })),
  uploadBytes: vi.fn(() => Promise.resolve()),
  uploadBytesResumable: vi.fn(() => Promise.resolve()),
  uploadString: vi.fn(() => Promise.resolve()),
  getDownloadURL: vi.fn(() =>
    Promise.resolve('https://firebasestorage.googleapis.com/v0/b/x/o/tmp%2Ffile?alt=media&token=abc'),
  ),
  deleteObject: vi.fn(() => Promise.resolve()),
}))

vi.mock('./clientErrorReporting.js', () => ({ reportClientError: vi.fn() }))

function stubAnchor() {
  const a = { href: '', rel: '', click: vi.fn(), setAttribute(k, v) { this[k] = v } }
  vi.spyOn(document, 'createElement').mockReturnValue(a)
  vi.spyOn(document.body, 'appendChild').mockImplementation(() => {})
  vi.spyOn(document.body, 'removeChild').mockImplementation(() => {})
  return a
}

describe('contentDispositionFor', () => {
  it('builds an attachment header carrying the real filename', () => {
    const cd = contentDispositionFor('Grade 6 English Lesson Plan - Reading.docx')
    expect(cd).toContain('attachment;')
    expect(cd).toContain('filename="Grade 6 English Lesson Plan - Reading.docx"')
    // The UTF-8 form is percent-encoded (spaces → %20) and decodes back exactly.
    const utf8 = cd.split("filename*=UTF-8''")[1]
    expect(utf8).toContain('%20') // spaces were encoded
    expect(decodeURIComponent(utf8)).toBe('Grade 6 English Lesson Plan - Reading.docx')
  })

  it('keeps a quote-free ASCII fallback and a UTF-8 form for non-ASCII names', () => {
    const cd = contentDispositionFor('Notes — café.docx')
    expect(cd).not.toContain('"Notes — café.docx"') // raw non-ASCII not in the quoted fallback
    expect(cd).toContain("filename*=UTF-8''")
    expect(decodeURIComponent(cd.split("filename*=UTF-8''")[1])).toBe('Notes — café.docx')
  })
})

describe('saveViaStampedUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.currentUser = { uid: 'teacher-1' }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('declines (returns false) when no user is signed in', async () => {
    auth.currentUser = null
    const a = stubAnchor()

    const ok = await saveViaStampedUrl(new Blob(['x']), 'Grade 6 English Lesson Plan.docx')

    expect(ok).toBe(false)
    expect(uploadBytes).not.toHaveBeenCalled()
    expect(a.click).not.toHaveBeenCalled()
  })

  it('uploads with the filename stamped on Content-Disposition, then triggers the download', async () => {
    const a = stubAnchor()
    const blob = new Blob(['hello'], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    const ok = await saveViaStampedUrl(blob, 'Grade 6 English Lesson Plan.docx')

    expect(ok).toBe(true)
    // Owner-scoped temp path with the right extension.
    expect(ref).toHaveBeenCalled()
    expect(ref.mock.calls[0][1]).toMatch(/^tmp-downloads\/teacher-1\/.*\.docx$/)
    // THE contract: the real name rides on Content-Disposition metadata.
    const meta = uploadBytes.mock.calls[0][2]
    expect(meta.contentDisposition).toContain('filename="Grade 6 English Lesson Plan.docx"')
    expect(meta.contentType).toBe(blob.type)
    // And the browser's download manager is pointed at the tokened URL.
    expect(getDownloadURL).toHaveBeenCalledOnce()
    expect(a.href).toContain('alt=media')
    expect(a.click).toHaveBeenCalledOnce()
  })

  it('returns false (so the caller falls back) when the upload fails', async () => {
    uploadBytes.mockRejectedValueOnce(new Error('network'))
    const a = stubAnchor()

    const ok = await saveViaStampedUrl(new Blob(['x']), 'Grade 6 English Lesson Plan.docx')

    expect(ok).toBe(false)
    expect(a.click).not.toHaveBeenCalled()
  })
})
