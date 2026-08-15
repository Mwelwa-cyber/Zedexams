// Pure regression tests for curriculum-specific education-level labels.
// Run automatically by npm run test:all (scripts/test-*.mjs discovery).

import assert from 'node:assert'
import {
  applyFrameworkLevelLabel,
  levelLabelForFramework,
} from '../src/shared/utils/frameworkLevelLabels.js'

let passed = 0
const eq = (actual, expected, message) => {
  assert.strictEqual(actual, expected, message)
  passed += 1
}

const levels = [
  { value: 'G8', kbGrade: 'G8', label: 'Form 1', stage: 'secondary' },
  { value: 'G9', kbGrade: 'G9', label: 'Form 2', stage: 'secondary' },
  { value: 'G10', kbGrade: 'G10', label: 'Form 3', stage: 'secondary' },
  { value: 'G11', kbGrade: 'G11', label: 'Form 4', stage: 'secondary' },
  { value: 'G12', kbGrade: 'G12', label: 'Form 5', stage: 'secondary' },
]

eq(levels.map((level) => levelLabelForFramework(level, '2013')).join(','),
  'Grade 8,Grade 9,Grade 10,Grade 11,Grade 12',
  '2013 secondary levels display as Grade 8–12')

eq(levels.slice(0, 4).map((level) => levelLabelForFramework(level, '2023')).join(','),
  'Form 1,Form 2,Form 3,Form 4',
  '2023 CBC secondary levels display as Form 1–4')

eq(levelLabelForFramework({ value: '4', kbGrade: 'G4', label: 'Grade 4', stage: 'primary' }, '2013'),
  'Grade 4', 'primary labels are unchanged')

eq(levelLabelForFramework({ value: 'ECE_N', kbGrade: 'ECE_N', label: 'Nursery', stage: 'ece' }, '2023'),
  'Nursery', 'ECE labels are unchanged')

const original = levels[2]
const relabelled = applyFrameworkLevelLabel(original, '2013')
eq(relabelled.label, 'Grade 10', 'copy receives the 2013 label')
eq(original.label, 'Form 3', 'source level is not mutated')
eq(relabelled.value, 'G10', 'stored grade code is unchanged')

console.log(`framework level labels: ${passed} assertions passed`)
