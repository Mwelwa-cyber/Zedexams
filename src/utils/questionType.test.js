/**
 * Unit tests for the shared question-type + marks normalizer
 * (src/utils/questionType.js) — the single source of truth the editor,
 * importers, scorer and exporters now share.
 *
 * The cross-surface behavior (import→save→read→score) is locked by
 * scripts/test-question-consistency.mjs; this file tests the module's own API:
 * the marks policy, the import-spelling tolerance, the assessment namespace,
 * and the quiz⇄assessment bridge. Plus a parity guard that the assessment
 * namespace here matches functions/teacherTools/assessmentSchema.js (the two
 * module systems can't share a module, so the test pins the parity).
 *
 * Run: node src/utils/questionType.test.js   (npm run test:question-type)
 */
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  canonicalizeQuestionType,
  canonicalizeImportedQuestionType,
  normalizeMarks,
  MARKS_BOUNDS,
  ASSESSMENT_QUESTION_TYPES,
  canonicalizeAssessmentType,
  editorTypeToAssessment,
  assessmentTypeToEditor,
} from './questionType.js'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}
const eq = (name, a, b) => ok(`${name} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, a === b)

console.log('questionType — editor canonicalization')
eq('truefalse → tf', canonicalizeQuestionType('truefalse'), 'tf')
eq('fill_in_the_blank → fill_blanks', canonicalizeQuestionType('fill_in_the_blank'), 'fill_blanks')
eq('mcq passes through', canonicalizeQuestionType('mcq'), 'mcq')
eq('unknown passes through unchanged', canonicalizeQuestionType('multiple_choice'), 'multiple_choice')

console.log('\nquestionType — import-spelling tolerance')
eq('"multiple choice" → mcq', canonicalizeImportedQuestionType('multiple choice'), 'mcq')
eq('"multiple-choice" → mcq', canonicalizeImportedQuestionType('multiple-choice'), 'mcq')
eq('"short" → short_answer', canonicalizeImportedQuestionType('short'), 'short_answer')
eq('"number" → numeric', canonicalizeImportedQuestionType('number'), 'numeric')
eq('"true/false" → tf (via shared canonicalizer)', canonicalizeImportedQuestionType('true/false'), 'tf')
eq('unknown import type passes through', canonicalizeImportedQuestionType('gibberish'), 'gibberish')

console.log('\nquestionType — normalizeMarks (one policy, per-context bounds)')
// quiz bounds 1..20
eq('quiz: 15 → 15', normalizeMarks(15, MARKS_BOUNDS.quiz), 15)
eq('quiz: 20 → 20', normalizeMarks(20, MARKS_BOUNDS.quiz), 20)
eq('quiz: 25 clamps to 20', normalizeMarks(25, MARKS_BOUNDS.quiz), 20)
eq('quiz: 0 falls back to 1', normalizeMarks(0, MARKS_BOUNDS.quiz), 1)
eq('quiz: NaN falls back to 1', normalizeMarks('abc', MARKS_BOUNDS.quiz), 1)
eq('quiz: -3 falls back to 1', normalizeMarks(-3, MARKS_BOUNDS.quiz), 1)
eq('quiz: 15.7 floors to 15', normalizeMarks(15.7, MARKS_BOUNDS.quiz), 15)
eq('quiz: numeric string "12" → 12', normalizeMarks('12', MARKS_BOUNDS.quiz), 12)
eq('default bounds are quiz bounds', normalizeMarks(99), 20)
// assessment bounds 1..100 (the divergence the policy preserves on purpose)
eq('assessment: 50 → 50 (no 20 cap)', normalizeMarks(50, MARKS_BOUNDS.assessmentQuestion), 50)
eq('assessment: 150 clamps to 100', normalizeMarks(150, MARKS_BOUNDS.assessmentQuestion), 100)
// sub-part bounds 0..99 (min 0 allowed)
eq('subPart: 0 stays 0', normalizeMarks(0, MARKS_BOUNDS.subPart), 0)
eq('subPart: 120 clamps to 99', normalizeMarks(120, MARKS_BOUNDS.subPart), 99)
// custom fallback
eq('honours an explicit fallback', normalizeMarks('x', { min: 1, max: 20, fallback: 5 }), 5)

console.log('\nquestionType — assessment namespace')
eq('"multiple choice" → multiple_choice', canonicalizeAssessmentType('multiple choice'), 'multiple_choice')
eq('"tf" → true_false', canonicalizeAssessmentType('tf'), 'true_false')
eq('essay passes through', canonicalizeAssessmentType('essay'), 'essay')

console.log('\nquestionType — the quiz⇄assessment bridge')
eq('editor mcq → assessment multiple_choice', editorTypeToAssessment('mcq'), 'multiple_choice')
eq('editor tf → assessment true_false', editorTypeToAssessment('tf'), 'true_false')
eq('editor short (legacy) → assessment short_answer', editorTypeToAssessment('short'), 'short_answer')
ok('editor numeric has no clean assessment counterpart (null)', editorTypeToAssessment('numeric') === null)
ok('editor fill_blanks has no clean assessment counterpart (null)', editorTypeToAssessment('fill_blanks') === null)
eq('assessment multiple_choice → editor mcq', assessmentTypeToEditor('multiple_choice'), 'mcq')
eq('assessment true_false → editor tf', assessmentTypeToEditor('true_false'), 'tf')
ok('assessment structured has no clean editor counterpart (null)', assessmentTypeToEditor('structured') === null)
ok('assessment calculation has no clean editor counterpart (null)', assessmentTypeToEditor('calculation') === null)
// bijective pairs round-trip
for (const t of ['mcq', 'tf', 'short_answer', 'essay', 'matching']) {
  eq(`round-trip ${t}`, assessmentTypeToEditor(editorTypeToAssessment(t)), t)
}

console.log('\nquestionType — assessment namespace parity with functions/')
// functions/ (CJS) can't import this (ESM) module, so pin the parity by text.
const here = dirname(fileURLToPath(import.meta.url))
const assessmentSchemaSrc = readFileSync(
  join(here, '../../functions/teacherTools/assessmentSchema.js'),
  'utf8',
)
const allowedBlock = assessmentSchemaSrc.match(/ALLOWED_TYPES\s*=\s*new Set\(\[([\s\S]*?)\]\)/)
ok('found ALLOWED_TYPES in assessmentSchema.js', !!allowedBlock)
const functionsTypes = [...allowedBlock[1].matchAll(/["']([\w]+)["']/g)].map((m) => m[1]).sort()
const moduleTypes = [...ASSESSMENT_QUESTION_TYPES].sort()
ok(
  `ASSESSMENT_QUESTION_TYPES matches functions/ ALLOWED_TYPES (${moduleTypes.join(',')})`,
  JSON.stringify(functionsTypes) === JSON.stringify(moduleTypes),
)

console.log(`\n✓ ${passed} assertions passed`)
