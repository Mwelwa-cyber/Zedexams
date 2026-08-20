/**
 * subjectProgressCore — the learner's subject progress percentage.
 *
 * Every case below is one of the ways the previous model produced a number
 * nobody could have earned. The Home Economics case is the reported bug: a
 * subject with nothing published in it, never opened, reading 100%.
 */
import assert from 'node:assert/strict'
import {
  TOPIC_PASS_MARK,
  buildSubjectTermRows,
  buildSubjectTopics,
  summariseSubjectProgress,
  computeSubjectProgress,
  subjectRowMeta,
} from '../src/features/learnerHome/lib/subjectProgressCore.js'

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── The denominator is the term's own rows ──────────────────────────

test('the term rows are what the screen lists, for an authored plan', () => {
  // Grade 7 Integrated Science Term 1 is three rows in the owner's plan.
  const { rows, planSource } = buildSubjectTermRows({ subjectId: 'science', grade: 7, term: 1 })
  assert.equal(planSource, 'authored')
  const planned = rows.filter((r) => r.planned)
  assert.equal(planned.length, 3)
  assert.deepEqual(planned.map((r) => r.name), [
    'The Digestive System', 'Diseases — Viruses & Bacteria', 'Fruits & Seeds as Food',
  ])
})

test('catalogue content the plan does not place shows on every term', () => {
  const t1 = buildSubjectTermRows({ subjectId: 'science', grade: 7, term: 1 })
  const t3 = buildSubjectTermRows({ subjectId: 'science', grade: 7, term: 3 })
  assert.ok(t1.unplacedCount > 0, 'Grade 7 Science has unplaced sub-topics')
  assert.equal(t1.unplacedCount, t3.unplacedCount)
  const unplacedIn = (r) => r.rows.filter((x) => !x.planned).map((x) => x.name)
  assert.deepEqual(unplacedIn(t1), unplacedIn(t3))
})

test('a subject with no authored plan gets the divided catalogue', () => {
  const { planSource, rows } = buildSubjectTermRows({ subjectId: 'home-economics', grade: 7, term: 1 })
  assert.equal(planSource, 'derived')
  assert.ok(rows.length > 0)
})

// ── The reported bug ────────────────────────────────────────────────

test('THE HOME ECONOMICS BUG: nothing published, never opened → no percentage', () => {
  // The old model: six distinct free-text topicScores keys, clamped by
  // Math.min(keys, catalogueTopics) to 6/6, printed as 100%.
  const results = [{
    quizId: 'q-elsewhere',
    percentage: 40,
    topicScores: {
      General: { correct: 2, total: 5 },
      'Something Else': { correct: 1, total: 2 },
      'Another Thing': { correct: 0, total: 3 },
      Misc: { correct: 1, total: 1 },
      Untagged: { correct: 1, total: 1 },
      Whatever: { correct: 1, total: 1 },
    },
  }]
  const { summary } = computeSubjectProgress({
    subjectId: 'home-economics', grade: 7, term: 1,
    subjectNotes: [], termNotes: [], subjectQuizzes: [], noteProgress: [], results,
  })
  assert.equal(summary.state, 'no-material')
  assert.equal(summary.percent, null, 'a subject with nothing published is not measured')
  assert.equal(summary.done, 0)
  assert.equal(summary.withMaterial, 0)
  assert.match(subjectRowMeta({ term: 1, summary }), /Material coming soon/)
})

test('an unmatched topicScores key credits nothing, and is never clamped up', () => {
  const rows = [{ name: 'Food Preservation' }, { name: 'Consumer Rights' }]
  const topics = buildSubjectTopics({
    rows,
    subjectQuizzes: [{ id: 'q1', topic: 'Food Preservation' }],
    results: [{
      quizId: 'q-other',
      topicScores: { General: { correct: 9, total: 9 }, Nonsense: { correct: 9, total: 9 } },
    }],
  })
  assert.equal(topics[0].status, 'available')
  assert.equal(topics[1].status, 'available')
  assert.equal(summariseSubjectProgress(topics).percent, 0)
})

test("'General' is a fallback label, not a topic", () => {
  // computeQuizScore files every untagged question under the literal string
  // 'General'. It must never match a row — not even one whose own name
  // contains the word, which is what the shared title matcher would do.
  const rows = [{ name: 'General Knowledge' }]
  const topics = buildSubjectTopics({
    rows,
    subjectQuizzes: [{ id: 'q1', topic: 'General Knowledge' }],
    results: [{ quizId: 'q-other', topicScores: { General: { correct: 8, total: 8 } } }],
  })
  assert.equal(topics[0].status, 'available')
})

// ── Attempted is not completed ──────────────────────────────────────

