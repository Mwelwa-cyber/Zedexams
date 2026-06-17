// Unit tests for the "Create paper with AI" taxonomy helpers
// (src/components/teacher/paperTaxonomy.js). Run with `node`.
//
// Guards the regressions behind the reported bugs:
//   - lower-primary / ECE subjects must resolve to the keys the syllabus
//     actually stores them under (numeracy, zambian_language, …),
//   - ECE Nursery/Reception must be selectable grades,
//   - topic caps must scale by test type (cumulative tests cover many),
//   - 'exercise' must be gone from the AI paper UI and 'monthly_test' present.

import assert from 'node:assert'
import {
  PAPER_TYPES, PAPER_GRADE_OPTIONS, isPaperGrade, maxTopicsFor,
  isCumulativeType, subjectLabel, toKbSubjectKey, studioGradeToKbGrade,
  FALLBACK_SUBJECT_KEYS,
} from '../src/components/teacher/paperTaxonomy.js'

let passed = 0
const ok = (cond, msg) => { assert.ok(cond, msg); passed++ }
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); passed++ }

// ── Subject-key resolution ───────────────────────────────────────────────
// Display labels → canonical keys.
eq(toKbSubjectKey('Mathematics'), 'mathematics', 'Mathematics → mathematics')
eq(toKbSubjectKey('Integrated Science'), 'integrated_science', 'Integrated Science → key')
eq(toKbSubjectKey('Expressive Art'), 'expressive_arts', 'Expressive Art → expressive_arts')
eq(toKbSubjectKey('Cinyanja'), 'zambian_language', 'Cinyanja → zambian_language (lower-grade key)')
// Already-canonical keys pass through unchanged (idempotent) — the dynamic
// subject dropdown yields keys, and they must not be re-mangled.
eq(toKbSubjectKey('numeracy'), 'numeracy', 'numeracy is idempotent')
eq(toKbSubjectKey('zambian_language'), 'zambian_language', 'zambian_language idempotent')
eq(toKbSubjectKey('creative_and_technology_studies'), 'creative_and_technology_studies',
  'creative_and_technology_studies idempotent')
eq(toKbSubjectKey('english'), 'english', 'english idempotent')
eq(toKbSubjectKey(''), '', 'empty → empty')

// ── Subject labels ───────────────────────────────────────────────────────
eq(subjectLabel('numeracy'), 'Numeracy (Maths & Science)', 'numeracy label')
eq(subjectLabel('integrated_science'), 'Integrated Science', 'integrated_science label')
ok(subjectLabel('some_new_subject') === 'Some New Subject', 'unknown key title-cased')
for (const k of FALLBACK_SUBJECT_KEYS) {
  ok(subjectLabel(k).length > 0, `fallback subject ${k} has a label`)
}

// ── Grades ───────────────────────────────────────────────────────────────
ok(PAPER_GRADE_OPTIONS.some((g) => g.value === 'ECE_N'), 'ECE Nursery selectable')
ok(PAPER_GRADE_OPTIONS.some((g) => g.value === 'ECE_R'), 'ECE Reception selectable')
ok(PAPER_GRADE_OPTIONS.some((g) => g.value === '1'), 'Grade 1 selectable')
ok(isPaperGrade('ECE_N') && isPaperGrade('1') && !isPaperGrade('99'), 'isPaperGrade')
eq(studioGradeToKbGrade('ECE_N'), 'ECE_N', 'ECE_N passes through')
eq(studioGradeToKbGrade('4'), 'G4', 'bare number → G-prefixed')
eq(studioGradeToKbGrade('g7'), 'G7', 'already-prefixed normalised to upper')

// ── Test types ───────────────────────────────────────────────────────────
const typeValues = PAPER_TYPES.map((t) => t.value)
ok(!typeValues.includes('exercise'), 'exercise removed from AI paper UI')
ok(typeValues.includes('monthly_test'), 'monthly_test added')
ok(typeValues.includes('end_of_term') && typeValues.includes('mock_exam'),
  'end_of_term + mock_exam present')

// ── Topic caps scale by type ─────────────────────────────────────────────
eq(maxTopicsFor('topic_test'), 3, 'topic test narrow')
ok(maxTopicsFor('monthly_test') >= maxTopicsFor('topic_test'), 'monthly ≥ topic')
ok(maxTopicsFor('mid_term') >= maxTopicsFor('monthly_test'), 'mid-term ≥ monthly')
ok(maxTopicsFor('end_of_term') >= maxTopicsFor('mid_term'), 'end of term ≥ mid-term')
ok(maxTopicsFor('mock_exam') >= maxTopicsFor('end_of_term'), 'mock ≥ end of term')
ok(maxTopicsFor('end_of_term') >= 10, 'end of term covers many topics')
eq(maxTopicsFor('unknown_type'), 3, 'unknown type → safe default')

// Cumulative types expose the "Add all topics" affordance.
ok(isCumulativeType('end_of_term') && isCumulativeType('mock_exam'), 'cumulative types')
ok(!isCumulativeType('topic_test') && !isCumulativeType('monthly_test'),
  'narrow types are not cumulative')

console.log(`✓ paper-taxonomy: ${passed} assertions passed`)
