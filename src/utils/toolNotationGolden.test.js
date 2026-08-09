/**
 * The worksheet drill grid, delivered — the Phase 5 acid test.
 *
 * Twelve structured fraction items in a 4-column grid, plus a column sum and a
 * mixed number, rendered to the artefacts a teacher receives: the print
 * window's HTML and a real .docx, pupil copy and answer key. The parser has
 * its own unit checks below; these end-to-end halves are what stop "the parser
 * works" from standing in for "the printout works".
 *
 * Run: node src/utils/toolNotationGolden.test.js
 */

import assert from 'node:assert/strict'
import { Packer } from 'docx'
import { unzipSync, strFromU8 } from 'fflate'
import {
  hasToolMarkup, parseInlineMarkup, parseMarkupBlocks, markupToHtml,
} from './toolNotationRender.js'
import { buildWorksheetPrintableHtml } from '../engines/export-engine/worksheetToPdf.js'
import { buildWorksheetDocument } from '../engines/export-engine/worksheetToDocx.js'
import { buildHomeworkPrintableHtml } from '../engines/export-engine/homeworkToPdf.js'
import { buildHomeworkDocument } from '../engines/export-engine/homeworkToDocx.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}
const atest = async (name, fn) => { await fn(); passed += 1; console.log(`  ✓ ${name}`) }

console.log('\ntoolNotationRender — the one parser')

test('a fraction, a mixed number and inline maths parse to typed parts', () => {
  const parts = parseInlineMarkup('Work out \\frac{3}{5} + 1\\frac{1}{2} = $x^2$')
  const kinds = parts.map((p) => p.type)
  assert.deepEqual(kinds, ['text', 'fraction', 'text', 'fraction', 'text', 'text', 'script'])
  assert.deepEqual(parts[1], { type: 'fraction', whole: '', num: '3', den: '5' })
  assert.deepEqual(parts[3], { type: 'fraction', whole: '1', num: '1', den: '2' })
  assert.deepEqual(parts[6], { type: 'script', script: 'sup', value: '2' })
})

test('a [[vmath]] line becomes a column-sum block', () => {
  const blocks = parseMarkupBlocks('Add these:\n[[vmath op=+ lines=347,285 answer=632]]')
  assert.equal(blocks.length, 2)
  assert.equal(blocks[1].kind, 'vmath')
  assert.deepEqual(blocks[1].attrs.lines, ['347', '285'])
})

