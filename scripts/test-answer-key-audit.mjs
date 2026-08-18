/**
 * The answer-key census: its classification rule, and its read-only property.
 *
 * The classifier decides whether a migration is needed, so a wrong answer here
 * is worse than no audit at all — it would report "clean" over data that
 * silently marks learners wrong. Each shape below is one the four-shape
 * resolver in PublicQuizRunner actually reads.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  classifyAnswerKey, isChoiceQuestion, summarise, SHAPES,
} from './audit-answer-key-shapes.mjs'

let n = 0
const test = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`) }
const OPTS = ['Lusaka', 'Ndola', 'Kitwe', 'Livingstone']

// ── the healthy shape ────────────────────────────────────────────────────────

test('a numeric index is the one shape both resolvers agree on', () => {
  const v = classifyAnswerKey({ options: OPTS, correctAnswer: 2 })
  assert.equal(v.shape, 'index')
  assert.equal(v.agrees, true)
  assert.equal(v.corruptedByResave, false)
})

test('index 0 is a real answer, not a falsy one', () => {
  // `Number(x) || 0` and `if (!correctAnswer)` both mistake option A for
  // "no answer recorded". The classifier must not repeat that.
  const v = classifyAnswerKey({ options: OPTS, correctAnswer: 0 })
  assert.equal(v.shape, 'index')
  assert.equal(v.agrees, true)
})

// ── the shapes only the four-shape resolver reads ────────────────────────────

test('the legacy index fields are recognised and flagged', () => {
  for (const field of ['correctAnswerIndex', 'correctIndex']) {
    const v = classifyAnswerKey({ options: OPTS, [field]: 1 })
    assert.equal(v.shape, field)
    assert.equal(v.agrees, false, `${field} must not read as agreeing`)
    assert.equal(v.corruptedByResave, true)
  }
})

test('a per-option isCorrect flag is recognised', () => {
  const v = classifyAnswerKey({
    options: [{ text: 'Lusaka' }, { text: 'Ndola', isCorrect: true }],
  })
  assert.equal(v.shape, 'option.isCorrect')
  assert.equal(v.agrees, false)
})

test('a letter key is recognised and marked corruptible', () => {
  const v = classifyAnswerKey({ options: OPTS, correctAnswer: 'C' })
  assert.equal(v.shape, 'letter')
  assert.equal(v.agrees, false)
  // Number('C') is NaN → `|| 0` → option A. This is the data-loss case.
  assert.equal(v.corruptedByResave, true)
})

test('an option-text key is recognised, case-insensitively', () => {
  const v = classifyAnswerKey({ options: OPTS, correctAnswer: 'kitwe' })
  assert.equal(v.shape, 'option-text')
  assert.equal(v.corruptedByResave, true)
})

test('a numeric string is separated from a letter — it survives a re-save', () => {
  const v = classifyAnswerKey({ options: OPTS, correctAnswer: '2' })
  assert.equal(v.shape, 'numeric-string')
  assert.equal(v.agrees, false, 'the strict scorer still marks every answer wrong')
  assert.equal(v.corruptedByResave, false, 'Number("2") is 2, so a re-save fixes it')
})

test('a key matching no option is reported as broken, not as text', () => {
  const v = classifyAnswerKey({ options: OPTS, correctAnswer: 'Chipata' })
  assert.equal(v.shape, 'text-unmatched')
})

test('an absent or blank key is "missing", not a resolver disagreement to migrate', () => {
  assert.equal(classifyAnswerKey({ options: OPTS }).shape, 'missing')
  assert.equal(classifyAnswerKey({ options: OPTS, correctAnswer: null }).shape, 'missing')
  assert.equal(classifyAnswerKey({ options: OPTS, correctAnswer: '  ' }).shape, 'empty')
})

test('precedence follows the resolver: a dedicated index field wins over correctAnswer', () => {
  // isCorrectChoice checks correctAnswerIndex FIRST, so a document carrying
  // both must be classified by the branch that would actually win.
  const v = classifyAnswerKey({ options: OPTS, correctAnswerIndex: 3, correctAnswer: 1 })
  assert.equal(v.shape, 'correctAnswerIndex')
})

test('every shape it can emit has a description', () => {
  const emitted = new Set([
    classifyAnswerKey({ options: OPTS, correctAnswer: 1 }).shape,
    classifyAnswerKey({ options: OPTS, correctAnswerIndex: 1 }).shape,
    classifyAnswerKey({ options: OPTS, correctIndex: 1 }).shape,
    classifyAnswerKey({ options: [{ text: 'a', isCorrect: true }] }).shape,
    classifyAnswerKey({ options: OPTS, correctAnswer: '2' }).shape,
    classifyAnswerKey({ options: OPTS, correctAnswer: 'Kitwe' }).shape,
    classifyAnswerKey({ options: OPTS, correctAnswer: 'B' }).shape,
    classifyAnswerKey({ options: OPTS, correctAnswer: 'nope' }).shape,
    classifyAnswerKey({ options: OPTS, correctAnswer: '' }).shape,
    classifyAnswerKey({ options: OPTS }).shape,
  ])
  for (const s of emitted) assert.ok(SHAPES[s], `no description for shape "${s}"`)
})

// ── scope ────────────────────────────────────────────────────────────────────

test('only choice questions are audited; a missing type defaults to MCQ', () => {
  assert.equal(isChoiceQuestion({ type: 'mcq' }), true)
  assert.equal(isChoiceQuestion({ type: 'true_false' }), true)
  assert.equal(isChoiceQuestion({}), true, 'the schema defaults an absent type to MCQ')
  for (const t of ['short_answer', 'numeric', 'fill_blanks', 'matching', 'sequence', 'hotspot']) {
    assert.equal(isChoiceQuestion({ type: t }), false, `${t} has its own grader`)
  }
})

// ── the roll-up ──────────────────────────────────────────────────────────────

test('summarise counts disagreements and corruptible keys separately', () => {
  const rows = [
    { quizId: 'q1', shape: 'index', agrees: true, corruptedByResave: false },
    { quizId: 'q1', shape: 'index', agrees: true, corruptedByResave: false },
    { quizId: 'q2', shape: 'letter', agrees: false, corruptedByResave: true },
    { quizId: 'q2', shape: 'numeric-string', agrees: false, corruptedByResave: false },
  ]
  const r = summarise(rows)
  assert.equal(r.total, 4)
  assert.equal(r.disagreeing, 2)
  assert.equal(r.corruptible, 1, 'a numeric string diverges but is not corrupted by a re-save')
  assert.equal(r.clean, false)
  assert.equal(r.byShape.index.count, 2)
  assert.equal(r.byShape.index.quizzes, 1)
})

test('an all-index corpus reports clean', () => {
  const r = summarise([{ quizId: 'q1', shape: 'index', agrees: true, corruptedByResave: false }])
  assert.equal(r.clean, true)
  assert.equal(r.disagreeing, 0)
})

test('an empty corpus is clean and does not divide by zero', () => {
  const r = summarise([])
  assert.equal(r.clean, true)
  assert.equal(r.total, 0)
})

// ── the read-only property ───────────────────────────────────────────────────

/**
 * Firestore writes always land on a Firestore-shaped receiver: `db`, something
 * ending in `ref`/`Ref`/`doc`/`Doc`, or a `collection(...)` call. Matching the
 * RECEIVER rather than the bare method name is what keeps `Set.add()` and
 * `Map.set()` — both idiomatic and both harmless — from reading as writes.
 */
