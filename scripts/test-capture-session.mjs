#!/usr/bin/env node
/**
 * Tests for src/utils/captureSessionCore.js — folding several photographs of a
 * hand-written class list into ONE ordered list of learners.
 * Pure logic; no camera, no Firebase, no DOM.
 * Run: npm run test:capture-session  (also via npm run test:all)
 */

const {
  detectRepeatedPage,
  detectPageOverlap,
  buildCaptureSession,
  reorderPages,
  removePage,
  retakePage,
  captureSessionReadiness,
} = await import('../src/utils/captureSessionCore.js')

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail += 1
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

const NAMES = [
  'Alex Lobela', 'Bright Kapaso', 'Naomi Chipeta', 'Chanda Mulenga', 'Ruth Mwila',
  'Kelvin Banda', 'Blessings Phiri', 'Samuel Zulu', 'Mary Tembo', 'John Sakala',
  'Grace Mwale', 'Peter Nkonde', 'Esther Zimba', 'David Musonda', 'Joyce Chileshe',
]
// One row per learner, admission numbers as the school writes them.
const row = (i) => ({ fullName: NAMES[i], admissionNumber: `ADM-${String(i + 1).padStart(3, '0')}`, confidence: 0.95 })
const rows = (from, to) => NAMES.slice(from, to).map((_, k) => row(from + k))

const page = (id, position, pageRows, over = {}) => ({
  id, position, rows: pageRows, status: 'extracted', imageDigest: `digest-${id}`, ...over,
})

// ── repeated photographs ─────────────────────────────────────────

console.log('\nrepeated photographs')

test('the same file picked twice is caught by its digest', () => {
  const a = page('p1', 1, rows(0, 5))
  const b = { ...page('p2', 2, rows(0, 5)), imageDigest: 'digest-p1' }
  const repeat = detectRepeatedPage(b, [a])
  eq(repeat.repeatOf, 'p1')
  eq(repeat.reason, 'identical_image')
})

test('a re-shot page is caught by its content even with a new digest', () => {
  const a = page('p1', 1, rows(0, 6))
  // The retake reads one name slightly differently — as retakes do.
  const retaken = rows(0, 6)
  retaken[3] = { ...retaken[3], confidence: 0.6 }
  const repeat = detectRepeatedPage(page('p2', 2, retaken), [a])
  eq(repeat.repeatOf, 'p1')
  eq(repeat.reason, 'same_content')
})

test('a genuine next page is NOT a repeat', () => {
  const a = page('p1', 1, rows(0, 6))
  const b = page('p2', 2, rows(6, 12))
  eq(detectRepeatedPage(b, [a]), null)
})

test('a short page is left to the duplicate reviewer rather than dropped', () => {
  const a = page('p1', 1, rows(0, 6))
  const b = page('p2', 2, rows(0, 2))
  eq(detectRepeatedPage(b, [a]), null, 'two rows is not enough evidence to discard a page')
})

// ── page overlap ─────────────────────────────────────────────────

console.log('\npage overlap')

test('finds the longest run of repeated rows at a page boundary', () => {
  const accumulated = rows(0, 8)
  const next = rows(5, 12) // pages 1 and 2 share learners 6, 7, 8
  eq(detectPageOverlap(accumulated, next), 3)
})

test('no overlap between cleanly separated pages', () => {
  eq(detectPageOverlap(rows(0, 5), rows(5, 10)), 0)
})

test('a single repeated row is believed only when it carries an admission number', () => {
  const withNumber = detectPageOverlap(rows(0, 5), [row(4), ...rows(5, 9)])
  eq(withNumber, 1)

  const nameOnly = detectPageOverlap(
    [{ fullName: 'Mary Tembo' }],
    [{ fullName: 'Mary Tembo' }, { fullName: 'Peter Nkonde' }],
  )
  eq(nameOnly, 0, 'one shared surname at a page break proves nothing')
})

test('overlap detection tolerates the same line being read twice, differently', () => {
  const accumulated = rows(0, 6)
  const next = [
    { fullName: 'Kelvin Bandaa', admissionNumber: 'ADM-006' }, // misread name, same number
    ...rows(6, 10),
  ]
  eq(detectPageOverlap(accumulated, next), 1)
})

// ── the session ──────────────────────────────────────────────────

console.log('\nthe whole session')

test('three clean pages become one list in page order', () => {
  const session = buildCaptureSession([
    page('p1', 1, rows(0, 5)),
    page('p2', 2, rows(5, 10)),
    page('p3', 3, rows(10, 15)),
  ])
  eq(session.rows.length, 15)
  eq(session.rows[0].fullName, 'Alex Lobela')
  eq(session.rows[14].fullName, 'Joyce Chileshe')
  eq(session.stats.pagesUsed, 3)
})

test('pages are folded in the order the TEACHER arranged, not the order shot', () => {
  const session = buildCaptureSession([
    page('p3', 3, rows(10, 15)),
    page('p1', 1, rows(0, 5)),
    page('p2', 2, rows(5, 10)),
  ])
  eq(session.rows[0].fullName, 'Alex Lobela')
  eq(session.rows[5].fullName, 'Kelvin Banda')
})

test('an overlapping page contributes only its new rows', () => {
  const session = buildCaptureSession([
    page('p1', 1, rows(0, 8)),
    page('p2', 2, rows(5, 13)),
  ])
  eq(session.rows.length, 13, 'the three shared learners must not be imported twice')
  eq(session.stats.overlapRowsTrimmed, 3)
  eq(session.decisions.find((d) => d.pageId === 'p2').action, 'trimmed_overlap')
})

