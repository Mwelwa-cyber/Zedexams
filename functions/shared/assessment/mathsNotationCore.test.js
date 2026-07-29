/**
 * The mathematics notation contract (Phase 2 §1, §3).
 *
 * The assertions that matter most here are the REFUSALS. Detection and repair
 * run unattended over every field of every generated paper, so a rule that is
 * too eager rewrites a teacher's question without anyone seeing it happen. A
 * rule that is too shy merely leaves "3/5" on the page, which the teacher can
 * see and fix.
 *
 * Run: node functions/shared/assessment/mathsNotationCore.test.js
 */

import assert from 'node:assert/strict'
import {
  NOTATION_FORMS, NOTATION_FIELDS, NOTATION_FIELD_PATHS, VMATH_OPERATORS,
  detectNotationViolations, repairNotation, toPlainMathsText,
  checkQuestionNotation, bareFractionIsSafeToRepair,
} from './mathsNotationCore.js'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const codesOf = (text) =>
  detectNotationViolations(text).violations.map((v) => v.code)

console.log('\nthe contract declares what it must')

check('every form has markup, a target node and a prompt rule', () => {
  assert.ok(NOTATION_FORMS.length >= 4)
  for (const form of NOTATION_FORMS) {
    assert.ok(form.id && form.markup && form.becomes, `${form.id} is incomplete`)
    assert.ok(form.promptRule instanceof RegExp, `${form.id} has no prompt rule`)
  }
})

check('all four column operators are in the contract', () => {
  // The prompt's prose named only addition and subtraction while the token and
  // the editor node always accepted all four, which read as "a long
  // multiplication cannot be set out in columns".
  assert.deepEqual([...VMATH_OPERATORS], ['+', '-', '×', '÷'])
})

check('the field list covers every place mathematics can hide', () => {
  for (const path of [
    'prompt', 'options[]', 'answer', 'markingGuide',
    'parts[].text', 'parts[].answer',
    'statements[].text', 'wordBank[]', 'passage.text',
  ]) {
    assert.ok(NOTATION_FIELD_PATHS.includes(path), `${path} is not in the contract`)
  }
  for (const field of NOTATION_FIELDS) {
    assert.ok(field.kind === 'inline' || field.kind === 'block', field.path)
    assert.ok(field.what, `${field.path} has no human description`)
  }
})

console.log('\ndetection — what broke the contract')

check('ASCII powers, roots and mixed numbers are found', () => {
  assert.deepEqual(codesOf('Simplify x^2'), ['POWER_ASCII'])
  assert.deepEqual(codesOf('Find sqrt(49)'), ['SQRT_ASCII'])
  assert.ok(codesOf('Convert 2 3/7 to an improper fraction').includes('MIXED_NUMBER_ASCII'))
})

check('a bare a/b is reported', () => {
  assert.ok(codesOf('Calculate 3/5 of 40').includes('FRACTION_ASCII'))
})

check('maths already inside $…$ is NOT reported', () => {
  // The contract's own form must not be flagged as a violation of itself.
  assert.deepEqual(codesOf('Simplify $x^{2}$'), [])
  assert.deepEqual(codesOf('Find $\\sqrt{49}$'), [])
})

check('a bare \\frac is allowed — the contract permits it undelimited', () => {
  assert.deepEqual(codesOf('Calculate \\frac{3}{5} of 40'), [])
  assert.deepEqual(codesOf('Convert 2\\frac{3}{7}'), [])
})

check('a LaTeX command loose outside dollars is reported', () => {
  // Unwrapped, it prints as its own source — the "raw LaTeX visible as text"
  // failure the phase exists to stop.
  assert.ok(codesOf('The area is \\pi r^2').includes('LATEX_UNWRAPPED'))
})

check('a malformed or unclosed vmath token is reported and is NOT repairable', () => {
  const malformed = detectNotationViolations('[[vmath op=+ answer=37]]')
  assert.ok(malformed.violations.some((v) => v.code === 'VMATH_MALFORMED'))
  assert.ok(malformed.violations.every((v) => !v.repairable || v.code !== 'VMATH_MALFORMED'))
  assert.ok(codesOf('[[vmath op=+ lines=24,13').includes('VMATH_UNCLOSED'))
})

