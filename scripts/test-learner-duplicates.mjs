#!/usr/bin/env node
/**
 * Tests for src/utils/learnerDuplicates.js — deciding whether two rows on a
 * class list are the same child. Pure logic; no Firebase, no DOM.
 * Run: npm run test:learner-duplicates  (also via npm run test:all)
 */

const {
  normalizeLearnerName,
  nameTokens,
  learnerNameKey,
  editDistance,
  nameSimilarity,
  samePhone,
  compareLearners,
  findDuplicatePairs,
  duplicateLearnerIds,
  mergeLearners,
} = await import('../src/utils/learnerDuplicates.js')

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail += 1
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

// ── name normalisation ───────────────────────────────────────────

console.log('\nname normalisation')

test('folds case, accents, punctuation and whitespace', () => {
  eq(normalizeLearnerName('  Chanda   MULENGA '), 'chanda mulenga')
  eq(normalizeLearnerName('Nakazwé'), 'nakazwe')
  eq(normalizeLearnerName("O'Brien"), 'obrien')
  eq(normalizeLearnerName('Mary-Jane Banda'), 'mary jane banda')
})

test('drops honorifics', () => {
  eq(nameTokens('Master John Phiri').join(' '), 'john phiri')
})

test('name key ignores word order — Zambian lists are written both ways', () => {
  eq(learnerNameKey('Mulenga Chanda'), learnerNameKey('Chanda Mulenga'))
  assert(learnerNameKey('Chanda Mulenga') !== learnerNameKey('Chanda Banda'))
})

test('empty input never produces a matching key', () => {
  eq(learnerNameKey(''), '')
  eq(learnerNameKey(null), '')
})

// ── similarity ───────────────────────────────────────────────────

console.log('\nsimilarity')

test('edit distance is capped and symmetric', () => {
  eq(editDistance('mulenga', 'mulenga'), 0)
  eq(editDistance('mulenga', 'mulenge'), 1)
  eq(editDistance('abc', 'xyz', 1), 2)
})

test('an initial stands for the name it abbreviates, but only partly', () => {
  // Both full tokens match exactly and the initial carries the third, so the
  // pair scores high — high enough to be offered — without the initial being
  // treated as certainty.
  const score = nameSimilarity('Chanda M. Mulenga', 'Chanda Mateo Mulenga')
  assert(score >= 0.8, `expected a strong score, got ${score}`)
  assert(score < 1, 'an initial is not proof that two names are the same')
})

test('an initial does not make every name sharing that letter a duplicate', () => {
  // The failure this guards: a single letter matches Musonda, Mwansa, Mwila
  // and every other M on the register. Scoring it as a full token offered a
  // teacher three "duplicates" that were three different children.
  for (const other of ['Chanda Musonda', 'Mwansa Chanda', 'Mwansa Mulenga']) {
    const result = compareLearners({ fullName: 'Chanda M. Mulenga' }, { fullName: other })
    eq(result.duplicate, false, `"Chanda M. Mulenga" must not match "${other}"`)
  }
})

test('an exact token is never spent on an initial that came first', () => {
  // "mulenga" reaches "m" before it reaches "mulenga" in a single greedy
  // pass; spending itself on the initial scored a real pair below two
  // strangers. Exact matches are claimed first.
  const score = nameSimilarity('Chanda Mulenga', 'Chanda M. Mulenga')
  assert(score >= 0.66, `expected both full tokens to match, got ${score}`)
})

test('one shared given name is weak evidence, not certainty', () => {
  const score = nameSimilarity('Chanda', 'Chanda Mulenga Banda')
  assert(score < 0.4, `expected a low score for one shared token, got ${score}`)
})

test('a repeated token cannot claim the same token twice', () => {
  // Without one-to-one matching "Mary Mary" would score a perfect match.
  const score = nameSimilarity('Mary Mary', 'Mary Banda')
  assert(score <= 0.5, `expected at most 0.5, got ${score}`)
})

test('short names do not tolerate a typo', () => {
  eq(nameSimilarity('Ben', 'Bea'), 0)
})

test('phones compare on the last nine digits', () => {
  assert(samePhone('0977123456', '+260977123456'))
  assert(samePhone('260977123456', '0977123456'))
  assert(!samePhone('0977123456', '0966555444'))
  assert(!samePhone('123', '123'), 'too-short numbers never match')
})

// ── the core rule ────────────────────────────────────────────────

console.log('\nduplicate decisions')

test('the same admission number settles it, and only it links without asking', () => {
  const r = compareLearners(
    { fullName: 'Chanda Mulenga', admissionNumber: 'ADM-004' },
    { fullName: 'C. Mulenga', admissionNumber: 'ADM-004' },
  )
  assert(r.duplicate)
  eq(r.confidence, 'same_admission_number')
  eq(r.canLinkWithoutAsking, true)
})

test('identical names alone are LIKELY and never auto-linked', () => {
  const r = compareLearners({ fullName: 'Chanda Mulenga' }, { fullName: 'Chanda Mulenga' })
  assert(r.duplicate)
  eq(r.confidence, 'likely')
  eq(r.canLinkWithoutAsking, false, 'names alone must never merge automatically (§8)')
})

test('identical names plus a corroborating fact are VERY LIKELY', () => {
  const r = compareLearners(
    { fullName: 'Chanda Mulenga', dateOfBirth: '2016-03-04' },
    { fullName: 'Chanda Mulenga', dateOfBirth: '2016-03-04' },
  )
  eq(r.confidence, 'very_likely')
  eq(r.canLinkWithoutAsking, false)
})