test('a repeated page contributes nothing and says so', () => {
  const session = buildCaptureSession([
    page('p1', 1, rows(0, 6)),
    { ...page('p2', 2, rows(0, 6)), imageDigest: 'digest-p1' },
    page('p3', 3, rows(6, 12)),
  ])
  eq(session.rows.length, 12)
  const decision = session.decisions.find((d) => d.pageId === 'p2')
  eq(decision.action, 'skipped_repeat')
  eq(decision.rowsAffected, 6)
  eq(session.stats.pagesSkipped, 1)
})

test('every dropped row is preserved so a teacher can undo the decision', () => {
  const session = buildCaptureSession([
    page('p1', 1, rows(0, 8)),
    page('p2', 2, rows(5, 13)),
  ])
  eq(session.droppedRows.length, 3)
  assert(session.droppedRows.every((d) => d.reason === 'page_overlap' && d.pageId === 'p2'))
  assert(session.droppedRows[0].row.fullName)
})

test('a page whose extraction FAILED is reported, never treated as empty', () => {
  const session = buildCaptureSession([
    page('p1', 1, rows(0, 5)),
    page('p2', 2, [], { status: 'failed' }),
    page('p3', 3, rows(5, 10)),
  ])
  eq(session.rows.length, 10)
  eq(session.stats.pagesFailed, 1)
  eq(session.decisions.find((d) => d.pageId === 'p2').action, 'extraction_failed')
})

test('each row remembers the page and line it came from', () => {
  const session = buildCaptureSession([
    page('p1', 1, rows(0, 5)),
    page('p2', 2, rows(4, 9)), // one row of overlap
  ])
  const first = session.rows[0]
  eq(first.sourcePageId, 'p1')
  eq(first.sourceRowIndex, 0)
  const fromSecond = session.rows.find((r) => r.sourcePageId === 'p2')
  eq(fromSecond.sourceRowIndex, 1, 'the index counts from the top of the original page')
})

test('an 86-learner, six-page capture folds correctly and quickly', () => {
  const big = Array.from({ length: 86 }, (_, i) => ({
    fullName: `Learner ${i + 1} Banda`,
    admissionNumber: `ADM-${String(i + 1).padStart(3, '0')}`,
    confidence: 0.9,
  }))
  // Six pages of 15, each repeating the last row of the one before.
  const pages = []
  for (let p = 0; p < 6; p += 1) {
    const start = Math.max(0, p * 15 - (p > 0 ? 1 : 0))
    pages.push(page(`p${p + 1}`, p + 1, big.slice(start, p * 15 + 15)))
  }
  const started = Date.now()
  const session = buildCaptureSession(pages)
  const elapsed = Date.now() - started
  eq(session.rows.length, 86, 'every learner exactly once')
  eq(new Set(session.rows.map((r) => r.admissionNumber)).size, 86)
  assert(elapsed < 500, `six-page fold took ${elapsed}ms`)
})

test('no pages produces an empty session rather than throwing', () => {
  const session = buildCaptureSession([])
  eq(session.rows.length, 0)
  eq(session.stats.pagesCaptured, 0)
  eq(buildCaptureSession(null).rows.length, 0)
})

// ── page list management ─────────────────────────────────────────

console.log('\npage list management')

test('reordering renumbers every page', () => {
  const pages = [page('a', 1, []), page('b', 2, []), page('c', 3, [])]
  const moved = reorderPages(pages, 2, 0)
  eq(moved.map((p) => p.id).join(''), 'cab')
  eq(moved.map((p) => p.position).join(''), '123')
})

test('reordering clamps out-of-range indices instead of throwing', () => {
  const pages = [page('a', 1, []), page('b', 2, [])]
  eq(reorderPages(pages, 99, -5).map((p) => p.id).join(''), 'ba')
  eq(reorderPages([], 0, 0).length, 0)
})

test('deleting a page closes the gap in the numbering', () => {
  const pages = [page('a', 1, []), page('b', 2, []), page('c', 3, [])]
  const left = removePage(pages, 'b')
  eq(left.map((p) => `${p.id}${p.position}`).join(''), 'a1c2')
})

test('retaking a page keeps its place and discards the old reading', () => {
  const pages = [page('a', 1, rows(0, 3)), page('b', 2, rows(3, 6))]
  const after = retakePage(pages, 'b', { imageDigest: 'new-digest', uri: 'blob:new' })
  const retaken = after.find((p) => p.id === 'b')
  eq(retaken.position, 2)
  eq(retaken.rows.length, 0, 'the rows belonged to the photograph that was discarded')
  eq(retaken.status, 'captured')
  eq(retaken.imageDigest, 'new-digest')
})

// ── readiness ────────────────────────────────────────────────────

console.log('\nreadiness')

test('finishing is refused with no pages', () => {
  eq(captureSessionReadiness([]).ready, false)
  eq(captureSessionReadiness([]).reason, 'no_pages')
})

test('finishing waits while a page is still being read, and names it', () => {
  const r = captureSessionReadiness([page('a', 1, rows(0, 3)), page('b', 2, [], { status: 'extracting' })])
  eq(r.ready, false)
  assert(r.message.includes('2'), `expected the page number in "${r.message}"`)
})

test('one unreadable page warns but does not block', () => {
  const r = captureSessionReadiness([page('a', 1, rows(0, 3)), page('b', 2, [], { status: 'failed' })])
  eq(r.ready, true)
  assert(r.warning && r.warning.includes('2'))
})

test('every page unreadable blocks with an instruction', () => {
  const r = captureSessionReadiness([page('a', 1, [], { status: 'failed' })])
  eq(r.ready, false)
  eq(r.reason, 'all_failed')
})

// ── summary ──────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.message}`))
  process.exit(1)
}
