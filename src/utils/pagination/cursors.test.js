/**
 * Unit tests for the pure cursor-pagination primitives.
 *
 *   node src/utils/pagination/cursors.test.js
 */
import assert from 'node:assert/strict'
import {
  DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE,
  clampPageSize, overfetchLimit, splitOverfetch,
  dedupeById, mergeUniqueItems, removeById,
  cursorFingerprint, pageRequestKey,
} from './cursors.js'

let passed = 0
function test(name, fn) { fn(); passed++ }

// ── clampPageSize ────────────────────────────────────────────────────────
test('clampPageSize caps above MAX and never returns unbounded', () => {
  assert.equal(clampPageSize(5000), MAX_PAGE_SIZE)
  assert.equal(clampPageSize(MAX_PAGE_SIZE + 1), MAX_PAGE_SIZE)
  // Infinity isn't a finite request — treat it as garbage and fall back to the
  // safe default rather than the max (a caller asking for "everything" must
  // never be handed the largest allowed page by accident).
  assert.equal(clampPageSize(Infinity), DEFAULT_PAGE_SIZE)
})

test('clampPageSize floors below MIN and falls back on garbage', () => {
  assert.equal(clampPageSize(0), DEFAULT_PAGE_SIZE)
  assert.equal(clampPageSize(-3), DEFAULT_PAGE_SIZE)
  assert.equal(clampPageSize('abc'), DEFAULT_PAGE_SIZE)
  assert.equal(clampPageSize(undefined), DEFAULT_PAGE_SIZE)
  assert.equal(clampPageSize(null), DEFAULT_PAGE_SIZE)
})

test('clampPageSize floors non-integers and honours custom bounds', () => {
  assert.equal(clampPageSize(24.9), 24)
  assert.equal(clampPageSize(100, { max: 30 }), 30)
  assert.equal(clampPageSize(2, { min: 5, fallback: 10 }), 5)
})

// ── overfetch / splitOverfetch ───────────────────────────────────────────
test('overfetchLimit requests exactly one extra row', () => {
  assert.equal(overfetchLimit(25), 26)
  assert.equal(overfetchLimit(1), 2)
})

test('splitOverfetch reports hasNextPage true only when the sentinel row is present', () => {
  const rows = Array.from({ length: 26 }, (_, i) => ({ id: `q${i}` }))
  const { items, hasNextPage } = splitOverfetch(rows, 25)
  assert.equal(items.length, 25)
  assert.equal(hasNextPage, true)
  assert.equal(items[items.length - 1].id, 'q24') // sentinel q25 dropped
})

test('splitOverfetch on a short final page has no next page', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}` }))
  const { items, hasNextPage } = splitOverfetch(rows, 25)
  assert.equal(items.length, 10)
  assert.equal(hasNextPage, false)
})

test('splitOverfetch on exactly pageSize rows has no next page (over-fetch is exact)', () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: `q${i}` }))
  const { items, hasNextPage } = splitOverfetch(rows, 25)
  assert.equal(items.length, 25)
  assert.equal(hasNextPage, false)
})

// ── dedupeById / mergeUniqueItems ────────────────────────────────────────
test('dedupeById keeps last-write-wins and preserves first-seen order', () => {
  const list = [
    { id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'a', v: 2 },
  ]
  const out = dedupeById(list)
  assert.deepEqual(out.map(x => x.id), ['a', 'b'])
  assert.equal(out.find(x => x.id === 'a').v, 2) // fresher copy wins
})

test('dedupeById passes through id-less rows without merging them', () => {
  const list = [{ id: 'a' }, { name: 'x' }, { name: 'y' }]
  const out = dedupeById(list)
  assert.equal(out.length, 3)
})

test('mergeUniqueItems appends new ids and refreshes existing ones (incoming wins)', () => {
  const existing = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }]
  const incoming = [{ id: 'b', v: 2 }, { id: 'c', v: 1 }]
  const out = mergeUniqueItems(existing, incoming)
  assert.deepEqual(out.map(x => x.id), ['a', 'b', 'c'])
  assert.equal(out.find(x => x.id === 'b').v, 2)
})

test('mergeUniqueItems is a no-op-safe on empty inputs', () => {
  assert.deepEqual(mergeUniqueItems(undefined, undefined), [])
  assert.deepEqual(mergeUniqueItems([{ id: 'a' }], []).map(x => x.id), ['a'])
})

test('a document moving between pages never appears twice after merge', () => {
  // page 1 loaded {a,b,c}; while paging, b's sort field changed so page 2
  // re-surfaces b alongside d — merge must not duplicate b.
  const page1 = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const page2 = [{ id: 'b' }, { id: 'd' }]
  const out = mergeUniqueItems(page1, page2)
  assert.deepEqual(out.map(x => x.id), ['a', 'b', 'c', 'd'])
})

// ── removeById ───────────────────────────────────────────────────────────
test('removeById drops the matching record only', () => {
  const out = removeById([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'b')
  assert.deepEqual(out.map(x => x.id), ['a', 'c'])
})

// ── cursor fingerprints / lock keys ──────────────────────────────────────
test('cursorFingerprint is "start" for the first page and the id otherwise', () => {
  assert.equal(cursorFingerprint(null), 'start')
  assert.equal(cursorFingerprint(undefined), 'start')
  assert.equal(cursorFingerprint({ id: 'doc9' }), 'doc9')
  assert.equal(cursorFingerprint('doc9'), 'doc9')
})

test('pageRequestKey distinguishes pages within a session and sessions from each other', () => {
  assert.equal(pageRequestKey('page:qb:g4', null), 'page:qb:g4::start')
  assert.equal(pageRequestKey('page:qb:g4', { id: 'd1' }), 'page:qb:g4::d1')
  assert.notEqual(
    pageRequestKey('page:qb:g4', { id: 'd1' }),
    pageRequestKey('page:qb:g7', { id: 'd1' }),
  )
})

test('MIN/MAX constants are sane', () => {
  assert.ok(MIN_PAGE_SIZE >= 1)
  assert.ok(MAX_PAGE_SIZE > DEFAULT_PAGE_SIZE)
})

console.log(`cursors.test.js: ${passed} passed`)
