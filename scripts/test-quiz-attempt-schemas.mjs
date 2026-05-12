#!/usr/bin/env node
/**
 * Tests for the Quiz + Attempt schemas and their coerce helpers.
 * Run: npm run test:schemas-domain  (also via npm run test:all)
 *
 * No DOM needed — both modules are pure data validators.
 */

const { quizWriteSchema, quizUpdateSchema, coerceQuiz } = await import('../src/schemas/quiz.js')
const { attemptStartSchema, attemptSubmitSchema, coerceAttempt } = await import('../src/schemas/attempt.js')
const { numericMatches } = await import('../src/utils/numericGrading.js')
const { hotspotMatches } = await import('../src/utils/hotspotGrading.js')

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function validQuiz() {
  return {
    title: 'Grade 5 Mathematics — Term 1',
    subject: 'Mathematics',
    grade: '5',
    term: '1',
    description: 'Fractions and decimals practice.',
    passages: [],
    parts: [],
    passageCount: 0,
    totalMarks: 20,
    questionCount: 10,
    isPublished: true,
    status: 'published',
    createdBy: 'admin_user_id_1',
    quizType: 'practice',
  }
}

function validAttemptStart() {
  return {
    userId: 'learner_user_id_1',
    displayName: 'Test Learner',
    examId: 'exam_doc_id_1',
    subject: 'Mathematics',
    grade: '5',
    attemptDate: '2026-05-12',
    status: 'in_progress',
    startedAt: { __sentinel: 'serverTimestamp' },
    endTime: Date.now() + 30 * 60 * 1000,
    submittedAt: null,
    answers: {},
    flagged: [],
    currentSectionIndex: 0,
    score: null,
    totalMarks: 20,
    percentage: null,
    timeTakenSeconds: null,
  }
}

// ── quizWriteSchema ──────────────────────────────────────────────

console.log('\nquizWriteSchema (valid records)')

test('canonical quiz passes', () => {
  const parsed = quizWriteSchema.safeParse(validQuiz())
  assert(parsed.success, parsed.error?.issues?.[0]?.message)
})

test('grade may be a number', () => {
  const parsed = quizWriteSchema.safeParse({ ...validQuiz(), grade: 5 })
  assert(parsed.success, parsed.error?.issues?.[0]?.message)
})

test('passes through unknown fields (passthrough)', () => {
  const parsed = quizWriteSchema.safeParse({ ...validQuiz(), customAdminFlag: true })
  assert(parsed.success, parsed.error?.issues?.[0]?.message)
  assert(parsed.data.customAdminFlag === true, 'passthrough field should survive')
})

test('passages with valid shape pass', () => {
  const parsed = quizWriteSchema.safeParse({
    ...validQuiz(),
    passages: [{ id: 'p1', title: 'Story 1', passageText: 'Once upon a time…', order: 0 }],
  })
  assert(parsed.success, parsed.error?.issues?.[0]?.message)
})

console.log('\nquizWriteSchema (rejection cases)')

test('rejects missing title', () => {
  const { title: _t, ...rest } = validQuiz()
  const parsed = quizWriteSchema.safeParse(rest)
  assert(!parsed.success, 'missing title should reject')
})

test('rejects empty title', () => {
  const parsed = quizWriteSchema.safeParse({ ...validQuiz(), title: '' })
  assert(!parsed.success, 'empty title should reject')
})

test('rejects bad status enum', () => {
  const parsed = quizWriteSchema.safeParse({ ...validQuiz(), status: 'archived' })
  assert(!parsed.success, 'archived status should reject')
})

test('rejects passage without id', () => {
  const parsed = quizWriteSchema.safeParse({
    ...validQuiz(),
    passages: [{ title: 'Story 1', passageText: 'No id here' }],
  })
  assert(!parsed.success, 'passage without id should reject')
})

test('rejects totalMarks above cap', () => {
  const parsed = quizWriteSchema.safeParse({ ...validQuiz(), totalMarks: 99_999 })
  assert(!parsed.success, 'absurd totalMarks should reject')
})

// ── quizUpdateSchema (partial) ───────────────────────────────────

console.log('\nquizUpdateSchema (partial updates)')

test('empty patch passes', () => {
  const parsed = quizUpdateSchema.safeParse({})
  assert(parsed.success, parsed.error?.issues?.[0]?.message)
})

test('single field patch passes', () => {
  const parsed = quizUpdateSchema.safeParse({ isPublished: true })
  assert(parsed.success, parsed.error?.issues?.[0]?.message)
})

test('partial still rejects bad enum', () => {
  const parsed = quizUpdateSchema.safeParse({ status: 'whatever' })
  assert(!parsed.success, 'partial should still validate types of present fields')
})

// ── coerceQuiz ───────────────────────────────────────────────────

console.log('\ncoerceQuiz')

