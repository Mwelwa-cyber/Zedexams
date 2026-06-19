/**
 * Tests for the free-plan export watermark.
 *
 *   - src/utils/docxAttribution.js — the DOCX path gets a diagonal WordArt
 *     watermark in the page header plus the attribution footer when
 *     opts.attribution is true, and nothing when it's false.
 *   - src/utils/exportWatermark.js — the HTML/PDF path injects a tiled SVG
 *     body background only when a watermark text is supplied.
 *
 * Plain `node` assertions. Run: `npm run test:export-watermark` or
 * `node scripts/test-export-watermark.mjs`.
 */

import assert from 'node:assert/strict'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import JSZip from 'jszip'
import { attributionSection, WATERMARK_TEXT } from '../src/utils/docxAttribution.js'
import {
  buildWatermarkSvgDataUri,
  injectHtmlWatermark,
  watermarkBodyCss,
  WATERMARK_TEXT as HTML_WATERMARK_TEXT,
} from '../src/utils/exportWatermark.js'

let passed = 0
async function test(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// Pack a one-section doc built with the given attribution opts and return the
// header + footer xml (empty string when the part is absent).
async function packParts(opts) {
  const doc = new Document({
    sections: [
      { ...attributionSection(opts), children: [new Paragraph({ children: [new TextRun('Body')] })] },
    ],
  })
  const buf = await Packer.toBuffer(doc)
  const zip = await JSZip.loadAsync(buf)
  const read = async (re) => {
    const name = Object.keys(zip.files).find((f) => re.test(f))
    return name ? zip.files[name].async('string') : ''
  }
  return {
    header: await read(/word\/header\d*\.xml$/),
    footer: await read(/word\/footer\d*\.xml$/),
  }
}

console.log('export-watermark — DOCX')

await test('attributionSection({attribution:true}) yields header + footer parts', () => {
  const sec = attributionSection({ attribution: true })
  assert.ok(sec.headers?.default, 'has a default header')
  assert.ok(sec.footers?.default, 'has a default footer')
})

await test('attributionSection with no/false attribution stays completely clean', () => {
  assert.deepEqual(attributionSection({ attribution: false }), {})
  assert.deepEqual(attributionSection({}), {})
  assert.deepEqual(attributionSection(undefined), {})
})

await test('free DOCX packs a diagonal WordArt watermark + footer attribution', async () => {
  const { header, footer } = await packParts({ attribution: true })
  assert.ok(header.includes('_x0000_t136'), 'header carries the WordArt shape')
  assert.ok(header.includes(WATERMARK_TEXT), 'watermark shows the brand text')
  assert.ok(/rotation:315/.test(header), 'watermark is rotated (diagonal)')
  assert.ok(footer.includes('Made with ZedExams'), 'footer keeps the attribution line')
})

await test('paid DOCX has no header/footer parts at all', async () => {
  const { header, footer } = await packParts({ attribution: false })
  assert.equal(header, '', 'no watermark header')
  assert.equal(footer, '', 'no attribution footer')
})

console.log('export-watermark — HTML/PDF')

await test('injectHtmlWatermark adds a body-background style only when text given', () => {
  const html = '<!DOCTYPE html><html><head><style>body{background:#fff}</style></head><body><p>Hi</p></body></html>'
  const marked = injectHtmlWatermark(html, 'ZedExams.com')
  assert.ok(marked.includes('background-image'), 'injects a background-image rule')
  assert.ok(marked.includes('data:image/svg+xml'), 'uses an SVG data URI tile')
  // Style must land AFTER the document's own styles so it wins the background.
  assert.ok(marked.indexOf('background-image') > marked.indexOf('background:#fff'))
  // No-op when there is no watermark text.
  assert.equal(injectHtmlWatermark(html, ''), html)
  assert.equal(injectHtmlWatermark(html, null), html)
})

await test('injectHtmlWatermark falls back to <body> when there is no </head>', () => {
  const html = '<html><body><p>Hi</p></body></html>'
  const marked = injectHtmlWatermark(html, 'X')
  assert.ok(marked.includes('<style>'), 'still injects a style block')
  assert.ok(marked.indexOf('<style>') > marked.indexOf('<body>'), 'style sits inside body')
})

await test('SVG data URI + CSS carry the (escaped) watermark text', () => {
  assert.equal(HTML_WATERMARK_TEXT, WATERMARK_TEXT, 'DOCX and HTML share one brand text')
  const uri = buildWatermarkSvgDataUri('A & B')
  assert.ok(uri.startsWith('data:image/svg+xml,'))
  assert.ok(decodeURIComponent(uri).includes('A &amp; B'), 'XML-escapes the label')
  assert.ok(watermarkBodyCss('Z').includes('background-repeat:repeat'), 'tiles the mark')
})

console.log(`\n${passed} tests passed.`)
