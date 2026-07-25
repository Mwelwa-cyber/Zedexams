/**
 * Education-ladder tests — src/config/educationLevels.js.
 *
 * The ladder exists so a level's identity, syllabus code, aliases and band are
 * declared ONCE. These pin the two things that were previously restated in
 * several places and could therefore disagree:
 *
 *   1. "Form 3" and "Grade 10" are the same curriculum year — one level, one
 *      syllabus, never a duplicated copy behind a second name.
 *   2. A level's syllabus code is declared, not derived from its value, because
 *      Baby Class stores ECE_B while grounding on the 3-4 year syllabus.
 *
 * Run: node scripts/test-education-levels.mjs
 */

import assert from 'node:assert/strict'
import {
  EDUCATION_LEVELS, LEVEL_STAGES, LEVEL_STAGE_LABELS, resolveLevel,
  levelsForFramework, levelKbGrade, levelBandId, levelLabel, isSameLevel,
} from '../src/config/educationLevels.js'
import { BAND_IDS, ASSESSMENT_BAND_SEED } from '../src/config/assessmentBands.js'

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

/* ── the ladder is complete ─────────────────────────────────────────────── */

test('covers Baby Class through Form 5', () => {
  const labels = EDUCATION_LEVELS.map((l) => l.label)
  for (const expected of [
    'Baby Class', 'Middle Class', 'Reception',
    'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7',
    'Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5',
  ]) {
    assert.ok(labels.includes(expected), `${expected} missing from the ladder`)
  }
  assert.equal(EDUCATION_LEVELS.length, 15)
})

test('is in educational order, never alphabetical', () => {
  const orders = EDUCATION_LEVELS.map((l) => l.order)
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b))
  // Grade 10 would sort before Grade 2 alphabetically; every Form must follow
  // every Grade.
  const lastPrimary = EDUCATION_LEVELS.filter((l) => l.stage === 'primary').at(-1)
  const firstSecondary = EDUCATION_LEVELS.find((l) => l.stage === 'secondary')
  assert.ok(lastPrimary.order < firstSecondary.order)
})

test('every level declares a known stage and a known band', () => {
  for (const level of EDUCATION_LEVELS) {
    assert.ok(LEVEL_STAGES.includes(level.stage), `${level.label} stage`)
    assert.ok(LEVEL_STAGE_LABELS[level.stage], `${level.label} stage label`)
    assert.ok(BAND_IDS.includes(level.band), `${level.label} band "${level.band}"`)
  }
})

test('every level is claimed by exactly one band, and every band level exists', () => {
  const levelIds = new Set(EDUCATION_LEVELS.map((l) => l.id))
  const claimed = new Map()
  for (const bandId of BAND_IDS) {
    for (const levelId of ASSESSMENT_BAND_SEED[bandId].levels) {
      assert.ok(levelIds.has(levelId), `band ${bandId} lists unknown level ${levelId}`)
      assert.ok(!claimed.has(levelId), `${levelId} claimed by two bands`)
      claimed.set(levelId, bandId)
    }
  }
  for (const level of EDUCATION_LEVELS) {
    assert.equal(claimed.get(level.id), level.band, `${level.label} band disagrees`)
  }
})

/* ── aliases: one curriculum year, several namings ──────────────────────── */

test('Form 3 and Grade 10 are the same level', () => {
  assert.ok(isSameLevel('Form 3', 'Grade 10'))
  assert.equal(resolveLevel('Grade 10').id, 'form-3')
  assert.equal(resolveLevel('Form 3').id, 'form-3')
  // …and therefore the same syllabus. This is the "never duplicate syllabus
  // content per naming convention" requirement, as an assertion.
  assert.equal(levelKbGrade('Grade 10'), levelKbGrade('Form 3'))
})

test('every Form carries its Grade alias', () => {
  for (let n = 1; n <= 5; n += 1) {
    assert.ok(isSameLevel(`Form ${n}`, `Grade ${n + 7}`), `Form ${n}`)
    // The Form is the display name — a Form is never relabelled a Grade.
    assert.equal(levelLabel(`Grade ${n + 7}`), `Form ${n}`)
  }
})

