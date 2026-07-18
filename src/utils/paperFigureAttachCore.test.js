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
  padAndClampBox,
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

// ── padAndClampBox (Phase 9: automatic crop padding + page clamp) ──────────
test('padAndClampBox adds ~2.5% padding around the box', () => {
  const box = { x: 0.3, y: 0.3, w: 0.2, h: 0.2 }
  const padded = padAndClampBox(box)
  assert.ok(padded.x < box.x, 'left edge moves outward')
  assert.ok(padded.y < box.y, 'top edge moves outward')
  assert.ok(padded.w > box.w, 'wider than the source box')
  assert.ok(padded.h > box.h, 'taller than the source box')
  // 2.5% of 0.2 = 0.005 on each side.
  assert.ok(Math.abs(padded.x - (box.x - 0.005)) < 1e-9)
  assert.ok(Math.abs(padded.w - (box.w + 0.01)) < 1e-9)
})

test('padAndClampBox clamps to the page — never goes negative or past 1', () => {
  const nearTopLeft = padAndClampBox({ x: 0.001, y: 0.001, w: 0.1, h: 0.1 })
  assert.ok(nearTopLeft.x >= 0)
  assert.ok(nearTopLeft.y >= 0)
  const nearBottomRight = padAndClampBox({ x: 0.92, y: 0.92, w: 0.08, h: 0.08 })
  assert.ok(nearBottomRight.x + nearBottomRight.w <= 1 + 1e-9)
  assert.ok(nearBottomRight.y + nearBottomRight.h <= 1 + 1e-9)
})

test('padAndClampBox supports a custom padding fraction (e.g. the "+5%" expand action)', () => {
  const box = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }
  const p2 = padAndClampBox(box, 0.02)
  const p5 = padAndClampBox(box, 0.05)
  assert.ok(p5.w > p2.w, 'a larger padding fraction yields a larger box')
})

test('padAndClampBox rejects a degenerate/garbage box', () => {
  assert.equal(padAndClampBox(null), null)
  assert.equal(padAndClampBox({ x: 0.1, y: 0.1, w: 0, h: 0.2 }), null)
  assert.equal(padAndClampBox({ x: 'a', y: 0.1, w: 0.2, h: 0.2 }), null)
})

console.log(`\npaperFigureAttachCore: ${passed} passed`)
