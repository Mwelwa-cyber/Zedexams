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
import { DEFAULT_ANSWER_LINES } from './assessmentPaperLayout.js'
import { clearImageBytesCache } from './fetchImageBytes.js'

// fetchImageBytes caches successful byte results per URL for the session.
// These scenarios deliberately reuse the same imageUrl with different fetch
// stubs (success in one case, failure in another), so each clears the cache
// first — otherwise a prior success leaks in and masks the case under test.

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
clearImageBytesCache()
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

console.log('\nCORS-poisoned cache → exporter retries and still embeds the image')
// The studio preview loads the image with a plain <img>, poisoning the HTTP
// cache with a no-CORS (header-less) response. The first mode:'cors' fetch
// therefore rejects with a CORS error; the exporter must retry with
// `cache: 'reload'` and recover the bytes so the diagram still lands in the
// download. Without the retry the image silently vanished from the paper even
// though it showed in the preview.
{
  let calls = 0
  clearImageBytesCache()
  globalThis.fetch = async (_url, opts) => {
    calls += 1
    // First attempt mimics the poisoned-cache CORS rejection; the reload
    // attempt (cache:'reload') gets a fresh response with the bytes.
    if ((opts && opts.cache) !== 'reload') throw new TypeError('Failed to fetch (CORS)')
    return { ok: true, arrayBuffer: async () => PNG_1x1.buffer.slice(0) }
  }
  try {
    const recoveredDoc = await buildAssessmentDocument(
      { title: 'Pic Test', subject: 'Science', showNameField: true, showDateField: true },
      [{ id: 'q1', order: 1, type: 'short_answer', text: 'Identify the diagram.', imageUrl: 'https://example/diagram.png', marks: 1 }],
      { mode: 'paper' },
    )
    const recoveredText = Buffer.from(await Packer.toBuffer(recoveredDoc)).toString('latin1')
    assert(calls >= 2, 'first (poisoned-cache) fetch failed, exporter retried with cache:reload')
    assert(recoveredText.includes('media/') && recoveredText.includes('.png'), 'retried fetch → image embedded as a real media part')
    assert(!recoveredText.includes('could not be embedded'), 'retried fetch → no fallback placeholder')
  } finally {
    globalThis.fetch = realFetch
  }
}

console.log('\nBucket CORS missing → exporter falls back to the same-origin image proxy')
// When the bucket returns NO CORS headers at all (config missing or applied to
// the wrong bucket name), every direct fetch — including the cache:'reload'
// retry — rejects. The exporter must then read the bytes through the same-origin
// /api/image-proxy and still embed the figure, instead of dropping a placeholder.
{
  let proxyHit = false
  clearImageBytesCache()
  globalThis.fetch = async (url, _opts) => {
    if (String(url).includes('/api/image-proxy')) {
      proxyHit = true
      return { ok: true, arrayBuffer: async () => PNG_1x1.buffer.slice(0) }
    }
    // Every direct (cross-origin) attempt fails with a CORS error.
    throw new TypeError('Failed to fetch (CORS)')
  }
  try {
    const proxiedDoc = await buildAssessmentDocument(
      { title: 'Pic Test', subject: 'Science', showNameField: true, showDateField: true },
      [{ id: 'q1', order: 1, type: 'short_answer', text: 'Identify the diagram.', imageUrl: 'https://firebasestorage.googleapis.com/v0/b/examsprepzambia.firebasestorage.app/o/x.png?alt=media&token=t', marks: 1 }],
      { mode: 'paper' },
    )
    const proxiedText = Buffer.from(await Packer.toBuffer(proxiedDoc)).toString('latin1')
    assert(proxyHit, 'direct CORS fetch failed → exporter requested the same-origin proxy')
    assert(proxiedText.includes('media/') && proxiedText.includes('.png'), 'proxy fetch → image embedded as a real media part')
    assert(!proxiedText.includes('could not be embedded'), 'proxy fetch → no fallback placeholder')
  } finally {
    globalThis.fetch = realFetch
  }
}

