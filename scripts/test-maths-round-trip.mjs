// scripts/test-maths-round-trip.mjs
//
// The canonical rich-text contract for mathematics, proved end to end on the
// two fixtures Phase 1 is specified against: a Grade 7 Mathematics paper and a
// Grade 2 "Mathematics and Science" paper.
//
// What this file pins is the LIFECYCLE, not the editor:
//
//   authored value → serializeQuizSections (Firestore shape)
//                  → hydrateQuizSections (reopen)
//                  → still a structured maths node, byte-identical
//
// The contract in one line: a maths field is a Tiptap doc while the studio
// holds it and a JSON STRING once serialised; `text` and every entry of
// `options` obey the same rule, and hydration is the exact inverse. A plain
// string stays a plain string at every step — an existing paper must not
// acquire a wrapper it never had.
//
// Run with `npm run test:maths-round-trip`.

import assert from 'node:assert/strict'
import { serializeQuizSections, hydrateQuizSections, createStandaloneSection } from '../src/utils/quizSections.js'
import { richTextToPlainText, richTextHasFormatting } from '../src/utils/quizRichText.js'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

/* ------------------------------------------------------------------ *
 * Fixture builders — the structured nodes the editor's modals produce.
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

// ── Grade 7 Mathematics (§11) ──────────────────────────────────────────────
const GRADE_7_FIXTURE = [
  {
    // Q1 — 3/5 + 1/4 as two stacked fractions, never "3/5".
    text: doc(para(text('Calculate '), fraction('3', '5'), text(' + '), fraction('1', '4'), text('.'))),
    type: 'short_answer', options: [], correctAnswer: '17/20', marks: 3,
  },
  {
    // Q2 — a mixed number: the whole 2 beside a stacked 3-over-7.
    text: doc(para(text('Convert '), fraction('3', '7', '2'), text(' to an improper fraction.'))),
    type: 'short_answer', options: [], correctAnswer: '17/7', marks: 2,
  },
  {
    // Q3 — a vertical multiplication set out in columns.
    text: doc(para(text('Work out:')), para(verticalArithmetic(['234', '6'], '×'))),
    type: 'short_answer', options: [], correctAnswer: '1404', marks: 3,
  },
  {
    // Q4 — four MCQ options, every one a stacked fraction.
    text: doc(para(text('Which fraction is the largest?'))),
    type: 'mcq',
    options: [
      doc(para(fraction('1', '2'))),
      doc(para(fraction('2', '3'))),
      doc(para(fraction('3', '4'))),
      doc(para(fraction('5', '8'))),
    ],
    correctAnswer: 2, marks: 1,
  },
  {
    // Q5 — a power and a square root.
    text: doc(para(text('Simplify '), mathNode('x^2'), text(' + '), mathNode('\\sqrt{49}'), text('.'))),
    type: 'short_answer', options: [], correctAnswer: 'x² + 7', marks: 2,
  },
  {
    // Q6 — a number base.
    text: doc(para(text('Write '), numberBase('313', '5'), text(' in base ten.'))),
    type: 'short_answer', options: [], correctAnswer: '83', marks: 2,
  },
]

// ── Grade 2 Mathematics and Science (§11) ──────────────────────────────────
const GRADE_2_FIXTURE = [
  {
    text: doc(para(text('Add:')), para(verticalArithmetic(['24', '13'], '+'))),
    type: 'short_answer', options: [], correctAnswer: '37', marks: 2,
  },
  {
    text: doc(para(text('Colour '), fraction('1', '2'), text(' of the circle.'))),
    type: 'short_answer', options: [], correctAnswer: 'half the circle shaded', marks: 1,
  },
  {
    // The control: a question with no mathematics at all must stay a plain
    // string through every step. Maths-aware mode must not convert a paper's
    // ordinary questions into rich documents just because the subject qualifies.
    text: 'Name two animals that live on a farm.',
    type: 'short_answer', options: [], correctAnswer: 'cow, goat', marks: 2,
  },
]

function sectionsFor(fixture) {
  return fixture.map((q) => createStandaloneSection(q))
}

/** Serialise → hydrate, the way saving and reopening a paper actually works. */
function roundTrip(fixture) {
  const serialized = serializeQuizSections(sectionsFor(fixture), [])
  const { sections } = hydrateQuizSections(serialized.questions, serialized.passages || [], [], [])
  return { serialized, hydrated: sections }
}

/* ------------------------------------------------------------------ *
 * The contract
 * ------------------------------------------------------------------ */

console.log('\ncanonical rich-text contract — Grade 7 Mathematics')

const g7 = roundTrip(GRADE_7_FIXTURE)

check('a maths field serialises to a JSON STRING, not an object and never "[object Object]"', () => {
  for (const q of g7.serialized.questions) {
    assert.equal(typeof q.text, 'string', 'serialised text must be a string')
    assert.ok(!q.text.includes('[object Object]'), 'rich content stringified through String()')
    // Every Grade 7 fixture question is authored rich, so each must arrive as
    // a serialised doc rather than as flattened prose.
    assert.ok(q.text.startsWith('{'), `expected serialised Tiptap doc, got: ${q.text.slice(0, 40)}`)
    assert.equal(JSON.parse(q.text).type, 'doc')
  }
})

