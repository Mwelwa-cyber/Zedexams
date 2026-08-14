/**
 * Cross-renderer sync guard for the "school paper".
 *
 * Three renderers walk the SAME typed blocks from buildPaperLayout
 * (assessmentPaperLayout.js):
 *   - the studio preview  → src/engines/paper-render/PaperBlocks.jsx  (also the PDF, via window.print)
 *   - the Word export     → src/utils/assessmentToDocx.js
 *   - the print-window PDF → src/utils/assessmentToPdf.js
 *
 * When one renderer learns a new block kind (or a new default) and the other
 * doesn't, the Word download or PDF silently diverges from the on-screen paper —
 * the class of bug this whole change set is about. These checks fail the moment
 * any two switch statements (or the shared answer-line defaults) drift apart, so
 * the drift is caught in CI instead of in a teacher's printout.
 *
 * Pure text + a single buildPaperLayout call — no docx, no DOM. Run:
 *   node src/utils/paperRenderersSync.test.js
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildPaperLayout, DEFAULT_ANSWER_LINES } from './assessmentPaperLayout.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

const eqSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x))
const showSet = (s) => `{${[...s].sort().join(', ')}}`

// Pull the `case 'xxx':` string-literal labels out of a single named function's
// body. We scope to the function (its declaration up to the next top-level
// `function`) so an unrelated switch elsewhere in the file can't pollute the set.
function caseLabelsIn(src, marker) {
  const start = src.indexOf(marker)
  if (start === -1) return null
  const rest = src.slice(start + marker.length)
  const end = rest.search(/\n(?:export )?(?:async )?function /)
  const body = end === -1 ? rest : rest.slice(0, end)
  const set = new Set()
  const re = /case\s+'([a-zA-Z]+)'\s*:/g
  let m
  while ((m = re.exec(body)) !== null) set.add(m[1])
  return set
}

const previewSrc = readFileSync(join(root, 'src/engines/paper-render/PaperBlocks.jsx'), 'utf8')
const docxSrc = readFileSync(join(root, 'src/utils/assessmentToDocx.js'), 'utf8')
const pdfSrc = readFileSync(join(root, 'src/utils/assessmentToPdf.js'), 'utf8')

console.log('block-kind sync — preview switch === DOCX switch === PDF switch === layout output')

const previewKinds = caseLabelsIn(previewSrc, 'function PaperBlock(')
const docxKinds = caseLabelsIn(docxSrc, 'function renderBlock(')
const pdfKinds = caseLabelsIn(pdfSrc, 'function renderBlock(')
assert(previewKinds && previewKinds.size >= 8, `preview PaperBlock handles ${previewKinds ? previewKinds.size : 0} block kinds`)
assert(docxKinds && docxKinds.size >= 8, `DOCX renderBlock handles ${docxKinds ? docxKinds.size : 0} block kinds`)
assert(pdfKinds && pdfKinds.size >= 8, `PDF renderBlock handles ${pdfKinds ? pdfKinds.size : 0} block kinds`)
assert(
  previewKinds && docxKinds && eqSet(previewKinds, docxKinds),
  `preview and DOCX handle the SAME block kinds\n      preview: ${showSet(previewKinds || new Set())}\n      docx:    ${showSet(docxKinds || new Set())}`,
)
assert(
  previewKinds && pdfKinds && eqSet(previewKinds, pdfKinds),
  `preview and PDF handle the SAME block kinds\n      preview: ${showSet(previewKinds || new Set())}\n      pdf:     ${showSet(pdfKinds || new Set())}`,
)

// A comprehensive paper that exercises EVERY block kind buildPaperLayout can
// emit (header, learnerFields, instructions, sectionHeader, passage, question,
// passageTotal, pagebreak, endOfPaper, footerCode, schoolFooter). The set of
// kinds actually produced must match what both renderers handle — so a kind
// can never be emitted-but-unrendered.
const assessment = {
  schoolName: 'Sync Primary', subject: 'Integrated Science', grade: '7',
  assessmentType: 'end_of_term', term: '2',
  showNameField: true, showDateField: true, showClassField: true, showMarksField: true,
  coverInstructions: 'Answer ALL the questions.',
  endOfPaperText: 'END OF PAPER',
  footerCode: 'G7/Science/Term 2/2026',
  footerText: 'Sync Primary — Sciences Department',
  parts: [{ id: 'pA', order: 0, title: 'Section A' }],
  passages: [{ id: 'ps1', order: 1, partId: 'pA', passageKind: 'diagram', title: 'Study the diagram below.', imageUrl: 'https://x/d.png' }],
  pagebreaks: [{ id: 'pb1', order: 3, partId: 'pA' }],
}
const questions = [
  { id: 'q1', order: 2, partId: 'pA', passageId: 'ps1', type: 'short_answer', marks: 3, text: 'Name the part labelled P.' },
  { id: 'q2', order: 4, partId: 'pA', type: 'mcq', marks: 1, text: 'Pick one', options: ['Lungs', 'Heart'], correctAnswer: 0 },
]
const layoutKinds = new Set(buildPaperLayout(assessment, questions, { mode: 'paper' }).map((b) => b.kind))
const expected = new Set(['header', 'learnerFields', 'instructions', 'sectionHeader', 'passage', 'question', 'passageTotal', 'pagebreak', 'endOfPaper', 'footerCode', 'schoolFooter'])
assert(eqSet(layoutKinds, expected), `buildPaperLayout emits every expected block kind ${showSet(layoutKinds)}`)
// Both renderer sets are equal (asserted above), so checking the layout against
// the DOCX set is enough to prove no kind is emitted-but-unrendered.
assert(eqSet(layoutKinds, docxKinds || new Set()), 'every emitted block kind is handled by both renderers')

console.log('\nanswer-line defaults — single source of truth, no re-drift')

// Both renderers must read the SHARED constant, not a private literal, so the
// Word essay can never silently grow back to 10 lines while the preview shows 8.
assert(DEFAULT_ANSWER_LINES.essay === 8, 'DEFAULT_ANSWER_LINES.essay is 8')
assert(DEFAULT_ANSWER_LINES.diagram === 4, 'DEFAULT_ANSWER_LINES.diagram is 4')
assert(DEFAULT_ANSWER_LINES.short === 2, 'DEFAULT_ANSWER_LINES.short is 2')
assert(previewSrc.includes('DEFAULT_ANSWER_LINES.essay'), 'preview uses DEFAULT_ANSWER_LINES.essay (not a literal)')
assert(docxSrc.includes('DEFAULT_ANSWER_LINES.essay'), 'DOCX uses DEFAULT_ANSWER_LINES.essay (not a literal)')
assert(pdfSrc.includes('DEFAULT_ANSWER_LINES.essay'), 'PDF uses DEFAULT_ANSWER_LINES.essay (not a literal)')
assert(!/answerSpaceParas\(b,\s*10\)/.test(docxSrc), 'DOCX no longer hard-codes 10 essay lines')
assert(!/defaultLines=\{(?:8|10|4)\}/.test(previewSrc), 'preview no longer hard-codes answer-line literals')

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll paper-renderer sync tests passed.')