console.log('\nProxy returns the SPA fallback (rewrite not live) → fail closed, no garbage embed')
// If the /api/image-proxy Hosting rewrite isn't live yet, the request resolves
// to the SPA's index.html (HTTP 200, text/html). The exporter must NOT embed
// those HTML bytes as a PNG (a fresh broken-image bug) — it must reject the
// non-image response and drop the visible placeholder instead.
{
  clearImageBytesCache()
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/image-proxy')) {
      return {
        ok: true,
        headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
        arrayBuffer: async () => new TextEncoder().encode('<!doctype html><html><body>app</body></html>').buffer,
      }
    }
    throw new TypeError('Failed to fetch (CORS)')
  }
  try {
    const htmlDoc = await buildAssessmentDocument(
      { title: 'Pic Test', subject: 'Science', showNameField: true, showDateField: true },
      [{ id: 'q1', order: 1, type: 'short_answer', text: 'Identify the diagram.', imageUrl: 'https://firebasestorage.googleapis.com/v0/b/examsprepzambia.firebasestorage.app/o/x.png?alt=media&token=t', marks: 1 }],
      { mode: 'paper' },
    )
    const docXml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(htmlDoc)))['word/document.xml'])
    assert(docXml.includes('could not be embedded'), 'HTML fallback response → visible placeholder, not embedded')
    assert(!docXml.includes('media/'), 'HTML fallback response → no media part written')
  } finally {
    globalThis.fetch = realFetch
  }
}

console.log('\nUnreadable image → visible fallback placeholder (not a silent gap)')
// When the image bytes can't be read (e.g. Storage CORS not applied, or a
// dead URL), fetchImageBytes returns null. The exporter must drop a visible
// dashed placeholder into the paper so the diagram gap is obvious — this is
// the belt to the cors.json braces.
clearImageBytesCache()
globalThis.fetch = async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) })
try {
  const stats = { failedImages: [] }
  const failDoc = await buildAssessmentDocument(
    { title: 'Pic Test', subject: 'Science', showNameField: true, showDateField: true },
    [{ id: 'q1', order: 1, type: 'short_answer', text: 'Identify the diagram.', imageUrl: 'https://example/diagram.png', imageAlt: 'water cycle', marks: 1 }],
    { mode: 'paper', stats },
  )
  const buf = await Packer.toBuffer(failDoc)
  const docXml = strFromU8(unzipSync(new Uint8Array(buf))['word/document.xml'])
  assert(docXml.includes('could not be embedded'), 'unreadable image → fallback placeholder text in the paper')
  assert(!docXml.includes('media/'), 'unreadable image → no broken media part')
  // The failure must also be REPORTED, not just marked in the document —
  // downloadAssessmentDocx counts these so the studio can toast a warning
  // instead of shipping a silently-degraded paper.
  assert(stats.failedImages.length === 1, 'unreadable image → counted in stats.failedImages')
  assert(stats.failedImages[0] === 'water cycle', 'failure records the figure label')
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

console.log('\nThe paper banner is a REAL Word header, not body text')
// The school / title / subject banner used to be the first few lines of body
// text. It is now a real Word first-page header (paperSectionShell), so it sits
// in the header region and prints once at the top — matching the preview / PDF.
{
  const doc = await buildAssessmentDocument(
    { schoolName: 'Kabulonga Primary', subject: 'Science', grade: '7', assessmentType: 'end_of_term', term: '2', showNameField: true },
    [{ id: 'q1', order: 1, type: 'short_answer', text: 'Name a planet.', marks: 1 }],
    { mode: 'paper' },
  )
  const files = unzipSync(new Uint8Array(await Packer.toBuffer(doc)))
  const headerParts = Object.keys(files).filter((n) => /word\/header\d+\.xml/.test(n))
  const headerXml = headerParts.map((n) => strFromU8(files[n])).join('\n')
  const docXml = strFromU8(files['word/document.xml'])
  assert(headerParts.length >= 1, 'document carries a real Word header part')
  assert(headerXml.includes('KABULONGA PRIMARY') && headerXml.includes('GRADE SEVEN'), 'school name + paper title live in the header part')
  assert(!docXml.includes('KABULONGA PRIMARY'), 'banner is NOT duplicated into the document body')
  assert(docXml.includes('<w:titlePg/>'), 'section is flagged titlePage so the banner prints once (page 1)')
  assert(docXml.includes('Pupil'), 'the document body still begins at the learner fields')
}

console.log('\nFree-plan export composes the watermark INTO the paper headers')
{
  const doc = await buildAssessmentDocument(
    { schoolName: 'Kabulonga Primary', subject: 'Science', grade: '7', showNameField: true },
    [{ id: 'q1', order: 1, type: 'short_answer', text: 'Q', marks: 1 }],
    { mode: 'paper', attribution: true },
  )
  const files = unzipSync(new Uint8Array(await Packer.toBuffer(doc)))
  const headerXmls = Object.keys(files).filter((n) => /word\/header\d+\.xml/.test(n)).map((n) => strFromU8(files[n]))
  const footerParts = Object.keys(files).filter((n) => /word\/footer\d+\.xml/.test(n))
  // A first-page header (banner + watermark) AND a running header (watermark)
  // for pages 2+ — a Word section has one header per type, so the banner and the
  // watermark must share the first-page header.
  assert(headerXmls.length >= 2, 'free-plan paper has both a first-page and a running header')
  assert(headerXmls.every((x) => x.includes('textpath')), 'every header part carries the diagonal watermark')
  assert(headerXmls.some((x) => x.includes('GRADE')), 'the first-page header still carries the banner')
  assert(footerParts.length >= 1, 'free-plan paper carries the attribution footer')
}
{
  // Paid / admin export stays completely clean.
  const doc = await buildAssessmentDocument(
    { schoolName: 'Kabulonga Primary', subject: 'Science', grade: '7', showNameField: true },
    [{ id: 'q1', order: 1, type: 'short_answer', text: 'Q', marks: 1 }],
    { mode: 'paper', attribution: false },
  )
  const files = unzipSync(new Uint8Array(await Packer.toBuffer(doc)))
  const headerXml = Object.keys(files).filter((n) => /word\/header\d+\.xml/.test(n)).map((n) => strFromU8(files[n])).join('')
  assert(!headerXml.includes('textpath'), 'paid export has no watermark in the header')
  assert(!Object.keys(files).some((n) => /word\/footer\d+\.xml/.test(n)), 'paid export has no footer')
}

console.log('\nInstructions box matches the preview label (Instructions vs Marking key)')
{
  const paper = await buildAssessmentDocument(
    { subject: 'Science', grade: '7', coverInstructions: 'Answer all questions.' },
    [{ id: 'q1', order: 1, type: 'mcq', text: 'Q', options: ['a', 'b'], correctAnswer: 0, marks: 1 }],
    { mode: 'paper' },
  )
  const paperXml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(paper)))['word/document.xml'])
  assert(paperXml.includes('Instructions') && !paperXml.includes('Marking key'), 'paper mode prints the "Instructions" label')

  // Scheme mode with NO cover instructions still prints the "Marking key" label,
  // matching the preview — the DOCX used to drop the whole block when text was empty.
  const scheme = await buildAssessmentDocument(
    { subject: 'Science', grade: '7' },
    [{ id: 'q1', order: 1, type: 'mcq', text: 'Q', options: ['a', 'b'], correctAnswer: 0, marks: 1 }],
    { mode: 'scheme' },
  )
  const schemeXml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(scheme)))['word/document.xml'])
  assert(schemeXml.includes('Marking key'), 'scheme mode prints the "Marking key" label even with no cover text')
}

