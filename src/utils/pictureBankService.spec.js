import { describe, it, expect, vi, beforeEach } from 'vitest'

// The picture-bank upload helpers must reject non-raster images (SVG in
// particular) before they ever reach Storage — the storage.rules validator is
// the security backstop, this is the friendly-message + defence-in-depth layer.
// We mock the Firebase surface so the pure input-validation branch runs without
// a live backend: a rejected file must throw BEFORE uploadBytes is called.

const uploadBytes = vi.fn(async () => ({ ref: {} }))
const getDownloadURL = vi.fn(async () => 'https://example.test/x.png')

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  deleteDoc: vi.fn(),
  doc: vi.fn(() => ({ id: 'pic123' })),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  serverTimestamp: vi.fn(() => 'ts'),
  setDoc: vi.fn(async () => {}),
  updateDoc: vi.fn(),
}))
vi.mock('firebase/storage', () => ({
  ref: vi.fn(() => ({})),
  uploadBytes: (...args) => uploadBytes(...args),
  getDownloadURL: (...args) => getDownloadURL(...args),
  deleteObject: vi.fn(async () => {}),
}))
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => vi.fn()),
}))
vi.mock('../firebase/config', () => ({
  default: {},
  db: {},
  storage: {},
}))
vi.mock('./generateDiagram', () => ({ generateDiagram: vi.fn() }))

const { uploadBankPicture, uploadStagedBankPicture } = await import('./pictureBankService')

// Real PNG magic bytes; a "<script>" payload for the renamed-file threat.
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]
const SCRIPT_BYTES = [0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x3e, 0x00, 0x00, 0x00, 0x00]

function fakeFile({ type, size = 1024, name = 'pic', bytes = PNG_BYTES }) {
  return {
    type,
    size,
    name,
    // assertFileSignature reads the leading bytes via slice().arrayBuffer().
    slice() {
      return { async arrayBuffer() { return Uint8Array.from(bytes).buffer } }
    },
  }
}

describe('pictureBankService upload validation', () => {
  beforeEach(() => {
    uploadBytes.mockClear()
    getDownloadURL.mockClear()
  })

  const meta = { name: 'Cell diagram', keywords: 'cell,biology', subject: 'science', uid: 'admin1' }

  it('rejects an SVG on the active upload path without touching Storage', async () => {
    await expect(
      uploadBankPicture(fakeFile({ type: 'image/svg+xml', name: 'payload.svg' }), meta),
    ).rejects.toThrow(/SVG is not allowed/i)
    expect(uploadBytes).not.toHaveBeenCalled()
  })

  it('rejects an SVG on the staged bulk-upload path', async () => {
    await expect(
      uploadStagedBankPicture(fakeFile({ type: 'image/svg+xml', name: 'payload.svg' }), { uid: 'admin1' }),
    ).rejects.toThrow(/SVG is not allowed/i)
    expect(uploadBytes).not.toHaveBeenCalled()
  })

  it('rejects a non-image (PDF masquerading) upload', async () => {
    await expect(
      uploadBankPicture(fakeFile({ type: 'application/pdf', name: 'doc.pdf' }), meta),
    ).rejects.toThrow(/JPEG, PNG or WebP/i)
    expect(uploadBytes).not.toHaveBeenCalled()
  })

  it('rejects an oversized raster image', async () => {
    await expect(
      uploadBankPicture(fakeFile({ type: 'image/png', size: 11 * 1024 * 1024, name: 'big.png' }), meta),
    ).rejects.toThrow(/10 MB limit/i)
    expect(uploadBytes).not.toHaveBeenCalled()
  })

  it('rejects a file declared image/png whose real bytes are not an image (STOR-003)', async () => {
    await expect(
      uploadBankPicture(fakeFile({ type: 'image/png', name: 'evil.png', bytes: SCRIPT_BYTES }), meta),
    ).rejects.toThrow(/contents don't match/i)
    expect(uploadBytes).not.toHaveBeenCalled()
  })

  it('accepts a PNG within the limit and uploads it', async () => {
    await expect(
      uploadBankPicture(fakeFile({ type: 'image/png', name: 'cell.png' }), meta),
    ).resolves.toBe('pic123')
    expect(uploadBytes).toHaveBeenCalledTimes(1)
  })
})
