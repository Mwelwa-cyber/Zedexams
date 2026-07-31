/**
 * Magic-byte (file-signature) verification for uploads. STOR-003.
 *
 * Every upload path validates the file's *declared* MIME (`file.type`) against
 * an allow-list, but that string is the client's word: a browser derives it
 * from the OS/extension, and a hostile uploader sets it to anything. So a
 * script renamed `logo.png` sails through an `image/png` allow-list. This reads
 * the real leading bytes and checks them against the allowed types, so the
 * bytes — not the label — decide.
 *
 * Pure detection (`sniffMimeFromBytes`) is DOM-free and unit-tested; the async
 * `assertFileSignature` only needs a Blob/File-like with `.slice().arrayBuffer()`.
 * Deliberately conservative: if it cannot form an expectation for ANY allowed
 * type (e.g. a caller allows a format we don't model), it declines to block
 * rather than reject a legitimate upload — it never *loosens* the existing
 * declared-type check, only adds a second gate on top of it.
 */

// Enough to cover the longest signature we check (WebP needs bytes 0–11).
export const SNIFF_BYTES = 16

// Fixed-offset signatures. WebP is handled separately (it's a split match:
// "RIFF" at 0 and "WEBP" at 8, with the file size in between).
const SIGNATURES = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] }, // "GIF8" (87a/89a)
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // "%PDF-"
  // ZIP local-file / empty-archive / spanned headers. Every OOXML office file
  // (docx/xlsx/pptx) is a ZIP container, so they all sniff as application/zip.
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x05, 0x06] },
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x07, 0x08] },
]

// Declared office MIMEs that legitimately present as a ZIP container on disk.
const ZIP_CONTAINER_MIMES = new Set([
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
])

// The detected types we actually know how to produce from bytes.
const SNIFFABLE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'application/zip'])

function normalizeMime(mime) {
  const m = String(mime || '').toLowerCase().trim()
  if (m === 'image/jpg' || m === 'image/pjpeg') return 'image/jpeg'
  return m
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (Array.isArray(input)) return Uint8Array.from(input)
  return new Uint8Array(0)
}

function isWebp(u8) {
  return u8.length >= 12
    && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 // "RIFF"
    && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50 // "WEBP"
}

/**
 * Detect a MIME type from a file's leading bytes. Returns the canonical MIME
 * (image/png, image/jpeg, image/webp, image/gif, application/pdf,
 * application/zip) or null when nothing matches.
 */
export function sniffMimeFromBytes(input) {
  const u8 = toBytes(input)
  if (isWebp(u8)) return 'image/webp'
  for (const sig of SIGNATURES) {
    if (u8.length >= sig.bytes.length && sig.bytes.every((b, i) => u8[i] === b)) return sig.mime
  }
  return null
}

/** The set of detected-MIMEs that would satisfy any of `allowedMimes`. */
export function expectedSignatureTypes(allowedMimes) {
  const out = new Set()
  for (const raw of allowedMimes || []) {
    const mime = normalizeMime(raw)
    if (ZIP_CONTAINER_MIMES.has(mime)) out.add('application/zip')
    else if (SNIFFABLE.has(mime)) out.add(mime)
  }
  return out
}

/** Read the first `SNIFF_BYTES` of a Blob/File as a Uint8Array. */
export async function readMagicBytes(file, n = SNIFF_BYTES) {
  const buf = await file.slice(0, n).arrayBuffer()
  return new Uint8Array(buf)
}

/**
 * Throw if a file's real bytes don't match one of `allowedMimes`. Returns the
 * detected MIME on success. No-ops (returns null) when none of the allowed
 * types are ones we can verify, so it never blocks a format we don't model.
 *
 * @throws {Error & {code:'file-signature-mismatch'}}
 */
export async function assertFileSignature(file, allowedMimes, { label } = {}) {
  const expected = expectedSignatureTypes(allowedMimes)
  if (expected.size === 0) return null // nothing to verify → don't block
  const detected = sniffMimeFromBytes(await readMagicBytes(file))
  if (!detected || !expected.has(detected)) {
    const err = new Error(
      `This file's contents don't match ${label || 'an accepted format'}. `
      + 'It may have been renamed or is corrupt — please upload a genuine '
      + `${label || 'file of the accepted type'}.`,
    )
    err.code = 'file-signature-mismatch'
    err.detected = detected
    throw err
  }
  return detected
}