test('returns null for null input', () => {
  assert(coerceQuiz(null) === null, 'expected null')
})

test('returns null for non-object input', () => {
  assert(coerceQuiz('quiz') === null, 'expected null for string')
  assert(coerceQuiz(42) === null, 'expected null for number')
  assert(coerceQuiz([]) === null, 'expected null for array')
})

test('non-array passages coerces to []', () => {
  const out = coerceQuiz({ passages: { foo: 'bar' } })
  assert(Array.isArray(out.passages), 'passages must be an array')
  assert(out.passages.length === 0, 'expected empty array')
})

test('non-array parts coerces to []', () => {
  const out = coerceQuiz({ parts: null })
  assert(Array.isArray(out.parts), 'parts must be an array')
  assert(out.parts.length === 0, 'expected empty array')
})

test('passages with malformed entries are filtered', () => {
  const out = coerceQuiz({
    passages: [
      null,
      'a string',
      { id: 'p1', passageText: 'Real one' },
      { passageText: 'Missing id — should be dropped' },
      { id: 'p2', passageText: 'Another real one' },
    ],
  })
  assert(out.passages.length === 2, `expected 2 valid passages, got ${out.passages.length}`)
  assert(out.passages[0].id === 'p1')
  assert(out.passages[1].id === 'p2')
})

test('passageCount falls back to passages.length', () => {
  const out = coerceQuiz({ passages: [{ id: 'p1' }, { id: 'p2' }] })
  assert(out.passageCount === 2, `expected 2, got ${out.passageCount}`)
})

test('preserves passthrough fields', () => {
  const out = coerceQuiz({ title: 'X', customField: 'preserve me', passages: [] })
  assert(out.customField === 'preserve me')
  assert(out.title === 'X')
})

test('coerces totalMarks string to number', () => {
  const out = coerceQuiz({ totalMarks: '25' })
  assert(out.totalMarks === 25, `expected 25, got ${out.totalMarks}`)
})

// ── attemptStartSchema ──────────────────────────────────────────

console.log('\nattemptStartSchema')

test('canonical start attempt passes', () => {
  const parsed = attemptStartSchema.safeParse(validAttemptStart())
  assert(parsed.success, parsed.error?.issues?.[0]?.message)
})

test('rejects answers as an array', () => {
  const parsed = attemptStartSchema.safeParse({ ...validAttemptStart(), answers: [] })
  assert(!parsed.success, 'answers must be a record (object), not array')
})

test('rejects status = submitted on start', () => {
  const parsed = attemptStartSchema.safeParse({ ...validAttemptStart(), status: 'submitted' })
  assert(!parsed.success, 'start should reject submitted status')
})

test('rejects negative endTime', () => {
  const parsed = attemptStartSchema.safeParse({ ...validAttemptStart(), endTime: -1 })
  assert(!parsed.success, 'endTime must be positive')
})

// ── attemptSubmitSchema ─────────────────────────────────────────

console.log('\nattemptSubmitSchema')

test('canonical submit patch passes', () => {
  const parsed = attemptSubmitSchema.safeParse({
    status: 'submitted',
    answers: { q1: 0, q2: 1 },
    score: 18,
    totalMarks: 20,
    totalQuestions: 10,
    percentage: 90,
    timeTakenSeconds: 1200,
    submittedAt: { __sentinel: 'serverTimestamp' },
    topicBreakdown: {},
    strengths: ['Fractions'],
    weaknesses: [],
    performanceLevel: 'Excellent',
    feedback: { can: 'great', developing: 'none', practice: 'maintain' },
  })
  assert(parsed.success, parsed.error?.issues?.[0]?.message)
})

test('rejects percentage above 100', () => {
  const parsed = attemptSubmitSchema.safeParse({
    status: 'submitted',
    answers: {},
    score: 0,
    totalMarks: 0,
    totalQuestions: 0,
    percentage: 101,
    timeTakenSeconds: 0,
    submittedAt: 0,
    performanceLevel: 'X',
    feedback: { can: '', developing: '', practice: '' },
  })
  assert(!parsed.success, 'percentage > 100 should reject')
})

// ── coerceAttempt ───────────────────────────────────────────────

console.log('\ncoerceAttempt')

test('returns null for null input', () => {
  assert(coerceAttempt(null) === null, 'expected null')
})

test('returns null for an array (the PR #379 bug shape)', () => {
  assert(coerceAttempt([]) === null, 'expected null for array')
})

test('answers as array coerces to {}', () => {
  const out = coerceAttempt({ answers: [{ id: 'q1', value: 'A' }] })
  assert(typeof out.answers === 'object' && !Array.isArray(out.answers))
  assert(Object.keys(out.answers).length === 0)
})

test('answers as null coerces to {}', () => {
  const out = coerceAttempt({ answers: null })
  assert(typeof out.answers === 'object' && !Array.isArray(out.answers))
})

