/**
 * paperTerminology tests — the words a Zambian paper is allowed to use (§4.1).
 *
 * What is worth testing here is not that a lookup table looks up. It is:
 *
 *  - every term the owner named is actually present, so the decision is
 *    enforced rather than paraphrased;
 *  - the register really CHANGES with the level, in both directions — a Nursery
 *    paper must not say "Express your answer in its lowest terms" and a Form 4
 *    paper must not be limited to "Colour";
 *  - the curriculum decides its own word, so neither "borrow" nor "regroup" is
 *    hard-coded;
 *  - a missing term resolves to nothing rather than to its key, because
 *    printing `mixedNumber` on a paper is exactly the developer vocabulary this
 *    file exists to keep off it.
 *
 * Run: node src/config/paperTerminology.test.js
 */

import assert from 'node:assert/strict'
import {
  PAPER_TERMS, INSTRUCTION_REGISTER, FORBIDDEN_ON_PAPER, CURRICULA,
  termFor, termsForTopic, allTerms, instructionRegisterFor, normalizeCurriculum,
  buildTerminologyDirective, findForbiddenTerms,
  advancedTermsForLevel, findAdvancedTerms,
} from './paperTerminology.js'
import { ASSESSMENT_BAND_SEED } from './assessmentBands.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`✗ ${name}\n  ${err.message}`)
    process.exitCode = 1
  }
}

/* ── the decision, as assertions ────────────────────────────────────────── */

console.log('\n— every term the decision named —')

test('the classroom vocabulary is all present', () => {
  // Straight from the owner's list. If a term is dropped in a refactor this
  // fails rather than the paper quietly reverting to looser wording.
  const required = [
    'numerator', 'denominator', 'fraction', 'mixed number', 'improper fraction',
    'equivalent fraction', 'simplify', 'lowest terms',
    'divide', 'dividend', 'divisor', 'quotient', 'remainder',
    'working', 'carry',
    'place value', 'ones', 'tens', 'hundreds', 'thousands', 'decimal point',
    'answer', 'Show your working',
  ]
  const declared = allTerms('cbc')
  for (const term of required) {
    assert.ok(declared.includes(term), `"${term}" is declared`)
  }
})

test('both accepted words for crossing a place value are reachable', () => {
  // CBC teaches regrouping; the previous curriculum's materials say borrow, and
  // a teacher trained on those will mark with it. Neither is hard-coded.
  assert.equal(termFor('columnArithmetic', 'regroup', 'cbc'), 'regroup')
  assert.equal(termFor('columnArithmetic', 'regroup', 'obc'), 'borrow')
  assert.ok(allTerms('obc').includes('borrow'))
  assert.ok(!allTerms('obc').includes('regroup'))
})

test('an unknown curriculum falls back to CBC, the current national one', () => {
  assert.equal(normalizeCurriculum('nonsense'), 'cbc')
  assert.equal(normalizeCurriculum(''), 'cbc')
  assert.equal(normalizeCurriculum(null), 'cbc')
  for (const c of CURRICULA) assert.equal(normalizeCurriculum(c), c)
})

test('every spelling the repo already uses resolves to the same curriculum', () => {
  // The generator carries a framework YEAR, the class register says 'previous',
  // and generateAssessment maps year → cbc/obc. A caller must not have to know
  // which spelling its neighbour chose.
  for (const cbc of ['cbc', 'CBC', '2023']) {
    assert.equal(normalizeCurriculum(cbc), 'cbc', String(cbc))
  }
  for (const obc of ['obc', 'OBC', 'previous', '2013']) {
    assert.equal(normalizeCurriculum(obc), 'obc', String(obc))
  }
  // And the word each one picks follows.
  assert.equal(termFor('columnArithmetic', 'regroup', '2013'), 'borrow')
  assert.equal(termFor('columnArithmetic', 'regroup', '2023'), 'regroup')
})

test('a term we do not have resolves to nothing, never to its key', () => {
  // Printing `mixedNumber` on a paper is the developer vocabulary this file
  // exists to prevent, so a miss must be empty rather than a fallback to the key.
  assert.equal(termFor('fractions', 'nope'), '')
  assert.equal(termFor('nope', 'numerator'), '')
  assert.deepEqual(termsForTopic('nope'), [])
  for (const term of allTerms('cbc')) {
    assert.ok(!/[a-z][A-Z]/.test(term), `"${term}" is not camelCase`)
  }
})

/* ── the register changes with the level ────────────────────────────────── */

console.log('\n— the same idea, the right words for the reader —')