test('a topic scored below the pass mark is in progress, not done', () => {
  const rows = [{ name: 'Nouns' }, { name: 'Punctuation' }]
  const results = [{
    quizId: 'q1', percentage: 30,
    topicScores: { Nouns: { correct: 3, total: 10 } },
  }]
  const topics = buildSubjectTopics({ rows, results })
  assert.equal(topics[0].status, 'in-progress')
  assert.equal(topics[0].bestScore, 30)
  const summary = summariseSubjectProgress(topics)
  assert.equal(summary.done, 0)
  assert.equal(summary.touched, 1)
})

test('a topic passed at the pass mark is done', () => {
  const rows = [{ name: 'Nouns' }, { name: 'Punctuation' }]
  const topics = buildSubjectTopics({
    rows,
    subjectQuizzes: [{ id: 'q1', topic: 'Nouns' }, { id: 'q2', topic: 'Punctuation' }],
    results: [{ quizId: 'q1', topicScores: { Nouns: { correct: TOPIC_PASS_MARK, total: 100 } } }],
  })
  assert.equal(topics[0].status, 'completed')
  assert.equal(summariseSubjectProgress(topics).percent, 50)
})

test('an answered topic counts as material even when its quiz is gone', () => {
  // The quiz was unpublished after the attempt, or the catalogue read came
  // back short. Either way a real score must not be erased into "coming soon".
  const topics = buildSubjectTopics({
    rows: [{ name: 'Nouns' }, { name: 'Punctuation' }],
    subjectQuizzes: [],
    results: [{ quizId: 'gone', topicScores: { Nouns: { correct: 9, total: 10 } } }],
  })
  const summary = summariseSubjectProgress(topics)
  assert.equal(summary.state, 'in-progress')
  assert.equal(summary.percent, 50)
})

test('a failed catalogue read says nothing rather than "coming soon"', () => {
  // An unreadable notes/quizzes query is not an empty catalogue. Reporting it
  // as one is an absence of evidence rendered as a finding.
  const topics = buildSubjectTopics({ rows: [{ name: 'A' }, { name: 'B' }] })
  const blind = summariseSubjectProgress(topics, { materialsKnown: false })
  assert.equal(blind.state, 'unknown')
  assert.equal(blind.percent, null)
  assert.equal(subjectRowMeta({ term: 1, summary: blind }), 'Term 1 · 2 topics')
  const known = summariseSubjectProgress(topics, { materialsKnown: true })
  assert.equal(known.state, 'no-material')
})

test('one passed topic does not finish the subject', () => {
  // The old clamp turned any evidence into full coverage. Seven rows, one
  // passed, is one seventh.
  const rows = Array.from({ length: 7 }, (_, i) => ({ name: `Topic ${i + 1}` }))
  const topics = buildSubjectTopics({
    rows,
    subjectQuizzes: rows.map((r, i) => ({ id: `q${i}`, topic: r.name })),
    results: [{ quizId: 'q0', percentage: 90, topicScores: { 'Topic 1': { correct: 9, total: 10 } } }],
  })
  const summary = summariseSubjectProgress(topics)
  assert.equal(summary.done, 1)
  assert.equal(summary.total, 7)
  assert.equal(summary.percent, 14)
  assert.equal(subjectRowMeta({ term: 1, summary }), 'Term 1 · 1 of 7 topics done')
})

// ── Attribution ─────────────────────────────────────────────────────

test('a key is attributed to its single best row, never to every overlap', () => {
  // 'Energy' overlaps both rows under the shared title matcher; crediting
  // both would report two topics done for one result.
  const rows = [{ name: 'Energy' }, { name: 'Materials and Energy' }]
  const topics = buildSubjectTopics({
    rows,
    results: [{ quizId: 'q1', topicScores: { Energy: { correct: 10, total: 10 } } }],
  })
  assert.equal(topics.filter((t) => t.status === 'completed').length, 1)
  assert.equal(topics[0].status, 'completed')
})

test('a whole-quiz result reaches its topic through the quiz, not the keys', () => {
  // Questions carry no topic, so topicScores is {General}. The quiz doc's own
  // topic is the only link, and dropping it lost every quiz authored that way.
  const rows = [{ name: 'Fractions' }]
  const topics = buildSubjectTopics({
    rows,
    subjectQuizzes: [{ id: 'q1', topic: 'Fractions' }],
    results: [{ quizId: 'q1', percentage: 80, topicScores: { General: { correct: 8, total: 10 } } }],
  })
  assert.equal(topics[0].status, 'completed')
  assert.equal(topics[0].bestScore, 80)
})

test('the title matcher connects the plan wording to the published note', () => {
  const rows = [{ name: 'Electric Circuits', note: null }]
  const notes = [{ id: 'n1', title: '5.2 Electric Current and Circuits' }]
  const topics = buildSubjectTopics({
    rows, subjectNotes: notes, termNotes: notes,
    noteProgress: [{ noteId: 'n1', status: 'completed' }],
  })
  assert.equal(topics[0].noteTarget.id, 'n1')
  assert.equal(topics[0].status, 'completed')
})