console.log('\nEssay answer space honours the shared line-count constant (preview parity)')
{
  // Learner fields off, so the only ruled lines in the body are the essay's.
  const doc = await buildAssessmentDocument(
    { subject: 'English', grade: '7', showNameField: false, showDateField: false, showMarksField: false },
    [{ id: 'q1', order: 1, type: 'essay', text: 'Write about your school.', marks: 10 }],
    { mode: 'paper' },
  )
  const docXml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(doc)))['word/document.xml'])
  const ruled = (docXml.match(/_{50,}/g) || []).length
  assert(ruled === DEFAULT_ANSWER_LINES.essay, `essay prints DEFAULT_ANSWER_LINES.essay (${DEFAULT_ANSWER_LINES.essay}) ruled lines, got ${ruled}`)
}

console.log('\nDrawing canvas prints ABOVE the ruled answer lines (preview block order)')
{
  const doc = await buildAssessmentDocument(
    { subject: 'Art', grade: '7', showNameField: false, showDateField: false, showMarksField: false },
    [{ id: 'q1', order: 1, type: 'essay', text: 'Sketch and describe a plant.', marks: 10, drawingHeight: 160 }],
    { mode: 'paper' },
  )
  const docXml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(doc)))['word/document.xml'])
  const canvasAt = docXml.indexOf('w:trHeight')   // the fixed-height drawing-canvas table row
  const firstLineAt = docXml.search(/_{50,}/)      // the first ruled answer line
  assert(canvasAt > -1 && firstLineAt > -1, 'both the drawing canvas and the ruled lines are present')
  assert(canvasAt < firstLineAt, 'drawing canvas comes before the ruled answer lines, like the preview')
}

