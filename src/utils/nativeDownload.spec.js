import { describe, it, expect, vi, beforeEach } from 'vitest'

const writeFile = vi.fn(async () => ({ uri: 'file:///cache/Grade 5 English Notes.docx' }))
const share = vi.fn(async () => {})

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: (...a) => writeFile(...a) },
  Directory: { Cache: 'CACHE' },
}))
vi.mock('@capacitor/share', () => ({
  Share: { share: (...a) => share(...a) },
}))

import { blobToBase64, saveBlobNative } from './nativeDownload.js'

describe('blobToBase64', () => {
  it('returns raw base64 without the data: prefix', async () => {
    const b64 = await blobToBase64(new Blob(['hello'], { type: 'text/plain' }))
    // base64('hello') === 'aGVsbG8='
    expect(b64).toBe('aGVsbG8=')
    expect(b64.startsWith('data:')).toBe(false)
  })
})

describe('saveBlobNative', () => {
  beforeEach(() => {
    writeFile.mockClear()
    share.mockClear()
  })

  it('writes the full bytes to the Cache dir, then shares the saved file', async () => {
    const ok = await saveBlobNative(
      new Blob(['hello'], { type: 'text/plain' }),
      'Grade 5 English Notes.docx',
    )

    expect(ok).toBe(true)

    expect(writeFile).toHaveBeenCalledOnce()
    const writeArg = writeFile.mock.calls[0][0]
    expect(writeArg.path).toBe('Grade 5 English Notes.docx')
    expect(writeArg.data).toBe('aGVsbG8=') // base64('hello') — full bytes, not truncated
    expect(writeArg.directory).toBe('CACHE')

    expect(share).toHaveBeenCalledOnce()
    const shareArg = share.mock.calls[0][0]
    expect(shareArg.files).toEqual(['file:///cache/Grade 5 English Notes.docx'])
    expect(shareArg.title).toBe('Grade 5 English Notes.docx')
  })

  it('propagates a write failure so the caller can fall back', async () => {
    writeFile.mockRejectedValueOnce(new Error('disk full'))
    await expect(saveBlobNative(new Blob(['x']), 'x.docx')).rejects.toThrow('disk full')
    expect(share).not.toHaveBeenCalled()
  })
})
