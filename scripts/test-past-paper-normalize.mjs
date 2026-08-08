/**
 * Tests for the past-paper content-normalization pipeline
 * (src/utils/pastPaperNormalize.js).
 *
 * Run: node scripts/test-past-paper-normalize.mjs   (npm run test:past-paper-normalize)
 */
import assert from 'node:assert'
import {
  normalizeGrade,
  normalizeSubjectId,
  normalizeTitle,
  normalizeExamBoard,
  normalizeYear,
  normalizePaperNumber,
  paperSlug,
  normalizePaperFields,
} from '../src/utils/pastPaperNormalize.js'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}
const eq = (name, a, b) => ok(`${name} (${JSON.stringify(a)} === ${JSON.stringify(b)})`, a === b)

const THIS_YEAR = new Date().getFullYear()

console.log('grade')
eq('"Grade 7" → "7"', normalizeGrade('Grade 7'), '7')
eq('number 7 → "7"', normalizeGrade(7), '7')
eq('"G12" → "12"', normalizeGrade('G12'), '12')
eq('"  7 " → "7"', normalizeGrade('  7 '), '7')
eq('ECE code passes through', normalizeGrade('ECE_N'), 'ECE_N')

console.log('\nsubject (→ canonical PAPER_SUBJECTS id)')
eq('id passes through', normalizeSubjectId('mathematics'), 'mathematics')
eq('label "Mathematics" → id', normalizeSubjectId('Mathematics'), 'mathematics')
eq('mixed case "MATHS"/"Maths" resolves via curriculum', normalizeSubjectId('Maths'), 'mathematics')
eq('underscore variant → hyphen id', normalizeSubjectId('social_studies'), 'social-studies')
eq('space variant → hyphen id', normalizeSubjectId('Social Studies'), 'social-studies')
eq('special-paper category label → id', normalizeSubjectId('Special Paper 2'), 'special-paper-2')
eq('special-paper underscore variant → id', normalizeSubjectId('special_paper_2'), 'special-paper-2')
eq('unknown subject → stable slug (not a wrong id)', normalizeSubjectId('Underwater Basket Weaving'), 'underwater-basket-weaving')

console.log('\ntitle casing')
eq('ALL CAPS → Title Case', normalizeTitle('MATHEMATICS PAPER 1'), 'Mathematics Paper 1')
eq('all lower → Title Case', normalizeTitle('mathematics paper 1 (2023)'), 'Mathematics Paper 1 (2023)')
eq('collapses whitespace + trims', normalizeTitle('  English   Paper   2  '), 'English Paper 2')
eq('keeps acronym ECZ uppercased', normalizeTitle('ecz grade 7 mathematics'), 'ECZ Grade 7 Mathematics')
eq('minor words lowercased mid-title', normalizeTitle('the history of the world'), 'The History of the World')
eq('roman numeral uppercased', normalizeTitle('section ii'), 'Section II')
eq('hyphenated word title-cased', normalizeTitle('mid-term test'), 'Mid-Term Test')
eq('preserves deliberate internal caps (IGCSE)', normalizeTitle('IGCSE Biology'), 'IGCSE Biology')

console.log('\nexam board')
eq('"ecz" → "ECZ"', normalizeExamBoard('ecz'), 'ECZ')
eq('full name → "ECZ"', normalizeExamBoard('Examinations Council of Zambia'), 'ECZ')
eq('blank defaults to ECZ', normalizeExamBoard(''), 'ECZ')
eq('short token uppercased', normalizeExamBoard('nied'), 'NIED')

console.log('\nyear')
eq('"2023" → 2023', normalizeYear('2023'), 2023)
eq('out-of-range → null', normalizeYear(1500), null)
eq('next year allowed', normalizeYear(THIS_YEAR + 1), THIS_YEAR + 1)
eq('two years out → null', normalizeYear(THIS_YEAR + 2), null)
eq('garbage → null', normalizeYear('soon'), null)

console.log('\npaper number')
eq('"3" → 3', normalizePaperNumber('3'), 3)
eq('0 → null', normalizePaperNumber(0), null)
eq('99 → null', normalizePaperNumber(99), null)
eq('empty → null', normalizePaperNumber(''), null)

console.log('\nslug')
eq('full identity', paperSlug({ grade: '7', subject: 'mathematics', year: 2023, paperNumber: 1 }), 'grade-7-mathematics-2023-paper-1')
eq('no paper number', paperSlug({ grade: 'Grade 12', subject: 'Social Studies', year: 2022 }), 'grade-12-social-studies-2022')
eq('normalizes inputs before slugging', paperSlug({ grade: 'G7', subject: 'Maths', year: '2021', paperNumber: '2' }), 'grade-7-mathematics-2021-paper-2')

console.log('\nnormalizePaperFields (the pipeline)')
{
  const out = normalizePaperFields({
    title: 'MATHEMATICS PAPER 1', grade: 'Grade 7', subject: 'Maths',
    examBoard: 'ecz', year: '2023', paperNumber: '1',
  })
  eq('title cased', out.title, 'Mathematics Paper 1')
  eq('grade normalized', out.grade, '7')
  eq('subject → id', out.subject, 'mathematics')
  eq('examBoard → ECZ', out.examBoard, 'ECZ')
  eq('year → number', out.year, 2023)
  eq('paperNumber → number', out.paperNumber, 1)
  eq('slug derived', out.slug, 'grade-7-mathematics-2023-paper-1')
}
{
  // A status-only update must not invent or clobber other fields, and must not
  // add a slug (no identity present).
  const out = normalizePaperFields({ status: 'published' })
  eq('status passes through', out.status, 'published')
  ok('no title added', !('title' in out))
  ok('no slug added when identity is absent', !('slug' in out))
}
{
  // Partial update with full identity still derives the slug.
  const out = normalizePaperFields({ grade: '12', subject: 'english', year: 2020 })
  eq('partial-but-complete identity slugs', out.slug, 'grade-12-english-2020')
}
{
  // quizStatus — the optional-quiz flow. A recognised value is canonicalised;
  // an unrecognised one is DROPPED rather than stored, because the readers
  // derive a status from quizId when the field is absent and that is a better
  // answer than a persisted word no surface understands.
  eq('quizStatus pending passes through',
    normalizePaperFields({ quizStatus: 'pending' }).quizStatus, 'pending')
  eq('quizStatus attached passes through',
    normalizePaperFields({ quizStatus: 'attached' }).quizStatus, 'attached')
  eq('quizStatus is canonicalised',
    normalizePaperFields({ quizStatus: ' Attached ' }).quizStatus, 'attached')
  ok('an unrecognised quizStatus is not written',
    !('quizStatus' in normalizePaperFields({ quizStatus: 'ready' })))
  ok('a null quizStatus is not written',
    !('quizStatus' in normalizePaperFields({ quizStatus: null })))
  ok('quizStatus is untouched when absent',
    !('quizStatus' in normalizePaperFields({ title: 'x' })))
}

console.log(`\n✓ ${passed} assertions passed`)