check('a well-formed vmath token is clean', () => {
  assert.deepEqual(codesOf('[[vmath op=+ lines=24,13 answer=37]]'), [])
})

check('a column sum drawn in ASCII is reported', () => {
  assert.ok(codesOf('  234\n+  13\n-----').includes('ASCII_COLUMN_SUM'))
})

check('ordinary prose with no mathematics is clean', () => {
  for (const text of [
    'Name two animals that live on a farm.',
    'Explain why the sky appears blue.',
    'Write a short paragraph about your school.',
  ]) {
    assert.deepEqual(codesOf(text), [], text)
  }
})

console.log('\nthe refusals — where repair must not guess')

check('a bare a/b is repairable ONLY when the text proves it is a fraction', () => {
  assert.equal(bareFractionIsSafeToRepair('Write 3/5 in its lowest terms'), true)
  assert.equal(bareFractionIsSafeToRepair('Simplify the fraction 3/5'), true)
  // No evidence either way.
  assert.equal(bareFractionIsSafeToRepair('Calculate 3/5 of 40'), false)
  // A competing reading is named.
  assert.equal(bareFractionIsSafeToRepair('The ratio 3/5 of boys to girls'), false)
  assert.equal(bareFractionIsSafeToRepair('The fraction and the ratio 3/5'), false)
})

check('a ratio, a date and a score are never rewritten', () => {
  for (const text of [
    'The ratio of boys to girls is 3/5.',
    'The meeting was on 3/5/2026.',
    'She scored 3/5 out of 5 marks.',
  ]) {
    const { text: out } = repairNotation(text)
    assert.equal(out, text, `repair touched: ${text}`)
  }
})

check('a fraction in a proven context IS repaired', () => {
  const { text, repaired } = repairNotation('Write the fraction 3/5 in its lowest terms.')
  assert.ok(repaired >= 1)
  assert.match(text, /\\frac\{3\}\{5\}/)
})

console.log('\nrepair — the unambiguous rewrites')

check('x^2 becomes wrapped inline maths', () => {
  const { text } = repairNotation('Simplify x^2 + 1')
  assert.match(text, /\$x\^\{2\}\$/)
  assert.deepEqual(detectNotationViolations(text).violations, [])
})

check('sqrt(49) becomes a wrapped root', () => {
  const { text } = repairNotation('Find sqrt(49)')
  assert.match(text, /\$\\sqrt\{49\}\$/)
  assert.deepEqual(detectNotationViolations(text).violations, [])
})

check('2 3/7 becomes a mixed number, not a whole beside a fraction', () => {
  const { text } = repairNotation('Convert 2 3/7 to an improper fraction.')
  assert.match(text, /2\\frac\{3\}\{7\}/)
  assert.ok(!/2 3\/7/.test(text))
})

check('a loose LaTeX command is wrapped rather than left to print as source', () => {
  const { text } = repairNotation('The area is \\pi r^2')
  assert.match(text, /\$\\pi\$/)
})

check('repair never introduces a new violation', () => {
  // The property that matters: whatever repair emits must itself be contract-
  // compliant, or the pipeline would loop or ship its own output as a defect.
  for (const source of [
    'Simplify x^2', 'Find sqrt(49)', 'Convert 2 3/7 now',
    'Write the fraction 3/5 in its lowest terms', 'The area is \\pi r^2',
    'Already fine: \\frac{1}{2} and $x^{3}$',
  ]) {
    const { text } = repairNotation(source)
    const after = detectNotationViolations(text).violations
      .filter((v) => v.repairable)
    assert.deepEqual(after, [], `${source} → ${text}`)
  }
})

check('a division by zero is never turned into a fraction', () => {
  const { text } = repairNotation('Write the fraction 3/0 in its lowest terms')
  assert.ok(!/\\frac\{3\}\{0\}/.test(text))
})

console.log('\nthe plain-text floor — legible, never raw markup')

