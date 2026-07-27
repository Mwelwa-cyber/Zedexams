/**
 * Pagination arithmetic, on measurements rather than on question counts.
 *
 * The box is passed in with round numbers so a failure reads as "it put the
 * block on the wrong page" and not as a millimetre conversion. The real box is
 * checked separately, against the geometry module that the print stylesheet
 * itself is generated from.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import {
  paginateBlocks, inspectPages, pageContentBoxPx, paperFingerprint, isStale,
  paginationLabel, emptyPagination, PAGINATION_STATES, PAGINATION_ISSUES, mmToPx,
} from './paperPaginationCore.js'
import { PAGE_MM, PAGE_MARGINS_MM, RESERVED_BOTTOM_MM } from '../config/paperPageGeometry.js'

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

/** A 1000px-tall page, so "three blocks of 400 make two pages" is readable. */
const BOX = { width: 500, height: 1000, footerBandTop: 1000, reservedBottom: 60, footerReserve: 42, marginBottom: 18 }
const block = (id, heightPx, over = {}) => ({ id, kind: 'question', heightPx, widthPx: 400, ...over })
const codes = (result) => result.issues.map((i) => i.code)

console.log('\n— the page box comes from the print stylesheet’s own geometry —')

test('the content box is the sheet minus its margins and the footer reservation', () => {
  const box = pageContentBoxPx()
  assert.equal(
    Math.round(box.width),
    Math.round(mmToPx(PAGE_MM.width - PAGE_MARGINS_MM.left - PAGE_MARGINS_MM.right)),
  )
  assert.equal(
    Math.round(box.height),
    Math.round(mmToPx(PAGE_MM.height - PAGE_MARGINS_MM.top - RESERVED_BOTTOM_MM)),
  )
  // The footer reservation is taken out of the FLOW by the running <tfoot>, so
  // body content that reached the bottom of this box has already stopped short
  // of the printed footer. Adding it back would overfill every page by 16mm.
  assert.ok(box.height < mmToPx(PAGE_MM.height - PAGE_MARGINS_MM.top),
    'the reservation must be subtracted, not ignored')
})

console.log('\n— flowing measured blocks —')

test('an empty paper is zero pages, and says READY rather than guessing 1', () => {
  const r = paginateBlocks([], BOX)
  assert.equal(r.status, PAGINATION_STATES.READY)
  assert.equal(r.pageCount, 0)
  assert.deepEqual(r.pages, [])
})

test('blocks that fit stay on one page', () => {
  const r = paginateBlocks([block('a', 300), block('b', 300), block('c', 300)], BOX)
  assert.equal(r.pageCount, 1)
  assert.deepEqual(r.pages[0].blockIds, ['a', 'b', 'c'])
})

test('a block that would overflow starts the next page, whole', () => {
  const r = paginateBlocks([block('a', 600), block('b', 600)], BOX)
  assert.equal(r.pageCount, 2)
  assert.deepEqual(r.pages[0].blockIds, ['a'])
  assert.deepEqual(r.pages[1].blockIds, ['b'])
})

test('exactly filling a page does not start another', () => {
  // The off-by-one that would add a phantom sheet to every full paper.
  const r = paginateBlocks([block('a', 500), block('b', 500)], BOX)
  assert.equal(r.pageCount, 1)
  assert.deepEqual(codes(r), [], 'and no blank-page issue')
})

test('an explicit page break starts a new page', () => {
  const r = paginateBlocks([block('a', 100), block('b', 100, { breakBefore: true })], BOX)
  assert.equal(r.pageCount, 2)
})

test('a page break on the very first block does not create a leading blank page', () => {
  const r = paginateBlocks([block('a', 100, { breakBefore: true }), block('b', 100)], BOX)
  assert.equal(r.pageCount, 1)
})

test('a zero-height break element pushes what FOLLOWS it onto the next page', () => {
  // `.pagebreak` is `height: 0` with `page-break-after: always`, so the break
  // belongs to the next block and the element itself contributes nothing to the
  // flow. Reading only break-before missed every teacher-inserted page break —
  // measured 2 pages where Chromium printed 3.
  const r = paginateBlocks([
    block('a', 100),
    block('brk', 0, { breakAfter: true, structural: true }),
    block('b', 100),
  ], BOX)
  assert.equal(r.pageCount, 2)
  assert.deepEqual(r.pages[1].blockIds, ['b'])
})

