/**
 * Tests for the past-paper quiz-status derivation (plain node).
 *
 * What these pin down, in order of how expensive the mistake is:
 *   1. A paper published BEFORE `quizStatus` existed still reads correctly.
 *      Getting this wrong makes every legacy paper in the archive claim its
 *      quiz is missing (or, worse, present when it isn't).
 *   2. 'attached' with no quizId reads as PENDING. The learner UI routes on
 *      the id; honouring the status alone renders a Start Quiz button that
 *      leads to a 404.
 *   3. Attaching is ONE patch containing both fields, so no read of the
 *      paper can ever see half of it.
 *
 * Run: node src/utils/pastPaperQuizStatus.test.js
 */

import assert from 'node:assert/strict'
import {
  LEARNER_QUIZ_PENDING_TEXT,
  QUIZ_PENDING_COPY,
  QUIZ_STATUSES,
  attachQuizFields,
  countPendingQuizPapers,
  derivePaperQuizStatus,
  normalizeQuizStatus,
  paperQuizIsAttached,
  paperQuizIsPending,
  pendingQuizFields,
  resolveStudioQuizId,
} from './pastPaperQuizStatus.js'

let passed = 0
function ok(label, condition) {
  assert.ok(condition, label)
  passed += 1
}

// ── normalizeQuizStatus ─────────────────────────────────────────────────
ok('accepts pending', normalizeQuizStatus('pending') === QUIZ_STATUSES.PENDING)
ok('accepts attached', normalizeQuizStatus('attached') === QUIZ_STATUSES.ATTACHED)
ok('accepts padded / mixed case', normalizeQuizStatus('  Attached ') === QUIZ_STATUSES.ATTACHED)
ok('undefined for an unknown string', normalizeQuizStatus('done') === undefined)
ok('undefined for a non-string', normalizeQuizStatus(1) === undefined)
ok('undefined when absent', normalizeQuizStatus(undefined) === undefined)

// ── Back-compat: papers written before quizStatus existed ───────────────
ok(
  'legacy paper WITH a quizId derives attached',
  derivePaperQuizStatus({ quizId: 'q1' }) === QUIZ_STATUSES.ATTACHED,
)
ok(
  'legacy paper WITHOUT a quizId derives pending',
  derivePaperQuizStatus({ title: 'Grade 7 Maths 2019' }) === QUIZ_STATUSES.PENDING,
)
ok(
  'legacy paper with an empty-string quizId derives pending',
  derivePaperQuizStatus({ quizId: '   ' }) === QUIZ_STATUSES.PENDING,
)
ok(
  'legacy paper with a null quizId derives pending',
  derivePaperQuizStatus({ quizId: null }) === QUIZ_STATUSES.PENDING,
)

// ── Stated status ───────────────────────────────────────────────────────
ok(
  'stated attached + quizId is attached',
  derivePaperQuizStatus({ quizStatus: 'attached', quizId: 'q1' }) === QUIZ_STATUSES.ATTACHED,
)
ok(
  'stated pending is pending even when a quizId lingers',
  derivePaperQuizStatus({ quizStatus: 'pending', quizId: 'q1' }) === QUIZ_STATUSES.PENDING,
)
ok(
  'stated attached with NO quizId falls back to pending (never links to nothing)',
  derivePaperQuizStatus({ quizStatus: 'attached', quizId: null }) === QUIZ_STATUSES.PENDING,
)
ok(
  'a junk status is ignored and the quizId signal decides',
  derivePaperQuizStatus({ quizStatus: 'ready', quizId: 'q1' }) === QUIZ_STATUSES.ATTACHED,
)
ok(
  'a junk status with no quizId is pending',
  derivePaperQuizStatus({ quizStatus: 'ready' }) === QUIZ_STATUSES.PENDING,
)

// ── Defensive inputs ────────────────────────────────────────────────────
ok('null paper is pending', derivePaperQuizStatus(null) === QUIZ_STATUSES.PENDING)
ok('undefined paper is pending', derivePaperQuizStatus(undefined) === QUIZ_STATUSES.PENDING)
ok('non-object paper is pending', derivePaperQuizStatus('nope') === QUIZ_STATUSES.PENDING)
ok('derivation only ever returns the two canonical values', [
  {}, { quizId: 'q' }, { quizStatus: 'pending' }, { quizStatus: 'x' }, null,
].every((p) => Object.values(QUIZ_STATUSES).includes(derivePaperQuizStatus(p))))

