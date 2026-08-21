import { describe, it, expect, vi, beforeEach } from 'vitest'

const writeFile = vi.fn(async () => ({ uri: 'file:///cache/Grade 5 English Notes.docx' }))
const share = vi.fn(async () => {})
const saveToDownloads = vi.fn(async () => ({
  uri: 'content://media/external/downloads/42',
  filename: 'Grade 5 English Notes.docx',
}))

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: (...a) => writeFile(...a) },
  Directory: { Cache: 'CACHE' },
}))
vi.mock('@capacitor/share', () => ({
  Share: { share: (...a) => share(...a) },
}))
vi.mock('./clientErrorReporting.js', () => ({ reportClientError: vi.fn() }))

// The app-local `ZedDownloads` Capacitor plugin is resolved through
// runtime.nativePlugin(), so that is the seam the tests drive: returning null
// simulates an APK built before the plugin existed.
vi.mock('./runtime.js', () => ({ nativePlugin: vi.fn() }))

import { nativePlugin } from './runtime.js'
import { blobToBase64, saveBlobNative, shareBlobNative } from './nativeDownload.js'

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
    vi.clearAllMocks()
    vi.mocked(nativePlugin).mockReturnValue({ saveToDownloads })
    saveToDownloads.mockResolvedValue({ uri: 'content://media/external/downloads/42' })
    writeFile.mockResolvedValue({ uri: 'file:///cache/Grade 5 English Notes.docx' })
  })

  // ── THE regression: Download must save a file, not offer a share sheet ──────

  it('writes the full bytes into the public Downloads folder, and does NOT share', async () => {
    // Teachers reported that "Download" opened a WhatsApp/Bluetooth chooser and
    // left nothing on the phone. The bytes now go to MediaStore's Downloads
    // collection, where Files and Word can both see them.
    const ok = await saveBlobNative(
      new Blob(['hello'], { type: 'text/plain' }),
      'Grade 5 English Notes.docx',
    )

    expect(ok).toBe(true)
    expect(saveToDownloads).toHaveBeenCalledOnce()
    const arg = saveToDownloads.mock.calls[0][0]
    expect(arg.filename).toBe('Grade 5 English Notes.docx')
    expect(arg.data).toBe('aGVsbG8=') // base64('hello') — full bytes, not truncated
    expect(arg.mimeType).toBe('text/plain')

    // The two halves of the fix: nothing is shared, and nothing is written to
    // the unreachable app-private cache.
    expect(share).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('passes an empty mimeType through when the blob has none (the plugin guesses)', async () => {
    await saveBlobNative(new Blob(['x']), 'paper.docx')
    expect(saveToDownloads.mock.calls[0][0].mimeType).toBe('')
  })

  // ── Fallback: an APK that predates the plugin ─────────────────────────────

  it('falls back to cache+share when the Downloads plugin is not in this APK', async () => {
    // Adding the Java file is not enough — the plugin only reaches the device
    // after `npx cap sync android` and a fresh build. Until a user updates, the
    // old route is still their way to get the document out, so the worst case
    // of this change is yesterday's behaviour rather than a broken button.
    vi.mocked(nativePlugin).mockReturnValue(null)

    const ok = await saveBlobNative(new Blob(['hello']), 'Grade 5 English Notes.docx')

    expect(ok).toBe(true)
    expect(writeFile).toHaveBeenCalledOnce()
    expect(writeFile.mock.calls[0][0].directory).toBe('CACHE')
    expect(share).toHaveBeenCalledOnce()
    expect(share.mock.calls[0][0].files).toEqual(['file:///cache/Grade 5 English Notes.docx'])
  })

  it('falls back to cache+share when the user denies the legacy storage permission', async () => {
    // Android 9 and below need WRITE_EXTERNAL_STORAGE for the public Downloads
    // directory. Refusing it is a decision about the folder, not about the file.
    saveToDownloads.mockRejectedValueOnce(new Error('STORAGE_PERMISSION_DENIED'))

    const ok = await saveBlobNative(new Blob(['x']), 'x.docx')

    expect(ok).toBe(true)
    expect(share).toHaveBeenCalledOnce()
  })

  it('throws when BOTH routes fail, so saveBlob can reach its data: URL last resort', async () => {
    saveToDownloads.mockRejectedValueOnce(new Error('SAVE_FAILED: disk full'))
    writeFile.mockRejectedValueOnce(new Error('disk full'))

    await expect(saveBlobNative(new Blob(['x']), 'x.docx')).rejects.toThrow('disk full')
  })
})

describe('shareBlobNative (the fallback route)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    writeFile.mockResolvedValue({ uri: 'file:///cache/x.docx' })
  })

  it('propagates a write failure so the caller can fall back', async () => {
    writeFile.mockRejectedValueOnce(new Error('disk full'))
    await expect(shareBlobNative(new Blob(['x']), 'x.docx')).rejects.toThrow('disk full')
    expect(share).not.toHaveBeenCalled()
  })

  it('resolves (does NOT throw) when the user dismisses the share sheet', async () => {
    // The file is already on disk; a dismissed sheet is a deliberate "no". If we
    // threw, saveBlob would fall through to the data: URL route and dump a
    // truncated .docx the user never asked for — the "unreadable content" bug.
    share.mockRejectedValueOnce(new Error('Share canceled'))
    await expect(
      shareBlobNative(new Blob(['x'], { type: 'application/octet-stream' }), 'x.docx'),
    ).resolves.toBe(true)
    expect(writeFile).toHaveBeenCalledOnce()
  })

  it('propagates a genuine share failure so the caller can fall back', async () => {
    // Not a cancel — the file sits in unreachable app-private cache, so saveBlob
    // must still get a chance to hand the user the bytes via the data: URL.
    share.mockRejectedValueOnce(new Error('No Activity found to handle Intent'))
    await expect(shareBlobNative(new Blob(['x']), 'x.docx')).rejects.toThrow(/No Activity/)
  })
})
