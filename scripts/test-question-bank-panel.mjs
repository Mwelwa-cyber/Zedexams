/**
 * Unit tests for the Exam Studio Question Bank side-panel pure logic
 * (src/utils/questionBankPanel.js).
 *
 * Plain-node assertion script — run with `node scripts/test-question-bank-panel.mjs`
 * or `npm run test:question-bank-panel`. Throws on the first failed assertion.
 */
import {
  normalizeGrade, gradeMatches, subjectMatches, topicMatches,
  deriveContext, countTopicMatches, applyPanelFilters, facetOptions,
} from '../src/utils/questionBankPanel.js'

let passed = 0
function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
}
function eq(a, b, msg) {
  assert(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

// A tiny bank fixture. `data` carries a stem so bankRowMatches can search it.
const row = (o) => ({
  id: o.id,
  grade: o.grade ?? '',
  subject: o.subject ?? '',
  topic: o.topic ?? '',
  type: o.type ?? 'mcq',
  marks: o.marks ?? 1,
  difficulty: o.difficulty ?? '',
  usageCount: o.usageCount ?? 0,
  // Real rows always carry `preview` (the stem snippet); bankRowMatches searches it.
  preview: o.preview ?? o.stem ?? '',
  keywords: o.keywords ?? [],
  data: JSON.stringify({ text: o.stem ?? o.preview ?? '' }),
})

const rows = [
  row({ id: 'a', grade: '4', subject: 'Mathematics', topic: 'Common Fractions', type: 'mcq', marks: 2, difficulty: 'easy', stem: 'Add the fractions', usageCount: 5 }),
  row({ id: 'b', grade: 'Grade 4', subject: 'Mathematics', topic: 'Fractions', type: 'short_answer', marks: 3, difficulty: 'medium', stem: 'Simplify the fraction', usageCount: 0 }),
  row({ id: 'c', grade: '4', subject: 'Mathematics', topic: 'Geometry', type: 'mcq', marks: 1, difficulty: 'easy', stem: 'Name the shape' }),
  row({ id: 'd', grade: '5', subject: 'Mathematics', topic: 'Fractions', type: 'mcq', marks: 2, difficulty: 'hard', stem: 'Compare fractions' }),
  row({ id: 'e', grade: '4', subject: 'English', topic: 'Grammar', type: 'mcq', marks: 1, stem: 'Pick the verb' }),
]

/* ── normalizeGrade / gradeMatches ─────────────────────────────── */
eq(normalizeGrade('Grade 4'), '4', 'strips "Grade"')
eq(normalizeGrade('G4'), '4', 'strips "G"')
eq(normalizeGrade('  grade   4 '), '4', 'collapses whitespace')
assert(gradeMatches({ grade: 'Grade 4' }, '4'), 'Grade 4 matches 4')
assert(gradeMatches({ grade: '4' }, 'Grade 4'), '4 matches Grade 4')
assert(!gradeMatches({ grade: '5' }, '4'), '5 does not match 4')
assert(gradeMatches({ grade: '' }, '4'), 'untagged grade is kept (lenient)')
assert(gradeMatches({ grade: '4' }, ''), 'no grade filter keeps everything')

/* ── subjectMatches ────────────────────────────────────────────── */
assert(subjectMatches({ subject: 'Mathematics' }, 'mathematics'), 'case-insensitive subject')
assert(subjectMatches({ subject: 'Integrated Science' }, 'science'), 'substring subject match')
assert(!subjectMatches({ subject: 'English' }, 'Mathematics'), 'different subject excluded')
assert(subjectMatches({ subject: '' }, 'Mathematics'), 'untagged subject is kept')

/* ── topicMatches ──────────────────────────────────────────────── */
assert(topicMatches({ topic: 'Common Fractions' }, 'Fractions'), 'row topic contains paper topic')
assert(topicMatches({ topic: 'Fractions' }, 'Common Fractions'), 'paper topic contains row topic')
assert(topicMatches({ topic: 'Geometry' }, 'Fractions; Geometry'), 'matches one of a topic list')
assert(!topicMatches({ topic: 'Algebra' }, 'Fractions'), 'unrelated topic excluded')
assert(!topicMatches({ topic: '' }, 'Fractions'), 'untagged topic never matches a topic query')

/* ── deriveContext: topic level ────────────────────────────────── */
const ctxTopic = deriveContext(rows, { grade: '4', subject: 'Mathematics', topic: 'Fractions' })
eq(ctxTopic.scope, 'topic', 'topic-level scope when matches exist')
eq(ctxTopic.widened, false, 'not widened when topic matches')
eq(ctxTopic.rows.length, 2, 'only the two grade-4 maths fraction rows (a, b) — not grade-5 d')
assert(ctxTopic.rows.every(r => ['a', 'b'].includes(r.id)), 'topic rows are a and b')

/* ── deriveContext: subject fallback when topic has no matches ──── */
const ctxFallback = deriveContext(rows, { grade: '4', subject: 'Mathematics', topic: 'Statistics' })
eq(ctxFallback.scope, 'subject', 'falls back to subject scope')
eq(ctxFallback.widened, true, 'flags widened on fallback')
eq(ctxFallback.rows.length, 3, 'all three grade-4 maths rows (a, b, c)')

/* ── deriveContext: no topic set ───────────────────────────────── */
const ctxNoTopic = deriveContext(rows, { grade: '4', subject: 'Mathematics' })
eq(ctxNoTopic.scope, 'subject', 'subject scope with no topic')
eq(ctxNoTopic.widened, false, 'no-topic is not a widening event')
eq(ctxNoTopic.rows.length, 3, 'grade-4 maths rows only')

/* ── countTopicMatches (nudge) ─────────────────────────────────── */
eq(countTopicMatches(rows, { grade: '4', subject: 'Mathematics', topic: 'Fractions' }), 2, 'nudge counts topic matches')
eq(countTopicMatches(rows, { grade: '4', subject: 'Mathematics', topic: 'Statistics' }), 0, 'no nudge when nothing matches')
eq(countTopicMatches(rows, { grade: '4', subject: 'Mathematics', topic: '' }), 0, 'no nudge without a topic')

/* ── applyPanelFilters ─────────────────────────────────────────── */
const base = ctxFallback.rows // a, b, c
eq(applyPanelFilters(base, { type: 'mcq' }).length, 2, 'type filter (a, c)')
eq(applyPanelFilters(base, { difficulty: 'Easy' }).length, 2, 'difficulty is case-insensitive (a, c)')
eq(applyPanelFilters(base, { marks: 3 }).length, 1, 'marks filter (b)')
eq(applyPanelFilters(base, { marks: '' }).length, 3, 'empty marks filter is a no-op')
eq(applyPanelFilters(base, { term: 'simplify' }).length, 1, 'free-text search hits the stem (b)')
eq(applyPanelFilters(base, { term: 'fraction', type: 'mcq' }).length, 1, 'stacked filters (a)')

/* ── facetOptions ──────────────────────────────────────────────── */
const facets = facetOptions(base)
assert(JSON.stringify(facets.difficulties) === JSON.stringify(['easy', 'medium']), 'distinct difficulties sorted')
assert(JSON.stringify(facets.marks) === JSON.stringify([1, 2, 3]), 'distinct marks sorted numerically')
assert(facets.types.includes('mcq') && facets.types.includes('short_answer'), 'distinct types')

/* ── defensive: non-array inputs ───────────────────────────────── */
eq(deriveContext(null, {}).rows.length, 0, 'null rows → empty')
eq(applyPanelFilters(undefined, {}).length, 0, 'undefined rows → empty')
eq(countTopicMatches(null, { topic: 'x' }), 0, 'null rows → 0 count')

console.log(`\n✅ question-bank-panel: ${passed} assertions passed`)
