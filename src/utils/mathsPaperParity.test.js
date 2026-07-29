/**
 * §9 — the same mathematics in every output.
 *
 * A stacked fraction is only useful if it stays stacked all the way to the
 * teacher's hand. This suite takes the two Phase 1 fixtures — a Grade 7
 * Mathematics paper and a Grade 2 Mathematics and Science paper — through the
 * FOUR renderers a paper actually reaches:
 *
 *   buildPaperLayout  →  the studio preview  (textHtml / optionsHtml)
 *                     →  the print window     (buildPrintableHtml → PDF)
 *                     →  Word                 (buildDocxDocument → document.xml)
 *                     →  the marking key      (mode: 'scheme', all three again)
 *
 * and asserts the same thing of each: a real horizontal fraction bar, and none
 * of the forms §5 forbids — no "3/5", no ½ glyph, no raw LaTeX, no
 * "[object Object]".
 *
 * The print window and Word are the ones that can silently fail, because
 * neither runs JavaScript: whatever richTextToPaperHtml leaves behind IS the
 * formula on the page. A test that stopped at the block model would pass while
 * the teacher's download was blank.
 *
 * A DOM is installed before the exporters load, exactly as paperGolden.test.js
 * does, because both branch on `typeof DOMParser === 'undefined'` at call time
 * and the browser branch is the one under test.
 *
 * Run: node src/utils/mathsPaperParity.test.js
 */

import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.DOMParser = dom.window.DOMParser
globalThis.Node = dom.window.Node

