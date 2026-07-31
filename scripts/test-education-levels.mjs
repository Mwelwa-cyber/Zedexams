/**
 * Education-ladder tests — src/config/educationLevels.js.
 *
 * The ladder exists so a level's identity, syllabus code, aliases and band are
 * declared ONCE. These pin the two things that were previously restated in
 * several places and could therefore disagree:
 *
 *   1. "Form 3" and "Grade 10" are the same curriculum year — one level, one
 *      syllabus, never a duplicated copy behind a second name.
 *   2. Early Childhood is exactly Nursery and Reception. "Baby Class" and
 *      "Middle Class" are legacy spellings only — never displayed as levels,
 *      but still resolvable so an old record opens.
 *
 * Run: node scripts/test-education-levels.mjs
 */

import assert from 'node:assert/strict'
import {
  EDUCATION_LEVELS, LEVEL_STAGES, LEVEL_STAGE_LABELS, resolveLevel,
  levelsForFramework, levelKbGrade, levelBandId, levelLabel, isSameLevel,
  levelResolution, levelAvailability, LEVEL_AVAILABILITY,
  advancedLevelsForFramework,
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

test('covers Nursery through Form 6 — the full range the product claims', () => {
  const labels = EDUCATION_LEVELS.map((l) => l.label)
  for (const expected of [
    'Nursery', 'Reception',
    'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7',
    // Form 6 is the second CBC A-Level year. The Curriculum Reference page has
    // always advertised "Forms 1 – 6"; until the ladder carried Form 6 that was
    // a claim no picker could honour.
    'Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5', 'Form 6',
  ]) {
    assert.ok(labels.includes(expected), `${expected} missing from the ladder`)
  }
  assert.equal(EDUCATION_LEVELS.length, 15)
})

test('the A-Level tier is reachable, but never in an O-Level grade picker', () => {
  // Under the CBC, Forms 5-6 are A-Level years; under the 2013 set, Form 5 is
  // the final O-Level year. Same rung, different tier — so the tier is read per
  // framework, and the O-Level ladder each framework returns differs.
  assert.deepEqual(
    advancedLevelsForFramework('2023').map((l) => l.id), ['form-5', 'form-6'],
  )
  assert.deepEqual(advancedLevelsForFramework('2013').map((l) => l.id), [])
  assert.ok(
    levelsForFramework('2023', { includeAdvanced: true }).some((l) => l.id === 'form-6'),
    'a surface spanning both tiers can ask for Form 6',
  )
})

test('Early Childhood is exactly Nursery and Reception', () => {
  const ece = EDUCATION_LEVELS.filter((l) => l.stage === 'ece')
  assert.deepEqual(ece.map((l) => l.label), ['Nursery', 'Reception'])
  assert.deepEqual(ece.map((l) => l.value), ['ECE_N', 'ECE_R'])
})

test('Baby Class and Middle Class are never levels', () => {
  // They are legacy spellings only. Displaying either as a current level is the
  // regression this guards.
  for (const retired of ['Baby Class', 'Middle Class']) {
    assert.ok(!EDUCATION_LEVELS.some((l) => l.label === retired),
      `${retired} must not be a level`)
    assert.ok(!EDUCATION_LEVELS.some((l) => l.aliases.includes(retired)),
      `${retired} must not be a declared alias of a level`)
  }
  for (const code of ['ECE_B', 'ECE_M']) {
    assert.ok(!EDUCATION_LEVELS.some((l) => l.value === code), `${code} must not be a level value`)
  }
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

test('the canonical ECE codes resolve to their own levels', () => {
  assert.equal(resolveLevel('ECE_N').id, 'nursery')
  assert.equal(resolveLevel('Nursery').id, 'nursery')
  assert.equal(resolveLevel('ECE_R').id, 'reception')
  assert.equal(resolveLevel('Reception').id, 'reception')
})

test('retired Baby/Middle Class records still open, under Nursery', () => {
  // Legacy, so they resolve — but onto Nursery, not onto a level of their own.
  for (const retired of ['Baby Class', 'baby class', 'ECE_B', 'Middle Class', 'ECE_M']) {
    const res = levelResolution(retired)
    assert.equal(res.level?.id, 'nursery', retired)
    assert.equal(res.legacy, true, `${retired} must be reported as legacy`)
  }
})

test('a bare ECE resolves consistently and is reported as ambiguous', () => {
  const res = levelResolution('ECE')
  assert.equal(res.level.id, 'nursery')
  assert.equal(res.ambiguous, true)
  assert.equal(res.legacy, true)
})

test('a canonical value is not reported as legacy', () => {
  for (const value of ['ECE_N', 'ECE_R', '4', 'G10']) {
    const res = levelResolution(value)
    assert.equal(res.legacy, false, value)
    assert.equal(res.ambiguous, false, value)
  }
})

test('unknown values resolve to nothing rather than guessing', () => {
  assert.equal(resolveLevel('Grade 99'), null)
  assert.equal(resolveLevel('nonsense'), null)
  assert.equal(resolveLevel(''), null)
  assert.equal(resolveLevel(null), null)
})

/* ── syllabus codes are declared, not derived ───────────────────────────── */

test('the ECE years map one-to-one onto the published age bands', () => {
  // The syllabus publishes 3-4 and 4-5; Nursery and Reception take one each, so
  // neither is an alias of the other and each has its own content.
  assert.equal(levelKbGrade('ECE_N'), 'ECE_N')
  assert.equal(levelKbGrade('ECE_R'), 'ECE_R')
  // A legacy record still lands on real syllabus content.
  assert.equal(levelKbGrade('Baby Class'), 'ECE_N')
  assert.equal(levelKbGrade('Middle Class'), 'ECE_N')
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
  assert.ok(cbc.includes('nursery') && cbc.includes('reception'))
  assert.ok(prev.includes('grade-7') && prev.includes('form-5'))
  assert.ok(!prev.some((id) => ['nursery', 'reception'].includes(id)))
})

test('an unknown framework falls back to CBC rather than an empty ladder', () => {
  assert.deepEqual(
    levelsForFramework('nonsense').map((l) => l.id),
    levelsForFramework('2023').map((l) => l.id),
  )
})

/* ── band lookup ────────────────────────────────────────────────────────── */

test('levels map onto the expected bands', () => {
  assert.equal(levelBandId('ECE_N'), 'early_childhood')
  assert.equal(levelBandId('ECE_R'), 'early_childhood')
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

/* ── availability: four distinguishable states ───────────────────────────── */

test('a level with syllabus content is available', () => {
  const res = levelAvailability('4', { framework: '2023', gradeCodes: new Set(['G4']) })
  assert.equal(res.availability, LEVEL_AVAILABILITY.AVAILABLE)
  assert.equal(res.message, '')
})

test('a recognised level with no catalogue data says so, by name', () => {
  const res = levelAvailability('5', { framework: '2023', gradeCodes: new Set(['G4']) })
  assert.equal(res.availability, LEVEL_AVAILABILITY.NO_CATALOGUE_DATA)
  assert.match(res.message, /Grade 5 is recognised/)
  assert.match(res.message, /CBC syllabus content has not yet been loaded/)
  assert.match(res.message, /administrator/)
})

test('a level the other curriculum defines is named as such', () => {
  // Grade 7 exists under the previous syllabus, not CBC. It must not silently
  // borrow content from the other curriculum.
  const res = levelAvailability('7', { framework: '2023', gradeCodes: new Set(['G7']) })
  assert.equal(res.availability, LEVEL_AVAILABILITY.OTHER_CURRICULUM_ONLY)
  assert.match(res.message, /not part of CBC/)
  assert.match(res.message, /switch curriculum/)
})

test('an unrecognised level is distinguished from an unavailable one', () => {
  const res = levelAvailability('Grade 99', { framework: '2023', gradeCodes: new Set() })
  assert.equal(res.availability, LEVEL_AVAILABILITY.UNKNOWN)
  assert.match(res.message, /not a level ZedExams recognises/)
})

test('an unresolved catalogue reads as available, never as an empty picker', () => {
  const res = levelAvailability('4', { framework: '2023', gradeCodes: null })
  assert.equal(res.availability, LEVEL_AVAILABILITY.AVAILABLE)
})

console.log(`✓ education levels — ${passed} tests passed`)
