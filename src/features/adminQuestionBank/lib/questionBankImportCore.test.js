/**
 * Tests for the firebase-free import core: the curriculum-derived topic→grade
 * index + lookup. Run: node src/utils/questionBankImportCore.test.js
 */

import {
  toCurriculumSubject, topicKey, normalizeGrade,
  buildGradeIndexFromCurriculum, lookupGradeClient, planBankAction,
} from './questionBankImportCore.js'
import { TOPICS } from '../../../config/curriculum.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

console.log('toCurriculumSubject / topicKey / normalizeGrade')
{
  assert(toCurriculumSubject('Integrated Science') === 'science', 'integrated_science → science (catalogue id)')
  assert(toCurriculumSubject('Mathematics') === 'mathematics', 'mathematics stays mathematics')
  assert(topicKey('Integrated Science', 'Living Things') === topicKey('science', 'living things'), 'subject + topic normalise the same regardless of spelling/case')
  assert(normalizeGrade('G7') === '7' && normalizeGrade('Grade 4') === '4' && normalizeGrade(5) === '5', 'grade normalises to a digit')
}

console.log('\nbuildGradeIndexFromCurriculum (real catalogue)')
{
  const idx = buildGradeIndexFromCurriculum()
  assert(idx.size > 0, `index is non-empty (${idx.size} topic keys)`)
  // Every indexed grade is in 4-7.
  let allValid = true
  for (const grades of idx.values()) for (const g of grades) if (!['4', '5', '6', '7'].includes(g)) allValid = false
  assert(allValid, 'every indexed grade is 4–7')
  // A real topic resolves to a grade (pick the first math grade-7 topic).
  const mathG7 = (TOPICS.mathematics && TOPICS.mathematics[7]) || []
  if (mathG7.length) {
    const r = lookupGradeClient(idx, 'mathematics', mathG7[0])
    assert(r.grade === '7' || r.ambiguous, `a real Grade-7 maths topic resolves to 7 or is ambiguous (got ${JSON.stringify(r)})`)
  }
}

console.log('\nlookupGradeClient — unique / ambiguous / none')
{
  // Build a tiny controlled index by hand via the same key function.
  const idx = new Map()
  idx.set(topicKey('mathematics', 'Fractions'), new Set(['4']))
  idx.set(topicKey('mathematics', 'Geometry'), new Set(['5', '6']))
  assert(lookupGradeClient(idx, 'Mathematics', 'fractions').grade === '4', 'unique match → grade (case-insensitive)')
  const amb = lookupGradeClient(idx, 'mathematics', 'Geometry')
  assert(amb.grade === null && amb.ambiguous === true, 'multi-grade topic → ambiguous')
  assert(lookupGradeClient(idx, 'mathematics', 'Calculus').grade === null, 'unmatched topic → null')
  assert(lookupGradeClient(idx, 'mathematics', '').grade === null, 'empty topic → null')
}

console.log('\nplanBankAction — create / skip / promote')
{
  const admin = 'admin-1'
  assert(planBankAction(null, admin) === 'create', 'no existing row → create (seed Master Bank)')
  assert(planBankAction({ id: 'x', ownerId: admin, masterEligible: true }, admin) === 'skip', 'already master-eligible → skip')
  assert(planBankAction({ id: 'x', ownerId: 'other', masterEligible: true }, admin) === 'skip', "someone else's master row → skip")
  assert(planBankAction({ id: 'x', ownerId: admin, masterEligible: false }, admin) === 'promote', "admin's own earlier pending import → promote")
  assert(planBankAction({ id: 'x', ownerId: admin }, admin) === 'promote', 'admin-owned row with no master flag → promote')
  assert(planBankAction({ id: 'x', ownerId: 'teacher-9', masterEligible: false }, admin) === 'skip', "a teacher's private duplicate is never promoted")
  assert(planBankAction({ id: 'x', ownerId: 'teacher-9', masterEligible: false }, '') === 'skip', 'no admin uid → never promote')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll questionBankImportCore tests passed.')
