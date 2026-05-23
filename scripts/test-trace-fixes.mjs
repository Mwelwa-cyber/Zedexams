#!/usr/bin/env node
/**
 * Trace-fix bundle — unit tests.
 *
 * Covers the four bug-fixes surfaced by the end-to-end workflow trace
 * for the Grade 4 / Integrated Science / Blood Circulatory System
 * fixture:
 *
 *   Fix #1 — normalizeGrade in functions/teacherTools/cbcKnowledge.js
 *            accepts "4" / "G4" / "g4" / " G 4 " and outputs "G4".
 *            Idempotent. Non-numeric labels (e.g. "ECE") pass through.
 *
 *   Fix #3 — _stubFactory artifact write is wrapped in try/catch and
 *            emits a structured `firestore_write_failed` agent log +
 *            task step + live state on failure (source-text grep).
 *
 *   Fix #4 — qualityCheck.js `checkExplanationsPresent` flags
 *            practice_quiz MCQs / short_answers without an
 *            explanation; skips exam_quiz (marking guide carries it).
 *
 *   Fix #5 — standardsCheck.js `checkTopicDrift` flags when the
 *            Curriculum Reader matched a different topic than the
 *            requester asked for. Severity: minor.
 *
 * Run: npm run test:trace-fixes  (wired into test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const STUB_FACTORY_TEXT = readFileSync(
  join(ROOT, 'functions/agents/learnerAi/runners/_stubFactory.js'), 'utf8',
)

// Mock firebase-admin enough for cbcKnowledge.js + the runners to load.
const fakeAdmin = {
  firestore: () => ({
    collection: () => ({
      doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }),
      where: () => ({ where: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
    }),
    doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }),
  }),
}
fakeAdmin.firestore.FieldValue = {
  serverTimestamp: () => '__ts__',
  increment: (n) => ({ __increment: n }),
}

const origLoad = Module._load
Module._load = function(request, parent, ...rest) {
  if (request === 'firebase-admin') return fakeAdmin
  return origLoad.call(this, request, parent, ...rest)
}
const { normalizeGrade } = await import(
  join(ROOT, 'functions/teacherTools/cbcKnowledge.js')
)
const qualityCheck = await import(
  join(ROOT, 'functions/agents/learnerAi/runners/qualityCheck.js')
)
const standardsCheck = await import(
  join(ROOT, 'functions/agents/learnerAi/runners/standardsCheck.js')
)
const {
  QUALITY_CHECK_AXES, STANDARDS_CHECK_AXES,
} = await import('../src/schemas/learnerAi.js')
Module._load = origLoad

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try {
    const r = fn()
    if (r && typeof r.then === 'function') {
      return r.then(() => { pass++; console.log(`  ok  ${name}`) })
              .catch(err => { fail++; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) })
    }
    pass++; console.log(`  ok  ${name}`)
  } catch (err) {
    fail++; failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}\n       ${err.message}`)
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

// ── Fix #1: normalizeGrade ───────────────────────────────────────

console.log('\nFix #1 — normalizeGrade')

test('"4" → "G4"',           () => assert(normalizeGrade('4') === 'G4'))
test('"G4" → "G4" (idempotent)', () => assert(normalizeGrade('G4') === 'G4'))
test('"g4" → "G4"',           () => assert(normalizeGrade('g4') === 'G4'))
test('" G 4 " → "G4"',        () => assert(normalizeGrade(' G 4 ') === 'G4'))
test('"12" → "G12"',          () => assert(normalizeGrade('12') === 'G12'))
test('"ECE" → "ECE" (non-numeric pass-through)',
  () => assert(normalizeGrade('ECE') === 'ECE'))
test('null → ""',             () => assert(normalizeGrade(null) === ''))
test('undefined → ""',        () => assert(normalizeGrade(undefined) === ''))
test('"" → ""',               () => assert(normalizeGrade('') === ''))
test('numeric 4 → "G4"',      () => assert(normalizeGrade(4) === 'G4'))

// ── Fix #3: _stubFactory wraps the artifact write ────────────────

console.log('\nFix #3 — _stubFactory artifact-write error handling')

test('try / catch around add() exists', () => {
  // The fix introduces `try {` immediately before `ref = await admin.firestore()...add(docPayload)`
  // and a catch that calls writeAgentLog with severity ERROR.
  assert(/try\s*\{[\s\S]{0,200}ref = await admin\.firestore\(\)[\s\S]{0,200}\.add\(docPayload\)/.test(STUB_FACTORY_TEXT),
    'try { ... ref = ... .add(docPayload) } block missing')
})

test('catch emits writeAgentLog with severity ERROR + firestore_write_failed', () => {
  assert(/Artifact write failed:/.test(STUB_FACTORY_TEXT),
    'writeAgentLog message text missing')
  assert(/severity:\s*SEVERITY\.ERROR/.test(STUB_FACTORY_TEXT),
    'severity ERROR missing in catch')
  assert(/firestore_write_failed/.test(STUB_FACTORY_TEXT),
    'firestore_write_failed task step + return reason missing')
})

test('catch returns {ok:false, reason:"firestore_write_failed"}', () => {
  assert(/return\s*\{\s*ok:\s*false,\s*reason:\s*["']firestore_write_failed["']\s*\}/.test(STUB_FACTORY_TEXT),
    'structured failure return missing')
})

// ── Fix #4: checkExplanationsPresent ─────────────────────────────

console.log('\nFix #4 — checkExplanationsPresent')

test('schema enum includes explanations_present', () => {
  assert(QUALITY_CHECK_AXES.options.includes('explanations_present'),
    'QUALITY_CHECK_AXES missing explanations_present')
})

test('flags MCQ on practice_quiz with no explanation', () => {
  const r = qualityCheck.checkExplanationsPresent({
    artifactType: 'practice_quiz',
    content: { questions: [
      { questionType: 'mcq', options: ['a','b'], correctAnswer: 'a', marks: 1 }, // no explanation
      { questionType: 'mcq', options: ['c','d'], correctAnswer: 'c', marks: 1, explanation: 'has one' },
    ]},
  })
  assert(r.issue, 'must surface an issue')
  assert(r.issue.axis === 'explanations_present')
  assert(r.issue.severity === 'minor')
  assert(/1 question/.test(r.issue.message), `expected '1 question' in message: ${r.issue.message}`)
})

test('passes (no issue) when all MCQs carry explanations', () => {
  const r = qualityCheck.checkExplanationsPresent({
    artifactType: 'practice_quiz',
    content: { questions: [
      { questionType: 'mcq', options: ['a','b'], correctAnswer: 'a', marks: 1, explanation: 'because A' },
      { questionType: 'mcq', options: ['c','d'], correctAnswer: 'c', marks: 1, explanation: 'because C' },
    ]},
  })
  assert(!r.issue, 'should pass')
})

test('skips short_answer when explanation present', () => {
  const r = qualityCheck.checkExplanationsPresent({
    artifactType: 'practice_quiz',
    content: { questions: [
      { questionType: 'short_answer', correctAnswer: 'photosynthesis', marks: 1, explanation: 'plants...' },
    ]},
  })
  assert(!r.issue)
})

test('flags short_answer without explanation', () => {
  const r = qualityCheck.checkExplanationsPresent({
    artifactType: 'practice_quiz',
    content: { questions: [
      { questionType: 'short_answer', correctAnswer: 'photosynthesis', marks: 1 },
    ]},
  })
  assert(r.issue, 'must flag missing explanation on short_answer too')
})

test('skipped for exam_quiz (marking guide carries it)', () => {
  const r = qualityCheck.checkExplanationsPresent({
    artifactType: 'exam_quiz',
    content: { sections: [{ questions: [
      { questionType: 'mcq', options: ['a','b'], correctAnswer: 'a', marks: 1 },
    ]}]},
  })
  assert(!r.issue, 'exam_quiz should be skipped')
})

test('skipped for notes / study_tips / learner_feedback', () => {
  for (const t of ['notes', 'study_tips', 'learner_feedback']) {
    const r = qualityCheck.checkExplanationsPresent({
      artifactType: t, content: { questions: [] },
    })
    assert(!r.issue, `${t} should be skipped`)
  }
})

// ── Fix #5: checkTopicDrift ──────────────────────────────────────

console.log('\nFix #5 — checkTopicDrift')

test('schema enum includes topic_drift', () => {
  assert(STANDARDS_CHECK_AXES.options.includes('topic_drift'),
    'STANDARDS_CHECK_AXES missing topic_drift')
})

test('passes when reader.topic === task.topic', () => {
  const r = standardsCheck.checkTopicDrift({
    task: { topic: 'Photosynthesis' },
    reader: { topic: 'Photosynthesis' },
  })
  assert(r.verdict === 'pass')
  assert(!r.issue)
})

test('flags (minor) when reader.topic !== task.topic', () => {
  const r = standardsCheck.checkTopicDrift({
    task: { topic: 'Blood Circulatory System' },
    reader: { topic: 'The Circulatory System' },
  })
  assert(r.verdict === 'fail', `expected fail, got ${r.verdict}`)
  assert(r.issue, 'must surface issue')
  assert(r.issue.severity === 'minor',
    `severity must be 'minor' (not critical — admin decides)`)
  assert(/Blood Circulatory System/.test(r.issue.message))
  assert(/The Circulatory System/.test(r.issue.message))
})

test('skips when either field is missing', () => {
  const r1 = standardsCheck.checkTopicDrift({ task: {}, reader: { topic: 'X' } })
  assert(r1.verdict === 'skip')
  const r2 = standardsCheck.checkTopicDrift({ task: { topic: 'X' }, reader: {} })
  assert(r2.verdict === 'skip')
  const r3 = standardsCheck.checkTopicDrift({ task: null, reader: null })
  assert(r3.verdict === 'skip')
})

test('case-insensitive comparison', () => {
  const r = standardsCheck.checkTopicDrift({
    task: { topic: 'Photosynthesis' },
    reader: { topic: 'photosynthesis' },
  })
  assert(r.verdict === 'pass', 'should normalize case')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
