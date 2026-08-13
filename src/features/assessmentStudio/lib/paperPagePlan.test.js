/**
 * Turning a measurement into "page 2 holds blocks 7 through 12".
 *
 * The property this file exists to pin: the preview NEVER invents a page
 * boundary. Every case below either uses the measured boundaries or falls back
 * to one continuous sheet and says so.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import { buildPagePlan, pageLabel } from './paperPagePlan.js'
import { PAGINATION_STATES } from '../../../utils/paperPaginationCore.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

const ready = (pages) => ({ status: PAGINATION_STATES.READY, pageCount: pages.length, pages, issues: [] })

console.log('\n— a measured paper —')

test('three measured pages produce three pages of blocks', () => {
  const plan = buildPagePlan(ready([
    { pageNumber: 1, blockIndexes: [0, 1, 2] },
    { pageNumber: 2, blockIndexes: [3, 4] },
    { pageNumber: 3, blockIndexes: [5] },
  ]), 6)
  assert.equal(plan.measured, true)
  assert.equal(plan.pageCount, 3)
  assert.deepEqual(plan.pages.map((p) => p.blockIndexes), [[0, 1, 2], [3, 4], [5]])
})

test('every block is drawn exactly once, on exactly one page', () => {
  const plan = buildPagePlan(ready([
    { pageNumber: 1, blockIndexes: [0, 1] },
    { pageNumber: 2, blockIndexes: [2, 3] },
  ]), 4)
  const drawn = plan.pages.flatMap((p) => p.blockIndexes)
  assert.deepEqual(drawn.sort((a, b) => a - b), [0, 1, 2, 3])
  assert.equal(new Set(drawn).size, drawn.length)
})

test('a block the measurement dropped is placed with the one before it', () => {
  // Zero-height blocks are filtered out of the measurement. Dropping them from
  // the preview would be a hole, and a hole looks like content the paper does
  // not have.
  const plan = buildPagePlan(ready([
    { pageNumber: 1, blockIndexes: [0, 2] },
    { pageNumber: 2, blockIndexes: [3] },
  ]), 4)
  assert.deepEqual(plan.pages[0].blockIndexes, [0, 1, 2])
  assert.deepEqual(plan.pages[1].blockIndexes, [3])
})

test('a measured blank page is kept, because the teacher should SEE it', () => {
  const plan = buildPagePlan(ready([
    { pageNumber: 1, blockIndexes: [0, 1] },
    { pageNumber: 2, blockIndexes: [] },
  ]), 2)
  assert.equal(plan.pageCount, 2)
  assert.deepEqual(plan.pages[1].blockIndexes, [])
})

test('an index outside the block list is ignored rather than drawn', () => {
  const plan = buildPagePlan(ready([{ pageNumber: 1, blockIndexes: [0, 99, -1] }]), 2)
  assert.deepEqual(plan.pages[0].blockIndexes, [0, 1])
})

console.log('\n— when there is no usable measurement —')

for (const status of [PAGINATION_STATES.IDLE, PAGINATION_STATES.MEASURING, PAGINATION_STATES.STALE, PAGINATION_STATES.FAILED]) {
  test(`${status} draws one continuous sheet and says it is not measured`, () => {
    const plan = buildPagePlan({ status, pages: [], pageCount: 0 }, 5)
    assert.equal(plan.measured, false)
    assert.equal(plan.pageCount, 1)
    assert.equal(plan.pages[0].continuous, true)
    assert.deepEqual(plan.pages[0].blockIndexes, [0, 1, 2, 3, 4])
  })
}

test('a stale result is flagged as stale, not silently redrawn as fresh', () => {
  assert.equal(buildPagePlan({ status: PAGINATION_STATES.STALE, pages: [] }, 3).stale, true)
})

test('no pagination at all is the same honest fallback', () => {
  const plan = buildPagePlan(null, 3)
  assert.equal(plan.measured, false)
  assert.equal(plan.pages[0].continuous, true)
})

test('a measurement that stamped no indices is not trusted', () => {
  // An older renderer, or a document built before block indices existed. Page
  // boxes drawn from a mapping that does not exist would be the exact failure
  // this whole component avoids.
  const plan = buildPagePlan(ready([
    { pageNumber: 1, blockIndexes: [] },
    { pageNumber: 2, blockIndexes: [] },
  ]), 4)
  assert.equal(plan.measured, false)
  assert.equal(plan.pageCount, 1)
})

test('an empty paper has no pages, not one blank one', () => {
  assert.deepEqual(buildPagePlan(null, 0).pages, [])
  assert.equal(buildPagePlan(ready([{ pageNumber: 1, blockIndexes: [] }]), 0).pageCount, 0)
})

console.log('\n— the label —')

test('a measured page says where it is', () => {
  assert.equal(pageLabel(2, 3), 'Page 2 of 3')
})

test('an unmeasured sheet never claims a position', () => {
  assert.match(pageLabel(1, 1, { measured: false }), /counting pages/i)
})

console.log(`\n✓ paper page plan — ${passed} tests passed`)
