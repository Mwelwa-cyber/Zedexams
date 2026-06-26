/**
 * Regression spec for studioHtmlToDocx.js
 *
 * The core regression guarded here: the Lesson Plan Studio previously exported
 * .docx files via html-docx-js which wraps the body in a `w:altChunk` /
 * `afchunk.mht` MHTML part.  Desktop Word silently converts altChunk on open,
 * but Word for Android / iOS / Web rejects the file with "This version of Word
 * can't open files that contain alternate formats."
 *
 * The fix replaces html-docx-js with the `docx` npm library (native
 * WordprocessingML).  This spec asserts:
 *   (a) word/document.xml is present in the output zip,
 *   (b) it contains native markup like <w:tbl and <w:p,
 *   (c) there is NO altChunk reference in any part of the zip, and
 *   (d) the zip has NO afchunk.mht entry.
 *
 * Vitest / jsdom spec (see CLAUDE.md — *.spec.* files only).
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
import JSZip from 'jszip'
import { htmlToDocxBlob } from './studioHtmlToDocx.js'

// ── tiny 1×1 transparent PNG as a base64 data URI ─────────────────────────
// Avoids network access and lets us test the ImageRun path in jsdom.
const TINY_PNG_DATA_URI =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// Representative studio export HTML — a heading, a paragraph with inline bold,
// a ul, a 2-row table with a th, and an inlined 1×1 PNG image.
const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Test</title></head>
<body>
<div class="WordSection1">
  <h1>Grade 4 Integrated Science Lesson Plan</h1>
  <p>This lesson explores <strong>The Eye</strong> and how we see.</p>
  <ul>
    <li>Objective one</li>
    <li>Objective two</li>
  </ul>
  <table class="meta-table">
    <tr><th>Subject</th><th>Duration</th></tr>
    <tr><td>Integrated Science</td><td>40 minutes</td></tr>
  </table>
  <img src="${TINY_PNG_DATA_URI}" width="50" />
  <p>End of plan.</p>
</div>
</body>
</html>`

// We need DOMParser in jsdom — vitest uses jsdom which provides it.
// Stub window.__zxExportWatermark as absent by default (paid-plan export).

describe('htmlToDocxBlob', () => {
  let zip
  let docXml
  let zipFileNames

  beforeAll(async () => {
    // Run the converter on the sample HTML
    const blob = await htmlToDocxBlob(SAMPLE_HTML)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(0)

    // Unzip the result so we can inspect parts
    const arrayBuffer = await blob.arrayBuffer()
    zip = await JSZip.loadAsync(arrayBuffer)
    zipFileNames = Object.keys(zip.files)

    // Extract word/document.xml
    const docFile = zip.files['word/document.xml']
    expect(docFile).toBeTruthy()
    docXml = await docFile.async('string')
  })

  // ── (a) word/document.xml must exist ────────────────────────────────────
  it('produces a zip containing word/document.xml', () => {
    expect(zipFileNames).toContain('word/document.xml')
  })

  // ── (b) native OOXML markup present ─────────────────────────────────────
  it('word/document.xml contains native <w:p paragraph markup', () => {
    expect(docXml).toMatch(/<w:p[ >]/)
  })

  it('word/document.xml contains native <w:tbl table markup (from the sample table)', () => {
    expect(docXml).toMatch(/<w:tbl[ >]/)
  })

  it('word/document.xml contains a <w:r text run', () => {
    expect(docXml).toMatch(/<w:r[ >]/)
  })

  // ── (c) THE KEY REGRESSION: NO altChunk anywhere ─────────────────────────
  it('word/document.xml does NOT contain altChunk (the mobile-Word killer)', () => {
    expect(docXml).not.toContain('altChunk')
  })

  it('no part of the zip references altChunk', async () => {
    for (const name of zipFileNames) {
      const file = zip.files[name]
      if (file.dir) continue
      const content = await file.async('string')
      if (content.includes('altChunk')) {
        throw new Error(`altChunk found in zip entry: ${name}`)
      }
    }
  })

  // ── (d) NO afchunk.mht entry ─────────────────────────────────────────────
  it('zip contains no afchunk.mht entry', () => {
    const hasAfchunk = zipFileNames.some(n => n.includes('afchunk'))
    expect(hasAfchunk).toBe(false)
  })

  // ── content checks ───────────────────────────────────────────────────────
  it('word/document.xml contains the heading text', () => {
    expect(docXml).toContain('Grade 4 Integrated Science Lesson Plan')
  })

  it('word/document.xml contains the bold-run text', () => {
    expect(docXml).toContain('The Eye')
  })

  it('word/document.xml contains a list item', () => {
    expect(docXml).toContain('Objective one')
  })

  it('word/document.xml contains table cell content', () => {
    expect(docXml).toContain('Integrated Science')
  })

  // Image: the PNG bytes should be embedded in the media part, not as altChunk.
  it('zip contains at least one image media file (PNG embedded natively)', () => {
    const mediaFiles = zipFileNames.filter(n => n.startsWith('word/media/'))
    expect(mediaFiles.length).toBeGreaterThan(0)
  })

  // ── watermark: when window.__zxExportWatermark is set, a header is present ──
  it('includes a header section when __zxExportWatermark is set', async () => {
    // Set the watermark global before the async work; restore after
    vi.stubGlobal('__zxExportWatermark', 'ZedExams Free Plan')
    const blob2 = await htmlToDocxBlob(SAMPLE_HTML)
    vi.unstubAllGlobals()

    const ab2 = await blob2.arrayBuffer()
    const zip2 = await JSZip.loadAsync(ab2)
    const names2 = Object.keys(zip2.files)
    // The docx library emits word/header1.xml (or similar) when a Header is set
    const hasHeader = names2.some(n => /word\/header\d+\.xml/.test(n))
    expect(hasHeader).toBe(true)
    // Verify watermark text appears in a header file
    const headerFile = names2.find(n => /word\/header\d+\.xml/.test(n))
    if (headerFile) {
      const headerContent = await zip2.files[headerFile].async('string')
      expect(headerContent).toContain('ZedExams Free Plan')
    }
  })

  it('produces a valid .docx Blob (correct MIME type)', async () => {
    const blob = await htmlToDocxBlob(SAMPLE_HTML)
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  })

  it('does not throw on empty HTML', async () => {
    const blob = await htmlToDocxBlob('')
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(0)
  })

  it('does not throw on HTML with no WordSection1 container', async () => {
    const blob = await htmlToDocxBlob('<body><p>Hello world</p></body>')
    expect(blob).toBeInstanceOf(Blob)
  })

  // ── the metadata header must NOT be a boxed grid ─────────────────────────
  // On Android the native bridge IS the export path. The reflowed
  // `.word-meta-table` header was being boxed with the full grey CELL_BORDER on
  // every cell, so the download's top looked nothing like the preview, which
  // fences the meta block with a single rule top and bottom only. Guard that
  // the meta table renders borderless (no grey 888888 box) while a normal table
  // keeps it.
  async function docXmlFor(html) {
    const blob = await htmlToDocxBlob(html)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    return zip.files['word/document.xml'].async('string')
  }
  const META_HTML = `<div class="WordSection1"><table class="word-meta-table">
    <tr><td colspan="2"><strong>NAME OF TEACHER:</strong> Mahenga</td></tr>
    <tr><td><strong>DATE:</strong> 26 June 2026</td><td><strong>TIME:</strong></td></tr>
    <tr><td colspan="2"><strong>SUBJECT:</strong> Integrated Science</td></tr>
  </table></div>`
  const PROGRESSION_HTML = `<div class="WordSection1"><table class="lp-table official-table">
    <thead><tr><th>STAGES</th><th>TEACHER'S ACTIVITIES</th></tr></thead>
    <tbody><tr><td>INTRODUCTION</td><td>Greet learners</td></tr></tbody>
  </table></div>`

  it('renders the .word-meta-table header without the boxed grey cell border', async () => {
    const xml = await docXmlFor(META_HTML)
    expect(xml).toMatch(/<w:tbl[ >]/)            // it is still a table
    expect(xml).not.toContain('888888')          // …but not the boxed CELL_BORDER
    expect(xml).toContain('Mahenga')             // content survived
  })

  it('still boxes a normal progression table with full cell borders', async () => {
    const xml = await docXmlFor(PROGRESSION_HTML)
    expect(xml).toMatch(/<w:tbl[ >]/)
    expect(xml).toContain('888888')              // CELL_BORDER retained
  })
})