const { Packer } = await import('docx')
const { unzipSync, strFromU8 } = await import('fflate')
const { buildPaperLayout } = await import('./assessmentPaperLayout.js')
const { buildPrintableHtml } = await import('./assessmentToPdf.js')
const { buildDocxDocument } = await import('./assessmentToDocx.js')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}
async function checkAsync(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

/* ------------------------------------------------------------------ *
 * Fixtures — the structured nodes the editor's modals produce
 * ------------------------------------------------------------------ */

const doc = (...content) => ({ type: 'doc', content })
const para = (...content) => ({ type: 'paragraph', content })
const text = (t) => ({ type: 'text', text: t })
const fraction = (num, den, whole = '') => ({ type: 'mathFraction', attrs: { whole, num, den } })
const numberBase = (number, base) => ({ type: 'numberBase', attrs: { number, base } })
// The editor's real node name — asserting against 'math' would build a
// fixture ProseMirror rejects, and the renderer's catch would turn that into
// a silently empty paper rather than a failing test.
const mathNode = (latex) => ({ type: 'mathInline', attrs: { latex } })
const verticalArithmetic = (operands, operator) => ({
  type: 'verticalArithmetic', attrs: { operands: operands.join(','), operator },
})

const GRADE_7_META = {
  title: 'Mathematics Topic Test', grade: '7', subject: 'mathematics',
  term: '1', year: 2026, assessmentType: 'topic_test',
}
const GRADE_7_QUESTIONS = [
  {
    id: 'q1', order: 0, type: 'short_answer', marks: 3,
    text: doc(para(text('Calculate '), fraction('3', '5'), text(' + '), fraction('1', '4'), text('.'))),
    correctAnswer: doc(para(fraction('17', '20'))),
    explanation: doc(para(text('Common denominator 20, so '), fraction('12', '20'), text(' + '), fraction('5', '20'), text('.'))),
    options: [],
  },
  {
    id: 'q2', order: 1, type: 'short_answer', marks: 2,
    text: doc(para(text('Convert '), fraction('3', '7', '2'), text(' to an improper fraction.'))),
    correctAnswer: doc(para(fraction('17', '7'))), options: [],
  },
  {
    id: 'q3', order: 2, type: 'short_answer', marks: 3,
    text: doc(para(text('Work out:')), para(verticalArithmetic(['234', '6'], '×'))),
    correctAnswer: '1404', options: [],
  },
  {
    id: 'q4', order: 3, type: 'mcq', marks: 1, correctAnswer: 2,
    text: doc(para(text('Which fraction is the largest?'))),
    options: [
      doc(para(fraction('1', '2'))),
      doc(para(fraction('2', '3'))),
      doc(para(fraction('3', '4'))),
      doc(para(fraction('5', '8'))),
    ],
  },
  {
    id: 'q5', order: 4, type: 'short_answer', marks: 2,
    text: doc(para(text('Simplify '), mathNode('x^2'), text(' + '), mathNode('\\sqrt{49}'), text('.'))),
    correctAnswer: 'x² + 7', options: [],
  },
  {
    id: 'q6', order: 5, type: 'short_answer', marks: 2,
    text: doc(para(text('Write '), numberBase('313', '5'), text(' in base ten.'))),
    correctAnswer: '83', options: [],
  },
]

const GRADE_2_META = {
  title: 'Mathematics and Science Weekly Test', grade: '2', subject: 'numeracy',
  term: '1', year: 2026, assessmentType: 'weekly_test',
}
const GRADE_2_QUESTIONS = [
  {
    id: 'g2q1', order: 0, type: 'short_answer', marks: 2,
    text: doc(para(text('Add:')), para(verticalArithmetic(['24', '13'], '+'))),
    correctAnswer: '37', options: [],
  },
  {
    id: 'g2q2', order: 1, type: 'short_answer', marks: 1,
    text: doc(para(text('Colour '), fraction('1', '2'), text(' of the circle.'))),
    correctAnswer: 'half the circle shaded', options: [],
  },
  {
    id: 'g2q3', order: 2, type: 'short_answer', marks: 2,
    text: 'Name two animals that live on a farm.',
    correctAnswer: 'cow, goat', options: [],
  },
]

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** The text a reader actually SEES — attribute values do not count. */
function visibleText(html) {
  const el = dom.window.document.createElement('div')
  el.innerHTML = html
  return el.textContent || ''
}

async function renderDocxXml(meta, questions, mode) {
  const document_ = await buildDocxDocument(meta, questions, { mode })
  const zip = unzipSync(new Uint8Array(await Packer.toBuffer(document_)))
  return strFromU8(zip['word/document.xml'])
}

/**
 * The forms §5 rules out, checked against what a reader SEES.
 *
 * `data-tex` deliberately carries the source LaTeX so Word can build a real
 * equation from it (§4.2), so this looks at rendered text rather than raw
 * markup — a substring check over the HTML would flag the paper for carrying
 * exactly the attribute that makes Word's equations possible.
 */
const PRECOMPOSED_FRACTION_GLYPHS = /[½¼¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞⅟↉⁄]/

function assertNoForbiddenForms(seen, where) {
  assert.ok(!seen.includes('[object Object]'), `${where}: rich content was stringified`)
  assert.ok(!PRECOMPOSED_FRACTION_GLYPHS.test(seen), `${where}: a precomposed fraction glyph reached the page`)
  assert.ok(!seen.includes('\\frac'), `${where}: raw LaTeX reached the page`)
  assert.ok(!seen.includes('\\sqrt'), `${where}: raw LaTeX reached the page`)
  assert.ok(!/\{"type":"doc"/.test(seen), `${where}: raw JSON reached the page`)
}

/* ══════════════════════════════════════════════════════════════════ *
 * 1. The block model
 * ══════════════════════════════════════════════════════════════════ */

console.log('\nGrade 7 Mathematics — the layout every renderer reads')

// buildPaperLayout returns the block array itself.
const g7Layout = buildPaperLayout(GRADE_7_META, GRADE_7_QUESTIONS, { mode: 'paper' })
const g7Scheme = buildPaperLayout(GRADE_7_META, GRADE_7_QUESTIONS, { mode: 'scheme' })
const g7Blocks = g7Layout.filter(b => b.type && b.number)

check('every question reaches the layout with its mathematics as paper HTML', () => {
  const q1 = g7Blocks.find(b => b.number === 1)
  assert.ok(q1.textHtml.includes('math-frac'), 'the fraction lost its markup')
  assert.ok(q1.textHtml.includes('math-frac-num'), 'the fraction has no numerator element')
  assert.ok(q1.textHtml.includes('math-frac-den'), 'the fraction has no denominator element')
  // The stacked structure is what draws the bar; without it the markup reads
  // as "35" rather than three fifths.
  assert.ok(q1.textHtml.includes('math-frac-stack'))
})

check('the mixed number keeps its whole part beside the stack', () => {
  const q2 = g7Blocks.find(b => b.number === 2)
  assert.ok(q2.textHtml.includes('math-frac-whole'), 'the whole number was dropped')
  assert.ok(/math-frac-whole[^>]*>2</.test(q2.textHtml), 'the whole number is not 2')
})

check('vertical arithmetic arrives in columns, not as an inline sum', () => {
  const q3 = g7Blocks.find(b => b.number === 3)
  assert.ok(q3.textHtml.includes('vert-arith'), 'the vertical calculation was flattened')
  assert.ok(q3.textHtml.includes('va-row'), 'the columns were not built')
})

check('all four MCQ options carry their own fraction', () => {
  const q4 = g7Blocks.find(b => b.number === 4)
  assert.equal(q4.optionsHtml.length, 4)
  for (const html of q4.optionsHtml) {
    assert.ok(html.includes('math-frac-stack'), `an option lost its fraction: ${html}`)
  }
  // The answer key is an INDEX and stays one, whatever the options are made of.
  assert.equal(q4.correctAnswer, 2)
})

check('a number base keeps its subscript base', () => {
  const q6 = g7Blocks.find(b => b.number === 6)
  assert.ok(q6.textHtml.includes('num-base'), 'the number base was flattened')
})

check('KaTeX nodes are flattened for the JavaScript-free renderers, not left blank', () => {
  const q5 = g7Blocks.find(b => b.number === 5)
  const seen = visibleText(q5.textHtml)
  assert.ok(seen.includes('x'), 'the power lost its base')
  assert.ok(seen.includes('49'), 'the square root lost its operand')
  assertNoForbiddenForms(seen, 'question 5 stem')
})

console.log('\nthe marking key carries the same mathematics (§4, §9)')

check('a structured expected answer becomes paper HTML rather than "[object Object]"', () => {
  const q1 = g7Scheme.find(b => b.number === 1)
  assert.ok(q1.answerHtml.includes('math-frac-stack'), 'the expected answer lost its fraction')
  assert.ok(Array.isArray(q1.answerNodes) && q1.answerNodes.length, 'no content model for the answer')
  assert.ok(!String(q1.answerPlain).includes('[object Object]'))
})

check('a structured marking note does too', () => {
  const q1 = g7Scheme.find(b => b.number === 1)
  assert.ok(q1.explanationHtml.includes('math-frac-stack'), 'the marking note lost its fractions')
  assert.ok(Array.isArray(q1.explanationNodes) && q1.explanationNodes.length)
})

check('a PLAIN answer keeps the exact path it always took — no shape change', () => {
  // Producing nodes for every answer would change the marking key of every
  // paper ever saved. The rich twins appear only when the value is genuinely
  // rich; everything else falls through to the plain mirror.
  const q3 = g7Scheme.find(b => b.number === 3)
  assert.equal(q3.answerHtml, '')
  assert.deepEqual(q3.answerNodes, [])
  assert.equal(q3.answerPlain, '1404')
})

check('an MCQ answer index is never run through the rich pipeline', () => {
  const q4 = g7Scheme.find(b => b.number === 4)
  assert.equal(q4.correctAnswer, 2)
  assert.equal(q4.answerHtml, '')
  assert.equal(q4.answerPlain, '2')
})

check('the learner copy carries no answer at all', () => {
  for (const block of g7Blocks) {
    assert.equal(block.answerHtml ?? '', '', `question ${block.number} leaked its answer`)
    assert.equal(block.explanation ?? '', '', `question ${block.number} leaked its marking note`)
  }
})

/* ══════════════════════════════════════════════════════════════════ *
 * 2. The print window (→ PDF)
 * ══════════════════════════════════════════════════════════════════ */

console.log('\nthe print window — no JavaScript, so the markup IS the formula')

const g7PrintPaper = buildPrintableHtml(GRADE_7_META, GRADE_7_QUESTIONS, 'paper')
const g7PrintScheme = buildPrintableHtml(GRADE_7_META, GRADE_7_QUESTIONS, 'scheme')

check('every fraction prints with a real horizontal bar', () => {
  assert.ok(g7PrintPaper.includes('math-frac-stack'), 'no stacked fraction in the print document')
  // The bar is drawn by a border on the numerator, and the print CSS has to be
  // inlined because the window has no stylesheet to link.
  assert.ok(/\.math-frac-num\s*\{[^}]*border-bottom/.test(g7PrintPaper),
    'the fraction bar rule is missing from the inlined print stylesheet')
})

check('the printed paper shows none of the forbidden forms', () => {
  assertNoForbiddenForms(visibleText(g7PrintPaper), 'print paper')
})

check('vertical calculations and number bases print in their school layout', () => {
  assert.ok(g7PrintPaper.includes('vert-arith'))
  assert.ok(g7PrintPaper.includes('num-base'))
})

check('the printed marking key shows the answer as a stacked fraction', () => {
  assert.ok(g7PrintScheme.includes('Expected answer'))
  const answerBlocks = g7PrintScheme.split('answer-block').slice(1).join('')
  assert.ok(answerBlocks.includes('math-frac-stack'), 'the marking key flattened its answer')
  assertNoForbiddenForms(visibleText(g7PrintScheme), 'print marking key')
})

/* ══════════════════════════════════════════════════════════════════ *
 * 3. Word
 * ══════════════════════════════════════════════════════════════════ */

console.log('\nWord — the export that fails silently when it fails')

const g7DocxPaper = await renderDocxXml(GRADE_7_META, GRADE_7_QUESTIONS, 'paper')
const g7DocxScheme = await renderDocxXml(GRADE_7_META, GRADE_7_QUESTIONS, 'scheme')

await checkAsync('a fraction reaches Word as a real OMML equation, not as "3/5"', async () => {
  // §4.2 — two-dimensional constructs become genuine Word equations, which is
  // what keeps the bar horizontal and the whole thing editable in Word.
  assert.ok(g7DocxPaper.includes('<m:f>'), 'no OMML fraction in the Word document')
  assert.ok(g7DocxPaper.includes('<m:num>'), 'the OMML fraction has no numerator')
  assert.ok(g7DocxPaper.includes('<m:den>'), 'the OMML fraction has no denominator')
})

await checkAsync('the Word paper shows none of the forbidden forms', async () => {
  const visible = g7DocxPaper.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)?.join(' ') || ''
  assertNoForbiddenForms(visible, 'Word paper')
})

await checkAsync('the four fraction options all reach Word', async () => {
  // Four options, each one fraction, so at least four equations must survive
  // alongside the ones in the stems.
  const fractionCount = (g7DocxPaper.match(/<m:f>/g) || []).length
  assert.ok(fractionCount >= 4, `expected at least 4 Word fractions, found ${fractionCount}`)
})

await checkAsync('the Word marking key keeps the answer structured', async () => {
  assert.ok(g7DocxScheme.includes('Expected answer'), 'the marking key has no expected answer')
  const visible = g7DocxScheme.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)?.join(' ') || ''
  assertNoForbiddenForms(visible, 'Word marking key')
  // The scheme has strictly more equations than the learner copy, because the
  // answers and marking notes add their own.
  const paperFractions = (g7DocxPaper.match(/<m:f>/g) || []).length
  const schemeFractions = (g7DocxScheme.match(/<m:f>/g) || []).length
  assert.ok(schemeFractions > paperFractions,
    `the marking key added no mathematics of its own (${schemeFractions} vs ${paperFractions})`)
})

