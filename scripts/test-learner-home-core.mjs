/**
 * Tests for src/features/learnerHome/lib/learnerHomeCore.js — the pure
 * decision logic behind the learner home experience. Plain node script:
 * throws on failure (run via `npm run test:learner-home`, auto-picked
 * up by test:all).
 */
import assert from 'node:assert/strict'
import {
  getGreeting,
  firstNameOf,
  resolveActiveTerm,
  normalizeTerm,
  pickLearningResume,
  buildRecentActivity,
  activityKey,
  relativeTime,
  computeSubjectCompletion,
  buildRecommendations,
  extractWeakTopics,
  getExamCountdownState,
  countdownParts,
  buildTodaysExamsSummary,
  deriveTopicTerms,
  topicsForTerm,
  countThisWeek,
  timestampMillis,
} from '../src/features/learnerHome/lib/learnerHomeCore.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// ── Greeting ────────────────────────────────────────────────────────
test('greeting is time-aware', () => {
  assert.equal(getGreeting(6), 'Good morning')
  assert.equal(getGreeting(11), 'Good morning')
  assert.equal(getGreeting(12), 'Good afternoon')
  assert.equal(getGreeting(16), 'Good afternoon')
  assert.equal(getGreeting(17), 'Good evening')
  assert.equal(getGreeting(23), 'Good evening')
  assert.equal(getGreeting(3), 'Good evening')
  assert.equal(getGreeting(undefined), 'Good afternoon')
})

test('firstNameOf extracts the first name safely', () => {
  assert.equal(firstNameOf('Lydia Mwansa'), 'Lydia')
  assert.equal(firstNameOf('  Chanda  '), 'Chanda')
  assert.equal(firstNameOf(''), '')
  assert.equal(firstNameOf(null), '')
})

// ── Term resolution (spec fallback order) ───────────────────────────
test('term resolution follows school → calendar → saved → Term 1', () => {
  assert.deepEqual(resolveActiveTerm({ schoolTerm: 2, calendarTerm: 1, savedTerm: 3 }), { term: 2, source: 'school' })
  assert.deepEqual(resolveActiveTerm({ calendarTerm: 3, savedTerm: 1 }), { term: 3, source: 'calendar' })
  assert.deepEqual(resolveActiveTerm({ savedTerm: 2 }), { term: 2, source: 'saved' })
  assert.deepEqual(resolveActiveTerm({}), { term: 1, source: 'default' })
  // invalid values are skipped, not trusted
  assert.deepEqual(resolveActiveTerm({ schoolTerm: 9, calendarTerm: 0, savedTerm: 2 }), { term: 2, source: 'saved' })
})

test('normalizeTerm handles Firestore string variants', () => {
  assert.equal(normalizeTerm('Term 2'), 2)
  assert.equal(normalizeTerm('1'), 1)
  assert.equal(normalizeTerm(3), 3)
  assert.equal(normalizeTerm('term3'), 3)
  assert.equal(normalizeTerm(''), null)
  assert.equal(normalizeTerm(null), null)
  assert.equal(normalizeTerm(7), null)
})

// ── Resume selection ────────────────────────────────────────────────
test('resume picks by priority: in-progress lesson beats quiz and notes', () => {
  const picked = pickLearningResume([
    { kind: 'note', id: 'n1', grade: '7', percent: 40, openedAt: 900 },
    { kind: 'quiz', id: 'q1', grade: '7', percent: 10, openedAt: 800 },
    { kind: 'lesson', id: 'l1', grade: '7', percent: 30, openedAt: 100 },
  ], { grade: '7' })
  assert.equal(picked.id, 'l1')
})

test('resume picks by priority: quiz session over notes', () => {
  const picked = pickLearningResume([
    { kind: 'note', id: 'n1', title: 'Notes', grade: '7', percent: 40, openedAt: 200 },
    { kind: 'quiz', id: 'q1', title: 'Quiz', grade: '7', percent: 10, openedAt: 100 },
  ], { grade: '7' })
  assert.equal(picked.id, 'q1')
})

