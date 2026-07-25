/**
 * questionRegeneration tests — the §3.6 acceptance criterion, literally.
 *
 * "Regenerating question 4 leaves questions 1–3 and 5+ byte-identical." That is a
 * claim about object identity, so these tests assert identity (===), not deep
 * equality: a question that came back as a fresh object with the same contents
 * would still be a rebuild, and a rebuild is what loses a teacher's work.
 *
 * Run: node src/utils/questionRegeneration.test.js
 */

import assert from 'node:assert/strict'
import {
  replaceQuestionInSections, mergeRegeneratedQuestion, canRegenerateQuestion,
  slotForQuestionNumber, flattenQuestions, avoidList, setQuestionLock,
} from './questionRegeneration.js'

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

function question(n, over = {}) {
  return {
    localId: `question-${n}`,
    _id: `doc-${n}`,
    text: `Question ${n}`,
    options: ['a', 'b', 'c', 'd'],
    correctAnswer: 0,
    explanation: `Because ${n}`,
    marks: 2,
    type: 'mcq',
    topic: 'Plants',
    partId: null,
    imageUrl: '',
    imageDiagram: null,
    locked: false,
    teacherEdited: false,
    ...over,
  }
}

/** A five-question paper: four standalone, plus a passage carrying two. */
function paper() {
  return [
    { id: 's1', kind: 'standalone', question: question(1) },
    { id: 's2', kind: 'standalone', question: question(2) },
    { id: 's3', kind: 'standalone', question: question(3) },
    {
      id: 's4', kind: 'passage',
      passage: { text: 'A short passage.', questions: [question(4), question(5)] },
    },
  ]
}

/* ── the acceptance criterion ───────────────────────────────────────────── */

test('regenerating question 4 leaves every other question byte-identical', () => {
  const before = paper()
  const { sections: after, replaced } = replaceQuestionInSections(
    before, 'question-4', (q) => ({ ...q, text: 'Rewritten' }),
  )
  assert.equal(replaced, true)

  // Sections 1-3 are the SAME objects — not copies with the same contents.
  for (let i = 0; i < 3; i += 1) {
    assert.equal(after[i], before[i], `section ${i + 1} was rebuilt`)
    assert.equal(after[i].question, before[i].question, `question ${i + 1} was rebuilt`)
  }
  // Question 5 shares the passage with the rewritten question 4, so its section
  // object necessarily changes — but the QUESTION object must not.
  assert.equal(after[3].passage.questions[1], before[3].passage.questions[1],
    'question 5 was rebuilt')
  // And the target did change.
  assert.notEqual(after[3].passage.questions[0], before[3].passage.questions[0])
  assert.equal(after[3].passage.questions[0].text, 'Rewritten')
  // The passage itself is untouched apart from its questions array.
  assert.equal(after[3].passage.text, before[3].passage.text)
})

test('regenerating a standalone question leaves the rest byte-identical', () => {
  const before = paper()
  const { sections: after } = replaceQuestionInSections(
    before, 'question-2', (q) => ({ ...q, text: 'New' }),
  )
  assert.equal(after[0], before[0])
  assert.equal(after[2], before[2])
  assert.equal(after[3], before[3])
  assert.notEqual(after[1], before[1])
})

test('a key that matches nothing hands back the original array untouched', () => {
  // Not a copy: the studio must not think the paper changed when nothing did.
  const before = paper()
  const result = replaceQuestionInSections(before, 'question-99', (q) => q)
  assert.equal(result.sections, before)
  assert.equal(result.replaced, false)
})

test('a missing key or rewrite is a no-op, not a crash', () => {
  const before = paper()
  assert.equal(replaceQuestionInSections(before, '', (q) => q).sections, before)
  assert.equal(replaceQuestionInSections(before, 'question-1', null).sections, before)
  assert.deepEqual(replaceQuestionInSections(null, 'x', (q) => q).sections, [])
})

