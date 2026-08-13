/**
 * §8 — converting computer-style mathematics in AI-generated and imported text.
 *
 * The interesting assertions here are the NEGATIVE ones. Anything this module
 * converts, it converts silently and in bulk across a generated paper, so the
 * cost of a wrong conversion is a wrong question the teacher never saw change.
 * That is why a bare `a/b` is reported and not converted: "3/5" is a fraction,
 * a ratio, a date and a range, and the string does not say which.
 *
 * Run: node src/utils/mathsTextNormalizer.test.js
 */

import assert from 'node:assert/strict'
import {
  normalizeMathsInText,
  normalizeMathsInTextIncludingBareFractions,
  normalizeMathsInField,
  normalizeMathsInQuestion,
} from './mathsTextNormalizer.js'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const typesOf = (nodes) => nodes.map((n) => n.type)

console.log('\nwhat converts without guessing')

check('a mixed number becomes one fraction node with its whole part', () => {
  const { nodes, converted } = normalizeMathsInText('Convert 2 3/7 to an improper fraction.')
  assert.equal(converted, 1)
  const frac = nodes.find((n) => n.type === 'mathFraction')
  assert.deepEqual(frac.attrs, { whole: '2', num: '3', den: '7' })
  // The surrounding prose survives on both sides.
  assert.equal(nodes[0].text, 'Convert ')
  assert.equal(nodes[nodes.length - 1].text, ' to an improper fraction.')
})

check('a power becomes a maths node', () => {
  const { nodes, converted } = normalizeMathsInText('Simplify x^2 please')
  assert.equal(converted, 1)
  const math = nodes.find((n) => n.type === 'mathInline')
  assert.equal(math.attrs.latex, 'x^{2}')
})

check('a negative and a braced exponent both convert', () => {
  assert.equal(normalizeMathsInText('10^-3').nodes[0].attrs.latex, '10^{-3}')
  assert.equal(normalizeMathsInText('x^{n+1}').nodes[0].attrs.latex, 'x^{n+1}')
})

check('sqrt converts in both spellings', () => {
  assert.equal(normalizeMathsInText('sqrt(49)').nodes[0].attrs.latex, '\\sqrt{49}')
  assert.equal(normalizeMathsInText('sqrt 49').nodes[0].attrs.latex, '\\sqrt{49}')
})

check('several patterns in one sentence all convert, in order', () => {
  const { nodes, converted } = normalizeMathsInText('Find x^2 + sqrt(16) and 1 1/2.')
  assert.equal(converted, 3)
  assert.deepEqual(
    typesOf(nodes).filter((t) => t !== 'text'),
    ['mathInline', 'mathInline', 'mathFraction'],
  )
})

console.log('\nwhat is deliberately left alone')

check('a bare a/b is REPORTED, never converted', () => {
  // This is the whole design decision. "3/5" is a fraction and a ratio and a
  // date, and converting on sight would silently change the meaning of a
  // question about ratios.
  const { nodes, converted, candidates } = normalizeMathsInText('Calculate 3/5 of 40.')
  assert.equal(converted, 0)
  assert.equal(candidates, 1)
  assert.deepEqual(nodes, [{ type: 'text', text: 'Calculate 3/5 of 40.' }])
})

check('a date is untouched and is not even offered', () => {
  // A three-part date cannot be a fraction, so it is not a candidate either —
  // offering it would train the teacher to skim past the confirmation.
  const { converted, candidates } = normalizeMathsInText('Due on 3/5/2026.')
  assert.equal(converted, 0)
  assert.equal(candidates, 0)
})

check('a URL, a decimal and a unit survive intact', () => {
  for (const source of [
    'See https://example.com/a/b for details.',
    'The value 3.5/2.5 is given.',
    'Speed is 60 km/h.',
    'Answer in m/s.',
  ]) {
    const { nodes, converted } = normalizeMathsInText(source)
    assert.equal(converted, 0, source)
    assert.equal(nodes[0].text, source)
  }
})

check('a zero denominator is never turned into a fraction', () => {
  // The fraction modal refuses one, so the normaliser must not create one
  // behind its back.
  assert.equal(normalizeMathsInText('3/0').converted, 0)
  assert.equal(normalizeMathsInText('3/0').candidates, 0)
  assert.equal(normalizeMathsInText('2 3/0').converted, 0)
})