test('Form 3 and Grade 3 are NOT the same level', () => {
  assert.equal(isSameLevel('Form 3', 'Grade 3'), false)
})

test('the retired ECE spellings still resolve', () => {
  // A paper saved before the ECE rename must keep opening.
  assert.equal(resolveLevel('ECE_N').id, 'baby-class')
  assert.equal(resolveLevel('Nursery').id, 'baby-class')
  assert.equal(resolveLevel('ECE_B').id, 'baby-class')
})

test('unknown values resolve to nothing rather than guessing', () => {
  assert.equal(resolveLevel('Grade 99'), null)
  assert.equal(resolveLevel('nonsense'), null)
  assert.equal(resolveLevel(''), null)
  assert.equal(resolveLevel(null), null)
})

/* ── syllabus codes are declared, not derived ───────────────────────────── */

test('the ECE years map onto the two published age bands', () => {
  // The syllabus publishes 3-4 and 4-5. Baby Class takes 3-4; Middle Class and
  // Reception are two school years sharing 4-5 — an alias, not a duplication.
  assert.equal(levelKbGrade('ECE_B'), 'ECE_N')
  assert.equal(levelKbGrade('ECE_M'), 'ECE_R')
  assert.equal(levelKbGrade('ECE_R'), 'ECE_R')
})

test('no ECE level grounds on a syllabus code that does not exist', () => {
  // Guards against inventing a third ECE band the catalogue has never had.
  const published = new Set(['ECE_N', 'ECE_R', 'ECE'])
  for (const level of EDUCATION_LEVELS.filter((l) => l.stage === 'ece')) {
    assert.ok(published.has(level.kbGrade), `${level.label} → ${level.kbGrade}`)
  }
})

test('primary and secondary codes follow the syllabus keying', () => {
  assert.equal(levelKbGrade('4'), 'G4')
  assert.equal(levelKbGrade('7'), 'G7')
  assert.equal(levelKbGrade('G8'), 'G8')
  assert.equal(levelKbGrade('G12'), 'G12')
})

/* ── per-framework availability ─────────────────────────────────────────── */

test('CBC drops Grade 7 and Form 5; the previous syllabus has no ECE', () => {
  const cbc = levelsForFramework('2023').map((l) => l.id)
  const prev = levelsForFramework('2013').map((l) => l.id)
  assert.ok(!cbc.includes('grade-7'), 'CBC abolished Grade 7')
  assert.ok(!cbc.includes('form-5'), 'CBC stops at Form 4')
  assert.ok(cbc.includes('baby-class') && cbc.includes('reception'))
  assert.ok(prev.includes('grade-7') && prev.includes('form-5'))
  assert.ok(!prev.some((id) => ['baby-class', 'middle-class', 'reception'].includes(id)))
})

test('an unknown framework falls back to CBC rather than an empty ladder', () => {
  assert.deepEqual(
    levelsForFramework('nonsense').map((l) => l.id),
    levelsForFramework('2023').map((l) => l.id),
  )
})

/* ── band lookup ────────────────────────────────────────────────────────── */

test('levels map onto the expected bands', () => {
  assert.equal(levelBandId('ECE_B'), 'early_childhood')
  assert.equal(levelBandId('2'), 'lower_primary')
  assert.equal(levelBandId('4'), 'lower_primary')
  assert.equal(levelBandId('5'), 'upper_primary')
  assert.equal(levelBandId('7'), 'upper_primary')
  assert.equal(levelBandId('G8'), 'junior_secondary')
  assert.equal(levelBandId('G9'), 'junior_secondary')
  assert.equal(levelBandId('G10'), 'senior_secondary')
  assert.equal(levelBandId('G12'), 'senior_secondary')
  // …and via the alias, so a school using Grade naming gets the same rules.
  assert.equal(levelBandId('Grade 10'), 'senior_secondary')
})

console.log(`✓ education levels — ${passed} tests passed`)
