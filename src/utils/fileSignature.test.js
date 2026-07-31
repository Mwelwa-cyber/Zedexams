/**
 * Node tests for the magic-byte upload verifier (STOR-003).
 */

import assert from 'node:assert/strict'
import {
  sniffMimeFromBytes,
  expectedSignatureTypes,
  assertFileSignature,
} from './fileSignature.js'

// Real leading bytes for each format.
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]
const ZIP = [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]
// "RIFF" + 4 size bytes + "WEBP"
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]
// A script/text payload renamed to .png — the exact STOR-003 threat.
const TEXT = [0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x3e] // "<script>"

// A minimal File-like: only .slice().arrayBuffer() is used by the verifier.
const fakeFile = (bytes) => ({
  slice() {
    return { async arrayBuffer() { return Uint8Array.from(bytes).buffer } }
  },
})

async function run(name, fn) {
  await fn()
  console.log(`  ✓ ${name}`)
}

const IMG = ['image/jpeg', 'image/png', 'image/webp']

async function main() {
  console.log('fileSignature')

  // ── sniffMimeFromBytes ──────────────────────────────────────────────────
  await run('detects each known format from its bytes', () => {
    assert.equal(sniffMimeFromBytes(PNG), 'image/png')
    assert.equal(sniffMimeFromBytes(JPEG), 'image/jpeg')
    assert.equal(sniffMimeFromBytes(GIF), 'image/gif')
    assert.equal(sniffMimeFromBytes(PDF), 'application/pdf')
    assert.equal(sniffMimeFromBytes(ZIP), 'application/zip')
    assert.equal(sniffMimeFromBytes(WEBP), 'image/webp')
  })

  await run('returns null for unknown / text bytes and for empty input', () => {
    assert.equal(sniffMimeFromBytes(TEXT), null)
    assert.equal(sniffMimeFromBytes([]), null)
    assert.equal(sniffMimeFromBytes(new Uint8Array(0)), null)
  })

  await run('does NOT mistake a RIFF-but-not-WEBP container for webp', () => {
    const riffAvi = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20] // "AVI "
    assert.equal(sniffMimeFromBytes(riffAvi), null)
  })

  // ── expectedSignatureTypes ──────────────────────────────────────────────
  await run('maps office OOXML declared types onto the zip container', () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    assert.deepEqual([...expectedSignatureTypes([docx])], ['application/zip'])
  })

  await run('normalises image/jpg to image/jpeg and ignores unmodellable types', () => {
    assert.deepEqual([...expectedSignatureTypes(['image/jpg'])], ['image/jpeg'])
    assert.equal(expectedSignatureTypes(['application/x-unknowable']).size, 0)
  })

  // ── assertFileSignature ─────────────────────────────────────────────────
  await run('accepts a real image and returns the detected type', async () => {
    assert.equal(await assertFileSignature(fakeFile(PNG), IMG), 'image/png')
    assert.equal(await assertFileSignature(fakeFile(WEBP), IMG), 'image/webp')
  })

  await run('rejects a text payload renamed as an allowed image', async () => {
    await assert.rejects(
      () => assertFileSignature(fakeFile(TEXT), IMG),
      (e) => e.code === 'file-signature-mismatch',
    )
  })

  await run('rejects a real GIF when GIF is not in the allow-list', async () => {
    await assert.rejects(
      () => assertFileSignature(fakeFile(GIF), IMG),
      (e) => e.code === 'file-signature-mismatch' && e.detected === 'image/gif',
    )
  })

  await run('does not block when no allowed type is verifiable (returns null)', async () => {
    assert.equal(await assertFileSignature(fakeFile(TEXT), ['application/x-unknowable']), null)
  })

  console.log('All fileSignature tests passed.')
}

main().catch((err) => { console.error(err); process.exit(1) })