test('every band\'s formality has a register declared', () => {
  // The ladder is declared once, in assessmentBands.js. A band whose formality
  // has no register would silently fall back to "standard" — fine as a
  // safety net, wrong as a way of shipping a level.
  for (const [name, band] of Object.entries(ASSESSMENT_BAND_SEED)) {
    assert.ok(
      INSTRUCTION_REGISTER[band.instructionFormality],
      `${name} declares formality "${band.instructionFormality}" — no register for it`,
    )
  }
})

test('a Nursery paper is never asked to express anything in lowest terms', () => {
  const spoken = instructionRegisterFor('spoken')
  const all = [...spoken.verbs, ...spoken.phrases].join(' ').toLowerCase()
  assert.ok(!all.includes('lowest terms'), all)
  assert.ok(!all.includes('significant figures'), all)
  assert.ok(!all.includes('justify'), all)
  assert.ok(spoken.verbs.includes('Work out'), 'and it does get "Work out"')
  assert.ok(spoken.verbs.includes('Share equally'), 'and "Share equally"')
})

test('…and a Form 4 paper is not limited to colouring in', () => {
  const exam = instructionRegisterFor('examination')
  assert.ok(!exam.verbs.includes('Colour'), 'no Colour at examination level')
  assert.ok(exam.verbs.includes('Calculate'))
  assert.ok(exam.phrases.some((p) => /lowest terms/.test(p)))
})

test('the register really differs between the two ends', () => {
  const young = instructionRegisterFor('spoken').verbs
  const old = instructionRegisterFor('examination').verbs
  const shared = young.filter((v) => old.includes(v))
  assert.equal(shared.length, 0, `the ends share nothing: got ${shared.join(', ')}`)
})

test('an unrecognised formality is standard, not empty', () => {
  // A level we have not tiered must still produce usable wording.
  const fallback = instructionRegisterFor('made-up')
  assert.deepEqual(fallback, INSTRUCTION_REGISTER.standard)
  assert.deepEqual(instructionRegisterFor(null), INSTRUCTION_REGISTER.standard)
})

/* ── the prompt directive ───────────────────────────────────────────────── */

console.log('\n— what the generator is told —')

test('the directive carries the level\'s register and the curriculum\'s word', () => {
  const cbc = buildTerminologyDirective({ formality: 'standard', curriculum: 'cbc', subject: 'Mathematics' })
  assert.match(cbc, /regroup/)
  assert.ok(!/\bborrow\b/.test(cbc), 'and not the other curriculum\'s word')

  const prev = buildTerminologyDirective({ formality: 'standard', curriculum: 'obc', subject: 'Mathematics' })
  assert.match(prev, /borrow/)
  assert.ok(!/\bregroup\b/.test(prev))
})

test('the directive is graded by level', () => {
  const young = buildTerminologyDirective({ formality: 'spoken', subject: 'Mathematics' })
  const old = buildTerminologyDirective({ formality: 'examination', subject: 'Mathematics' })
  assert.match(young, /Share equally/)
  assert.ok(!/lowest terms/.test(young), 'no examination phrasing at Nursery')
  assert.match(old, /lowest terms/)
})

test('the maths vocabulary is not spent on an English paper', () => {
  const english = buildTerminologyDirective({ formality: 'standard', subject: 'English' })
  assert.ok(!/numerator/.test(english), 'no fraction vocabulary on an English paper')
  const maths = buildTerminologyDirective({ formality: 'standard', subject: 'Mathematics' })
  assert.match(maths, /numerator/)
})

test('the directive always forbids our own machinery by name', () => {
  for (const formality of Object.keys(INSTRUCTION_REGISTER)) {
    const directive = buildTerminologyDirective({ formality })
    for (const term of FORBIDDEN_ON_PAPER) {
      assert.ok(directive.includes(term), `${formality}: forbids "${term}"`)
    }
  }
})

/* ── syllabus wording must not walk down a level ────────────────────────── */

console.log('\n— advanced terminology stays where it belongs —')

test('a syllabus outcome may say "denominator"; a Nursery question may not', () => {
  // The loophole this closes. An approved outcome — "Add fractions with the same
  // denominator" — is what the curriculum wrote, and the application has no
  // business rewriting it. It travels into the prompt as planning context. What
  // must not happen is the model copying that wording into the question.
  const outcome = 'Add fractions with the same denominator'
  assert.deepEqual(findAdvancedTerms(outcome, 'spoken'), ['denominator'])
  // …and at a level that carries fraction vocabulary, the same wording is fine.
  assert.deepEqual(findAdvancedTerms(outcome, 'standard'), [])
})

