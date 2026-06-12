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
import { detectImageType } from './assessmentToDocx.js'

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

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll assessmentToDocx tests passed.')