test('resume skips completed, wrong-grade and unpublished items', () => {
  const picked = pickLearningResume([
    { kind: 'quiz', id: 'q1', grade: '7', status: 'completed', openedAt: 500 },
    { kind: 'quiz', id: 'q2', grade: '5', percent: 10, openedAt: 400 },
    { kind: 'note', id: 'n1', grade: '7', percent: 100, openedAt: 300 },
    { kind: 'note', id: 'n2', grade: '7', percent: 20, openedAt: 200, unpublished: true },
    { kind: 'note', id: 'n3', grade: '7', percent: 20, openedAt: 100 },
  ], { grade: '7' })
  assert.equal(picked.id, 'n3')
})

test('resume returns null with no eligible candidates', () => {
  assert.equal(pickLearningResume([], { grade: '7' }), null)
  assert.equal(pickLearningResume([{ kind: 'note', id: 'x', grade: '4', percent: 5 }], { grade: '7' }), null)
})

test('resume prefers most recently opened within same kind', () => {
  const picked = pickLearningResume([
    { kind: 'note', id: 'old', grade: '7', percent: 10, openedAt: 100 },
    { kind: 'note', id: 'new', grade: '7', percent: 10, openedAt: 900 },
  ], { grade: '7' })
  assert.equal(picked.id, 'new')
})

// ── Recent activity dedup ───────────────────────────────────────────
test('activity dedupes by type+sourceId+attemptId+timestamp', () => {
  const items = [
    { type: 'quiz_completed', sourceId: 'q1', attemptId: 'a1', completedAt: 1000, title: 'Quiz A' },
    { type: 'quiz_completed', sourceId: 'q1', attemptId: 'a1', completedAt: 1000, title: 'Quiz A (dup)' },
    { type: 'quiz_completed', sourceId: 'q1', attemptId: 'a2', completedAt: 2000, title: 'Quiz A again' },
    { type: 'note_opened', sourceId: 'n1', completedAt: 1500, title: 'Notes' },
  ]
  const out = buildRecentActivity(items, { limit: 3 })
  assert.equal(out.length, 3)
  assert.deepEqual(out.map((i) => i.attemptId || i.sourceId), ['a2', 'n1', 'a1'])
})

test('activity sorts newest first and caps at limit', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ type: 't', sourceId: `s${i}`, completedAt: i }))
  const out = buildRecentActivity(items, { limit: 3 })
  assert.deepEqual(out.map((i) => i.sourceId), ['s9', 's8', 's7'])
})

test('activityKey is stable', () => {
  assert.equal(
    activityKey({ type: 'a', sourceId: 'b', attemptId: 'c', completedAt: 5 }),
    activityKey({ type: 'a', sourceId: 'b', attemptId: 'c', completedAt: 5 }),
  )
})

test('relativeTime buckets', () => {
  const now = 10_000_000_000
  assert.equal(relativeTime(now - 30_000, now), 'Just now')
  assert.equal(relativeTime(now - 5 * 60_000, now), '5 min ago')
  assert.equal(relativeTime(now - 2 * 3_600_000, now), '2 hours ago')
  assert.equal(relativeTime(now - 25 * 3_600_000, now), 'Yesterday')
  assert.equal(relativeTime(now - 3 * 86_400_000, now), '3 days ago')
  assert.equal(relativeTime(null, now), '')
})

// ── Subject completion weighting ────────────────────────────────────
test('subject completion weights notes + quiz coverage, not scores', () => {
  assert.equal(computeSubjectCompletion({ notesRead: 5, notesTotal: 10, topicsAttempted: 5, topicsTotal: 10 }), 50)
  assert.equal(computeSubjectCompletion({ notesRead: 10, notesTotal: 10, topicsAttempted: 10, topicsTotal: 10, examsDone: 1, examsExpected: 1 }), 100)
})

test('subject completion renormalises when a component has no data', () => {
  // Only quiz coverage available → it carries full weight.
  assert.equal(computeSubjectCompletion({ topicsAttempted: 3, topicsTotal: 4 }), 75)
  assert.equal(computeSubjectCompletion({}), 0)
})

test('subject completion clamps over-complete components', () => {
  assert.equal(computeSubjectCompletion({ notesRead: 20, notesTotal: 10 }), 100)
})