test('valid answers map survives', () => {
  const out = coerceAttempt({ answers: { q1: 0, q2: 'C' } })
  assert(out.answers.q1 === 0)
  assert(out.answers.q2 === 'C')
})

test('flagged as legacy object map converts to keys', () => {
  const out = coerceAttempt({ flagged: { q1: true, q2: false, q3: true } })
  assert(Array.isArray(out.flagged))
  assert(out.flagged.length === 2, `expected 2 truthy keys, got ${out.flagged.length}`)
  assert(out.flagged.includes('q1'))
  assert(out.flagged.includes('q3'))
})

test('flagged as array survives', () => {
  const out = coerceAttempt({ flagged: ['q1', 'q2'] })
  assert(out.flagged.length === 2)
  assert(out.flagged[0] === 'q1')
})

test('flagged with non-string entries filtered', () => {
  const out = coerceAttempt({ flagged: ['q1', 42, null, '', 'q2'] })
  assert(out.flagged.length === 2, `expected 2, got ${out.flagged.length}`)
  assert(out.flagged.includes('q1'))
  assert(out.flagged.includes('q2'))
})

test('currentSectionIndex non-finite coerces to 0', () => {
  const out = coerceAttempt({ currentSectionIndex: NaN })
  assert(out.currentSectionIndex === 0)
})

test('status unknown coerces to in_progress', () => {
  const out = coerceAttempt({ status: 'archived' })
  assert(out.status === 'in_progress')
})

test('preserves passthrough fields', () => {
  const out = coerceAttempt({
    examId: 'e1',
    status: 'submitted',
    customField: 'preserve',
    score: 99,
  })
  assert(out.customField === 'preserve')
  assert(out.examId === 'e1')
  assert(out.score === 99)
  assert(out.status === 'submitted')
})

// ── numericMatches (server-authoritative grading) ───────────────

console.log('\nnumericMatches')

test('exact match passes with tolerance=0', () => {
  assert(numericMatches(3.14, 3.14, 0) === true)
})

test('within ±tolerance passes', () => {
  assert(numericMatches(3.15, 3.14, 0.01) === true)
  assert(numericMatches(3.13, 3.14, 0.01) === true)
})

test('outside ±tolerance fails', () => {
  assert(numericMatches(3.2, 3.14, 0.01) === false)
  assert(numericMatches(3.0, 3.14, 0.05) === false)
})

test('parses numeric strings', () => {
  assert(numericMatches('3.14', 3.14, 0) === true)
  assert(numericMatches('3.15', 3.14, 0.01) === true)
})

test('unwraps { value } object form (runner local-check shape)', () => {
  assert(numericMatches({ value: 3.14 }, 3.14, 0) === true)
  assert(numericMatches({ value: 3.15 }, 3.14, 0.01) === true)
})

test('rejects non-numeric input', () => {
  assert(numericMatches('hello', 3.14, 0) === false)
  assert(numericMatches(null, 3.14, 0) === false)
  assert(numericMatches(undefined, 3.14, 0) === false)
  assert(numericMatches(NaN, 3.14, 0) === false)
})

test('negative tolerance clamps to 0 (exact match only)', () => {
  assert(numericMatches(3.15, 3.14, -1) === false)
  assert(numericMatches(3.14, 3.14, -1) === true)
})

test('undefined tolerance treated as 0', () => {
  assert(numericMatches(3.14, 3.14, undefined) === true)
  assert(numericMatches(3.15, 3.14, undefined) === false)
})

test('handles integer answers correctly', () => {
  assert(numericMatches(42, 42, 0) === true)
  assert(numericMatches('42', 42, 0) === true)
  assert(numericMatches(43, 42, 1) === true)
  assert(numericMatches(44, 42, 1) === false)
})

test('empty/whitespace string does NOT grade as 0 (no silent credit)', () => {
  // Number('') === 0 would otherwise hand a learner free marks on any
  // numeric question whose correctAnswer is 0.
  assert(numericMatches('', 0, 0) === false)
  assert(numericMatches('   ', 0, 0) === false)
  assert(numericMatches({ value: '' }, 0, 0) === false)
  // But '0' should still grade correctly — it's a real answer.
  assert(numericMatches('0', 0, 0) === true)
})

test('classic FP trap: 0.1 + 0.2 grades as 0.3 with zero tolerance', () => {
  // 0.1 + 0.2 === 0.30000000000000004 in IEEE 754. The slack lets the
  // teacher set tolerance=0 without learners getting penalised for it.
  assert(numericMatches(0.1 + 0.2, 0.3, 0) === true)
})

test('whitespace around numeric strings is tolerated', () => {
  assert(numericMatches('  3.14  ', 3.14, 0) === true)
  assert(numericMatches('\t-2.5\n', -2.5, 0) === true)
})