test('different admission numbers mean two children, whatever the names say', () => {
  const r = compareLearners(
    { fullName: 'Chanda Mulenga', admissionNumber: 'ADM-004' },
    { fullName: 'Chanda Mulenga', admissionNumber: 'ADM-051' },
  )
  eq(r.duplicate, false, 'real namesakes must not be reported as duplicates')
  assert(r.conflicts.includes('admission_number'))
})

test('a different date of birth or gender also separates them', () => {
  eq(compareLearners(
    { fullName: 'Ruth Mwila', dateOfBirth: '2015-01-01' },
    { fullName: 'Ruth Mwila', dateOfBirth: '2016-01-01' },
  ).duplicate, false)
  eq(compareLearners(
    { fullName: 'Bright Kapaso', gender: 'M' },
    { fullName: 'Bright Kapaso', gender: 'F' },
  ).duplicate, false)
})

test('an abbreviated name is POSSIBLE — worth asking, not worth acting on', () => {
  const r = compareLearners({ fullName: 'Chanda Mulenga' }, { fullName: 'Chanda M. Mulenga' })
  assert(r.duplicate)
  assert(['likely', 'possible'].includes(r.confidence), `got ${r.confidence}`)
  eq(r.canLinkWithoutAsking, false)
})

test('unrelated learners are not duplicates', () => {
  eq(compareLearners({ fullName: 'Alex Lobela' }, { fullName: 'Naomi Chipeta' }).duplicate, false)
})

test('conflicts are reported even when the names match exactly', () => {
  const r = compareLearners(
    { fullName: 'Chanda Mulenga', admissionNumber: 'A1' },
    { fullName: 'Chanda Mulenga', admissionNumber: 'A2' },
  )
  assert(r.agreements.includes('name'), 'the name agreement is still stated')
  assert(r.conflicts.includes('admission_number'))
})

// ── whole-list scan ──────────────────────────────────────────────

console.log('\nwhole-list scan')

const CLASS = [
  { id: '1', fullName: 'Alex Lobela', admissionNumber: 'ADM-001' },
  { id: '2', fullName: 'Bright Kapaso', admissionNumber: 'ADM-002' },
  { id: '3', fullName: 'Chanda Mulenga', admissionNumber: 'ADM-004' },
  { id: '4', fullName: 'Chanda M. Mulenga' },
  { id: '5', fullName: 'Ruth Mwila', admissionNumber: 'ADM-005' },
  { id: '6', fullName: 'Ruth Mwila', admissionNumber: 'ADM-077' },
]

test('finds the real pair and leaves the namesakes alone', () => {
  const pairs = findDuplicatePairs(CLASS)
  const ids = pairs.map((p) => [p.a.id, p.b.id].join('-'))
  assert(ids.includes('3-4'), `expected the abbreviated pair, got ${JSON.stringify(ids)}`)
  assert(!ids.includes('5-6'), 'two Ruth Mwilas with different admission numbers are two learners')
})

test('duplicate ids power the Class List filter', () => {
  const ids = duplicateLearnerIds(CLASS)
  assert(ids.has('3') && ids.has('4'))
  assert(!ids.has('1'))
})

test('the scan is stable at class size', () => {
  const big = Array.from({ length: 150 }, (_, i) => ({
    id: String(i),
    fullName: `Learner ${i} Banda`,
    admissionNumber: `ADM-${String(i).padStart(3, '0')}`,
  }))
  const started = Date.now()
  const pairs = findDuplicatePairs(big)
  const elapsed = Date.now() - started
  eq(pairs.length, 0, 'distinct learners produce no pairs')
  assert(elapsed < 1000, `150-learner scan took ${elapsed}ms`)
})

test('empty and malformed input never throws', () => {
  eq(findDuplicatePairs(null).length, 0)
  eq(findDuplicatePairs([{}, {}]).length, 0)
})

// ── merging ──────────────────────────────────────────────────────

console.log('\nmerging')

test('merge fills gaps and never overwrites what the keeper already has', () => {
  const { merged, filledFrom } = mergeLearners(
    { id: 'keep', fullName: 'Chanda Mulenga', admissionNumber: 'ADM-004', gender: null },
    { id: 'drop', fullName: 'Chanda M. Mulenga', admissionNumber: 'ADM-999', gender: 'F', parentPhone: '0977123456' },
  )
  eq(merged.id, 'keep')
  eq(merged.admissionNumber, 'ADM-004', 'the keeper’s own value survives')
  eq(merged.gender, 'F', 'a gap is filled from the dropped record')
  eq(merged.parentPhone, '0977123456')
  assert(filledFrom.includes('gender') && filledFrom.includes('parentPhone'))
  assert(!filledFrom.includes('admissionNumber'))
})

test('merging clears the duplicate flag but keeps other open questions', () => {
  const { merged } = mergeLearners(
    { id: 'a', fullName: 'X', needsReview: true, reviewReasons: ['possible_duplicate'] },
    { id: 'b', fullName: 'X', needsReview: false, reviewReasons: [] },
  )
  eq(merged.needsReview, false)
  eq(merged.reviewReasons.length, 0)

  const second = mergeLearners(
    { id: 'a', fullName: 'X', needsReview: true, reviewReasons: ['possible_duplicate', 'low_confidence'] },
    { id: 'b', fullName: 'X' },
  ).merged
  eq(second.needsReview, true)
  eq(second.reviewReasons.join(','), 'low_confidence')
})

// ── summary ──────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.message}`))
  process.exit(1)
}