test('the HTML fraction is stacked structure, never a slash or a glyph', () => {
  const html = markupToHtml('Shade \\frac{7}{10} of the shape.')
  assert.match(html, /tn-num">7<\/span>/)
  assert.match(html, /tn-den">10<\/span>/)
  assert.ok(!html.includes('7/10'), 'no slash form')
  assert.ok(!/[½¼¾]/.test(html), 'no precomposed glyph')
})

test('plain text passes through escaped and otherwise untouched', () => {
  assert.equal(markupToHtml('Score 3/4 & <b>win</b>'),
    'Score 3/4 &amp; &lt;b&gt;win&lt;/b&gt;')
  assert.equal(hasToolMarkup('a ratio of 3:5 on 12/03/2026'), false)
})

test('hostile markup content cannot escape into the page', () => {
  const html = markupToHtml('\\frac{<script>x</script>}{2}')
  assert.ok(!html.includes('<script>'), 'the numerator is escaped')
})

/* ── the worksheet drill grid, end to end ────────────────────────────────── */

const DRILL_QUESTIONS = Array.from({ length: 12 }, (_, i) => ({
  number: i + 1,
  type: 'calculation',
  prompt: `\\frac{${i + 1}}{${i + 2}} =`,
  marks: 1,
  answer: `$${(((i + 1) / (i + 2)) * 100).toFixed(0)}\\%$`,
  workingNotes: '',
}))

const WORKSHEET = {
  header: {
    title: 'Grade 5 Mathematics — Fractions Worksheet',
    subject: 'Mathematics', grade: '5', topic: 'Fractions', subtopic: '',
    duration: '30 minutes', totalMarks: 14,
    instructions: 'Answer ALL questions. Show your working.',
  },
  sections: [
    {
      title: 'Section A — Fraction drill', instructions: '', passage: '', passageTitle: '',
      layout: 'grid', columns: 4, questions: DRILL_QUESTIONS,
    },
    {
      title: 'Section B — Working', instructions: '', passage: '', passageTitle: '',
      layout: 'standard', columns: 0,
      questions: [
        {
          number: 13, type: 'calculation', marks: 1,
          prompt: 'Work out:\n[[vmath op=+ lines=347,285 answer=]]',
          answer: '632', workingNotes: 'Carry the ten.',
        },
        {
          number: 14, type: 'calculation', marks: 1,
          prompt: 'Convert 1\\frac{3}{7} to an improper fraction.',
          answer: '\\frac{10}{7}', workingNotes: '',
        },
      ],
    },
  ],
  answerKey: { markingNotes: 'One mark per item.', totalMarks: 14 },
}

console.log('\nthe worksheet print window')

test('all twelve drill fractions print stacked inside the grid', () => {
  const html = buildWorksheetPrintableHtml(WORKSHEET, 'worksheet')
  assert.ok(html.includes('grid-4'), 'the 4-column grid is used')
  const stacked = (html.match(/tn-frac/g) || []).length
  assert.ok(stacked >= 13, `expected 13+ stacked fractions, found ${stacked}`)
  assert.ok(!html.includes('\\frac'), 'no raw markup reaches the page')
  assert.match(html, /tn-va-op">\+</, 'the column sum sets out with its operator')
  assert.match(html, /tn-whole">1</, 'the mixed number keeps its whole part')
  assert.ok(html.includes('.tn-frac{'), 'the notation stylesheet is embedded')
})

test('the answer key renders the maths in its answers too', () => {
  const html = buildWorksheetPrintableHtml(WORKSHEET, 'answer_key')
  assert.ok(!html.includes('$'), 'no inline-maths markup survives in answers')
  assert.match(html, /tn-num">10<\/span>/, 'the improper-fraction answer is stacked')
})

console.log('\nthe worksheet Word download')

await atest('the drill grid reaches Word as sup/⁄/sub runs, no markup', async () => {
  const doc = buildWorksheetDocument(WORKSHEET, { mode: 'worksheet' })
  const zip = unzipSync(new Uint8Array(await Packer.toBuffer(doc)))
  const xml = strFromU8(zip['word/document.xml'])
  assert.ok(!xml.includes('\\frac'), 'no raw markup in the Word file')
  assert.ok(!xml.includes('[[vmath'), 'no unconverted token in the Word file')
  const sup = (xml.match(/w:val="superscript"/g) || []).length
  const sub = (xml.match(/w:val="subscript"/g) || []).length
  assert.ok(sup >= 13 && sub >= 13, `each fraction carries real scripts (sup ${sup}, sub ${sub})`)
  assert.ok(xml.includes('⁄'), 'the fraction slash is the real fraction character')
  assert.match(xml, /Courier New/, 'the column sum is set in tabular figures')
})

await atest('the Word answer key carries the answers, converted', async () => {
  const doc = buildWorksheetDocument(WORKSHEET, { mode: 'answer_key' })
  const zip = unzipSync(new Uint8Array(await Packer.toBuffer(doc)))
  const xml = strFromU8(zip['word/document.xml'])
  assert.ok(!xml.includes('$'), 'no inline-maths markup in the key')
  assert.ok(xml.includes('632'), 'the column-sum answer is present')
})

/* ── homework, same treatment ────────────────────────────────────────────── */

const HOMEWORK = {
  header: {
    title: 'Fractions Homework', grade: '5', subject: 'Mathematics',
    topic: 'Fractions', subtopic: '', estimatedMinutes: 20, language: 'English',
  },
  instructions: 'Do all questions in your exercise book.',
  questions: [
    { number: 1, prompt: 'Work out \\frac{2}{3} of 18.', answer: '12', workingNotes: '18 ÷ 3 × 2.' },
    { number: 2, prompt: 'Write $5^2$ as a number.', answer: '25', workingNotes: '' },
  ],
  parentNote: 'Please check the working, not just the answers.',
  answerKey: { markingNotes: 'One mark each.' },
}

console.log('\nhomework, both routes')

test('the homework print window stacks its fractions', () => {
  const html = buildHomeworkPrintableHtml(HOMEWORK, { includeAnswers: true })
  assert.match(html, /tn-num">2<\/span>/)
  assert.ok(!html.includes('\\frac') && !html.includes('$5^2$'), 'no markup on the page')
  assert.match(html, /5<sup>2<\/sup>/, 'the power is a real superscript')
})

await atest('the homework Word download converts both questions', async () => {
  const doc = buildHomeworkDocument(HOMEWORK, { includeAnswers: true })
  const zip = unzipSync(new Uint8Array(await Packer.toBuffer(doc)))
  const xml = strFromU8(zip['word/document.xml'])
  assert.ok(!xml.includes('\\frac') && !xml.includes('$'), 'no markup in Word')
  assert.ok(xml.includes('⁄'), 'the fraction is the sup/slash/sub form')
  assert.match(xml, /w:val="superscript"/, 'the power is a real superscript run')
})

console.log(`\ntool notation golden: ${passed} passed\n`)