test('only the FIRST match is replaced, so a duplicated key cannot rewrite twice', () => {
  const dupe = [
    { id: 's1', kind: 'standalone', question: question(1) },
    { id: 's2', kind: 'standalone', question: question(1) },
  ]
  const { sections } = replaceQuestionInSections(dupe, 'question-1',
    (q) => ({ ...q, text: 'Rewritten' }))
  assert.equal(sections[0].question.text, 'Rewritten')
  assert.equal(sections[1].question.text, 'Question 1')
})

/* ── teacher edits are sacred ───────────────────────────────────────────── */

test('a locked question is refused outright', () => {
  const verdict = canRegenerateQuestion(question(1, { locked: true }))
  assert.equal(verdict.allowed, false)
  assert.equal(verdict.reason, 'locked')
  assert.match(verdict.message, /locked/i)
  assert.ok(!/blueprint|slot/i.test(verdict.message), 'the message leaks jargon')
})

test('an edited question is allowed but asks first', () => {
  const verdict = canRegenerateQuestion(question(1, { teacherEdited: true }))
  assert.equal(verdict.allowed, true)
  assert.equal(verdict.confirm, true)
  assert.match(verdict.message, /replace your changes/i)
})

test('an untouched AI question needs no confirmation', () => {
  const verdict = canRegenerateQuestion(question(1))
  assert.equal(verdict.allowed, true)
  assert.equal(verdict.confirm, false)
})

test('a question that is no longer there is refused, not regenerated blindly', () => {
  assert.equal(canRegenerateQuestion(null).allowed, false)
  assert.equal(canRegenerateQuestion(undefined).reason, 'missing')
})

test('locking a question leaves every other question byte-identical', () => {
  const before = paper()
  const { sections: after } = setQuestionLock(before, 'question-3', true)
  assert.equal(after[3].passage.questions[0], before[3].passage.questions[0])
  assert.equal(after[0], before[0])
  assert.equal(after[2].question.locked, true)
})

/* ── the merge: identity is never the model's to decide ─────────────────── */

test('the studio identity of a question survives a rewrite', () => {
  const existing = question(4, { partId: 'part-b', passageId: 'p1' })
  const merged = mergeRegeneratedQuestion(existing, {
    localId: 'hijacked', _id: 'hijacked', partId: 'part-z',
    text: 'New stem', marks: 99,
  })
  assert.equal(merged.localId, 'question-4')
  assert.equal(merged._id, 'doc-4')
  assert.equal(merged.partId, 'part-b')
  assert.equal(merged.passageId, 'p1')
  assert.equal(merged.text, 'New stem')
})

test('the slot decides the marks, so the header total cannot drift', () => {
  const merged = mergeRegeneratedQuestion(question(4), { text: 'x', marks: 99 }, {
    slot: { marks: 5, topic: 'Weather', learningOutcome: 'Explain rainfall' },
  })
  assert.equal(merged.marks, 5)
  assert.equal(merged.topic, 'Weather')
  assert.equal(merged.specificOutcome, 'Explain rainfall')
})

test('without a slot the replacement\'s own marks are taken', () => {
  assert.equal(mergeRegeneratedQuestion(question(4), { marks: 3 }).marks, 3)
})

test('a teacher\'s uploaded picture is not thrown away by a rewrite', () => {
  const existing = question(4, {
    imageUrl: 'https://x/mine.png', imageAlt: 'my diagram', imageAssetId: 'asset-1',
  })
  const merged = mergeRegeneratedQuestion(existing, { text: 'New stem' })
  assert.equal(merged.imageUrl, 'https://x/mine.png')
  assert.equal(merged.imageAlt, 'my diagram')
  assert.equal(merged.imageAssetId, 'asset-1')
})

test('…but a replacement that brings its own figure wins', () => {
  const existing = question(4, { imageUrl: 'https://x/old.png' })
  const merged = mergeRegeneratedQuestion(existing, {
    text: 'New', imageUrl: 'https://x/new.png', imageAlt: 'new alt',
  })
  assert.equal(merged.imageUrl, 'https://x/new.png')
  assert.equal(merged.imageAlt, 'new alt')
})

test('a rewritten question is no longer marked as teacher-edited', () => {
  const merged = mergeRegeneratedQuestion(
    question(4, { teacherEdited: true }), { text: 'New' })
  assert.equal(merged.teacherEdited, false)
})

