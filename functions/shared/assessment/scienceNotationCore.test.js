/**
 * The science half of the notation contract (Phase 3 §1, §7).
 *
 * As with mathematics, the REFUSALS carry the weight. This runs unattended over
 * every field of every generated science paper, and a rule that reads "Form 4"
 * or "Section B2" as chemistry subscripts a heading in front of a teacher who
 * never asked. Being too shy just leaves "H2O" on the page, which is visible
 * and fixable.
 *
 * Run: node functions/shared/assessment/scienceNotationCore.test.js
 */

import assert from 'node:assert/strict'
import {
  SCIENCE_SUBJECT_KEYS, isScienceSubjectKey,
  detectScienceViolations, repairScienceNotation, scienceToPlainText,
} from './mathsNotationCore.js'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const repair = (t) => repairScienceNotation(t).text
const codes = (t) => detectScienceViolations(t).violations.map((v) => v.code)

console.log('\nwhich papers get science notation')

check('every examinable science subject is covered', () => {
  for (const key of [
    'integrated_science', 'environmental_science',
    'physics', 'chemistry', 'biology', 'agricultural_science',
  ]) {
    assert.equal(isScienceSubjectKey(key), true, key)
  }
})

check('numeracy is in BOTH contracts, and that is deliberate', () => {
  // CBC "Mathematics and Science" is one integrated learning area, so a Grade 2
  // paper owes both — a column sum and a water molecule can sit on one page.
  assert.equal(isScienceSubjectKey('numeracy'), true)
  assert.ok(SCIENCE_SUBJECT_KEYS.includes('numeracy'))
})

check('a language or humanities subject gets nothing', () => {
  for (const key of ['english', 'social_studies', 'history', 'mathematics']) {
    assert.equal(isScienceSubjectKey(key), false, key)
  }
})

console.log('\nchemical formulae')

check('a formula gains real subscripts', () => {
  assert.equal(repair('Water is H2O and the gas is CO2.'),
    'Water is H<sub>2</sub>O and the gas is CO<sub>2</sub>.')
  assert.equal(repair('Glucose is C6H12O6.'), 'Glucose is C<sub>6</sub>H<sub>12</sub>O<sub>6</sub>.')
  assert.equal(repair('The acid is H2SO4.'), 'The acid is H<sub>2</sub>SO<sub>4</sub>.')
})

check('a COEFFICIENT stays full size — it counts molecules, it is not part of one', () => {
  const out = repair('Photosynthesis: 6CO2 + 6H2O → C6H12O6 + 6O2')
  assert.match(out, /6CO<sub>2<\/sub>/)
  assert.ok(!/<sub>6<\/sub>CO/.test(out), 'the coefficient was subscripted')
})

check('a balanced symbol equation converts completely', () => {
  assert.equal(repair('2H2 + O2 -> 2H2O'),
    '2H<sub>2</sub> + O<sub>2</sub> → 2H<sub>2</sub>O')
})

console.log('\nthe refusals — where a digit after a letter is NOT chemistry')

check('grade, form, question and section labels are never touched', () => {
  for (const text of [
    'Grade 2 pupils in Form 4 must answer.',
    'Question 3 in Section B2 is compulsory.',
    'Answer B2 on the grid.',
    'See Table 2 and Figure 3.',
  ]) {
    assert.equal(repair(text), text, `repair touched: ${text}`)
  }
})

check('a LONE formula converts only when the text has proved it is chemistry', () => {
  // "O2" is a formula in a balanced equation and a label everywhere else. The
  // evidence is a reaction arrow or another real formula in the same field —
  // the same shape as the bare-fraction rule, for the same reason.
  assert.equal(repair('Oxygen gas is O2.'), 'Oxygen gas is O2.')
  assert.match(repair('The gas O2 reacts with H2O.'), /O<sub>2<\/sub>/)
  assert.match(repair('N2 + 3H2 -> 2NH3'), /N<sub>2<\/sub>/)
})

check('a letter that is not an element symbol is never subscripted', () => {
  assert.equal(repair('Point Q2 on the graph, with H2O nearby.').includes('Q<sub>2</sub>'), false)
})

console.log('\narrows, units and degrees')

check('an ASCII arrow becomes a real reaction arrow', () => {
  assert.equal(repair('carbon dioxide + water -> glucose + oxygen'),
    'carbon dioxide + water → glucose + oxygen')
  assert.equal(repair('A --> B'), 'A → B')
  assert.equal(repair('A => B'), 'A → B')
})

check('a reversible arrow is reversible, not one-way', () => {
  // Collapsing ⇌ to → changes the chemistry the question is asking about.
  assert.equal(repair('A <-> B'), 'A ⇌ B')
  assert.equal(repair('A <=> B'), 'A ⇌ B')
})

check('unit exponents become superscripts', () => {
  assert.equal(repair('Speed 9.8 m/s2'), 'Speed 9.8 m/s<sup>2</sup>')
  assert.equal(repair('Volume 25 cm3'), 'Volume 25 cm<sup>3</sup>')
  assert.equal(repair('Area 5 km2'), 'Area 5 km<sup>2</sup>')
})

check('a written-out degree becomes the sign', () => {
  assert.equal(repair('Heat to 30 deg C'), 'Heat to 30 °C')
  assert.equal(repair('Boils at 100 degrees C'), 'Boils at 100 °C')
})

console.log('\ndetection and the floor')

check('detection reports what repair will fix', () => {
  assert.ok(codes('Water is H2O').includes('CHEM_FORMULA_ASCII'))
  assert.ok(codes('A -> B').includes('ARROW_ASCII'))
  assert.ok(codes('9.8 m/s2').includes('UNIT_EXPONENT_ASCII'))
  assert.ok(codes('30 deg C').includes('DEGREE_ASCII'))
})

check('already-correct science reports clean', () => {
  for (const text of [
    'Water is H<sub>2</sub>O.',
    'carbon dioxide + water → glucose + oxygen',
    'Speed 9.8 m/s<sup>2</sup> at 30 °C.',
  ]) {
    assert.deepEqual(codes(text), [], text)
  }
})

check('repair never introduces a new violation', () => {
  for (const source of [
    'Water is H2O and CO2', '2H2 + O2 -> 2H2O',
    'Speed 9.8 m/s2 at 30 deg C', 'A <-> B with H2O',
  ]) {
    const out = repair(source)
    assert.deepEqual(detectScienceViolations(out).violations, [], `${source} → ${out}`)
  }
})

check('ordinary prose is untouched', () => {
  for (const text of [
    'Name two parts of a flower.',
    'Explain how rain forms.',
    'A farmer plants maize in November.',
  ]) {
    assert.equal(repair(text), text)
    assert.deepEqual(codes(text), [])
  }
})

check('the floor degrades markup to legible Unicode, never to tags', () => {
  // A teacher may see unformatted science; they must never see <sub>.
  assert.equal(scienceToPlainText('Water is H<sub>2</sub>O.'), 'Water is H₂O.')
  assert.equal(scienceToPlainText('Speed 9.8 m/s<sup>2</sup>'), 'Speed 9.8 m/s²')
  const out = scienceToPlainText(repair('6CO2 + 6H2O -> C6H12O6'))
  assert.ok(!out.includes('<'), out)
  assert.ok(out.includes('₂') && out.includes('→'), out)
})

console.log(`\n${passed} science-notation checks passed\n`)