console.log('\nLabelled-diagram markers composite onto the Word image (buildDiagramIdentifySvg mode:labeled)')
{
  const svg = buildDiagramIdentifySvg({
    href: 'data:image/png;base64,AAAA',
    width: 400, height: 300, mode: 'labeled',
    labels: [
      { x: 0.25, y: 0.25, tx: 0.4, ty: 0.4, text: 'Aorta' },
      { x: 0.6, y: 0.6, text: 'Vena cava' },
      { x: 0.8, y: 0.8, text: '' }, // empty → no pill
    ],
  })
  assert((svg.match(/<rect /g) || []).length === 2, 'one pill box per non-empty label (the blank one is skipped)')
  assert(svg.includes('>Aorta</text>') && svg.includes('>Vena cava</text>'), 'pills carry the label TEXT, not a number')
  assert((svg.match(/<line /g) || []).length === 1, 'a leader line is drawn only for the label with a target tip')
  assert(!svg.includes('>1</text>'), 'labelled mode does not number the markers (that is identify mode)')
}
{
  // Special characters in a label are XML-escaped so the composited SVG stays valid.
  const svg = buildDiagramIdentifySvg({
    href: 'data:image/png;base64,AAAA', width: 100, height: 100, mode: 'labeled',
    labels: [{ x: 0.5, y: 0.5, text: 'H2O <gas> & air' }],
  })
  assert(svg.includes('H2O &lt;gas&gt; &amp; air'), 'label text is XML-escaped in the pill')
}

console.log('\nThe Word overlay places labels through the shared resolver (§4.2)')
{
  // A leader line must LEAVE the pill. It used to start at the label's centre,
  // so its first third ran underneath the box and struck through the text.
  const svg = buildDiagramIdentifySvg({
    href: 'data:image/png;base64,AAAA', width: 400, height: 300, mode: 'labeled',
    labels: [{ x: 0.25, y: 0.5, tx: 0.85, ty: 0.5, text: 'Aorta' }],
  })
  const line = /<line x1="([\d.]+)" y1="[\d.]+" x2="([\d.]+)"/.exec(svg)
  assert(line, 'a leader line is drawn')
  const centre = 0.25 * 400
  assert(Number(line[1]) > centre + 8, `the line starts outside the pill (x1=${line[1]}, centre=${centre})`)
  assert(Math.abs(Number(line[2]) - 0.85 * 400) < 0.5, 'and ends exactly on the part')
}
{
  // Two labels dropped on the same point printed on top of each other in every
  // renderer. They are separated now — and the resolver is shared, so the Word
  // file and the studio preview separate them the same way.
  const svg = buildDiagramIdentifySvg({
    href: 'data:image/png;base64,AAAA', width: 400, height: 300, mode: 'labeled',
    labels: [{ x: 0.5, y: 0.5, text: 'Atrium' }, { x: 0.5, y: 0.5, text: 'Ventricle' }],
  })
  const ys = [...svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)"/g)].map(m => Number(m[1]))
  assert(ys.length === 2, 'both pills are drawn')
  assert(Math.abs(ys[0] - ys[1]) > 1, `and they no longer sit at the same spot (${ys.join(' vs ')})`)
}

console.log('\nLabelled diagram keeps its labels as a text list when the composite is unavailable')
{
  // No canvas in this node harness, so the on-image composite can't render; the
  // labels must still survive as a "Labels:" text list so the Word download
  // doesn't silently lose them.
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => PNG_1x1.buffer.slice(0) })
  try {
    const doc = await buildAssessmentDocument(
      { subject: 'Science', grade: '7', showNameField: false, showDateField: false, showMarksField: false },
      [{
        id: 'q1', order: 1, type: 'diagram', marks: 3, text: 'Study the heart.',
        imageUrl: 'https://example/heart.png', diagramMode: 'labeled',
        diagramLabels: [{ x: 0.3, y: 0.3, text: 'Aorta' }, { x: 0.6, y: 0.6, text: 'Vena cava' }],
      }],
      { mode: 'paper' },
    )
    const docXml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(doc)))['word/document.xml'])
    assert(docXml.includes('Labels:') && docXml.includes('Aorta') && docXml.includes('Vena cava'), 'labelled diagram falls back to a text list when the composite is unavailable')
  } finally {
    globalThis.fetch = realFetch
  }
}