check('markup degrades to readable mathematics', () => {
  assert.equal(toPlainMathsText('Calculate \\frac{3}{5} of 40'), 'Calculate 3/5 of 40')
  assert.equal(toPlainMathsText('Convert 2\\frac{3}{7}'), 'Convert 2 3/7')
  assert.equal(toPlainMathsText('Find $\\sqrt{49}$'), 'Find √49')
  assert.equal(toPlainMathsText('Simplify $x^{2}$'), 'Simplify x²')
  // The space between the symbol and the variable is in the LaTeX source;
  // keeping it is faithful, and closing it up would be this module inventing
  // typographic spacing it has no business deciding.
  assert.equal(toPlainMathsText('Area is $\\pi r^{2}$'), 'Area is π r²')
})

check('a vmath token degrades to the linear sum it stood for', () => {
  assert.equal(toPlainMathsText('[[vmath op=+ lines=24,13 answer=37]]'), '24 + 13 = 37')
  assert.equal(toPlainMathsText('[[vmath op=- lines=95,36]]'), '95 − 36')
  assert.equal(toPlainMathsText('[[vmath op=x lines=234,6 answer=1404]]'), '234 × 6 = 1404')
})

check('NOTHING that reaches the floor still carries raw markup', () => {
  // This is the §3 guarantee: a teacher may see unformatted mathematics, never
  // a backslash command or a stray token.
  for (const source of [
    'Calculate \\frac{3}{5} + \\frac{1}{4}',
    '[[vmath op=+ lines=24,13 answer=37]]',
    'Find $\\sqrt{49}$ and $x^{2}$',
    'The area of the circle is $\\pi r^{2}$ cm$^{2}$',
    '[[vmath op=+ answer=37]]',
  ]) {
    const plain = toPlainMathsText(source)
    assert.ok(!plain.includes('\\'), `backslash survived: ${plain}`)
    assert.ok(!plain.includes('[['), `token survived: ${plain}`)
    assert.ok(!plain.includes('$'), `delimiter survived: ${plain}`)
    assert.ok(!plain.includes('{'), `brace survived: ${plain}`)
    assert.ok(!plain.includes('[object Object]'))
  }
})

check('plain prose passes through the floor unchanged', () => {
  const text = 'Name two animals that live on a farm.'
  assert.equal(toPlainMathsText(text), text)
})

console.log('\nwhole-question compliance')

check('every contract field of a question is inspected, sub-parts included', () => {
  const question = {
    prompt: 'Calculate 3/5 of 40.',
    options: ['x^2', '\\frac{1}{2}'],
    answer: 'sqrt(49)',
    markingGuide: 'Award 1 mark.',
    parts: [{ text: 'Work out 2 3/7', answer: 'y^3' }],
  }
  const { ok, fields } = checkQuestionNotation(question)
  assert.equal(ok, false)
  const paths = fields.map((f) => f.path)
  assert.ok(paths.includes('prompt'))
  assert.ok(paths.includes('options[]'))
  assert.ok(paths.includes('answer'))
  assert.ok(paths.includes('parts[].text'), 'sub-part text was not inspected')
  assert.ok(paths.includes('parts[].answer'), 'sub-part answer was not inspected')
  // The compliant marking guide and option are not reported.
  assert.ok(!paths.includes('markingGuide'))
})

check('a fully compliant question reports clean', () => {
  const question = {
    prompt: 'Calculate \\frac{3}{5} + \\frac{1}{4}.',
    options: ['\\frac{17}{20}', '\\frac{4}{9}', '\\frac{1}{2}', '\\frac{2}{3}'],
    answer: '\\frac{17}{20}',
    markingGuide: 'Common denominator 20.',
    parts: [{ text: 'Work out 2\\frac{3}{7}', answer: '\\frac{17}{7}' }],
    statements: [{ text: 'One half is \\frac{1}{2}.', answers: ['\\frac{1}{2}'] }],
  }
  assert.deepEqual(checkQuestionNotation(question), { ok: true, fields: [] })
})

check('a non-mathematics question is clean and untouched', () => {
  const question = {
    prompt: 'Name two animals that live on a farm.',
    options: ['Cow', 'Aeroplane', 'Goat', 'Table'],
    answer: 'Cow',
    markingGuide: 'One mark each.',
  }
  assert.equal(checkQuestionNotation(question).ok, true)
})

console.log(`\n${passed} notation-contract checks passed\n`)