test('the lock survives a rewrite that somehow got past the guard', () => {
  // Belt and braces: canRegenerateQuestion refuses a locked question, but if a
  // caller bypassed it the lock must not be cleared by the merge.
  const merged = mergeRegeneratedQuestion(
    question(4, { locked: true }), { text: 'New', locked: false })
  assert.equal(merged.locked, true)
})

test('review flags belong to the new text, not the old', () => {
  const merged = mergeRegeneratedQuestion(
    question(4, { requiresReview: true, reviewNotes: ['old note'] }),
    { text: 'New' },
  )
  assert.equal(merged.requiresReview, false)
  assert.deepEqual(merged.reviewNotes, [])
})

test('rewrites are counted so a question the model keeps failing at is visible', () => {
  const once = mergeRegeneratedQuestion(question(4), { text: 'a' })
  assert.equal(once.regenerationCount, 1)
  assert.equal(mergeRegeneratedQuestion(once, { text: 'b' }).regenerationCount, 2)
})

test('the merge never mutates the question it was given', () => {
  const existing = question(4)
  const snapshot = JSON.stringify(existing)
  mergeRegeneratedQuestion(existing, { text: 'New', marks: 7 })
  assert.equal(JSON.stringify(existing), snapshot)
})

/* ── the slot ───────────────────────────────────────────────────────────── */

const BLUEPRINT = {
  version: 'blueprint.v1',
  sections: [
    { items: [{ id: 'q1', number: 1, marks: 2 }, { id: 'q2', number: 2, marks: 2 }] },
    { items: [{ id: 'q3', number: 3, marks: 5, topic: 'Weather' }] },
  ],
}

test('a question\'s slot is found by its position in the paper', () => {
  assert.equal(slotForQuestionNumber(BLUEPRINT, 1).id, 'q1')
  assert.equal(slotForQuestionNumber(BLUEPRINT, 3).id, 'q3')
  assert.equal(slotForQuestionNumber(BLUEPRINT, 3).topic, 'Weather')
})

test('a position outside the plan has no slot, rather than a wrong one', () => {
  assert.equal(slotForQuestionNumber(BLUEPRINT, 0), null)
  assert.equal(slotForQuestionNumber(BLUEPRINT, 4), null)
  assert.equal(slotForQuestionNumber(BLUEPRINT, 1.5), null)
  assert.equal(slotForQuestionNumber(null, 1), null)
  assert.equal(slotForQuestionNumber({ sections: 'nope' }, 1), null)
})

/* ── helpers ────────────────────────────────────────────────────────────── */

test('flattenQuestions walks standalone and passage sections in paper order', () => {
  const all = flattenQuestions(paper())
  assert.equal(all.length, 5)
  assert.deepEqual(all.map((q) => q.localId),
    ['question-1', 'question-2', 'question-3', 'question-4', 'question-5'])
  assert.deepEqual(flattenQuestions(null), [])
})

test('the avoid list excludes the question being rewritten and strips markup', () => {
  const sections = paper()
  sections[0].question.text = '<p>What is <strong>photosynthesis</strong>?</p>'
  const avoid = avoidList(sections, 'question-4')
  assert.equal(avoid.length, 4)
  assert.equal(avoid[0], 'What is photosynthesis ?')
  assert.ok(!avoid.some((t) => t === 'Question 4'))
})

test('the avoid list is capped and truncated — it goes into a prompt', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    id: `s${i}`, kind: 'standalone',
    question: question(i, { text: 'x'.repeat(500) }),
  }))
  const avoid = avoidList(many, 'question-0', { limit: 5, stemLength: 20 })
  assert.equal(avoid.length, 5)
  assert.ok(avoid.every((t) => t.length <= 20))
})

test('a blank question stem contributes nothing to the avoid list', () => {
  const sections = [{ id: 's1', kind: 'standalone', question: question(1, { text: '   ' }) }]
  assert.deepEqual(avoidList(sections, 'question-9'), [])
})

console.log(`✓ question regeneration — ${passed} tests passed`)
