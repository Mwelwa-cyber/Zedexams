/**
 * Unit tests for the multi-page test scanner's pure helpers:
 *   • scanPages    — page list add / replace / remove / move / progress
 *   • scanImageQuality — Laplacian-variance blur metric
 *
 * The whole point of the scanner is that capturing page 2 must NOT replace
 * page 1 (the bug this feature fixes), and that reorder/retake preserve every
 * other page in order — so those transforms are the high-value thing to lock
 * down here, away from the DOM.
 *
 * Run: node scripts/test-scan-pages.mjs
 */

import assert from 'node:assert/strict'

import {
  addPage,
  hasBlurryPage,
  makePage,
  movePage,
  progressSteps,
  removePage,
  replacePage,
} from '../src/features/assessmentStudio/lib/scanPages.js'
import {
  BLUR_VARIANCE_THRESHOLD,
  isBlurry,
  laplacianVariance,
} from '../src/features/assessmentStudio/lib/scanImageQuality.js'

function p(tag) {
  return makePage({ dataUrl: `data:image/jpeg;base64,${tag}` })
}

// --- addPage: never replaces, always appends in order ---------------------
{
  const page1 = p('one')
  const page2 = p('two')
  let pages = addPage([], page1)
  pages = addPage(pages, page2)
  assert.equal(pages.length, 2, 'second capture must add a page, not replace')
  assert.equal(pages[0].id, page1.id)
  assert.equal(pages[1].id, page2.id)
  // input not mutated
  assert.equal([].length, 0)
}

// --- replacePage: swaps content in place, keeps the slot's id + order ------
{
  const pages = [p('a'), p('b'), p('c')]
  const fresh = p('b-retake')
  const next = replacePage(pages, 1, fresh)
  assert.equal(next.length, 3, 'retake keeps the page count')
  assert.equal(next[1].dataUrl, fresh.dataUrl, 'retaken content swapped in')
  assert.equal(next[1].id, pages[1].id, 'retake keeps the original slot id')
  assert.equal(next[0].id, pages[0].id)
  assert.equal(next[2].id, pages[2].id)
  // out-of-range is a no-op
  assert.equal(replacePage(pages, 9, fresh), pages)
}

// --- removePage ------------------------------------------------------------
{
  const pages = [p('a'), p('b'), p('c')]
  const next = removePage(pages, 1)
  assert.deepEqual(next.map(x => x.dataUrl), ['data:image/jpeg;base64,a', 'data:image/jpeg;base64,c'])
  assert.equal(removePage(pages, -1), pages, 'bad index is a no-op')
}

// --- movePage: up / down / boundary no-ops, order preserved ----------------
{
  const pages = [p('a'), p('b'), p('c'), p('d')]
  const labels = arr => arr.map(x => x.dataUrl.slice(-1))

  assert.deepEqual(labels(movePage(pages, 2, -1)), ['a', 'c', 'b', 'd'], 'move up')
  assert.deepEqual(labels(movePage(pages, 1, 1)), ['a', 'c', 'b', 'd'], 'move down')
  assert.deepEqual(labels(movePage(pages, 0, -1)), ['a', 'b', 'c', 'd'], 'move first up = no-op')
  assert.deepEqual(labels(movePage(pages, 3, 1)), ['a', 'b', 'c', 'd'], 'move last down = no-op')
  // does not mutate input
  assert.deepEqual(labels(pages), ['a', 'b', 'c', 'd'])
}

// --- progressSteps: one per page + a gated "Ready to convert" --------------
{
  assert.deepEqual(progressSteps([]).map(s => s.label), ['Ready to convert'])
  assert.equal(progressSteps([]).at(-1).done, false, 'no pages → not ready')

  const steps = progressSteps([p('a'), p('b'), p('c')])
  assert.deepEqual(steps.map(s => s.label), [
    'Page 1 captured',
    'Page 2 captured',
    'Page 3 captured',
    'Ready to convert',
  ])
  assert.equal(steps.at(-1).done, true, 'pages present → ready to convert')
}

// --- hasBlurryPage ---------------------------------------------------------
{
  assert.equal(hasBlurryPage([makePage({ blurry: false }), makePage({ blurry: false })]), false)
  assert.equal(hasBlurryPage([makePage({ blurry: false }), makePage({ blurry: true })]), true)
}

// --- blur metric: sharp (high-contrast checkerboard) >> flat (uniform) -----
{
  const w = 32
  const h = 32
  const flat = new Float32Array(w * h).fill(128)
  const checker = new Float32Array(w * h)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      checker[y * w + x] = (x + y) % 2 === 0 ? 0 : 255
    }
  }
  const flatVar = laplacianVariance(flat, w, h)
  const sharpVar = laplacianVariance(checker, w, h)

  assert.equal(flatVar, 0, 'a uniform image has zero edge energy')
  assert.ok(sharpVar > flatVar, 'a high-contrast pattern scores far sharper than flat')
  assert.ok(isBlurry(flatVar), 'flat image is flagged blurry')
  assert.ok(!isBlurry(sharpVar), 'sharp pattern is not flagged blurry')
  assert.ok(BLUR_VARIANCE_THRESHOLD > 0, 'threshold is a positive guard')

  // degenerate sizes never throw
  assert.equal(laplacianVariance(null, 0, 0), 0)
  assert.equal(laplacianVariance(new Float32Array(4), 2, 2), 0)
}

console.log('scan-pages tests passed')