// ── Weak topics + recommendations ───────────────────────────────────
test('extractWeakTopics aggregates topicScores below 60%', () => {
  const results = [
    { subject: 'mathematics', grade: '7', topicScores: { Fractions: { correct: 1, total: 4 } } },
    { subject: 'mathematics', grade: '7', topicScores: { Fractions: { correct: 1, total: 4 }, Algebra: { correct: 4, total: 4 } } },
  ]
  const weak = extractWeakTopics(results)
  assert.equal(weak.length, 1)
  assert.equal(weak[0].topic, 'Fractions')
  assert.equal(Math.round(weak[0].percent), 25)
})

test('extractWeakTopics ignores thin evidence', () => {
  const weak = extractWeakTopics([{ subject: 's', topicScores: { X: { correct: 0, total: 2 } } }], { minAttempted: 4 })
  assert.equal(weak.length, 0)
})

test('recommendations carry reasons and skip wrong grade / completed / dupes', () => {
  const recs = buildRecommendations({
    grade: '7',
    weakTopics: [
      { subject: 'mathematics', subjectLabel: 'Mathematics', grade: '7', topic: 'Fractions', topicLabel: 'Fractions', percent: 40 },
      { subject: 'english', grade: '5', topic: 'Verbs', percent: 30 }, // wrong grade → dropped
    ],
    resumeCandidates: [
      { kind: 'note', id: 'n1', title: 'Digestion notes', subject: 'science', grade: '7', status: 'in-progress' },
      { kind: 'note', id: 'n2', title: 'Done notes', subject: 'science', grade: '7', status: 'completed' },
    ],
    nextTermItems: [{ kind: 'note', id: 'n3', title: 'Next note', subject: 'science', grade: '7' }],
  }, { limit: 3 })
  assert.equal(recs.length, 3)
  assert.ok(recs.every((r) => typeof r.reason === 'string' && r.reason.length > 0))
  assert.ok(recs.every((r) => String(r.grade) === '7'))
  assert.equal(recs[0].title, 'Improve in Fractions')
})

test('recommendations dedupe by id', () => {
  const recs = buildRecommendations({
    nextTermItems: [
      { kind: 'note', id: 'n1', title: 'A' },
      { kind: 'note', id: 'n1', title: 'A again' },
    ],
  })
  assert.equal(recs.length, 1)
})

// ── Countdown state machine ─────────────────────────────────────────
const S = (startsAt, endsAt, label) => ({ startsAt, endsAt, label })

test('countdown: upcoming → in_progress → next → completed', () => {
  const sessions = [S(1000, 2000, 'English P1'), S(3000, 4000, 'Maths P1')]
  assert.equal(getExamCountdownState(sessions, 500).phase, 'upcoming')
  assert.equal(getExamCountdownState(sessions, 500).session.label, 'English P1')
  assert.equal(getExamCountdownState(sessions, 500).msRemaining, 500)
  assert.equal(getExamCountdownState(sessions, 1500).phase, 'in_progress')
  const afterFirst = getExamCountdownState(sessions, 2500)
  assert.equal(afterFirst.phase, 'upcoming')
  assert.equal(afterFirst.session.label, 'Maths P1')
  assert.equal(getExamCountdownState(sessions, 9000).phase, 'completed')
})

test('countdown handles missing data gracefully', () => {
  assert.equal(getExamCountdownState([], 100).phase, 'none')
  assert.equal(getExamCountdownState(null, 100).phase, 'none')
  assert.equal(getExamCountdownState([{ label: 'bad' }], 100).phase, 'none')
})

test('countdownParts breaks down remaining time', () => {
  const ms = ((23 * 24 + 14) * 60 + 32) * 60_000 + 48_000
  assert.deepEqual(countdownParts(ms), { days: 23, hours: 14, minutes: 32, seconds: 48 })
  assert.deepEqual(countdownParts(-5), { days: 0, hours: 0, minutes: 0, seconds: 0 })
})

// ── Today's exams summary ───────────────────────────────────────────
test("today's exams: counts, next pick, resume beats fresh start", () => {
  const exams = [
    { examId: 'e1', subject: 'mathematics' },
    { examId: 'e2', subject: 'english' },
    { examId: 'e3', subject: 'science' },
  ]
  const locks = {
    mathematics: { status: 'submitted' },
    english: { status: 'in_progress' },
  }
  const s = buildTodaysExamsSummary(exams, locks)
  assert.equal(s.total, 3)
  assert.equal(s.completed, 1)
  assert.equal(s.next.examId, 'e2') // resume in-progress first
  assert.equal(s.next.resume, true)
})