test('the check is precise enough to be worth having', () => {
  // "ones", "carry", "divide", "working" and "answer" are ordinary English. A
  // Nursery paper saying "Circle the red ones" is not using place-value
  // vocabulary, and a checker that said so would be switched off.
  const ordinary = [
    'Circle the red ones.',
    'Carry the box to the table.',
    'Divide the sweets between the two children.',
    'Write your answer in the box.',
    'Show your working.',
  ]
  for (const text of ordinary) {
    assert.deepEqual(findAdvancedTerms(text, 'spoken'), [], text)
  }
})

test('a term technical in one curriculum only is judged per curriculum', () => {
  // CBC's "regroup" has no other meaning. OBC's "borrow" is what you do with a
  // pencil, so flagging it would report a problem the paper does not have.
  assert.ok(advancedTermsForLevel('spoken', 'cbc').includes('regroup'))
  assert.ok(!advancedTermsForLevel('spoken', 'obc').includes('borrow'))
  assert.deepEqual(findAdvancedTerms('You may borrow a pencil.', 'spoken', 'obc'), [])
  assert.deepEqual(findAdvancedTerms('Regroup the tens.', 'spoken', 'cbc'), ['regroup'])
})

test('the top of the ladder has nothing left to leak', () => {
  // Upper primary and above carry every topic, so there is no advanced wording
  // to detect — the check is level-relative, not a global banned list.
  for (const formality of ['standard', 'formal', 'examination']) {
    assert.deepEqual(advancedTermsForLevel(formality), [], formality)
  }
  assert.ok(advancedTermsForLevel('spoken').length > 0, 'and plenty at Nursery')
})

test('lower primary carries place value but not fractions', () => {
  const simple = advancedTermsForLevel('simple')
  assert.ok(!simple.includes('place value'), 'place value is taught here')
  assert.ok(simple.includes('denominator'), 'fraction vocabulary is not')
})

test('nothing in, nothing flagged', () => {
  assert.deepEqual(findAdvancedTerms('', 'spoken'), [])
  assert.deepEqual(findAdvancedTerms(null, 'spoken'), [])
  assert.deepEqual(findAdvancedTerms('Anything', 'made-up'), [],
    'an unknown level falls back to standard, which permits everything')
})

/* ── the leak detector ──────────────────────────────────────────────────── */

console.log('\n— internal terms never reach the paper —')

test('every forbidden term is detected in rendered output', () => {
  for (const term of FORBIDDEN_ON_PAPER) {
    assert.deepEqual(
      findForbiddenTerms(`<p>Question 1. The ${term} is wrong.</p>`), [term],
      `"${term}" is caught`,
    )
  }
})

test('casing does not let one through', () => {
  assert.deepEqual(findForbiddenTerms('a latex diagram'), ['LaTeX'])
  assert.deepEqual(findForbiddenTerms('an svg figure'), ['SVG'])
})

test('an ordinary paper reports nothing', () => {
  const paper = 'Simplify 6/8 and give your answer in its lowest terms. '
    + 'Show your working. Name the parts of the heart.'
  assert.deepEqual(findForbiddenTerms(paper), [])
  assert.deepEqual(findForbiddenTerms(''), [])
  assert.deepEqual(findForbiddenTerms(null), [])
})

test('a word that merely contains a forbidden one is not a leak', () => {
  // Word-boundary matched: a paper about the Latvian flag does not report LaTeX,
  // and a checker that cried wolf would be turned off.
  assert.deepEqual(findForbiddenTerms('The Latvian flag'), [])
  assert.deepEqual(findForbiddenTerms('svgs'), [])
})

test('nothing in the declared vocabulary is itself forbidden', () => {
  // A term that was both required and banned would make every paper fail.
  for (const curriculum of CURRICULA) {
    for (const term of allTerms(curriculum)) {
      assert.deepEqual(findForbiddenTerms(term), [], `"${term}" is not forbidden`)
    }
  }
  for (const register of Object.values(INSTRUCTION_REGISTER)) {
    for (const phrase of [...register.verbs, ...register.phrases]) {
      assert.deepEqual(findForbiddenTerms(phrase), [], `"${phrase}" is not forbidden`)
    }
  }
})

/* ── shape ──────────────────────────────────────────────────────────────── */

console.log('\n— the config holds together —')

test('every declared term is a real word, not a placeholder', () => {
  for (const [topic, group] of Object.entries(PAPER_TERMS)) {
    for (const [key, entry] of Object.entries(group)) {
      const resolved = CURRICULA.map((c) => termFor(topic, key, c))
      for (const value of resolved) {
        assert.ok(value && value.trim().length > 1, `${topic}.${key} resolves to "${value}"`)
      }
    }
  }
})

console.log(`\n✓ paper terminology — ${passed} tests passed`)
