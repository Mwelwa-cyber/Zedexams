/**
 * The pre-export validation report (§10).
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import {
  REPORT_CHECKS, REPORT_ISSUES,
  buildExportValidationReport, findUnresolvedMaths, findUnsupportedFonts, reportHeadline,
} from './assessmentValidationReport.js'
import { buildAssessmentDocument } from '../../../utils/assessmentDocument.js'
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

const paper = { schoolName: 'Kabulonga', subject: 'Science', grade: 5, answerChoiceCount: 4 }
const mcq = (n, over = {}) => ({
  localId: `q${n}`, order: n, type: 'mcq', text: `Question ${n}?`,
  options: ['a', 'b', 'c', 'd'], correctAnswer: 0, marks: 1, ...over,
})
const measured = (pageCount, issues = []) => ({
  status: PAGINATION_STATES.READY, pageCount, pages: [], issues,
})

const report = (assessment, questions, pagination = measured(1)) => buildExportValidationReport({
  document: buildAssessmentDocument(assessment, questions),
  assessment,
  questions,
  pagination,
})

const codes = (list) => list.map((i) => i.code)
const checkFor = (r, id) => r.checks.find((c) => c.id === id)

console.log('\n— a healthy paper —')

test('every check passes and nothing is reported', () => {
  const r = report(paper, [mcq(1), mcq(2)])
  assert.deepEqual(r.blockers, [])
  assert.deepEqual(r.warnings, [])
  assert.equal(r.ok, true)
  assert.equal(r.blockedForPrint, false)
  assert.ok(r.checks.every((c) => c.ok), 'every check is ticked')
})

test('the report states the numbers it checked', () => {
  const r = report(paper, [mcq(1), mcq(2)], measured(3))
  assert.equal(r.totalMarks, 2)
  assert.equal(r.pageCount, 3)
  assert.match(checkFor(r, REPORT_CHECKS.PAGE_COUNT).detail, /3 Print\/PDF pages/)
})

console.log('\n— the paper’s arithmetic and structure —')

test('a correct answer that is no longer printed blocks, under the choices check', () => {
  const r = report({ ...paper, answerChoiceCount: 3 }, [mcq(1, { correctAnswer: 3 })])
  assert.equal(r.ok, false)
  assert.equal(r.blockers[0].check, REPORT_CHECKS.CHOICES)
  assert.equal(checkFor(r, REPORT_CHECKS.CHOICES).ok, false)
})

test('a cover total that contradicts the questions blocks, under the marks check', () => {
  const r = report({ ...paper, declaredTotalMarks: 40 }, [mcq(1)])
  assert.ok(r.blockers.some((b) => b.check === REPORT_CHECKS.MARKS))
  assert.equal(checkFor(r, REPORT_CHECKS.MARKS).ok, false)
})

test('a mixed-choice section is a warning that does not block the export', () => {
  const withSection = { ...paper, answerChoiceCount: null, parts: [{ id: 'p1', title: 'A' }] }
  const r = report(withSection, [
    mcq(1, { partId: 'p1', options: ['a', 'b', 'c'] }),
    mcq(2, { partId: 'p1' }),
  ])
  assert.equal(r.ok, true)
  assert.ok(r.warnings.some((w) => w.check === REPORT_CHECKS.CHOICES))
})

console.log('\n— figures —')

test('a question asking about a diagram it does not have blocks', () => {
  const r = report(paper, [mcq(1, { diagramText: 'A diagram of the heart' })])
  assert.ok(codes(r.blockers).includes(REPORT_ISSUES.MISSING_DIAGRAM))
  assert.equal(r.blockers[0].questionNumber, 1)
  assert.equal(checkFor(r, REPORT_CHECKS.FIGURES).ok, false)
})

test('a question with the diagram it asked for passes', () => {
  const r = report(paper, [mcq(1, { diagramText: 'A heart', imageUrl: 'https://example.test/h.png' })])
  assert.equal(checkFor(r, REPORT_CHECKS.FIGURES).ok, true)
})

test('a figure taller than the page blocks — it cannot be placed anywhere', () => {
  const r = buildExportValidationReport({
    document: {
      layout: { content: { widthMm: 174, heightMm: 261 } },
      blocks: [{ kind: 'question', number: 1, figure: { widthMm: 100, heightMm: 400 } }],
    },
    assessment: paper,
    questions: [],
    pagination: measured(1),
  })
  assert.ok(codes(r.blockers).includes(REPORT_ISSUES.OVERSIZED_FIGURE))
})

test('a figure the page could not grow to the level’s minimum is a warning, not a block', () => {
  const r = buildExportValidationReport({
    document: {
      layout: { content: { widthMm: 174, heightMm: 261 } },
      blocks: [{ kind: 'question', number: 1, figure: { widthMm: 20, heightMm: 12, belowFloor: true } }],
    },
    assessment: paper,
    questions: [],
    pagination: measured(1),
  })
  assert.deepEqual(r.blockers, [])
  assert.ok(codes(r.warnings).includes(REPORT_ISSUES.FIGURE_BELOW_MINIMUM))
})

console.log('\n— maths —')

test('a formula that would print as its own source is found', () => {
  assert.equal(findUnresolvedMaths({ text: 'What is \\frac{1}{2} of 8?' }), '\\frac')
  assert.equal(findUnresolvedMaths({ text: 'Solve $$x^2 + 1$$' }), '$$x^2 + 1$$')
  assert.ok(findUnresolvedMaths({ text: 'Ordinary text.', optionsPlain: ['\\sqrt{4}'] }))
})

test('a formula that resolved is not a defect', () => {
  assert.equal(findUnresolvedMaths({ text: 'What is ½ of 8?' }), null)
  assert.equal(findUnresolvedMaths({ text: 'The cost is $5.' }), null, 'a currency amount is not LaTeX')
  assert.equal(findUnresolvedMaths({}), null)
})

test('an unresolved formula blocks the export', () => {
  const r = report(paper, [mcq(1, { text: 'What is \\frac{1}{2} of 8?' })])
  assert.ok(codes(r.blockers).includes(REPORT_ISSUES.UNRESOLVED_MATHS))
  assert.match(r.blockers[0].message, /rather than as a formula/)
})

console.log('\n— fonts —')

test('a face no school computer has is found and reported as a warning', () => {
  assert.deepEqual(
    findUnsupportedFonts({ textHtml: '<p style="font-family: Papyrus, serif">Hello</p>' }),
    ['papyrus'],
  )
  const r = buildExportValidationReport({
    document: {
      layout: { content: { widthMm: 174, heightMm: 261 } },
      blocks: [{ kind: 'question', number: 1, textHtml: '<p style="font-family: Papyrus">x</p>' }],
    },
    assessment: paper,
    questions: [],
    pagination: measured(1),
  })
  assert.deepEqual(r.blockers, [])
  assert.ok(codes(r.warnings).includes(REPORT_ISSUES.UNSUPPORTED_FONT))
})

test('the paper’s own fonts are not reported against it', () => {
  assert.deepEqual(findUnsupportedFonts({ textHtml: '<p style="font-family: \'Times New Roman\', serif">x</p>' }), [])
  assert.deepEqual(findUnsupportedFonts({ textHtml: '<p style="font-family: Arial">x</p>' }), [])
  assert.deepEqual(findUnsupportedFonts({}), [])
})

console.log('\n— the measured layout —')

test('a layout defect blocks the browser routes but not the paper’s content', () => {
  const r = report(paper, [mcq(1)], measured(2, [{ code: 'blank-page', message: 'Page 2 is blank.' }]))
  assert.equal(r.ok, true, 'the paper itself is finished — Word may go')
  assert.equal(r.blockedForPrint, true)
  assert.equal(checkFor(r, REPORT_CHECKS.LAYOUT).ok, false)
})

test('“not measured yet” is not reported as the teacher’s defect', () => {
  const r = report(paper, [mcq(1)], { status: PAGINATION_STATES.MEASURING, pages: [], issues: [] })
  assert.deepEqual(r.blockers, [])
  assert.equal(r.blockedForPrint, true, 'the print routes still wait for a verified layout')
  assert.equal(checkFor(r, REPORT_CHECKS.LAYOUT).ok, false)
  assert.match(checkFor(r, REPORT_CHECKS.LAYOUT).detail, /measuring/i)
})

test('no pagination at all does not crash the report', () => {
  const r = report(paper, [mcq(1)], null)
  assert.equal(r.pageCount, null)
  assert.equal(r.ok, true)
})

console.log('\n— the sentence —')

test('one problem is stated and acted on', () => {
  const r = report({ ...paper, answerChoiceCount: 3 }, [mcq(1, { correctAnswer: 3 })])
  assert.match(reportHeadline(r), /Fix that, then export\./)
})

test('several problems name the first and count the rest', () => {
  const r = report({ ...paper, answerChoiceCount: 3, declaredTotalMarks: 99 }, [mcq(1, { correctAnswer: 3 })])
  assert.match(reportHeadline(r), /other problems to fix/)
})

test('a clean paper says so, and a paper with only warnings does not read as broken', () => {
  assert.match(reportHeadline(report(paper, [mcq(1)])), /Every check passed/)
  const withWarning = report(paper, [mcq(1, { text: '<p style="font-family: Papyrus">x</p>' })])
  assert.equal(reportHeadline(withWarning).startsWith('Ready to export'), withWarning.warnings.length > 0)
})

test('no report at all is an empty string, not a crash', () => {
  assert.equal(reportHeadline(null), '')
})

console.log('\n— an empty paper —')

test('builds a report rather than throwing', () => {
  const r = buildExportValidationReport({})
  assert.ok(Array.isArray(r.blockers))
  assert.ok(Array.isArray(r.checks))
})

console.log(`\n✓ export validation report — ${passed} tests passed`)
