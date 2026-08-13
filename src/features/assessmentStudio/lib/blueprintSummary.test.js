/**
 * blueprintSummary tests — the plan a teacher reads before generating.
 *
 * The point of these is that the confirmation screen never shows machine
 * vocabulary and never shows a confident summary of a plan that isn't there.
 *
 * Run: node src/utils/blueprintSummary.test.js
 */

import assert from 'node:assert/strict'
import {
  summarizePlan, planHeadline, planTopicRows, planDifficultyRows,
  planActivityRows, planNotes, planSectionRows, planItems, listWords,
  presetById, DIFFICULTY_PRESETS, TIER_LABELS,
} from './blueprintSummary.js'

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

function item(over = {}) {
  return {
    id: 'q1', number: 1, topic: 'Plants', marks: 2, bloomLevel: 'remember',
    difficulty: 'recall', learningOutcome: 'Name the parts of a flower',
    activityType: 'multiple_choice', activityLabel: 'Multiple choice',
    activitySupport: 'native', renderType: 'multiple_choice',
    figureRequired: false, ...over,
  }
}

const PLAN = {
  version: 'blueprint.v1',
  totalMarks: 10,
  durationMinutes: 30,
  estimatedMinutes: 12,
  itemCount: 4,
  warnings: [],
  sections: [{
    name: '', heading: '', instructions: '', marks: 10, itemCount: 4,
    items: [
      item({ id: 'q1', number: 1, marks: 2, difficulty: 'recall' }),
      item({ id: 'q2', number: 2, marks: 2, topic: 'Weather', difficulty: 'understanding' }),
      item({
        id: 'q3', number: 3, marks: 3, difficulty: 'analysis',
        activityType: 'tracing', activityLabel: 'Tracing', activitySupport: 'unsupported',
        figureRequired: true, learningOutcome: '',
      }),
      item({ id: 'q4', number: 4, marks: 3, topic: 'Weather', difficulty: 'challenge' }),
    ],
  }],
}

/* ── headline ───────────────────────────────────────────────────────────── */

test('the headline states questions, marks and the time it will take', () => {
  assert.equal(planHeadline(PLAN), '4 questions · 10 marks · about 12 minutes of work')
})

test('one question is not "1 questions"', () => {
  assert.match(planHeadline({ ...PLAN, itemCount: 1 }), /^1 question · /)
})

test('a plan with no time estimate omits it rather than saying "about 0 minutes"', () => {
  assert.equal(planHeadline({ ...PLAN, estimatedMinutes: 0 }), '4 questions · 10 marks')
})

test('no plan produces no headline', () => {
  assert.equal(planHeadline(null), '')
})

/* ── topics ─────────────────────────────────────────────────────────────── */

test('topics are counted with their marks, biggest first', () => {
  const rows = planTopicRows(PLAN)
  assert.deepEqual(rows.map((r) => r.topic), ['Plants', 'Weather'])
  assert.equal(rows[0].questions, 2)
  assert.equal(rows[0].marks, 5)
  assert.equal(rows[1].marks, 5)
})

test('an untagged slot does not become a topic called ""', () => {
  const rows = planTopicRows({
    sections: [{ items: [item({ topic: '' }), item({ topic: '   ' })] }],
  })
  assert.deepEqual(rows, [])
})

/* ── difficulty ─────────────────────────────────────────────────────────── */

test('difficulty reads in ascending demand, in words, with percentages', () => {
  const rows = planDifficultyRows(PLAN)
  assert.deepEqual(rows.map((r) => r.key),
    ['recall', 'understanding', 'analysis', 'challenge'])
  assert.equal(rows[0].label, TIER_LABELS.recall)
  // Labels are English, not the tier ids the blueprint stores.
  assert.ok(!rows.some((r) => r.label === r.key), 'a raw tier id leaked into a label')
  assert.equal(rows[0].questions, 1)
  assert.equal(rows[0].percent, 25)
})

test('a tier with nothing on it is shown as zero, not dropped', () => {
  const rows = planDifficultyRows({ sections: [{ items: [item()] }] })
  const challenge = rows.find((r) => r.key === 'challenge')
  assert.equal(challenge.questions, 0)
  assert.equal(challenge.percent, 0)
})

/* ── activities ─────────────────────────────────────────────────────────── */

