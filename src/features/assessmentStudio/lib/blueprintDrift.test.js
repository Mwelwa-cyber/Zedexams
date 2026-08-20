/**
 * blueprintDrift tests — the §3.4 inversion.
 *
 * The studio's analysis tools used to report ABSENCE ("no cognitive levels
 * tagged yet"). With a blueprint they report DRIFT from a stated intent, which
 * is the difference between a number a teacher can read and a number a teacher
 * can act on.
 *
 * Run: node src/utils/blueprintDrift.test.js
 */

import assert from 'node:assert/strict'
import { compareToBlueprint, questionTier, blueprintItems } from './blueprintDrift.js'

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

const BLUEPRINT = {
  version: 'blueprint.v1',
  totalMarks: 10,
  sections: [{
    name: '', items: [
      {
        id: 'q1', number: 1, topic: 'Plants', marks: 2, bloomLevel: 'remember',
        difficulty: 'recall', learningOutcome: 'Name the parts of a flower',
        figureRequired: true, activityType: 'multiple_choice', renderType: 'multiple_choice',
      },
      {
        id: 'q2', number: 2, topic: 'Weather', marks: 3, bloomLevel: 'understand',
        difficulty: 'understanding', learningOutcome: '', figureRequired: false,
        activityType: 'short_answer', renderType: 'short_answer',
      },
      {
        id: 'q3', number: 3, topic: 'Plants', marks: 5, bloomLevel: 'analyse',
        difficulty: 'analysis', learningOutcome: 'Explain pollination',
        figureRequired: false, activityType: 'structured', renderType: 'structured',
      },
    ],
  }],
}

/** A paper that fills the blueprint exactly. */
function onPlanQuestions() {
  return [
    {
      topic: 'Plants', marks: 2, bloom: 'remember', difficulty: 'easy',
      learningOutcome: 'Name the parts of a flower', imageUrl: 'https://x/y.png',
    },
    { topic: 'Weather', marks: 3, bloom: 'understand', difficulty: 'medium' },
    {
      topic: 'Plants', marks: 5, bloom: 'analyse', difficulty: 'hard',
      learningOutcome: 'Explain pollination',
    },
  ]
}

/* ── no blueprint: degrade, never break ─────────────────────────────────── */

test('a paper with no blueprint reports that, rather than failing', () => {
  const r = compareToBlueprint({ blueprint: null, questions: onPlanQuestions() })
  assert.equal(r.hasBlueprint, false)
  assert.equal(r.itemCount.actual, 3)
  assert.equal(r.summary, '')
  // Callers keep their existing discovery behaviour on this flag.
  assert.equal(r.onPlan, false)
})

test('an empty blueprint is treated as no blueprint', () => {
  const r = compareToBlueprint({ blueprint: { sections: [] }, questions: [] })
  assert.equal(r.hasBlueprint, false)
})

/* ── on plan ────────────────────────────────────────────────────────────── */

test('a paper that fills the plan reads as on plan', () => {
  const r = compareToBlueprint({ blueprint: BLUEPRINT, questions: onPlanQuestions() })
  assert.equal(r.hasBlueprint, true)
  assert.equal(r.onPlan, true)
  assert.equal(r.summary, 'Matches the plan.')
  assert.equal(r.marks.reconciles, true)
  assert.equal(r.marks.planned, 10)
  assert.equal(r.marks.actual, 10)
  assert.ok(r.topics.every((row) => row.status === 'met'))
  assert.ok(r.difficulty.every((row) => row.status === 'met'))
})

test('the studio and blueprint difficulty vocabularies compare', () => {
  // The paper is tagged easy/medium/hard; the plan is tagged with tiers. If
  // these did not fold together every paper would read as 100% drifted.
  assert.equal(questionTier({ difficulty: 'easy' }), 'recall')
  assert.equal(questionTier({ difficulty: 'hard' }), 'analysis')
  assert.equal(questionTier({ difficulty: 'analysis' }), 'analysis')
  assert.equal(questionTier({ difficulty: '' }), '')
  assert.equal(questionTier({}), '')
})

