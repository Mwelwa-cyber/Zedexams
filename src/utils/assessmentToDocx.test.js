/**
 * Regression tests for the Assessment Studio Word (.docx) export.
 *
 * Guards the bug where question pictures showed in the studio preview but
 * were missing from the downloaded Word paper: docx v9 requires
 * `ImageRun.type`, and an undefined type makes Word silently drop the
 * embedded image (the media part is written as `<hash>.undefined`).
 *
 * Run: node src/utils/assessmentToDocx.test.js
 */

import { Document, ImageRun, Packer, Paragraph } from 'docx'
import { unzipSync, strFromU8 } from 'fflate'
import { buildAssessmentDocument, detectImageType } from './assessmentToDocx.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

// Minimal valid PNG (1×1 transparent pixel).
const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

console.log('detectImageType — magic-byte sniffing')
assert(detectImageType(PNG_1x1) === 'png', 'PNG header → png')
assert(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])) === 'jpg', 'JPEG header → jpg')
assert(detectImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38])) === 'gif', 'GIF header → gif')
assert(detectImageType(new Uint8Array([0x42, 0x4d, 0x00, 0x00])) === 'bmp', 'BMP header → bmp')
assert(detectImageType(new Uint8Array([0x00, 0x01, 0x02, 0x03])) === 'png', 'unknown header → png fallback')
assert(detectImageType(null) === 'png', 'null bytes → png fallback')
// WEBP (RIFF....WEBP) must be recognised so it can be transcoded to PNG —
// docx cannot embed WEBP, and the picture bank stores uploads in their
// original format. Mislabelling it as png would write a broken media part.
const WEBP_HEADER = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
assert(detectImageType(WEBP_HEADER) === 'webp', 'WEBP header → webp')

console.log('\nPacked .docx embeds a real image part (not <hash>.undefined)')
const doc = new Document({
  sections: [{
    children: [new Paragraph({
      children: [new ImageRun({
        type: detectImageType(PNG_1x1),
        data: PNG_1x1,
        transformation: { width: 100, height: 100 },
      })],
    })],
  }],
})

const buf = await Packer.toBuffer(doc)
// Zip stores entry filenames as plain bytes in local/central headers, so
// we can scan the raw buffer for the media part name.
const asText = Buffer.from(buf).toString('latin1')
assert(asText.includes('media/'), 'document contains a word/media image part')
assert(asText.includes('.png'), 'image part carries the .png extension')
assert(!asText.includes('.undefined'), 'no .undefined media part (the dropped-image bug)')

console.log('\nWEBP picture is never embedded as a broken media part')
// Transcoding WEBP→PNG needs a browser canvas. Without a DOM (this node
// harness) the exporter must skip the WEBP image rather than ship raw WEBP
// bytes under a .png/.undefined name that Word would render broken.
const realFetch = globalThis.fetch
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => WEBP_HEADER.buffer.slice(0) })
try {
  const webpDoc = await buildAssessmentDocument(
    { title: 'Pic Test', subject: 'Science', showNameField: true, showDateField: true },
    [{ id: 'q1', order: 1, type: 'short_answer', text: 'Identify the picture.', imageUrl: 'https://example/pic.webp', marks: 1 }],
    { mode: 'paper' },
  )
  const webpText = Buffer.from(await Packer.toBuffer(webpDoc)).toString('latin1')
  assert(!webpText.includes('.undefined'), 'WEBP question → no .undefined media part')
  assert(!webpText.includes('media/'), 'WEBP question → no broken media part when transcoding is unavailable')
} finally {
  globalThis.fetch = realFetch
}

console.log('\nUnreadable image → visible fallback placeholder (not a silent gap)')
// When the image bytes can't be read (e.g. Storage CORS not applied, or a
// dead URL), fetchImageBytes returns null. The exporter must drop a visible
// dashed placeholder into the paper so the diagram gap is obvious — this is
// the belt to the cors.json braces.
globalThis.fetch = async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) })
try {
  const failDoc = await buildAssessmentDocument(
    { title: 'Pic Test', subject: 'Science', showNameField: true, showDateField: true },
    [{ id: 'q1', order: 1, type: 'short_answer', text: 'Identify the diagram.', imageUrl: 'https://example/diagram.png', marks: 1 }],
    { mode: 'paper' },
  )
  const buf = await Packer.toBuffer(failDoc)
  const docXml = strFromU8(unzipSync(new Uint8Array(buf))['word/document.xml'])
  assert(docXml.includes('could not be embedded'), 'unreadable image → fallback placeholder text in the paper')
  assert(!docXml.includes('media/'), 'unreadable image → no broken media part')
} finally {
  globalThis.fetch = realFetch
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll assessmentToDocx tests passed.')
