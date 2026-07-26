/**
 * renderGuards — a successful exit is not a successful render (§4.6).
 *
 * This is the module the owner asked for by name, and it earns its place because
 * every renderer in the chain can fail *quietly*. LibreOffice exits 0 having
 * dropped the last page. Chromium exits 0 having written a zero-byte PDF. An
 * image fails to load and the page renders around the gap. Anchor extraction
 * finds nothing because a selector changed.
 *
 * In every one of those cases the process said it succeeded, so a harness that
 * trusted the exit code would hand the comparator partial output. And partial
 * output compares *consistently*: the same missing page, the same absent figure,
 * every run. So the suite goes green, or — worse — the reviewer sees a diff,
 * accepts it, and a baseline of a broken paper becomes the reference.
 *
 * So nothing here trusts an exit code. Each check asks whether the ARTEFACT is
 * complete, and a failure is a RenderIncompleteError — an infrastructure or
 * generation fault, never a visual finding, and never something a baseline update
 * can resolve.
 */

import { RenderEnvironmentError } from './renderEnvironment.js'

/**
 * Raised when a render technically completed but produced incomplete output.
 *
 * Deliberately a sibling of RenderEnvironmentError rather than a comparison
 * result: the correct response is to fix the render, not to look at a diff.
 */
export class RenderIncompleteError extends Error {
  constructor(message, detail = {}) {
    super(message)
    this.name = 'RenderIncompleteError'
    this.detail = detail
  }
}

/** A PDF smaller than this is empty in practice, whatever the exit code said. */
export const MIN_PDF_BYTES = 1024

/** A rendered page PNG smaller than this cannot contain a page of a paper. */
export const MIN_PAGE_BYTES = 512

/**
 * Check a completed render before anything is compared.
 *
 * @param {object} render
 * @param {string} render.fixtureId
 * @param {string} render.stage            'browser-print' | 'docx'
 * @param {number} render.exitCode         what the process claimed
 * @param {string} [render.stderr]         preserved for the report
 * @param {number} [render.documentBytes]  the PDF or DOCX size
 * @param {number} [render.declaredPageCount] pages the document says it has
 * @param {Array}  [render.pages]          [{pageNumber, bytes, width, height}]
 * @param {Array}  [render.anchors]        extracted semantic anchors
 * @param {Array}  [render.assetFailures]  assets that did not load
 * @param {object} expectations            the fixture's declared contract
 * @throws {RenderIncompleteError}
 */