test('the British and American spellings of analyse compare', () => {
  // The generator emits 'analyse'; the studio's canonical key is 'analyze'.
  const r = compareToBlueprint({ blueprint: BLUEPRINT, questions: onPlanQuestions() })
  const analyse = r.bloom.find((row) => row.key === 'analyze')
  assert.ok(analyse, 'the analyse level did not resolve at all')
  assert.equal(analyse.status, 'met')
})

/* ── drift is reported, and named ───────────────────────────────────────── */

test('a missing question is reported against the plan', () => {
  const questions = onPlanQuestions().slice(0, 2)
  const r = compareToBlueprint({ blueprint: BLUEPRINT, questions })
  assert.equal(r.onPlan, false)
  assert.equal(r.itemCount.delta, -1)
  assert.match(r.summary, /2 questions where the plan had 3/)
})

test('marks that no longer reconcile are reported with both numbers', () => {
  const questions = onPlanQuestions()
  questions[0].marks = 5
  const r = compareToBlueprint({ blueprint: BLUEPRINT, questions })
  assert.equal(r.marks.reconciles, false)
  assert.equal(r.marks.planned, 10)
  assert.equal(r.marks.actual, 13)
  assert.match(r.summary, /13 marks where the plan had 10/)
})

test('an under-covered topic is named with planned vs actual', () => {
  const questions = onPlanQuestions()
  questions[2].topic = 'Weather'
  const r = compareToBlueprint({ blueprint: BLUEPRINT, questions })
  const plants = r.topics.find((row) => row.key === 'Plants')
  assert.equal(plants.planned, 2)
  assert.equal(plants.actual, 1)
  assert.equal(plants.status, 'short')
  assert.match(r.summary, /1 topic under-covered/)
})

test('a topic the plan never had is reported as unplanned, not as missing', () => {
  // Content that should not be there is a different problem from content that is
  // missing, and reads differently to a teacher.
  const questions = onPlanQuestions()
  questions[1].topic = 'Rocks'
  const r = compareToBlueprint({ blueprint: BLUEPRINT, questions })
  const rocks = r.topics.find((row) => row.key === 'Rocks')
  assert.equal(rocks.status, 'unplanned')
  assert.equal(rocks.planned, 0)
  assert.match(r.summary, /not in the plan/)
})

test('difficulty drift is reported as planned vs actual, not as a bare count', () => {
  // The old panel said "1 easy · 0 medium · 0 hard". This says what was wanted.
  const questions = onPlanQuestions()
  questions[2].difficulty = 'easy'
  const r = compareToBlueprint({ blueprint: BLUEPRINT, questions })
  const analysis = r.difficulty.find((row) => row.key === 'analysis')
  assert.equal(analysis.planned, 1)
  assert.equal(analysis.actual, 0)
  assert.equal(analysis.status, 'short')
  assert.equal(analysis.label, 'Analysis')
  assert.match(r.summary, /difficulty spread has shifted/)
})

test('rows are ordered by how far off they are', () => {
  const questions = onPlanQuestions()
  questions[0].topic = 'Rocks'
  questions[2].topic = 'Rocks'
  const r = compareToBlueprint({ blueprint: BLUEPRINT, questions })
  assert.ok(Math.abs(r.topics[0].delta) >= Math.abs(r.topics[r.topics.length - 1].delta))
})

/* ── outcomes and figures ───────────────────────────────────────────────── */

test('outcome coverage counts only outcomes the plan actually carried', () => {
  const r = compareToBlueprint({ blueprint: BLUEPRINT, questions: onPlanQuestions() })
  // Two of the three slots carried an outcome; the third's syllabus gave none,
  // so its absence is not drift.
  assert.equal(r.outcomes.planned, 2)
  assert.equal(r.outcomes.covered, 2)
  assert.deepEqual(r.outcomes.missing, [])
})

test('an outcome the paper stopped assessing is named', () => {
  const questions = onPlanQuestions()
  delete questions[2].learningOutcome
  const r = compareToBlueprint({ blueprint: BLUEPRINT, questions })
  assert.deepEqual(r.outcomes.missing, ['Explain pollination'])
  assert.equal(r.outcomes.covered, 1)
})

