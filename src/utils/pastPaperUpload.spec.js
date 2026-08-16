/**
 * uploadPaperAsset's compression policy.
 *
 * A scanned page used to be uploaded raw at up to 50 MB, and every learner who
 * opens the paper downloads those bytes again — so this one call drives both
 * the bucket size and the egress bill. Compression was added there; these lock
 * the decisions around it, because every way this goes wrong is silent:
 *
 *   • a PDF fed to canvas
 *   • a re-encode that comes out BIGGER than the original
 *   • a canvas failure taking the whole upload with it
 *   • width/height describing the original while the stored bytes are smaller,
 *     so the viewer reserves the wrong layout slot — the exact jank the
 *     dimensions were captured to prevent
 *   • a .png name on JPEG bytes
 *
 * compressImage itself is mocked: it is a canvas round-trip, which jsdom does
 * not implement, and the logic under test is the POLICY around it rather than
 * the pixels.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../firebase/config', () => ({ db: {}, storage: {} }))
vi.mock('firebase/storage', () => ({
  getDownloadURL: vi.fn(async () => 'https://example.test/x'),
  ref: vi.fn((_s, path) => ({ __path: path })),
}))

const uploadBytes = vi.fn(async () => ({}))
vi.mock('../firebase/attestedStorage', () => ({
  uploadBytes: (...a) => uploadBytes(...a),
  deleteObject: vi.fn(async () => {}),
}))
vi.mock('./analytics', () => ({ capture: vi.fn() }))

const compressImage = vi.fn()
vi.mock('./imageCompression', () => ({ compressImage: (...a) => compressImage(...a) }))

const { uploadPaperAsset, PAPER_IMAGE_MAX_WIDTH, PAPER_IMAGE_QUALITY } =
  await import('./pastPapers.js')

/** A stand-in File: size + type + name is all the upload path reads. */
function fakeFile(name, type, size) {
  return { name, type, size, __file: true }
}
/** canvas.toBlob's product. */
function fakeBlob(size, type = 'image/jpeg') {
  return { size, type, __blob: true }
}

const ARGS = { uid: 'admin1', paperId: 'p1', index: 0 }
const uploaded = () => uploadBytes.mock.calls.at(-1)

beforeEach(() => {
  uploadBytes.mockClear()
  compressImage.mockReset()
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  // jsdom does not decode images, so a real `new Image()` fires NEITHER onload
  // nor onerror and readImageDimensions awaits forever. Stub one that reports a
  // decoded size, which also lets the dimensions assertions be real rather than
  // asserting the null-on-failure path by accident.
  vi.stubGlobal('Image', class {
    constructor() {
      this.naturalWidth = 1800
      this.naturalHeight = 2546
      setTimeout(() => this.onload?.(), 0)
    }
    set src(_v) { /* triggered from the constructor above */ }
  })
})

describe('uploadPaperAsset compression', () => {
  it('shrinks a scanned JPEG and stores the compressed bytes', async () => {
    const blob = fakeBlob(400_000)
    compressImage.mockResolvedValue(blob)
    const file = fakeFile('scan.jpg', 'image/jpeg', 6_000_000)
    const res = await uploadPaperAsset({ ...ARGS, file })

    expect(compressImage).toHaveBeenCalledOnce()
    expect(uploaded()[1]).toBe(blob)
    // The record must describe what was STORED, not what was chosen.
    expect(res.size).toBe(400_000)
    expect(res.contentType).toBe('image/jpeg')
    // Dimensions are measured from the COMPRESSED blob. Measuring the original
    // would have the viewer reserve a slot for an image that no longer exists
    // at that size, which is the jank this field was added to prevent.
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(URL.createObjectURL).not.toHaveBeenCalledWith(file)
    expect(res.width).toBe(1800)
    expect(res.height).toBe(2546)
  })

  it('passes the document-legible preset, not the illustration one', async () => {
    compressImage.mockResolvedValue(fakeBlob(400_000))
    await uploadPaperAsset({ ...ARGS, file: fakeFile('scan.jpg', 'image/jpeg', 6_000_000) })

    const [, maxWidth, quality, background] = compressImage.mock.calls[0]
    expect(maxWidth).toBe(PAPER_IMAGE_MAX_WIDTH)
    expect(quality).toBe(PAPER_IMAGE_QUALITY)
    // A paper is read, not glanced at: 1200px (the quiz-image/logo preset)
    // is where small print stops being legible on A4.
    expect(maxWidth).toBeGreaterThan(1200)
    // JPEG has no alpha; without an explicit white ground a transparent PNG
    // composites to BLACK, which is invisible in a thumbnail and ruins a page.
    expect(background).toBe('#ffffff')
  })

  it('never touches a PDF', async () => {
    const file = fakeFile('paper.pdf', 'application/pdf', 9_000_000)
    const res = await uploadPaperAsset({ ...ARGS, file })

    expect(compressImage).not.toHaveBeenCalled()
    expect(uploaded()[1]).toBe(file)
    expect(res.contentType).toBe('application/pdf')
    expect(res.size).toBe(9_000_000)
  })

  it('keeps the original when the re-encode comes out no smaller', async () => {
    // An already-optimised JPEG can grow on re-encode. Storing the larger one
    // would make "compression" a net loss, quietly.
    const file = fakeFile('tight.jpg', 'image/jpeg', 100_000)
    compressImage.mockResolvedValue(fakeBlob(140_000))
    const res = await uploadPaperAsset({ ...ARGS, file })

    expect(uploaded()[1]).toBe(file)
    expect(res.size).toBe(100_000)
    expect(res.filename).toBe('tight.jpg')
  })

  it('falls back to the original when canvas throws', async () => {
    // Canvas runs out of memory on very large images. A slightly larger paper
    // is fine; a paper the admin cannot upload at all is not.
    const file = fakeFile('huge.png', 'image/png', 40_000_000)
    compressImage.mockRejectedValue(new Error('canvas OOM'))
    const res = await uploadPaperAsset({ ...ARGS, file })

    expect(uploaded()[1]).toBe(file)
    expect(res.contentType).toBe('image/png')
  })

  it('renames a converted PNG to .jpg so the extension matches the bytes', async () => {
    compressImage.mockResolvedValue(fakeBlob(300_000))
    const res = await uploadPaperAsset({ ...ARGS, file: fakeFile('page-2.png', 'image/png', 5_000_000) })

    expect(res.filename).toBe('page-2.jpg')
    expect(res.contentType).toBe('image/jpeg')
    expect(uploaded()[0].__path).toMatch(/page-2\.jpg$/)
    expect(uploaded()[0].__path).not.toMatch(/\.png$/)
  })

  it('still rejects a file over the 50 MB gate rather than compressing around it', async () => {
    // The gate is deliberately BEFORE compression: shrinking first would change
    // what the product accepts, and would mean decoding an arbitrarily large
    // image on the client just to find out.
    await expect(
      uploadPaperAsset({ ...ARGS, file: fakeFile('vast.jpg', 'image/jpeg', 60 * 1024 * 1024) }),
    ).rejects.toThrow(/larger than 50MB/)
    expect(compressImage).not.toHaveBeenCalled()
    expect(uploadBytes).not.toHaveBeenCalled()
  })
})
