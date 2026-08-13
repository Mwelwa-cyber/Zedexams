/**
 * Two gates, and the boundary between them.
 *
 * The property that matters most here is a NEGATIVE one: Word must stay
 * available when the paper itself is fine, whatever Chromium measured. It is
 * the rule a later refactor is most likely to "tidy away" into one gate, and
 * the cost of that is a teacher refused a .docx that would have opened
 * perfectly.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import { buildPrintPdfReadiness, buildWordReadiness, blockingLayoutIssues, BLOCKING_PAGINATION_ISSUES } from './printPdfReadiness.js'
import { PAGINATION_STATES, PAGINATION_ISSUES } from '../../../utils/paperPaginationCore.js'

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

const okPaper = { gate: { blocked: false, reason: 'ready', message: '', numbers: [] } }
const brokenPaper = {
  gate: {
    blocked: true, reason: 'incomplete-questions', numbers: [3],
    message: 'Question 3 is not finished yet — it would print blank. Finish it in the builder, then download.',
  },
}
const measured = (issues = []) => ({ status: PAGINATION_STATES.READY, pageCount: 3, pages: [], issues })

console.log('\n— while the layout is unknown —')

test('every not-yet-measured state blocks Print and PDF, and says what is happening', () => {
  for (const status of [PAGINATION_STATES.IDLE, PAGINATION_STATES.MEASURING, PAGINATION_STATES.STALE]) {
    const r = buildPrintPdfReadiness({ baseReadiness: okPaper, pagination: { status, issues: [] } })
    assert.equal(r.blocked, true, status)
    assert.equal(r.message, 'Checking the page layout…')
    assert.equal(r.reason, 'layout-checking')
  }
  // No pagination at all is the same situation, not a pass.
  assert.equal(buildPrintPdfReadiness({ baseReadiness: okPaper }).blocked, true)
})

test('a failed measurement blocks with something a teacher can act on', () => {
  const r = buildPrintPdfReadiness({
    baseReadiness: okPaper,
    pagination: { status: PAGINATION_STATES.FAILED, issues: [{ code: 'measure-failed', message: 'x' }] },
  })
  assert.equal(r.blocked, true)
  assert.equal(r.message, 'The paper layout could not be verified. Try again before exporting.')
  assert.equal(r.reason, 'layout-unverified')
})

console.log('\n— once it is measured —')

test('a clean layout allows Print and PDF', () => {
  const r = buildPrintPdfReadiness({ baseReadiness: okPaper, pagination: measured([]) })
  assert.equal(r.blocked, false)
  assert.equal(r.reason, 'ready')
  assert.equal(r.message, '')
})

test('every declared printability failure blocks', () => {
  // Written as a sweep over the declared list rather than nine examples: an
  // issue code added to the pagination core and forgotten here would be a
  // defect that reports itself and exports anyway.
  for (const code of BLOCKING_PAGINATION_ISSUES) {
    const r = buildPrintPdfReadiness({
      baseReadiness: okPaper,
      pagination: measured([{ code, message: `something about ${code}` }]),
    })
    assert.equal(r.blocked, true, `${code} must block`)
    assert.equal(r.reason, code)
  }
  assert.equal(BLOCKING_PAGINATION_ISSUES.length, Object.keys(PAGINATION_ISSUES).length,
    'every pagination issue is a printability failure — if one is ever advisory, say so here on purpose')
})

test('the message is one instruction, with the rest counted', () => {
  const r = buildPrintPdfReadiness({
    baseReadiness: okPaper,
    pagination: measured([
      { code: PAGINATION_ISSUES.BLANK_PAGE, message: 'Page 4 is blank.', pageNumber: 4 },
      { code: PAGINATION_ISSUES.QUESTION_SPLIT, message: 'Question 2 is split.' },
      { code: PAGINATION_ISSUES.CLIPPED_CONTENT, message: 'A table is clipped.' },
    ]),
  })
  assert.match(r.message, /^Page 4 is blank\./)
  assert.match(r.message, /are 2 other layout problems/)
  assert.deepEqual(r.numbers, [4])
  assert.equal(r.layoutIssues.length, 3)
})

test('one other problem is singular', () => {
  const r = buildPrintPdfReadiness({
    baseReadiness: okPaper,
    pagination: measured([
      { code: PAGINATION_ISSUES.BLANK_PAGE, message: 'Page 4 is blank.' },
      { code: PAGINATION_ISSUES.QUESTION_SPLIT, message: 'Question 2 is split.' },
    ]),
  })
  assert.match(r.message, /is 1 other layout problem/)
})

test('a non-blocking issue code does not block', () => {
  const r = buildPrintPdfReadiness({
    baseReadiness: okPaper,
    pagination: measured([{ code: 'some-future-advisory', message: 'FYI' }]),
  })
  assert.equal(r.blocked, false)
  assert.deepEqual(blockingLayoutIssues(measured([{ code: 'some-future-advisory' }])), [])
})

console.log('\n— which problem a teacher is told about first —')

test('an unfinished paper is reported before its layout', () => {
  // Finishing question 3 is about to move every page boundary, so a layout
  // complaint about the current arrangement is advice about a document that is
  // going to change.
  const r = buildPrintPdfReadiness({
    baseReadiness: brokenPaper,
    pagination: measured([{ code: PAGINATION_ISSUES.BLANK_PAGE, message: 'Page 4 is blank.' }]),
  })
  assert.equal(r.reason, 'incomplete-questions')
  assert.match(r.message, /^Question 3 is not finished/)
  assert.deepEqual(r.layoutIssues, [], 'and the layout is not piled on top')
})

console.log('\n— Word is not held to the browser’s layout —')

test('Word stays available when the paper is fine, whatever Chromium measured', () => {
  for (const pagination of [
    { status: PAGINATION_STATES.IDLE, issues: [] },
    { status: PAGINATION_STATES.MEASURING, issues: [] },
    { status: PAGINATION_STATES.STALE, issues: [] },
    { status: PAGINATION_STATES.FAILED, issues: [{ code: 'measure-failed' }] },
    measured([{ code: PAGINATION_ISSUES.BLANK_PAGE, message: 'Page 4 is blank.' }]),
    measured([{ code: PAGINATION_ISSUES.QUESTION_SPLIT, message: 'Question 2 is split.' }]),
  ]) {
    const word = buildWordReadiness({ baseReadiness: okPaper, pagination })
    assert.equal(word.blocked, false, `Word must not be blocked by ${pagination.status}`)
    // And the same input DOES block the browser routes, so this is a real
    // separation rather than two functions that happen to agree.
    assert.equal(buildPrintPdfReadiness({ baseReadiness: okPaper, pagination }).blocked, true)
  }
})

test('Word is still blocked by the paper’s own problems', () => {
  const word = buildWordReadiness({ baseReadiness: brokenPaper })
  assert.equal(word.blocked, true)
  assert.match(word.message, /^Question 3 is not finished/)
  assert.deepEqual(word.numbers, [3])
})

test('Word’s verdict does not read pagination at all', () => {
  // Its signature takes only the base readiness. A future change that starts
  // consulting the layout here has to change the shape to do it.
  assert.deepEqual(
    buildWordReadiness({ baseReadiness: okPaper }),
    buildWordReadiness({ baseReadiness: okPaper, pagination: measured([{ code: PAGINATION_ISSUES.BLANK_PAGE }]) }),
  )
})

if (!process.exitCode) {
  console.log(`\n✓ print/PDF readiness — ${passed} tests passed`)
}
