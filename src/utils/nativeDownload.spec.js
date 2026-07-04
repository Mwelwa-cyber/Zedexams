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

  it('resolves (does NOT throw) when the user dismisses the share sheet', async () => {
    // The file is already on disk; a dismissed sheet is a deliberate "no". If we
    // threw, saveBlob would fall through to the data: URL route and dump a
    // truncated .docx the user never asked for — the "unreadable content" bug.
    share.mockRejectedValueOnce(new Error('Share canceled'))
    await expect(
      saveBlobNative(new Blob(['x'], { type: 'application/octet-stream' }), 'x.docx'),
    ).resolves.toBe(true)
    expect(writeFile).toHaveBeenCalledOnce()
  })

  it('propagates a genuine share failure so the caller can fall back', async () => {
    // Not a cancel — the file sits in unreachable app-private cache, so saveBlob
    // must still get a chance to hand the user the bytes via the data: URL.
    share.mockRejectedValueOnce(new Error('No Activity found to handle Intent'))
    await expect(saveBlobNative(new Blob(['x']), 'x.docx')).rejects.toThrow(/No Activity/)
  })
})
