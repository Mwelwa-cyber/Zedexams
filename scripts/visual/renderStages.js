/**
 * renderStages — a fixture becomes printed pages (§4.6).
 *
 * Two stages, deliberately kept apart:
 *
 *  - `browser-print` — the studio's own print path: `buildPrintableHtml`, then
 *    Chromium prints it. This is what a teacher gets from "Print / Save as PDF".
 *  - `docx` — `buildAssessmentDocument`, then LibreOffice converts it. This is
 *    what a teacher gets from "Download Word".
 *
 * The rule the owner set, and the reason these are separate: **Chromium is not
 * proof of Word fidelity.** The two stages share no layout engine, so the browser
 * stage cannot vouch for the Word stage and the Word stage is rendered by a word
 * processor rather than reconstructed from the exporter's own HTML. Every claim
 * about the `.docx` in this suite comes from a real word processor opening a real
 * file.
 *
 * ## The exporters run here, unmodified
 *
 * Both are the shipping modules from `src/utils/`, called exactly as the studio
 * calls them. They walk paper HTML with `DOMParser`, so a DOM is installed first
 * — the same arrangement `paperGolden.test.js` uses, and for the same reason: the
 * branch a browser takes is the branch worth testing.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { PNG } from 'pngjs'
import { unzipSync, strFromU8 } from 'fflate'
import { RENDER_SETTINGS, LIBREOFFICE_ARGS } from './renderEnvironment.js'
import { RenderIncompleteError } from './renderGuards.js'
import { printHtmlToPdf, rasterisePdf, isPlausiblePageSize } from './pdfPages.js'
import { buildLayoutMap } from './anchors.js'

let exporters = null

/**
 * Load the shipping exporters with a DOM in place.
 *
 * Order matters: `assessmentToDocx` and `safeRender` both decide at call time
 * whether a DOM exists, so the globals must be installed before the import.
 */
export async function loadExporters(opts = {}) {
  if (exporters) return exporters
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.DOMParser = dom.window.DOMParser
  globalThis.Node = dom.window.Node
  const { Packer } = await import('docx')
  const { buildAssessmentDocument } = await import('../../src/utils/assessmentToDocx.js')
  const { buildPrintableHtml } = await import('../../src/utils/assessmentToPdf.js')

  // Give the shipping exporter a real rasteriser.
  //
  // jsdom has no canvas, so `svgToPngBytes` threw, the exporter caught it, and
  // every library diagram was silently left out of the Word file — which meant
  // the docx stage was comparing papers missing their figures. Chromium is
  // already running for the browser stage, so it draws them: the exporter's own
  // code embeds the figure, and the harness supplies only the pixels a browser
  // would have supplied anyway.
  const { setSvgRasterizer, hasInjectedRasterizer } = await import('../../src/utils/svgRasterizer.js')
  const { rasteriseSvgToPng } = await import('./pdfPages.js')
  setSvgRasterizer((svg, width, height) => rasteriseSvgToPng(svg, width, height, opts))
  if (!hasInjectedRasterizer()) {
    throw new RenderIncompleteError(
      'the SVG rasteriser was not installed, so every library diagram would be '
      + 'quietly omitted from the Word file',
    )
  }

  exporters = { Packer, buildAssessmentDocument, buildPrintableHtml }
  return exporters
}

/**
 * Does this LibreOffice have Writer?
 *
 * `soffice --version` answers on a core-only install, so a toolchain check that
 * only asked for a version would pass and then every conversion would fail with
 * "source file could not be loaded" — a renderer that is present and cannot
 * render. Asked by converting something trivial, because that is the only answer
 * that means anything.
 */