export function assertRenderComplete(render, expectations = {}) {
  const fail = (message, detail = {}) => {
    throw new RenderIncompleteError(
      `${render?.fixtureId || '(unknown fixture)'} [${render?.stage || '?'}]: ${message}`,
      { fixtureId: render?.fixtureId, stage: render?.stage, stderr: render?.stderr, ...detail },
    )
  }
  if (!render || typeof render !== 'object') fail('no render result at all')

  // The exit code is checked, but it is the WEAKEST of these checks, not the
  // gate. Everything below assumes it was zero and still asks for proof.
  if (render.exitCode !== 0) {
    fail(`the renderer exited ${render.exitCode}`, { exitCode: render.exitCode })
  }

  // 1. A zero-byte or near-empty document. Chromium does this on a navigation
  //    failure and still exits 0.
  const bytes = Number(render.documentBytes)
  if (!Number.isFinite(bytes) || bytes <= 0) {
    fail('the renderer reported success but produced no document')
  }
  if (bytes < MIN_PDF_BYTES) {
    fail(
      `the document is ${bytes} bytes, which is empty in practice `
      + `(a real page is at least ${MIN_PDF_BYTES})`,
      { documentBytes: bytes },
    )
  }

  // 2. Pages missing relative to what the document claims. LibreOffice drops a
  //    final page on some layouts and exits 0.
  const pages = Array.isArray(render.pages) ? render.pages : []
  if (!pages.length) fail('the document produced no rendered pages')
  const declared = Number(render.declaredPageCount)
  if (Number.isFinite(declared) && declared > 0 && pages.length !== declared) {
    fail(
      `the document says it has ${declared} page${declared === 1 ? '' : 's'} but `
      + `${pages.length} were rendered — the render is incomplete, not different`,
      { declaredPageCount: declared, renderedPages: pages.length },
    )
  }

  // 3. Duplicate or non-contiguous page numbers. Either means the page list is
  //    not what it appears to be, and comparing page 3 against page 3 would be
  //    comparing different pages.
  const numbers = pages.map((p) => Number(p.pageNumber))
  const unique = new Set(numbers)
  if (unique.size !== numbers.length) {
    fail('two rendered pages carry the same page number', { numbers })
  }
  for (let i = 0; i < numbers.length; i += 1) {
    if (numbers[i] !== i + 1) {
      fail(`the rendered pages are not 1..${numbers.length} — got ${numbers.join(', ')}`, { numbers })
    }
  }

  // 4. An individual page that is too small to hold anything.
  for (const p of pages) {
    if (!(Number(p.bytes) > MIN_PAGE_BYTES)) {
      fail(`page ${p.pageNumber} rendered as ${p.bytes} bytes, which is blank`, { page: p.pageNumber })
    }
  }

  // 5. Unexpected page dimensions. Refused rather than resampled: a changed page
  //    size may BE the regression, and scaling it to fit would hide exactly the
  //    margin and pagination defects this suite exists to catch.
  const expectedW = Number(expectations.pageWidthPx)
  const expectedH = Number(expectations.pageHeightPx)
  if (Number.isFinite(expectedW) && Number.isFinite(expectedH)) {
    for (const p of pages) {
      if (Number(p.width) !== expectedW || Number(p.height) !== expectedH) {
        fail(
          `page ${p.pageNumber} rendered at ${p.width}×${p.height} instead of `
          + `${expectedW}×${expectedH} — refusing to resize, because a changed page `
          + 'size may be the regression itself',
          { page: p.pageNumber, got: [p.width, p.height], expected: [expectedW, expectedH] },
        )
      }
    }
  }

  // 6. An asset that failed to load while rendering "completed". This is the
  //    quietest of the lot: the paper renders around the gap and looks fine.
  const assetFailures = Array.isArray(render.assetFailures) ? render.assetFailures : []
  if (assetFailures.length) {
    fail(
      `${assetFailures.length} asset${assetFailures.length === 1 ? '' : 's'} failed to load `
      + `(${assetFailures.join(', ')}) — the paper rendered around the gap`,
      { assetFailures },
    )
  }

  // 7. No anchors from a fixture that needs them. Without anchors the structural
  //    pagination checks silently have nothing to check, which looks identical to
  //    passing them.
  const anchors = Array.isArray(render.anchors) ? render.anchors : []
  if (expectations.requiresAnchors && !anchors.length) {
    fail(
      'no semantic anchors were extracted, so every structural pagination check '
      + 'would silently have nothing to compare',
    )
  }
  // An anchor the fixture explicitly expects, absent.
  for (const id of Object.keys(expectations.expectedAnchorPages || {})) {
    if (!anchors.some((a) => a.id === id)) {
      fail(`the fixture expects anchor ${id} and the render produced none`, { missingAnchor: id })
    }
  }
  return true
}

/**
 * A baseline must never be created by a comparison run.
 *
 * The single most damaging convenience a visual suite can have: a missing
 * baseline silently written on first sight. It converts "nobody has reviewed this
 * appearance" into "this appearance is correct", and it does so exactly when a
 * fixture is new or has been renamed — the moment a human should be looking.
 */
export function assertBaselineExists(fixtureId, stage, exists, { allowCreate = false } = {}) {
  if (exists) return true
  if (allowCreate) return false
  throw new RenderIncompleteError(
    `${fixtureId} [${stage}]: no baseline exists. A comparison run never creates one — `
    + 'record it through the reviewed baseline workflow so the appearance is approved '
    + 'by a person rather than by its own first run.',
    { fixtureId, stage, missingBaseline: true },
  )
}

/**
 * Every failure this module and renderEnvironment can raise is an infrastructure
 * or generation fault, distinguished from a visual finding so a reviewer never
 * responds to one by updating a baseline.
 */
export function isInfrastructureFailure(err) {
  return err instanceof RenderIncompleteError || err instanceof RenderEnvironmentError
}