const FIRESTORE_WRITE = /\b(?:db|[A-Za-z_$]*(?:[Rr]ef|[Dd]oc)|collection\([^)]*\))\s*(?:\.[A-Za-z_$]+\([^()]*\))*\s*\.(?:set|update|delete|add|create)\s*\(/
const UNAMBIGUOUS_WRITES = ['writeBatch', 'bulkWriter', 'runTransaction', 'FieldValue', 'BulkWriter']

function strippedSource() {
  const src = readFileSync(new URL('./audit-answer-key-shapes.mjs', import.meta.url), 'utf8')
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

test('the audit script calls no Firestore write method', () => {
  // An audit that could mutate what it audits is not an audit. Checked as text
  // because there is no way to prove it by running the script without pointing
  // it at a real project.
  const code = strippedSource()
  const hit = code.split('\n').find((l) => FIRESTORE_WRITE.test(l))
  assert.equal(hit, undefined, `audit script performs a Firestore write: ${hit}`)
  for (const token of UNAMBIGUOUS_WRITES) {
    assert.ok(!code.includes(token), `audit script must not use ${token}`)
  }
})

test('the write guard actually fires on a real write, and spares a Set', () => {
  // A guard that cannot fail is decoration. These are the exact shapes a
  // careless edit would introduce.
  for (const write of [
    "await qDoc.ref.update({ correctAnswer: 0 })",
    "await db.collection('quizzes').doc(id).set(patch)",
    "batchRef.delete()",
    "await quizDoc.ref.collection('questions').add(q)",
  ]) {
    assert.ok(FIRESTORE_WRITE.test(write), `guard missed a real write: ${write}`)
  }
  for (const safe of [
    "b.quizzes.add(r.quizId)",
    "emitted.add(classifyAnswerKey(q).shape)",
    "seen.set(key, value)",
    "const snap = await q.get()",
  ]) {
    assert.ok(!FIRESTORE_WRITE.test(safe), `guard false-positived on: ${safe}`)
  }
})

test('the script does not connect to Firestore when merely imported', () => {
  // It is imported at the top of this file. If the entry-point guard were
  // wrong, initializeApp would already have run and thrown or hung.
  const src = readFileSync(new URL('./audit-answer-key-shapes.mjs', import.meta.url), 'utf8')
  assert.match(src, /const invokedAsScript\s*=/)
  assert.match(src, /if \(invokedAsScript\)/)
})

console.log(`\nanswer-key audit: ${n} checks passed`)