export async function assertLibreOfficeCanConvert(soffice = process.env.SOFFICE_PATH || 'soffice') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-lo-probe-'))
  const probe = path.join(dir, 'probe.fodt')
  // Flat ODF: a Writer document with no zip container, so the probe tests the
  // Writer filter itself rather than the zip reader.
  fs.writeFileSync(probe, '<?xml version="1.0" encoding="UTF-8"?>'
    + '<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"'
    + ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"'
    + ' office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.text">'
    + '<office:body><office:text><text:p>probe</text:p></office:text></office:body></office:document>')
  try {
    await convertWithLibreOffice(probe, dir, soffice)
  } catch (err) {
    throw new RenderIncompleteError(
      'LibreOffice reports a version but cannot convert a document — the Writer '
      + 'filters are missing (a core-only install). Install libreoffice-writer. '
      + `This is an infrastructure failure: ${err.message}`,
      { soffice },
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  return true
}

/** Run `soffice --convert-to pdf` and return the produced path. */
export function convertWithLibreOffice(inputPath, outDir, soffice = process.env.SOFFICE_PATH || 'soffice') {
  return new Promise((resolve, reject) => {
    const args = [
      ...LIBREOFFICE_ARGS,
      // A private profile per run. A shared profile carries state between runs,
      // and state is how a conversion becomes non-reproducible.
      `-env:UserInstallation=file://${path.join(outDir, '.loprofile')}`,
      '--convert-to', 'pdf:writer_pdf_Export',
      '--outdir', outDir,
      inputPath,
    ]
    const child = spawn(soffice, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', (err) => reject(new Error(`${soffice} could not be started: ${err.message}`)))
    child.on('close', (code) => {
      const produced = path.join(outDir, `${path.basename(inputPath).replace(/\.[^.]+$/, '')}.pdf`)
      // LibreOffice exits 0 on "source file could not be loaded", so the exit
      // code is not the test — the file is.
      if (!fs.existsSync(produced)) {
        reject(new Error(
          `no PDF was produced (exit ${code}). ${(stdout + stderr).trim().slice(0, 400)}`,
        ))
        return
      }
      resolve({ pdfPath: produced, stdout, stderr, exitCode: code, command: `${soffice} ${args.join(' ')}` })
    })
  })
}

/**
 * Render one fixture through one stage.
 *
 * Returns the shape `assertRenderComplete` inspects, plus the pages and layout
 * map the comparators need. Nothing here decides whether the render is good
 * enough — that is `renderGuards`' job, and keeping the two apart is what stops
 * a stage from quietly excusing its own incomplete output.
 */
export async function renderFixture(fixture, stage, opts = {}) {
  const { Packer, buildAssessmentDocument, buildPrintableHtml } = await loadExporters(opts)
  const workDir = opts.workDir || fs.mkdtempSync(path.join(os.tmpdir(), `visual-${fixture.id}-`))
  fs.mkdirSync(workDir, { recursive: true })

  let documentBytes = 0
  let documentPath = ''
  let pdfBytes = null
  let assetFailures = []
  let command = ''
  let stats = null

  if (stage === 'browser-print') {
    const html = buildPrintableHtml(fixture.assessment, fixture.questions, opts.mode || 'paper')
    documentPath = path.join(workDir, `${fixture.id}.html`)
    fs.writeFileSync(documentPath, html)
    const printed = await printHtmlToPdf(html, opts)
    pdfBytes = printed.pdf
    assetFailures = printed.assetFailures
    documentBytes = pdfBytes.length
    command = 'chromium page.pdf (preferCSSPageSize)'
    fs.writeFileSync(path.join(workDir, `${fixture.id}.pdf`), pdfBytes)
  } else if (stage === 'docx') {
    // `stats` is not optional here. Every figure the exporter could not embed
    // lands in `unresolvedFigures`, and a render carrying one must never become a
    // baseline: that is how a paper missing its diagram becomes the reference.
    stats = { failedImages: [], unresolvedFigures: [], unprintableFigures: [] }
    const doc = await buildAssessmentDocument(fixture.assessment, fixture.questions, {
      mode: opts.mode || 'paper',
      stats,
    })
    const buffer = await Packer.toBuffer(doc)
    documentPath = path.join(workDir, `${fixture.id}.docx`)
    fs.writeFileSync(documentPath, Buffer.from(buffer))
    const converted = await convertWithLibreOffice(documentPath, workDir)
    pdfBytes = fs.readFileSync(converted.pdfPath)
    documentBytes = pdfBytes.length
    command = converted.command
  } else {
    throw new RenderIncompleteError(`unknown render stage "${stage}"`, { fixtureId: fixture.id, stage })
  }

  const rastered = await rasterisePdf(pdfBytes, opts)
  const pages = []
  for (const page of rastered.pages) {
    const decoded = decodePng(page.png)
    if (!isPlausiblePageSize(decoded)) {
      // Reported, not corrected: a page that is not A4 is a finding, and
      // resizing it here would hide the margin and pagination defects this
      // suite exists to catch.
      throw new RenderIncompleteError(
        `${fixture.id} [${stage}]: page ${page.pageNumber} rendered `
        + `${decoded.width}×${decoded.height}px, which is not A4 at `
        + `${RENDER_SETTINGS.dpi}dpi — refusing to resize it`,
        { fixtureId: fixture.id, stage, page: page.pageNumber },
      )
    }
    pages.push({ ...page, ...decoded, bytes: page.png.length })
  }

  const layout = buildLayoutMap(pages, { schoolName: fixture.assessment?.schoolName })

  return {
    fixtureId: fixture.id,
    stage,
    exitCode: 0,
    documentBytes,
    documentPath,
    declaredPageCount: rastered.pageCount,
    pages,
    anchors: Object.keys(layout.anchors).map((id) => ({ id, page: layout.anchors[id] })),
    assetFailures,
    layout,
    stats,
    docxFigures: stage === 'docx' ? inspectDocxFigures(fs.readFileSync(documentPath)) : null,
    pdfBytes,
    workDir,
    command,
  }
}

/**
 * What is actually inside a generated `.docx`, figure-wise.
 *
 * The pixel comparison answers "does the page look right"; this answers "is the
 * figure really in the file", and the two are not the same question. A paper can
 * render a plausible page while the Word file carries no drawing at all — that is
 * exactly what happened — and a reviewer looking at a rendered page has no way to
 * tell. Read from the OPC parts rather than inferred.
 */
export function inspectDocxFigures(docxBytes) {
  const zip = unzipSync(new Uint8Array(docxBytes))
  const names = Object.keys(zip)
  const document = zip['word/document.xml'] ? strFromU8(zip['word/document.xml']) : ''
  const media = names.filter((n) => /^word\/media\//.test(n))
  return {
    drawings: (document.match(/<w:drawing>/g) || []).length,
    blips: (document.match(/<a:blip/g) || []).length,
    // §4.2's vector path: the SVG extension plus the raster the older builds use.
    svgBlips: (document.match(/svgBlip/g) || []).length,
    svgParts: media.filter((n) => /\.svg$/i.test(n)),
    pngParts: media.filter((n) => /\.png$/i.test(n)),
    // A drawing whose relationship is missing renders as a blank box in Word, so
    // the relationship file is part of the proof rather than an implementation
    // detail.
    imageRelationships: (
      (zip['word/_rels/document.xml.rels'] ? strFromU8(zip['word/_rels/document.xml.rels']) : '')
        .match(/Target="media\/[^"]+"/g) || []
    ).length,
    // The placeholder's own words. Its presence means a figure was asked for and
    // not produced, which must never be recorded as a correct appearance.
    placeholders: (document.match(/Figure could not be embedded/g) || []).length,
  }
}

/** Decode PNG bytes to RGBA, which is what the pixel comparator takes. */
export function decodePng(bytes) {
  const png = PNG.sync.read(Buffer.from(bytes))
  return { width: png.width, height: png.height, data: png.data }
}

/** Encode RGBA back to PNG, for the diff images published as artefacts. */
export function encodePng({ width, height, data }) {
  const png = new PNG({ width, height })
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(png.data)
  return PNG.sync.write(png)
}