console.log('\nschoolLogoUrl in header → image embedded in Word header (not dropped)')
// The Word export used to omit the school logo from the paper header even when
// the PDF/preview rendered it. buildAssessmentDocument now pre-fetches the logo
// bytes and passes an ImageRun into headerParagraphs so the .docx header matches.
{
  clearImageBytesCache()
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => PNG_1x1.buffer.slice(0) })
  try {
    const logoDoc = await buildAssessmentDocument(
      { title: 'Logo Test', subject: 'Science', schoolName: 'ZedExams Academy',
        schoolLogoUrl: 'https://example.com/logo.png', showNameField: false },
      [{ id: 'q1', order: 1, type: 'short_answer', text: 'Answer.', marks: 1 }],
      { mode: 'paper' },
    )
    const files = unzipSync(new Uint8Array(await Packer.toBuffer(logoDoc)))
    // The logo must land as a media part inside the packed docx.
    const mediaKeys = Object.keys(files).filter((k) => k.startsWith('word/media/'))
    assert(mediaKeys.length > 0, 'schoolLogoUrl → image embedded as a media part in the header')
    // The header XML must reference an image relationship (an a:blip element).
    const headerXmls = Object.keys(files)
      .filter((k) => /word\/header\d+\.xml$/.test(k))
      .map((k) => strFromU8(files[k]))
      .join('\n')
    assert(headerXmls.includes('blip'), 'schoolLogoUrl → header XML carries an image relationship (a:blip)')
    assert(headerXmls.includes('ZEDEXAMS ACADEMY'), 'school name is still present in the header alongside the logo')
  } finally {
    globalThis.fetch = realFetch
    clearImageBytesCache()
  }
}

console.log('\nschoolLogoUrl fetch fails → document still packs, failure counted, no throw')
// When the logo URL is unreachable the export must degrade gracefully: the
// text-only header renders as normal and the failure is counted in stats.failedImages
// so the studio can warn the teacher — matching the pattern for question images.
{
  clearImageBytesCache()
  globalThis.fetch = async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) })
  let threw = false
  const failStats = { failedImages: [] }
  try {
    const failLogoDoc = await buildAssessmentDocument(
      { title: 'Logo Fail Test', subject: 'Science', schoolName: 'ZedExams Academy',
        schoolLogoUrl: 'https://example.com/missing-logo.png', showNameField: false },
      [{ id: 'q1', order: 1, type: 'short_answer', text: 'Answer.', marks: 1 }],
      { mode: 'paper', stats: failStats },
    )
    await Packer.toBuffer(failLogoDoc) // must not throw
  } catch {
    threw = true
  } finally {
    globalThis.fetch = realFetch
    clearImageBytesCache()
  }
  assert(!threw, 'logo fetch failure → buildAssessmentDocument does not throw')
  assert(failStats.failedImages.length === 1, 'logo fetch failure → counted in stats.failedImages')
  assert(failStats.failedImages[0] === 'school logo', 'logo fetch failure → label is "school logo"')
}

console.log('\nNo logo URL → output unchanged (no regression for papers without a logo)')
// Papers without a schoolLogoUrl must pack identically to before — the logo
// paragraph must not appear in the header.
{
  const noLogoDoc = await buildAssessmentDocument(
    { title: 'No Logo Test', subject: 'Science', schoolName: 'ZedExams Academy', showNameField: false },
    [{ id: 'q1', order: 1, type: 'short_answer', text: 'Answer.', marks: 1 }],
    { mode: 'paper' },
  )
  const files = unzipSync(new Uint8Array(await Packer.toBuffer(noLogoDoc)))
  const mediaKeys = Object.keys(files).filter((k) => k.startsWith('word/media/'))
  assert(mediaKeys.length === 0, 'no schoolLogoUrl → no media part in the packed docx')
  const headerXmls = Object.keys(files)
    .filter((k) => /word\/header\d+\.xml$/.test(k))
    .map((k) => strFromU8(files[k]))
    .join('\n')
  assert(headerXmls.includes('ZEDEXAMS ACADEMY'), 'no logo → school name still present in header')
  assert(!headerXmls.includes('blip'), 'no logo → header XML carries no image relationship')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll assessmentToDocx tests passed.')