test('scientific notation strings parse correctly', () => {
  assert(numericMatches('1e2', 100, 0) === true)
  assert(numericMatches('1.5e-3', 0.0015, 0) === true)
})

test('negative numbers grade with tolerance correctly', () => {
  assert(numericMatches(-3.14, -3.14, 0) === true)
  assert(numericMatches(-3.13, -3.14, 0.01) === true)
  assert(numericMatches(-3.2, -3.14, 0.01) === false)
})

// ── hotspotMatches (server-authoritative grading) ──────────────

console.log('\nhotspotMatches')

const HOTSPOT_REGION = { x: 0.5, y: 0.5, radius: 0.1 }

test('tap at exact centre passes', () => {
  assert(hotspotMatches({ x: 0.5, y: 0.5 }, HOTSPOT_REGION) === true)
})

test('tap within radius passes', () => {
  assert(hotspotMatches({ x: 0.55, y: 0.52 }, HOTSPOT_REGION) === true)
  assert(hotspotMatches({ x: 0.45, y: 0.48 }, HOTSPOT_REGION) === true)
})

test('tap just inside the radius passes', () => {
  // distance = √(0.07² + 0.07²) ≈ 0.099 < 0.1
  assert(hotspotMatches({ x: 0.57, y: 0.57 }, HOTSPOT_REGION) === true)
})

test('tap just outside the radius fails', () => {
  // distance = √(0.08² + 0.08²) ≈ 0.113 > 0.1
  assert(hotspotMatches({ x: 0.58, y: 0.58 }, HOTSPOT_REGION) === false)
})

test('tap well outside fails', () => {
  assert(hotspotMatches({ x: 0.0, y: 0.0 }, HOTSPOT_REGION) === false)
  assert(hotspotMatches({ x: 1.0, y: 1.0 }, HOTSPOT_REGION) === false)
})

test('missing tap returns false', () => {
  assert(hotspotMatches(null, HOTSPOT_REGION) === false)
  assert(hotspotMatches(undefined, HOTSPOT_REGION) === false)
  assert(hotspotMatches({}, HOTSPOT_REGION) === false)
  assert(hotspotMatches({ x: 0.5 }, HOTSPOT_REGION) === false)
})

test('missing region returns false', () => {
  assert(hotspotMatches({ x: 0.5, y: 0.5 }, null) === false)
  assert(hotspotMatches({ x: 0.5, y: 0.5 }, {}) === false)
})

test('out-of-range tap coords return false', () => {
  // A bad legacy doc with x = -0.1 or 1.2 should not silently pass.
  assert(hotspotMatches({ x: -0.1, y: 0.5 }, HOTSPOT_REGION) === false)
  assert(hotspotMatches({ x: 1.2,  y: 0.5 }, HOTSPOT_REGION) === false)
})

test('negative radius returns false', () => {
  assert(hotspotMatches({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5, radius: -0.1 }) === false)
})

test('zero radius requires exact tap', () => {
  const exact = { x: 0.5, y: 0.5, radius: 0 }
  assert(hotspotMatches({ x: 0.5, y: 0.5 }, exact) === true)
  assert(hotspotMatches({ x: 0.51, y: 0.5 }, exact) === false)
})

test('numeric-string coords are coerced', () => {
  // The runner stores tap coords as numbers, but a doc round-tripped
  // through a JSON layer that strings everything (some legacy CSVs)
  // should still grade correctly.
  assert(hotspotMatches({ x: '0.5', y: '0.5' }, HOTSPOT_REGION) === true)
  assert(hotspotMatches({ x: 0.5, y: 0.5 }, { x: '0.5', y: '0.5', radius: '0.1' }) === true)
})

test('tap distance exactly equal to radius is inclusive (≤)', () => {
  // Tap is radius=0.1 to the right of centre — should be inside.
  assert(hotspotMatches({ x: 0.6, y: 0.5 }, HOTSPOT_REGION) === true)
})

test('NaN coords fail rather than throw', () => {
  assert(hotspotMatches({ x: NaN, y: 0.5 }, HOTSPOT_REGION) === false)
  assert(hotspotMatches({ x: 0.5, y: NaN }, HOTSPOT_REGION) === false)
})

test('region at image corner with tap at corner grades correctly', () => {
  const corner = { x: 0, y: 0, radius: 0.1 }
  assert(hotspotMatches({ x: 0, y: 0 }, corner) === true)
  assert(hotspotMatches({ x: 0.05, y: 0.05 }, corner) === true)
})

// ── Summary ─────────────────────────────────────────────────────

console.log(`\n─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───\n`)

if (fail > 0) {
  console.log('Failures:')
  failures.forEach(f => {
    console.log(`  - ${f.name}`)
    console.log(`      ${f.message}`)
  })
  process.exit(1)
}