check('reopening returns the SAME structured document that was authored', () => {
  g7.hydrated.forEach((section, i) => {
    assert.deepEqual(
      section.question.text, GRADE_7_FIXTURE[i].text,
      `question ${i + 1} did not survive save → reload unchanged`,
    )
  })
})

check('each maths node type survives — fraction, mixed number, vertical, power, root, base', () => {
  const nodeTypesIn = (node, found = new Set()) => {
    if (!node || typeof node !== 'object') return found
    if (Array.isArray(node)) { node.forEach(n => nodeTypesIn(n, found)); return found }
    if (node.type) found.add(node.type)
    if (Array.isArray(node.content)) node.content.forEach(n => nodeTypesIn(n, found))
    return found
  }
  const all = new Set()
  for (const section of g7.hydrated) nodeTypesIn(section.question.text, all)
  for (const type of ['mathFraction', 'verticalArithmetic', 'numberBase', 'mathInline']) {
    assert.ok(all.has(type), `${type} was lost in the round trip`)
  }
  // The mixed number keeps its whole part — a mixed number that loses its
  // whole number is silently a different fraction.
  const mixed = g7.hydrated[1].question.text.content[0].content[1]
  assert.equal(mixed.type, 'mathFraction')
  assert.deepEqual(mixed.attrs, { whole: '2', num: '3', den: '7' })
})

console.log('\nMCQ options carry mathematics without disturbing the answer key')

check('each option round-trips as its own structured document', () => {
  const q4Serialized = g7.serialized.questions[3]
  const q4Hydrated = g7.hydrated[3].question
  assert.equal(q4Serialized.options.length, 4)
  for (const opt of q4Serialized.options) {
    assert.equal(typeof opt, 'string', 'the schema declares options as strings')
    assert.equal(JSON.parse(opt).type, 'doc')
  }
  assert.deepEqual(q4Hydrated.options, GRADE_7_FIXTURE[3].options)
})

check('the correct-answer INDEX survives — identity never depends on comparing rich content', () => {
  // C is correct (3/4). The index must come back as the number 2 regardless of
  // what the options themselves are made of.
  assert.equal(g7.serialized.questions[3].correctAnswer, 2)
  assert.equal(g7.hydrated[3].question.correctAnswer, 2)
})

check('a fraction option is never flattened to a slash form on the way to storage', () => {
  for (const opt of g7.serialized.questions[3].options) {
    assert.ok(!/^\s*\d+\s*\/\s*\d+\s*$/.test(opt), `option stored as slash text: ${opt}`)
  }
})

console.log('\nGrade 2 Mathematics and Science — lower primary, and the plain control')

const g2 = roundTrip(GRADE_2_FIXTURE)

check('a lower-primary vertical addition and stacked half survive unchanged', () => {
  assert.deepEqual(g2.hydrated[0].question.text, GRADE_2_FIXTURE[0].text)
  assert.deepEqual(g2.hydrated[1].question.text, GRADE_2_FIXTURE[1].text)
})

check('a plain question stays a PLAIN STRING — no wrapper it never had', () => {
  const plainQ = g2.serialized.questions[2]
  assert.equal(typeof plainQ.text, 'string')
  assert.equal(plainQ.text, 'Name two animals that live on a farm.')
  assert.ok(!plainQ.text.startsWith('{'), 'a plain question was silently promoted to rich JSON')
  assert.equal(g2.hydrated[2].question.text, 'Name two animals that live on a farm.')
  assert.equal(richTextHasFormatting(g2.hydrated[2].question.text), false)
})

console.log('\nplain-text fallback (§13 — spoken text, search, duplicate detection)')

check('every maths question has a readable plain-text form, and none leaks raw JSON', () => {
  for (const section of [...g7.hydrated, ...g2.hydrated]) {
    const plain = richTextToPlainText(section.question.text)
    assert.ok(plain.trim().length > 0, 'a question with no plain-text fallback')
    assert.ok(!plain.includes('[object Object]'), plain)
    assert.ok(!plain.includes('"type"'), `raw JSON leaked into plain text: ${plain}`)
  }
})

check('the plain form of a fraction reads as a fraction, so duplicate detection still works', () => {
  // Normalised plain text MAY be the slash form — §7 allows it for dedup. What
  // it must never do is replace the stored rich content, which the assertions
  // above already pin.
  const q1 = richTextToPlainText(g7.hydrated[0].question.text)
  assert.match(q1, /3\/5/)
  assert.match(q1, /1\/4/)
})

check('the studio recognises every maths field as formatted, so no textarea can flatten it', () => {
  // Q4's stem is deliberately plain prose — its mathematics lives in the
  // OPTIONS, which is exactly the case a stem-only check would miss.
  const richStems = [0, 1, 2, 4, 5].map(i => g7.hydrated[i]).concat(g2.hydrated[0], g2.hydrated[1])
  for (const section of richStems) {
    assert.equal(
      richTextHasFormatting(section.question.text), true,
      'a maths question that a plain textarea would silently destroy went undetected',
    )
  }
  for (const option of g7.hydrated[3].question.options) {
    assert.equal(
      richTextHasFormatting(option), true,
      'a fraction option that a plain text input would silently destroy went undetected',
    )
  }
})

console.log(`\n${passed} maths round-trip checks passed\n`)
