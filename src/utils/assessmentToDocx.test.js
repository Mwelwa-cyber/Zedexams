/**
 * Regression tests for the Assessment Studio Word (.docx) export.
 *
 * Guards two bugs:
 *   1. Question pictures showed in the studio preview but were missing from
 *      the downloaded Word paper: docx v9 requires `ImageRun.type`, and an
 *      undefined type makes Word silently drop the embedded image (the media
 *      part is written as `<hash>.undefined`).
 *   2. The whole Word download produced a file Word couldn't open ("unreadable
 *      content") when any question carried characters XML 1.0 forbids — stray
 *      control bytes from imported/pasted/OCR'd papers. sanitizeXmlText strips
 *      them at the single run-text funnel.
 *
 * Run: node src/utils/assessmentToDocx.test.js
 */

import { Document, ImageRun, Packer, Paragraph } from 'docx'
import { unzipSync, strFromU8 } from 'fflate'
import { buildAssessmentDocument, buildDiagramIdentifySvg, detectImageType, sanitizeXmlText } from './assessmentToDocx.js'

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

console.log('\nXML-illegal control characters are stripped (the corrupt-.docx bug)')
// Word reports "unreadable content" and refuses to open a .docx whose XML
// carries characters XML 1.0 forbids. Imported papers (scanned PDFs, pasted
// Word, OCR) routinely smuggle in stray control bytes, so a single one
// silently broke the whole Word download. The control bytes are built via
// fromCharCode so this source file stays free of raw control characters.
const NUL = String.fromCharCode(0)
const BS = String.fromCharCode(8)
const US = String.fromCharCode(31)
const NONCHAR = String.fromCharCode(0xfffe) + String.fromCharCode(0xffff)
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/

assert(sanitizeXmlText(`a${NUL}b${BS}c${US}d`) === 'abcd', 'control chars (NUL / BS / US) are removed')
assert(sanitizeXmlText('keep\tthese\nlegal\rchars') === 'keep\tthese\nlegal\rchars', 'tab / newline / CR are kept (legal XML)')
assert(sanitizeXmlText('emoji 🦅 stays') === 'emoji 🦅 stays', 'surrogate pairs (emoji) survive')
assert(sanitizeXmlText(`non${NONCHAR}char`) === 'nonchar', 'the two XML non-characters are removed')

// End-to-end: a question whose title / text / options carry control bytes
// must still pack into a well-formed document.xml (no raw control char leaks).
const dirtyDoc = await buildAssessmentDocument(
  { title: `Dirty${US}Paper`, subject: 'Science', showNameField: true },
  [{
    id: 'q1', order: 1, type: 'mcq',
    text: `Pick the${BS} right one`,
    options: [`good${NUL}`, 'bad', 'ugly', 'fine'],
    correctAnswer: 0, marks: 1,
  }],
  { mode: 'paper' },
)
const dirtyXml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(dirtyDoc)))['word/document.xml'])
assert(!CONTROL_RE.test(dirtyXml), 'packed document.xml contains no raw XML-illegal control characters')
assert(dirtyXml.includes('right one'), 'sanitised question text still renders')

console.log('\nIdentify-mode markers are composited onto the Word image (buildDiagramIdentifySvg)')
// Word can't overlay positioned elements on an inline image, so identify
// papers used to embed a bare image whose numbered answer blanks pointed at
// invisible markers. We now bake numbered circles + leader lines into one PNG;
// this guards the pure SVG builder (the raster step is browser-only).
{
  const svg = buildDiagramIdentifySvg({
    href: 'data:image/png;base64,AAAA',
    width: 400,
    height: 300,
    labels: [
      { x: 0.25, y: 0.25, tx: 0.4, ty: 0.4, text: '' },
      { x: 0.5, y: 0.5, text: 'Aorta' },
      { x: 0.75, y: 0.75, tx: 0.6, ty: 0.6, text: '' },
    ],
  })
  assert(svg.startsWith('<svg') && svg.includes('viewBox="0 0 400 300"'), 'emits an SVG with the image viewBox')
  assert(svg.includes('<image href="data:image/png;base64,AAAA"'), 'inlines the image as the base layer')
  // One numbered <text> per hotspot, numbered 1..N in placement order — even
  // the two blank-text hotspots get a number (that is the whole point).
  assert((svg.match(/<text /g) || []).length === 3, 'one numbered marker per hotspot (blank text included)')
  assert(svg.includes('>1</text>') && svg.includes('>2</text>') && svg.includes('>3</text>'), 'markers are numbered 1, 2, 3 in order')
  // Leader lines only for hotspots that carry a target tip (2 of the 3 here).
  assert((svg.match(/<line /g) || []).length === 2, 'a leader line is drawn only for hotspots with a target tip')
}
{
  // No labels → just the image, no markers (defensive: never throws on empty).
  const svg = buildDiagramIdentifySvg({ href: 'data:image/png;base64,AAAA', width: 100, height: 100, labels: [] })
  assert((svg.match(/<text /g) || []).length === 0, 'no labels → no numbered markers')
  assert(svg.includes('<image '), 'no labels → still renders the base image')
}

console.log('\nTrue/False renders as a 2-option list + a marking-key answer')
// A true/false question used to print only its stem in the Word paper — no
// True/False options, no answer in the marking key — because renderQuestion
// had no `tf` branch. It now renders through the MCQ branch.
{
  const paperDoc = await buildAssessmentDocument(
    { title: 'TF Test', subject: 'Science', showNameField: true },
    [{ id: 'q1', order: 1, type: 'tf', text: 'The sun is a star.', options: ['True', 'False'], correctAnswer: 0, marks: 1 }],
    { mode: 'paper' },
  )
  const paperXml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(paperDoc)))['word/document.xml'])
  assert(paperXml.includes('True') && paperXml.includes('False'), 'tf paper prints the True / False options')

  const schemeDoc = await buildAssessmentDocument(
    { title: 'TF Test', subject: 'Science', showNameField: true },
    [{ id: 'q1', order: 1, type: 'tf', text: 'The sun is a star.', options: ['True', 'False'], correctAnswer: 0, marks: 1 }],
    { mode: 'scheme' },
  )
  const schemeXml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(schemeDoc)))['word/document.xml'])
  assert(schemeXml.includes('Answer'), 'tf marking key prints an Answer line')
}
{
  // The legacy 'truefalse' spelling folds onto 'tf' in buildQuestionBlock, so
  // it renders the same — even without an explicit options array.
  const doc = await buildAssessmentDocument(
    { title: 'TF Test', subject: 'Science', showNameField: true },
    [{ id: 'q1', order: 1, type: 'truefalse', text: 'Water boils at 100°C.', correctAnswer: 1, marks: 1 }],
    { mode: 'paper' },
  )
  const xml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(doc)))['word/document.xml'])
  assert(xml.includes('True') && xml.includes('False'), "aliased 'truefalse' still prints True / False options")
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll assessmentToDocx tests passed.')