test('a trailing break element DOES add an empty page, and it is reported', () => {
  // This asserted the opposite, on my assumption that a printer would not
  // bother opening a sheet for a break with nothing after it. Chromium does:
  // four questions with a break after the last one measured 1 page and printed
  // 2. Only the printer could settle it, and it did.
  //
  // It is also the case that makes BLANK_PAGE reachable — an issue code that
  // cannot fire is decoration — and it is the "why is my paper printing an
  // extra sheet" complaint, so the Print/PDF gate refuses it.
  const r = paginateBlocks([block('a', 100), block('brk', 0, { breakAfter: true, structural: true })], BOX)
  assert.equal(r.pageCount, 2)
  assert.equal(r.pages[1].hasBodyContent, false)
  const blank = r.issues.find((i) => i.code === PAGINATION_ISSUES.BLANK_PAGE)
  assert.ok(blank, JSON.stringify(codes(r)))
  assert.equal(blank.trailing, true)
})

test('each page reports the questions printed on it', () => {
  const r = paginateBlocks([
    block('a', 400, { ownerQuestionId: 'q1' }),
    block('b', 400, { ownerQuestionId: 'q2' }),
    block('c', 400, { ownerQuestionId: 'q3' }),
  ], BOX)
  assert.equal(r.pageCount, 2)
  assert.deepEqual(r.pages[0].questionIds, ['q1', 'q2'])
  assert.deepEqual(r.pages[1].questionIds, ['q3'])
  assert.equal(r.pages[0].hasBodyContent, true)
})

console.log('\n— the defects a teacher would otherwise find on the sheet —')

test('a trailing blank page is reported as trailing', () => {
  // Blocks with no height and nothing rendered: the shape of a paper whose last
  // sheet carries nothing a learner can see.
  const pages = [
    { pageNumber: 1, blockIds: ['a'], questionIds: ['q1'], hasBodyContent: true, usedPx: 500 },
    { pageNumber: 2, blockIds: [], questionIds: [], hasBodyContent: false, usedPx: 0 },
  ]
  const found = inspectPages(pages, [block('a', 500, { ownerQuestionId: 'q1' })], BOX)
  const blank = found.find((i) => i.code === PAGINATION_ISSUES.BLANK_PAGE)
  assert.ok(blank, 'a blank page is reported')
  assert.equal(blank.trailing, true)
  assert.match(blank.message, /ends with an empty sheet/)
})

test('a page carrying only the paper code is a footer-only page', () => {
  const pages = [{ pageNumber: 2, blockIds: ['f'], questionIds: [], hasBodyContent: true, usedPx: 10 }]
  const found = inspectPages(pages, [block('f', 10, { kind: 'footerCode' })], BOX)
  assert.ok(found.some((i) => i.code === PAGINATION_ISSUES.FOOTER_ONLY_PAGE), JSON.stringify(found))
})

test('content past the bottom of the box has entered the footer area', () => {
  const pages = [{ pageNumber: 1, blockIds: ['a'], questionIds: [], hasBodyContent: true, usedPx: 1050 }]
  const found = inspectPages(pages, [block('a', 1050)], BOX)
  const hit = found.find((i) => i.code === PAGINATION_ISSUES.BODY_IN_FOOTER)
  assert.ok(hit)
  assert.equal(hit.overflowPx, 50)
})

test('a question split across two sheets is reported', () => {
  const r = paginateBlocks([
    block('stem', 700, { ownerQuestionId: 'q1', questionLabel: 4 }),
    block('parts', 700, { ownerQuestionId: 'q1', questionLabel: 4 }),
  ], BOX)
  assert.equal(r.pageCount, 2)
  const split = r.issues.find((i) => i.code === PAGINATION_ISSUES.QUESTION_SPLIT)
  assert.ok(split, JSON.stringify(codes(r)))
  assert.match(split.message, /Question 4 is split across pages 1 and 2/)
})

test('a diagram separated from its question is reported as well as the split', () => {
  const r = paginateBlocks([
    block('stem', 700, { ownerQuestionId: 'q1', questionLabel: 5 }),
    block('fig', 700, { ownerQuestionId: 'q1', questionLabel: 5, isFigure: true }),
  ], BOX)
  const separated = r.issues.find((i) => i.code === PAGINATION_ISSUES.DIAGRAM_SEPARATED)
  assert.ok(separated, JSON.stringify(codes(r)))
  assert.equal(separated.stemPage, 1)
  assert.equal(separated.figurePage, 2)
  assert.match(separated.message, /away from the question on page 1/)
})

test('a block wider than the page will be cut off, and says so', () => {
  const r = paginateBlocks([block('wide', 100, { widthPx: 620, ownerQuestionId: 'q1', questionLabel: 2 })], BOX)
  const hit = r.issues.find((i) => i.code === PAGINATION_ISSUES.HORIZONTAL_OVERFLOW)
  assert.ok(hit)
  assert.equal(hit.overflowPx, 120)
  assert.match(hit.message, /Question 2 is wider than the page/)
})

test('a block the renderer never drew is reported, not counted as content', () => {
  const r = paginateBlocks([
    block('a', 100, { ownerQuestionId: 'q1' }),
    block('missing', 0, { rendered: false, ownerQuestionId: 'q2', questionLabel: 7 }),
  ], BOX)
  const hit = r.issues.find((i) => i.code === PAGINATION_ISSUES.MISSING_BLOCK)
  assert.ok(hit)
  assert.match(hit.message, /Part of question 7 did not render/)
})

