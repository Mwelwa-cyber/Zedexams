/**
 * Unit tests for the pure half of the past-paper figure-attach pass:
 * planning which uploaded asset/page each located figure is cropped from, and
 * merging attached URLs onto the quiz's passages array.
 *
 * Run: node src/utils/paperFigureAttachCore.test.js
 */

import assert from 'node:assert/strict'
import {
  planFigureAttachments,
  mergeFigureUrlsIntoPassages,
} from './paperFigureAttachCore.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('paperFigureAttachCore')

const pdfAsset = { path: 'papers/u/p/assets/0-paper.pdf', contentType: 'application/pdf' }
const img = (n) => ({ path: `papers/u/p/assets/${n}-page${n}.jpg`, contentType: 'image/jpeg' })
const fig = (over = {}) => ({ passageId: 'p001', title: 'Map of Zambia', sourcePage: 2, box: { x: 0.1, y: 0.1, w: 0.8, h: 0.5 }, ...over })

test('PDF paper: every figure crops from the first paper-role PDF at its page', () => {
  const { plan, skipped } = planFigureAttachments([fig()], [pdfAsset, img(1)])
  assert.equal(plan.length, 1)
  assert.equal(skipped.length, 0)
  assert.equal(plan[0].source.kind, 'pdf')
  assert.equal(plan[0].source.asset, pdfAsset)
  assert.equal(plan[0].page, 2)
  assert.deepEqual(plan[0].box, { x: 0.1, y: 0.1, w: 0.8, h: 0.5 })
})

test('photo paper: sourcePage N maps to the Nth image asset (1-based, order)', () => {
  const assets = [img(1), img(2), img(3)]
  const { plan } = planFigureAttachments([fig({ sourcePage: 3 })], assets)
  assert.equal(plan.length, 1)
  assert.equal(plan[0].source.kind, 'image')
  assert.equal(plan[0].source.asset, assets[2])
})

test('mark-scheme assets are never used as a figure source', () => {
  const ms = { ...pdfAsset, role: 'mark-scheme' }
  const { plan, skipped } = planFigureAttachments([fig()], [ms, img(1)])
  // No paper-role PDF → falls to photos; page 2 has no photo → skipped.
  assert.equal(plan.length, 0)
  assert.equal(skipped.length, 1)
})

test('a figure with no page, no passageId, or an out-of-range page is skipped (honestly)', () => {
  const { plan, skipped } = planFigureAttachments(
    [
      fig({ sourcePage: null }),
      fig({ passageId: '' }),
      fig({ sourcePage: 9 }), // photos only go to 2
    ],
    [img(1), img(2)],
  )
  assert.equal(plan.length, 0)
  assert.equal(skipped.length, 3)
})

test('a boxless figure still plans (whole-page crop fallback)', () => {
  const { plan } = planFigureAttachments([fig({ box: null })], [pdfAsset])
  assert.equal(plan.length, 1)
  assert.equal(plan[0].box, null)
})

test('empty/garbage inputs degrade to an empty plan', () => {
  assert.deepEqual(planFigureAttachments([], []), { plan: [], skipped: [] })
  assert.deepEqual(planFigureAttachments(null, null), { plan: [], skipped: [] })
})

test('mergeFigureUrlsIntoPassages writes url+alt onto the matching passage only', () => {
  const passages = [
    { id: 'p001', title: 'Map', imageUrl: '', imageAlt: '', passageKind: 'map' },
    { id: 'p002', title: 'Story', imageUrl: '', imageAlt: '', passageKind: 'comprehension' },
  ]
  const out = mergeFigureUrlsIntoPassages(passages, {
    p001: { url: 'https://cdn/x.jpg', alt: 'Map of Zambia' },
  })
  assert.equal(out[0].imageUrl, 'https://cdn/x.jpg')
  assert.equal(out[0].imageAlt, 'Map of Zambia')
  assert.equal(out[1].imageUrl, '', 'unmatched passage untouched')
  // Never mutates the input.
  assert.equal(passages[0].imageUrl, '')
})

test('mergeFigureUrlsIntoPassages keeps existing alt when the crop has none', () => {
  const out = mergeFigureUrlsIntoPassages(
    [{ id: 'p001', imageUrl: 'old', imageAlt: 'existing alt' }],
    { p001: { url: 'new-url', alt: '' } },
  )
  assert.equal(out[0].imageUrl, 'new-url')
  assert.equal(out[0].imageAlt, 'existing alt')
})

console.log(`\npaperFigureAttachCore: ${passed} passed`)