check("a mixed number's own fraction is not double-counted as a candidate", () => {
  const { converted, candidates } = normalizeMathsInText('Convert 2 3/7 now.')
  assert.equal(converted, 1)
  assert.equal(candidates, 0)
})

console.log('\nthe explicit opt-in for bare fractions')

check('the teacher-confirmed pass converts them, and reports none left', () => {
  const { nodes, converted, candidates } =
    normalizeMathsInTextIncludingBareFractions('Calculate 3/5 + 1/4.')
  assert.equal(converted, 2)
  assert.equal(candidates, 0)
  const fracs = nodes.filter((n) => n.type === 'mathFraction')
  assert.deepEqual(fracs.map((f) => f.attrs), [
    { whole: '', num: '3', den: '5' },
    { whole: '', num: '1', den: '4' },
  ])
})

check('even then, a date is still not a fraction', () => {
  const { converted } = normalizeMathsInTextIncludingBareFractions('Due on 3/5/2026.')
  assert.equal(converted, 0)
})

console.log('\nfields and questions')

check('a plain string field becomes a document only when something converted', () => {
  const nothing = normalizeMathsInField('Name two farm animals.')
  assert.equal(nothing.converted, 0)
  // The SAME reference back, so a no-op cannot mark a paper dirty.
  assert.equal(nothing.value, 'Name two farm animals.')

  const something = normalizeMathsInField('Convert 2 3/7.')
  assert.equal(something.converted, 1)
  assert.equal(something.value.type, 'doc')
})

check('an already-rich document converts inside its text runs, keeping marks', () => {
  const doc = {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{ type: 'text', text: 'Simplify x^2', marks: [{ type: 'bold' }] }],
    }],
  }
  const { value, converted } = normalizeMathsInField(doc)
  assert.equal(converted, 1)
  const runs = value.content[0].content
  // The prose keeps its bold; the maths node sits beside it.
  assert.deepEqual(runs[0].marks, [{ type: 'bold' }])
  assert.equal(runs[1].type, 'mathInline')
})

check('an existing maths node is left completely alone', () => {
  const doc = {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{ type: 'mathFraction', attrs: { whole: '', num: '3', den: '5' } }],
    }],
  }
  const { value, converted } = normalizeMathsInField(doc)
  assert.equal(converted, 0)
  assert.equal(value, doc)
})

check('an HTML or JSON string is not re-parsed here', () => {
  // There is deliberately one rich-text parser, and it is not this module.
  assert.equal(normalizeMathsInField('<p>x^2</p>').converted, 0)
  assert.equal(normalizeMathsInField('{"type":"doc"}').converted, 0)
})

check('a whole question converts its stem, answer, explanation and options', () => {
  const question = {
    type: 'mcq',
    text: 'Which equals 2 1/2?',
    correctAnswer: 1,
    options: ['x^2', '1 1/2', 'sqrt(9)', 'plain'],
    explanation: 'Because 3 1/4 is larger.',
  }
  const { question: next, converted } = normalizeMathsInQuestion(question)
  assert.ok(converted >= 4)
  assert.equal(next.text.type, 'doc')
  assert.equal(next.options[3], 'plain', 'a plain option was needlessly rewritten')
  assert.equal(next.explanation.type, 'doc')
  // An MCQ's correctAnswer is an INDEX and must survive as the number it is.
  assert.equal(next.correctAnswer, 1)
})

check('a question with no convertible mathematics comes back UNCHANGED by reference', () => {
  const question = { type: 'short_answer', text: 'Name two farm animals.', correctAnswer: 'cow', options: [] }
  const { question: next, converted } = normalizeMathsInQuestion(question)
  assert.equal(converted, 0)
  assert.equal(next, question)
})

check('an AI-style generated question reports its bare fractions rather than silently fixing them', () => {
  // The exact shape §8 names: "Create paper with AI" hands back "3/5".
  const question = { type: 'short_answer', text: 'Calculate 3/5 + 1/4.', correctAnswer: '17/20', options: [] }
  const seen = normalizeMathsInQuestion(question)
  assert.equal(seen.converted, 0)
  assert.equal(seen.candidates, 3, 'every bare fraction should be offered')
  assert.equal(seen.question, question, 'nothing changed without the teacher asking')

  const asked = normalizeMathsInQuestion(question, { includeBareFractions: true })
  assert.equal(asked.converted, 3)
  assert.equal(asked.question.text.type, 'doc')
})

console.log(`\n${passed} maths-normaliser checks passed\n`)