/* ══════════════════════════════════════════════════════════════════ *
 * 4. Grade 2 Mathematics and Science
 * ══════════════════════════════════════════════════════════════════ */

console.log('\nGrade 2 Mathematics and Science — the lower-primary paper')

const g2Layout = buildPaperLayout(GRADE_2_META, GRADE_2_QUESTIONS, { mode: 'paper' })
const g2Blocks = g2Layout.filter(b => b.type && b.number)
const g2Print = buildPrintableHtml(GRADE_2_META, GRADE_2_QUESTIONS, 'paper')

check('a two-digit vertical addition sets out in columns', () => {
  const q1 = g2Blocks.find(b => b.number === 1)
  assert.ok(q1.textHtml.includes('vert-arith'))
  assert.ok(q1.textHtml.includes('va-row'))
  assert.ok(g2Print.includes('vert-arith'))
})

check('one half prints as a stacked fraction, never as the ½ glyph', () => {
  const q2 = g2Blocks.find(b => b.number === 2)
  assert.ok(q2.textHtml.includes('math-frac-stack'))
  assertNoForbiddenForms(visibleText(q2.textHtml), 'Grade 2 question 2')
  assertNoForbiddenForms(visibleText(g2Print), 'Grade 2 print paper')
})

check('the plain question stays plain all the way to the page', () => {
  const q3 = g2Blocks.find(b => b.number === 3)
  assert.equal(visibleText(q3.textHtml).trim(), 'Name two animals that live on a farm.')
  assert.ok(!q3.textHtml.includes('math-frac'), 'a plain question grew mathematics')
})

await checkAsync('the Grade 2 paper reaches Word with its columns and its fraction', async () => {
  const xml = await renderDocxXml(GRADE_2_META, GRADE_2_QUESTIONS, 'paper')
  assert.ok(xml.includes('<m:f>'), 'the half lost its Word equation')
  const visible = xml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)?.join(' ') || ''
  assert.ok(visible.includes('Name two animals'), 'the plain question was lost')
  assertNoForbiddenForms(visible, 'Grade 2 Word paper')
})

console.log(`\n${passed} maths parity checks passed across four renderers\n`)