// ── Predicates ──────────────────────────────────────────────────────────
ok('paperQuizIsAttached mirrors the derivation', paperQuizIsAttached({ quizId: 'q1' }) === true)
ok('paperQuizIsPending mirrors the derivation', paperQuizIsPending({}) === true)
ok(
  'the two predicates are exclusive',
  [{}, { quizId: 'q' }, { quizStatus: 'attached' }].every(
    (p) => paperQuizIsPending(p) !== paperQuizIsAttached(p),
  ),
)

// ── Counting ────────────────────────────────────────────────────────────
ok('counts pending papers', countPendingQuizPapers([
  { quizId: 'a' },                          // attached
  { quizStatus: 'pending', quizId: 'b' },   // pending
  {},                                       // pending
  { quizStatus: 'attached', quizId: 'c' },  // attached
]) === 2)
ok('counts nothing in an empty list', countPendingQuizPapers([]) === 0)
ok('a non-list counts as zero', countPendingQuizPapers(null) === 0)

// ── Attach / pending patches ────────────────────────────────────────────
const attach = attachQuizFields('quiz-123')
ok('attach patch sets the id', attach.quizId === 'quiz-123')
ok('attach patch sets the status', attach.quizStatus === QUIZ_STATUSES.ATTACHED)
ok('attach patch clears the parked draft id', attach.pendingQuizId === null)
ok(
  'attach patch carries BOTH fields in one object (no two-step write)',
  'quizId' in attach && 'quizStatus' in attach,
)
ok('attach patch trims the id', attachQuizFields('  q9  ').quizId === 'q9')
assert.throws(() => attachQuizFields(''), /requires a quiz id/)
assert.throws(() => attachQuizFields(null), /requires a quiz id/)
passed += 2

const pending = pendingQuizFields('draft-quiz-1')
ok('pending patch nulls quizId', pending.quizId === null)
ok('pending patch states pending', pending.quizStatus === QUIZ_STATUSES.PENDING)
ok('pending patch parks the draft quiz id', pending.pendingQuizId === 'draft-quiz-1')
ok('pending patch tolerates no draft quiz', pendingQuizFields().pendingQuizId === null)
ok('pending patch tolerates a blank draft quiz', pendingQuizFields('  ').pendingQuizId === null)
ok(
  'a paper written with the pending patch derives pending',
  derivePaperQuizStatus({ ...pending }) === QUIZ_STATUSES.PENDING,
)
ok(
  'a paper written with the attach patch derives attached',
  derivePaperQuizStatus({ ...attach }) === QUIZ_STATUSES.ATTACHED,
)

// ── Studio quiz resolution (no orphaned draft quizzes) ──────────────────
ok(
  'studio reuses the attached quiz',
  resolveStudioQuizId({ quizId: 'q1', pendingQuizId: 'q0' }) === 'q1',
)
ok(
  'studio reuses the parked draft quiz on a pending paper',
  resolveStudioQuizId({ quizId: null, pendingQuizId: 'q0' }) === 'q0',
)
ok('studio mints a quiz when the paper has neither', resolveStudioQuizId({}) === null)
ok('studio resolution tolerates a null paper', resolveStudioQuizId(null) === null)

// ── Copy ────────────────────────────────────────────────────────────────
ok('learner copy matches the spec string',
  LEARNER_QUIZ_PENDING_TEXT === 'Quiz coming soon — practice questions for this paper are being prepared.')
ok('admin badge copy', QUIZ_PENDING_COPY.adminBadge === 'Quiz pending')
ok('admin action copy', QUIZ_PENDING_COPY.adminAction === 'Add quiz')
ok('skip action copy', QUIZ_PENDING_COPY.skipAction === 'Skip for now — add the quiz later')
ok('publish notice copy', QUIZ_PENDING_COPY.publishNotice === 'No quiz attached yet. This paper will be published and visible to learners now, with a "Quiz coming soon" note. You can add the quiz any time from All papers.')

console.log(`✓ pastPaperQuizStatus — ${passed} assertions passed`)
