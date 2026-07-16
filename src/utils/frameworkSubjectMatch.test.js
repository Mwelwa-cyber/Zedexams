/**
 * Unit tests for frameworkSubjectMatch — KB slug → framework allocation.
 * Run: node src/utils/frameworkSubjectMatch.test.js
 */

import { matchFrameworkSubject, periodsPerWeekLabel } from './frameworkSubjectMatch.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

console.log('matchFrameworkSubject — upper primary')
{
  const m = matchFrameworkSubject('G5', 'mathematics')
  assert(m !== null, 'G5 mathematics matches')
  assert(m.periodsPerWeek === 6, 'maths = 6 periods/week')
  assert(m.periodMinutes === 40, 'upper primary = 40-min periods')
  assert(typeof m.timeAllocation === 'string' && m.timeAllocation.length > 0, 'carries a time allocation')

  assert(matchFrameworkSubject('G4', 'integrated_science').periodsPerWeek === 6, 'integrated science = 6')
  assert(matchFrameworkSubject('G6', 'english').periodsPerWeek === 6, 'english = 6')
  assert(matchFrameworkSubject('G6', 'zambian_language').periodsPerWeek === 5, 'zambian language = 5')
  // Upper Primary is Grades 4–6 in the 2023 framework — Grade 7 must NOT
  // silently inherit its allocation (manual entry path instead).
  assert(matchFrameworkSubject('G7', 'zambian_language') === null, 'G7 has no automatic allocation')
  assert(matchFrameworkSubject('G5', 'cinyanja').periodsPerWeek === 5, 'cinyanja folds into zambian language = 5')
  assert(matchFrameworkSubject('G5', 'social_studies').periodsPerWeek === 5, 'social studies = 5')
}

console.log('matchFrameworkSubject — choiceGroup alternate falls back to sibling periods')
{
  const he = matchFrameworkSubject('G5', 'home_economics')
  assert(he !== null, 'home economics matches')
  assert(he.periodsPerWeek > 0, 'home economics gets its choiceGroup sibling allocation (not 0)')
}

console.log('matchFrameworkSubject — lower primary combined areas')
{
  const m = matchFrameworkSubject('G2', 'mathematics')
  assert(m !== null, 'G2 mathematics matches a lower-primary combined area')
  assert(m.periodMinutes === 30, 'lower primary = 30-min periods')
}

console.log('matchFrameworkSubject — secondary + unknown return null')
{
  assert(matchFrameworkSubject('G9', 'mathematics') === null, 'secondary has no framework data → null')
  assert(matchFrameworkSubject('F2', 'biology') === null, 'forms → null')
  assert(matchFrameworkSubject('G5', 'astrophysics') === null, 'unknown subject → null')
  assert(matchFrameworkSubject('', 'mathematics') === null, 'blank grade → null')
}

console.log('periodsPerWeekLabel')
{
  assert(periodsPerWeekLabel('G5', 'mathematics') === '6 periods × 40 minutes', 'formats the CDC period string')
  assert(periodsPerWeekLabel('G9', 'mathematics') === '', 'empty when unmatched')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll frameworkSubjectMatch tests passed')