test('a clipped answer space or table is reported', () => {
  const r = paginateBlocks([block('t', 100, { clipped: true, ownerQuestionId: 'q3', questionLabel: 3 })], BOX)
  assert.ok(r.issues.some((i) => i.code === PAGINATION_ISSUES.CLIPPED_CONTENT))
})

test('a block taller than a whole page is reported rather than silently split', () => {
  // The printer WILL fragment it. Modelling a split we cannot place accurately
  // would produce a page count the printed sheet disagrees with.
  const r = paginateBlocks([block('huge', 2500, { ownerQuestionId: 'q1', questionLabel: 1 })], BOX)
  assert.ok(r.issues.some((i) => i.code === PAGINATION_ISSUES.OVERSIZED_BLOCK), JSON.stringify(codes(r)))
})

test('a healthy paper reports no issues at all', () => {
  const r = paginateBlocks([
    block('a', 400, { ownerQuestionId: 'q1' }),
    block('b', 400, { ownerQuestionId: 'q2' }),
  ], BOX)
  assert.deepEqual(r.issues, [])
})

console.log('\n— staleness: a number that is out of date still looks like an answer —')

test('any edit that changes the printed page changes the fingerprint', () => {
  const base = { questions: [{ localId: 'a', text: 'Hello', marks: 2, type: 'short_answer' }] }
  const same = paperFingerprint(base)
  assert.equal(paperFingerprint(base), same, 'stable for identical input')

  const changes = [
    { questions: [{ localId: 'a', text: 'Hello there', marks: 2, type: 'short_answer' }] },
    { questions: [{ localId: 'a', text: 'Hello', marks: 5, type: 'short_answer' }] },
    { questions: [{ localId: 'a', text: 'Hello', marks: 2, type: 'essay' }] },
    { questions: [{ localId: 'a', text: 'Hello', marks: 2, type: 'short_answer', answerLines: 10 }] },
    { questions: [{ localId: 'a', text: 'Hello', marks: 2, type: 'short_answer', imageDiagram: { libraryKey: 'x' } }] },
    { ...base, pagebreaks: ['a'] },
    { ...base, details: { showAnswers: true } },
    { ...base, passages: [{ localId: 'p', passageText: 'A story' }] },
  ]
  for (const changed of changes) {
    assert.notEqual(paperFingerprint(changed), same, JSON.stringify(changed))
  }
})

test('a ready result goes stale when the paper moves under it', () => {
  const result = { status: PAGINATION_STATES.READY, fingerprint: 'abc', pageCount: 3, pages: [], issues: [] }
  assert.equal(isStale(result, 'abc'), false)
  assert.equal(isStale(result, 'def'), true)
  // Nothing that is not a finished measurement can be stale — a measurement in
  // flight is already going to produce a fresh answer.
  assert.equal(isStale({ status: PAGINATION_STATES.MEASURING, fingerprint: 'abc' }, 'def'), false)
  assert.equal(isStale(null, 'def'), false)
})

console.log('\n— what the teacher reads —')

test('every state says something honest, and none of them invent a number', () => {
  assert.equal(paginationLabel({ status: PAGINATION_STATES.IDLE }), 'Calculating pages…')
  assert.equal(paginationLabel({ status: PAGINATION_STATES.MEASURING }), 'Calculating pages…')
  assert.equal(paginationLabel({ status: PAGINATION_STATES.STALE, pageCount: 9 }), 'Calculating pages…')
  assert.equal(paginationLabel({ status: PAGINATION_STATES.FAILED }), 'Page count unavailable')
  assert.equal(paginationLabel({ status: PAGINATION_STATES.READY, pageCount: 4 }), '4 Print/PDF pages')
  assert.equal(paginationLabel({ status: PAGINATION_STATES.READY, pageCount: 1 }), '1 Print/PDF page')
  assert.equal(paginationLabel(), 'Calculating pages…')
})

test('the label names the documents it counted, and never claims Word', () => {
  // Word paginates with its own engine and its own font metrics. A number from
  // here would be wrong there in a way a teacher only discovers on opening the
  // file, so the unit is part of the sentence.
  const label = paginationLabel({ status: PAGINATION_STATES.READY, pageCount: 4 })
  assert.match(label, /Print\/PDF/)
  assert.ok(!/word|docx/i.test(label), label)
})

test('an empty result is the same shape as a full one', () => {
  const empty = emptyPagination()
  assert.deepEqual(Object.keys(empty).sort(), ['issues', 'pageCount', 'pages', 'status'])
  assert.equal(empty.status, PAGINATION_STATES.IDLE)
})

if (!process.exitCode) {
  console.log(`\n✓ paper pagination — ${passed} tests passed`)
}