test('activities are named the way the teacher picked them, never as render types', () => {
  const rows = planActivityRows(PLAN)
  assert.equal(rows[0].label, 'Multiple choice')
  const tracing = rows.find((r) => r.key === 'tracing')
  assert.equal(tracing.label, 'Tracing')
  // The limited-support marker survives into the summary so the confirmation
  // screen can repeat the caveat the picker already made.
  assert.equal(tracing.limited, true)
})

/* ── notes ──────────────────────────────────────────────────────────────── */

test('the plan\'s own warnings are carried through first', () => {
  const notes = planNotes({ ...PLAN, warnings: ['This paper looks long.'] })
  assert.equal(notes[0], 'This paper looks long.')
})

test('figures are counted so the teacher knows pictures are coming', () => {
  assert.ok(planNotes(PLAN).some((n) => /1 question will need a picture/.test(n)))
})

test('partial outcome coverage is stated rather than implied', () => {
  assert.ok(planNotes(PLAN).some((n) => /3 of 4 questions are tied to a named syllabus outcome/.test(n)))
})

test('a syllabus with no outcomes at all says so once, honestly', () => {
  const notes = planNotes({
    sections: [{ items: [item({ learningOutcome: '' }), item({ learningOutcome: '' })] }],
  })
  assert.ok(notes.some((n) => /lists no learning outcomes/.test(n)))
  assert.ok(!notes.some((n) => /tied to a named syllabus outcome/.test(n)))
})

/* ── sections ───────────────────────────────────────────────────────────── */

test('a single unnamed run of questions shows no section rows', () => {
  // Printing "Part 1" on a Nursery worksheet that has no sections is theatre.
  assert.deepEqual(planSectionRows(PLAN), [])
})

test('real sections are listed with their questions and marks', () => {
  const rows = planSectionRows({
    sections: [
      { name: 'A', heading: 'SECTION A', marks: 20, items: [item(), item()] },
      { name: 'B', heading: 'SECTION B', marks: 30, itemCount: 3, items: [] },
    ],
  })
  assert.deepEqual(rows.map((r) => r.label), ['SECTION A', 'SECTION B'])
  assert.equal(rows[0].questions, 2)
  assert.equal(rows[1].questions, 3)
  assert.equal(rows[1].marks, 30)
})

/* ── the whole summary ──────────────────────────────────────────────────── */

test('a real plan summarises as ready', () => {
  const s = summarizePlan(PLAN)
  assert.equal(s.ready, true)
  assert.equal(s.itemCount, 4)
  assert.equal(s.totalMarks, 10)
  assert.equal(s.topics.length, 2)
})

test('a missing or empty plan is NOT ready, so no fake summary is shown', () => {
  assert.equal(summarizePlan(null).ready, false)
  assert.equal(summarizePlan({ sections: [] }).ready, false)
  assert.equal(summarizePlan({ sections: [{ items: [] }] }).ready, false)
  // …and it still returns a usable shape rather than throwing in the render.
  assert.deepEqual(summarizePlan(null).topics, [])
  assert.deepEqual(summarizePlan(null).notes, [])
})

/* ── helpers + presets ──────────────────────────────────────────────────── */

test('planItems flattens every section and tolerates rubbish', () => {
  assert.equal(planItems(PLAN).length, 4)
  assert.deepEqual(planItems(null), [])
  assert.deepEqual(planItems({ sections: 'nope' }), [])
})

test('listWords joins the way a person writes a list', () => {
  assert.equal(listWords(['a']), 'a')
  assert.equal(listWords(['a', 'b']), 'a and b')
  assert.equal(listWords(['a', 'b', 'c']), 'a, b and c')
  assert.equal(listWords([]), '')
})

test('the difficulty presets are plain-language choices, not percentage boxes', () => {
  assert.ok(DIFFICULTY_PRESETS.length >= 3)
  for (const preset of DIFFICULTY_PRESETS) {
    assert.ok(preset.label && preset.hint, `${preset.id} needs a label and a hint`)
    assert.ok(!/bloom|tier|recall:|weight/i.test(`${preset.label} ${preset.hint}`),
      `${preset.id} leaks machine vocabulary into the UI`)
  }
})

test('the default preset defers to the level rather than imposing a spread', () => {
  assert.equal(presetById('band').weights, null)
  assert.equal(presetById('nonsense').id, 'band')
  assert.equal(presetById('harder').weights.challenge > presetById('gentler').weights.challenge, true)
})

console.log(`✓ blueprint summary — ${passed} tests passed`)
