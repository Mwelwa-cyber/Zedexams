// Unit tests for the "Create paper with AI" taxonomy helpers
// (src/components/teacher/paperTaxonomy.js). Run with `node`.
//
// Guards the regressions behind the reported bugs:
//   - lower-primary / ECE subjects must resolve to the keys the syllabus
//     actually stores them under (numeracy, zambian_language, …),
//   - ECE Nursery/Reception must be selectable grades,
//   - topic caps must scale by test type (cumulative tests cover many),
//   - the Test Paper Studio exposes exactly four test types
//     (topic / weekly / mid-term / end-of-term).

import assert from 'node:assert'
import {
  PAPER_TYPES, PAPER_GRADE_OPTIONS, paperGradeOptions, isPaperGrade,
  maxTopicsFor, isCumulativeType, subjectLabel, toKbSubjectKey,
  studioGradeToKbGrade, FALLBACK_SUBJECT_KEYS,
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

// Grade 7 was abolished from primary in the 2023 curriculum (3-6-4-2):
// not selectable under 2023, still available under 2013.
const grades2023 = paperGradeOptions('2023').map((g) => g.value)
const grades2013 = paperGradeOptions('2013').map((g) => g.value)
ok(!grades2023.includes('7'), '2023 framework drops Grade 7')
ok(grades2013.includes('7'), '2013 framework keeps Grade 7')
ok(grades2023.includes('6') && grades2023.includes('1'), '2023 keeps G1–G6')
ok(grades2023.includes('ECE_N') && grades2023.includes('ECE_R'), '2023 keeps ECE bands')
ok(grades2023.includes('8') && grades2023.includes('12'),
  '2023 keeps secondary grades (only primary G7 removed)')

// ── Test types ───────────────────────────────────────────────────────────
// The studio exposes exactly four types, in increasing scope.
const typeValues = PAPER_TYPES.map((t) => t.value)
eq(typeValues.length, 4, 'exactly four test types')
ok(!typeValues.includes('exercise'), 'exercise removed from AI paper UI')
ok(!typeValues.includes('monthly_test') && !typeValues.includes('mock_exam'),
  'monthly_test + mock_exam removed from the studio')
ok(typeValues.includes('topic_test') && typeValues.includes('weekly_test') &&
  typeValues.includes('mid_term') && typeValues.includes('end_of_term'),
  'topic / weekly / mid-term / end-of-term present')

// ── Topic caps scale by type ─────────────────────────────────────────────
eq(maxTopicsFor('topic_test'), 3, 'topic test narrow')
eq(maxTopicsFor('weekly_test'), 3, 'weekly test narrow')
ok(maxTopicsFor('mid_term') >= maxTopicsFor('weekly_test'), 'mid-term ≥ weekly')
ok(maxTopicsFor('end_of_term') >= maxTopicsFor('mid_term'), 'end of term ≥ mid-term')
ok(maxTopicsFor('end_of_term') >= 10, 'end of term covers many topics')
eq(maxTopicsFor('unknown_type'), 3, 'unknown type → safe default')

// Cumulative types expose the "Add all topics" affordance.
ok(isCumulativeType('end_of_term') && isCumulativeType('mid_term'), 'cumulative types')
ok(!isCumulativeType('topic_test') && !isCumulativeType('weekly_test'),
  'narrow types are not cumulative')

console.log(`✓ paper-taxonomy: ${passed} assertions passed`)