test('a planned figure that never arrived is counted', () => {
  const questions = onPlanQuestions()
  delete questions[0].imageUrl
  const r = compareToBlueprint({ blueprint: BLUEPRINT, questions })
  assert.equal(r.figures.planned, 1)
  assert.equal(r.figures.actual, 0)
  assert.equal(r.figures.missing, 1)
})

test('a figure counts whether it is an upload, a library shape or an option image', () => {
  const base = { topic: 'Plants', marks: 2, bloom: 'remember', difficulty: 'easy' }
  for (const figure of [
    { imageUrl: 'https://x/y.png' },
    { imageDiagram: { libraryKey: 'circle' } },
    { optionMedia: [null, { imageUrl: 'https://x/o.png' }] },
    { optionMedia: [{ diagram: { libraryKey: 'square' } }] },
  ]) {
    const r = compareToBlueprint({
      blueprint: { version: 'blueprint.v1', sections: [{ items: [{ id: 'q1', number: 1, marks: 2, figureRequired: true }] }] },
      questions: [{ ...base, ...figure }],
    })
    assert.equal(r.figures.actual, 1, JSON.stringify(figure))
  }
})

/* ── helpers ────────────────────────────────────────────────────────────── */

test('blueprintItems flattens every section', () => {
  assert.equal(blueprintItems(BLUEPRINT).length, 3)
  assert.deepEqual(blueprintItems(null), [])
  assert.deepEqual(blueprintItems({ sections: 'nope' }), [])
})

test('an empty paper says so rather than reporting drift on nothing', () => {
  const r = compareToBlueprint({ blueprint: BLUEPRINT, questions: [] })
  assert.match(r.summary, /the paper is empty/i)
})

/* ── Inherited keys are data, not lookups ───────────────────────────────── */

test('a difficulty tag named for an Object.prototype member yields a tier string', () => {
  // `STUDIO_DIFFICULTY_TO_TIER[raw] ||` resolved 'constructor' to the Object
  // constructor, so questionTier returned a FUNCTION where its contract says a
  // tier or ''. tally() then keyed on it and the difficulty table grew a row
  // labelled "function Object() { [native code] }".
  for (const tag of ['constructor', '__proto__', 'toString', 'valueOf']) {
    assert.equal(typeof questionTier({ difficulty: tag }), 'string', tag)
    assert.equal(questionTier({ difficulty: tag }), '', `${tag} is not a tier`)
  }
  // The real tags still map.
  assert.equal(questionTier({ difficulty: 'easy' }), 'recall')
  assert.equal(questionTier({ difficulty: 'analysis' }), 'analysis')
})

test('a topic named for an Object.prototype member is counted and labelled as itself', () => {
  // Two failures rode the same line. tally() into `{}` DROPPED a '__proto__'
  // topic and turned a 'constructor' count into a concatenated string; and
  // driftRows' `labels[key] ||` took the Object constructor as the row LABEL,
  // handing React a function and the sort a value with no .localeCompare.
  const blueprint = {
    version: 'blueprint.v1',
    sections: [{ items: [
      { topic: 'constructor', marks: 2 },
      { topic: '__proto__', marks: 2 },
      { topic: 'toString', marks: 2 },
      { topic: 'Fractions', marks: 2 },
    ] }],
  }
  const r = compareToBlueprint({ blueprint, questions: [{ topic: 'Fractions', marks: 2 }] })
  const byKey = new Map(r.topics.map((row) => [row.key, row]))
  for (const topic of ['constructor', '__proto__', 'toString', 'Fractions']) {
    const row = byKey.get(topic)
    assert.ok(row, `${topic} appears in the drift report`)
    assert.equal(typeof row.label, 'string', `${topic} label is a string`)
    assert.equal(row.label, topic, `${topic} is labelled as itself`)
    assert.equal(typeof row.planned, 'number', `${topic} planned is a number`)
    assert.equal(typeof row.delta, 'number', `${topic} delta is a number`)
  }
  assert.equal(byKey.get('constructor').planned, 1, 'counted once, not concatenated')
  assert.equal(byKey.get('__proto__').planned, 1, 'not swallowed by the prototype')
})

console.log(`✓ blueprint drift — ${passed} tests passed`)
