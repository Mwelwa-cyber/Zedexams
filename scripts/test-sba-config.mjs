/**
 * Unit tests for src/config/sba.js — the SBA taxonomy + ECZ mark conversion.
 *
 * Verifies the conversion math against the worked examples printed in the
 * ECZ "Guidelines for the Administration of School Based Assessment at Primary
 * School Level", and that every per-grade blueprint totals exactly what the
 * subject's distribution-of-marks table mandates.
 *
 * Run: node scripts/test-sba-config.mjs
 */

import assert from 'node:assert'
import {
  SBA_SUBJECTS,
  SBA_SUBJECT_VALUES,
  SBA_GRADE_VALUES,
  getSbaTaskTypes,
  getSbaBlueprint,
  getSbaGradeTotal,
  convertSbaMark,
  roundSbaMark,
  combineFinalSbaMark,
} from '../src/config/sba.js'

let passed = 0
function ok(name, cond) {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok  ${name}`)
}
function eq(name, a, b) {
  assert.strictEqual(a, b, `${name} (got ${a}, expected ${b})`)
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('sba.js — rounding (guidelines Table 20)')
eq('1.25 → 1', roundSbaMark(1.25), 1)
eq('3.75 → 4', roundSbaMark(3.75), 4)
eq('5 → 5', roundSbaMark(5), 5)
eq('7.5 → 8', roundSbaMark(7.5), 8)
eq('9.3 → 9', roundSbaMark(9.3), 9)
eq('9.6 → 10', roundSbaMark(9.6), 10)

console.log('sba.js — English / Zambian conversion (Tables 9 & 10)')
eq('G5 74/180 → 4',  convertSbaMark(74, 180).rounded, 4)
eq('G5 99/180 → 6',  convertSbaMark(99, 180).rounded, 6)   // 5.5 rounds up
eq('G5 175/180 → 10', convertSbaMark(175, 180).rounded, 10)
eq('G7 62/160 → 4',  convertSbaMark(62, 160).rounded, 4)
eq('G7 101/160 → 6', convertSbaMark(101, 160).rounded, 6)
eq('G7 160/160 → 10', convertSbaMark(160, 160).rounded, 10)

console.log('sba.js — Mathematics conversion (3.6.2 / 3.6.3)')
eq('G5/6 120/240 → 5', convertSbaMark(120, 240).rounded, 5)
eq('G7 80/160 → 5',    convertSbaMark(80, 160).rounded, 5)

console.log('sba.js — Integrated Science conversion (Tables 21–23 examples)')
eq('G5 225/300 → 8', convertSbaMark(225, 300).rounded, 8)
eq('G6 244/300 → 8', convertSbaMark(244, 300).rounded, 8)
eq('G7 155/200 → 8', convertSbaMark(155, 200).rounded, 8)

console.log('sba.js — CTS conversion (5.6.5 examples)')
eq('G5/6 180/180 → 10', convertSbaMark(180, 180).rounded, 10)
eq('G5/6 100/180 → 6',  convertSbaMark(100, 180).rounded, 6) // 5.5 rounds up
eq('G5/6 62/180 → 3',   convertSbaMark(62, 180).rounded, 3)  // 3.4 rounds down
eq('G7 105/105 → 10',   convertSbaMark(105, 105).rounded, 10)
eq('G7 75/105 → 7',     convertSbaMark(75, 105).rounded, 7)
eq('G7 40/105 → 4',     convertSbaMark(40, 105).rounded, 4)  // 3.8 rounds up

console.log('sba.js — Social Studies conversion (6.5.3 example)')
eq('72/100 → 7', convertSbaMark(72, 100).rounded, 7)

console.log('sba.js — clamping + guards')
eq('over-total clamps to 10', convertSbaMark(200, 180).rounded, 10)
eq('zero total is safe', convertSbaMark(50, 0).rounded, 0)
eq('negative obtained → 0', convertSbaMark(-5, 100).rounded, 0)

console.log('sba.js — final cumulative mark (3.5.3 / 4.x examples)')
eq('4 + 6 + 6 = 16', combineFinalSbaMark({ g5: 4, g6: 6, g7: 6 }), 16)
eq('8 + 8 + 9 = 25', combineFinalSbaMark({ g5: 8, g6: 8, g7: 9 }), 25)
eq('missing grades treated as 0', combineFinalSbaMark({ g5: 5 }), 5)

console.log('sba.js — blueprint totals match the official tables')
const EXPECTED_TOTALS = {
  english:                         { G5: 180, G6: 180, G7: 160 },
  zambian_language:                { G5: 100, G6: 100, G7: 100 },
  mathematics:                     { G5: 240, G6: 240, G7: 160 },
  integrated_science:              { G5: 300, G6: 300, G7: 200 },
  creative_and_technology_studies: { G5: 180, G6: 180, G7: 105 },
  social_studies:                  { G5: 100, G6: 100, G7: 100 },
}
for (const subject of Object.keys(EXPECTED_TOTALS)) {
  for (const grade of SBA_GRADE_VALUES) {
    const expected = EXPECTED_TOTALS[subject][grade]
    eq(`${subject} ${grade} total = ${expected}`, getSbaGradeTotal(subject, grade), expected)
  }
}

console.log('sba.js — blueprint task counts (Table 8 / subject tables)')
eq('English G5 = 18 tasks', getSbaBlueprint('english', 'G5').columns.length, 18)
eq('English G7 = 16 tasks', getSbaBlueprint('english', 'G7').columns.length, 16)
eq('Zambian G6 = 10 tasks', getSbaBlueprint('zambian_language', 'G6').columns.length, 10)
eq('Maths G5 = 12 tasks',   getSbaBlueprint('mathematics', 'G5').columns.length, 12)
eq('Maths G7 = 8 tasks',    getSbaBlueprint('mathematics', 'G7').columns.length, 8)
eq('CTS G5 = 12 tasks',     getSbaBlueprint('creative_and_technology_studies', 'G5').columns.length, 12)
eq('CTS G7 = 6 tasks',      getSbaBlueprint('creative_and_technology_studies', 'G7').columns.length, 6)
eq('Social G6 = 8 tasks',   getSbaBlueprint('social_studies', 'G6').columns.length, 8)

console.log('sba.js — every blueprint column total equals the year total')
for (const subject of SBA_SUBJECT_VALUES) {
  for (const grade of SBA_GRADE_VALUES) {
    const bp = getSbaBlueprint(subject, grade)
    const sum = bp.columns.reduce((acc, c) => acc + c.max, 0)
    eq(`${subject} ${grade} columns sum = total`, sum, bp.total)
    ok(`${subject} ${grade} every column has a stable key`, bp.columns.every((c) => typeof c.key === 'string' && c.key))
  }
}

console.log('sba.js — task-type catalogues are non-empty + labelled')
for (const s of SBA_SUBJECTS) {
  const types = getSbaTaskTypes(s.value)
  ok(`${s.value} has task types`, types.length > 0)
  ok(`${s.value} task types are labelled`, types.every((t) => typeof t.label === 'string' && t.label))
  ok(`${s.value} task types carry a marking style`, types.every((t) => typeof t.marking === 'string' && t.marking))
}

console.log(`\n✓ sba.js — all ${passed} assertions passed.`)