test('a plan row that names its note gets that note exactly', () => {
  // "Fruits & Seeds as Food" (Health) and "Fruits & Seeds" (Plants) share
  // every meaningful word; only the stated title separates them.
  const notes = [{ id: 'food', title: '2.2 Fruits' }, { id: 'seeds', title: '4.3 Fruits and Seeds' }]
  const topics = buildSubjectTopics({
    rows: [{ name: 'Fruits & Seeds as Food', note: '2.2 Fruits' }],
    subjectNotes: notes, termNotes: notes,
  })
  assert.equal(topics[0].noteTarget.id, 'food')
})

// ── Started / not started / unmarked ────────────────────────────────

test('an opened but unfinished note is in progress', () => {
  const notes = [{ id: 'n1', title: 'Nouns' }]
  const topics = buildSubjectTopics({
    rows: [{ name: 'Nouns' }], subjectNotes: notes, termNotes: notes,
    noteProgress: [{ noteId: 'n1', status: 'in-progress' }],
  })
  assert.equal(topics[0].status, 'in-progress')
})

test('an attempt still awaiting marking starts a topic but never finishes it', () => {
  // A throttled AI grader must not be able to award a pass.
  const rows = [{ name: 'Composition Writing' }]
  const topics = buildSubjectTopics({
    rows,
    subjectQuizzes: [{ id: 'q1', topic: 'Composition Writing' }],
    results: [{ quizId: 'q1', percentage: 100, finalScore: null, scoreStatus: 'provisional', gradingStatus: 'pending', topicScores: {} }],
  })
  assert.equal(topics[0].bestScore, null)
  assert.equal(topics[0].status, 'in-progress')
})

test('material published but nothing done reads as not started, with no percentage claim', () => {
  const notes = [{ id: 'n1', title: 'Nouns' }]
  const { summary } = computeSubjectProgress({
    subjectId: 'english', grade: 7, term: 1,
    subjectNotes: notes, termNotes: notes,
  })
  assert.equal(summary.state, 'not-started')
  assert.equal(summary.started, false)
  assert.equal(summary.percent, 0)
  assert.match(subjectRowMeta({ term: 1, summary }), /Not started$/)
})

test('every row done reports complete', () => {
  const rows = [{ name: 'A' }, { name: 'B' }]
  const notes = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]
  const topics = buildSubjectTopics({
    rows, subjectNotes: notes, termNotes: notes,
    noteProgress: [{ noteId: 'a', status: 'completed' }, { noteId: 'b', status: 'completed' }],
  })
  const summary = summariseSubjectProgress(topics)
  assert.equal(summary.state, 'complete')
  assert.equal(summary.percent, 100)
})

test('no rows at all is its own state, not zero per cent', () => {
  const summary = summariseSubjectProgress([])
  assert.equal(summary.state, 'no-topics')
  assert.equal(summary.percent, null)
  assert.match(subjectRowMeta({ term: 1, summary }), /Topics coming soon/)
})

// ── The two screens cannot disagree ─────────────────────────────────

test('the home row and the subject screen measure the same topics', () => {
  const notes = [{ id: 'n1', title: '1.1 The Digestive System' }]
  const args = {
    subjectId: 'science', grade: 7, term: 1,
    subjectNotes: notes, termNotes: notes,
    subjectQuizzes: [{ id: 'q1', topic: 'Diseases — Viruses & Bacteria' }],
    results: [{ quizId: 'q1', percentage: 70, topicScores: { Diseases: { correct: 7, total: 10 } } }],
    noteProgress: [{ noteId: 'n1', status: 'completed' }],
  }
  const a = computeSubjectProgress(args)
  const b = computeSubjectProgress(args)
  assert.equal(a.summary.percent, b.summary.percent)
  assert.equal(a.summary.done, 2)
  // The denominator is the rows the screen renders — planned plus unplaced.
  assert.equal(a.summary.total, a.topics.length)
  assert.equal(a.summary.percent, Math.round((2 / a.topics.length) * 100))
})

test('the percentage divides by the topic count the row prints', () => {
  const { topics, summary } = computeSubjectProgress({ subjectId: 'science', grade: 7, term: 1 })
  // The old model printed the term rows and divided by the 5 all-year
  // catalogue topics. Same list, one number.
  assert.equal(summary.total, topics.length)
  assert.notEqual(summary.total, 5)
})

// ── Runner ──────────────────────────────────────────────────────────

let failed = 0
for (const [name, fn] of tests) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed += 1
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}
if (failed > 0) {
  console.error(`\n${failed} of ${tests.length} subject-progress tests failed`)
  process.exit(1)
}
console.log(`\nsubject progress: ${tests.length} tests passed`)