test("today's exams: empty and all-done states", () => {
  assert.equal(buildTodaysExamsSummary([], {}).hasExams, false)
  const done = buildTodaysExamsSummary([{ examId: 'e1', subject: 'm' }], { m: { status: 'submitted' } })
  assert.equal(done.allDone, true)
  assert.equal(done.next, null)
})

// ── Topic ↔ term derivation ─────────────────────────────────────────
test('deriveTopicTerms votes by quiz term tags', () => {
  const map = deriveTopicTerms([
    { topic: 'The Human Body', term: 'Term 1' },
    { topic: 'The Human Body', term: '1' },
    { topic: 'The Human Body', term: 2 },
    { topic: 'Nutrition', term: 2 },
    { topic: 'NoTerm' },
  ])
  assert.equal(map.get('The Human Body'), 1)
  assert.equal(map.get('Nutrition'), 2)
  assert.equal(map.has('NoTerm'), false)
})

test('topicsForTerm shows full syllabus when no term data exists', () => {
  const topics = ['A', 'B', 'C']
  assert.deepEqual(topicsForTerm(topics, new Map(), 2), topics)
})

test('topicsForTerm filters tagged topics, keeps unsignalled ones', () => {
  const map = new Map([['A', 1], ['B', 2]])
  assert.deepEqual(topicsForTerm(['A', 'B', 'C'], map, 1), ['A', 'C'])
  assert.deepEqual(topicsForTerm(['A', 'B', 'C'], map, 2), ['B', 'C'])
})

// ── Mock papers are not pooled with ECZ papers (spec §7) ────────────────
//
// A PRISCA or school mock is written to a different standard from the ECZ
// examination it imitates, so answers on one are not evidence about the other.
// The rule itself lives in src/utils/paperProvenance.js and is tested there;
// these three assert that this aggregation actually applies it — and, just as
// important, that the ordinary practice quiz (which carries no provenance at
// all) is untouched.

const weakOnMock = {
  subject: 'science', grade: '7', paperSource: 'prisca', paperIsOfficial: false,
  topicScores: { Electricity: { correct: 0, total: 10 } },
}
const strongOnEcz = {
  subject: 'science', grade: '7', paperSource: 'ecz', paperIsOfficial: true,
  topicScores: { Electricity: { correct: 9, total: 10 } },
}

test('a topic a learner only fails on a MOCK is not reported as a weakness', () => {
  assert.deepEqual(extractWeakTopics([weakOnMock, strongOnEcz]), [])
})

test('the mock filter is load-bearing — the same data reports it when disabled', () => {
  // Without this, the assertion above would keep passing if the filter ever
  // became a no-op that dropped everything.
  const weak = extractWeakTopics([weakOnMock, strongOnEcz], { excludeMocks: false })
  assert.equal(weak.length, 1)
  assert.equal(weak[0].topic, 'Electricity')
})

test('a plain practice-quiz result (no provenance at all) still counts', () => {
  const weak = extractWeakTopics([{
    subject: 'science', grade: '7', topicScores: { Forces: { correct: 1, total: 8 } },
  }])
  assert.equal(weak.length, 1)
  assert.equal(weak[0].topic, 'Forces')
})

test('countThisWeek counts only rows dated within the last 7 days', () => {
  const now = Date.UTC(2026, 7, 17)
  const day = 24 * 60 * 60 * 1000
  const rows = [
    { completedAt: { seconds: (now - 1 * day) / 1000 } },        // Firestore shape, 1d ago
    { completedAt: { toMillis: () => now - 6 * day } },          // Timestamp shape, 6d ago
    { completedAt: new Date(now - 8 * day).toISOString() },      // too old
    { completedAt: null },                                        // undated never counts
    {},
  ]
  assert.equal(countThisWeek(rows, 'completedAt', now), 2)
  assert.equal(countThisWeek([], 'completedAt', now), 0)
  assert.equal(countThisWeek(null, 'completedAt', now), 0)
  assert.equal(timestampMillis('not a date'), null)
})

console.log(`\nlearner-home-core: ${passed} tests passed`)
