/**
 * Assessment-band tests — src/config/assessmentBands.js, its generated server
 * copy, and the server reader in functions/teacherTools/assessmentBands.js.
 *
 * The band is the ceiling for a stage: it decides which question types a level
 * may even be offered, how long the paper runs, how formal the instructions
 * are. These pin the three things that make that trustworthy:
 *
 *   1. the bands are internally valid and cover the whole ladder;
 *   2. the generated server copy is not stale, so the picker and the generator
 *      cannot disagree about what a level permits;
 *   3. the ceiling only ever NARROWS — a client cannot widen it, which is what
 *      stops a Nursery paper containing an essay.
 *
 * Run: node scripts/test-assessment-bands.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  ASSESSMENT_BAND_SEED, BAND_IDS, ALL_QUESTION_TYPES, validateBand,
} from '../src/config/assessmentBands.js'
import { EDUCATION_LEVELS, resolveLevel } from '../src/config/educationLevels.js'
import { renderBandsJson, BANDS_JSON_PATH } from './sync-assessment-bands.mjs'

const require = createRequire(import.meta.url)
const server = require('../functions/teacherTools/assessmentBands.js')

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

/* ── the bands themselves ───────────────────────────────────────────────── */

test('every band is valid', () => {
  for (const id of BAND_IDS) {
    const problems = validateBand(ASSESSMENT_BAND_SEED[id])
    assert.deepEqual(problems, [], `${id}: ${problems.join('; ')}`)
  }
})

test('validateBand rejects the mistakes an editor would actually make', () => {
  const base = ASSESSMENT_BAND_SEED.lower_primary
  assert.ok(validateBand({ ...base, id: 'made_up' }).length > 0, 'unknown id')
  assert.ok(validateBand({ ...base, questionTypes: [] }).length > 0, 'no types')
  assert.ok(validateBand({ ...base, questionTypes: ['telepathy'] }).length > 0, 'unknown type')
  assert.ok(validateBand({ ...base, reading: null }).length > 0, 'no reading rule')
  assert.ok(validateBand({ ...base, minFigureSizeMm: 'big' }).length > 0, 'non-numeric figure size')
  // A Bloom's spread that does not sum to 1 is a silent mis-weighting.
  assert.ok(validateBand({ ...base, bloomDistribution: { remember: 0.5 } }).length > 0, 'bad spread')
  assert.deepEqual(validateBand(null), ['band is not an object'])
})

test('every band covers each of its levels, and the ladder is fully covered', () => {
  const claimed = BAND_IDS.flatMap((id) => ASSESSMENT_BAND_SEED[id].levels)
  for (const level of EDUCATION_LEVELS) {
    assert.ok(claimed.includes(level.id), `${level.label} has no band`)
  }
})

test('every band carries a duration and a mark range for every assessment type', () => {
  // A missing entry would silently leave the previous band's numbers on screen.
  const types = [
    'topic_test', 'weekly_test', 'mid_term', 'end_of_term',
    'mock_exam', 'examination', 'final_exam',
  ]
  for (const id of BAND_IDS) {
    const band = ASSESSMENT_BAND_SEED[id]
    for (const type of types) {
      assert.ok(Number(band.defaultDurations[type]) > 0, `${id}.defaultDurations.${type}`)
      const range = band.markRanges[type]
      assert.ok(Array.isArray(range) && range.length === 2, `${id}.markRanges.${type}`)
      assert.ok(range[0] > 0 && range[1] >= range[0], `${id}.markRanges.${type} bounds`)
    }
  }
})

/* ── the brief's band table, as assertions ──────────────────────────────── */

test('Early Childhood requires no reading at all', () => {
  const band = ASSESSMENT_BAND_SEED.early_childhood
  assert.equal(band.reading.requirement, 'none')
  assert.equal(band.reading.maxWordsPerItem, 0)
  // Zero reading is only honest if every item carries a figure or a script.
  assert.equal(band.structure.requiresFigureOrScript, true)
  assert.equal(band.structure.teacherScript, true)
  assert.equal(band.structure.oneTaskPerInstruction, true)
  assert.equal(band.structure.answerSpace, 'oversized')
})

test('Early Childhood covers exactly Nursery and Reception', () => {
  assert.deepEqual(ASSESSMENT_BAND_SEED.early_childhood.levels, ['nursery', 'reception'])
})

test('Early Childhood offers only types a non-reader can answer', () => {
  const band = ASSESSMENT_BAND_SEED.early_childhood
  for (const writing of ['essay', 'extended_response', 'comprehension', 'short_answer', 'structured']) {
    assert.ok(!band.questionTypes.includes(writing), `${writing} must not be offered`)
  }
  for (const expected of [
    'picture_identification', 'circling', 'picture_matching', 'counting',
    'tracing', 'colouring', 'sorting',
  ]) {
    assert.ok(band.questionTypes.includes(expected), `${expected} missing`)
  }
})

test('Grades 1–4 use three MCQ options, Grades 5 and up use four', () => {
  assert.equal(ASSESSMENT_BAND_SEED.lower_primary.structure.mcqOptionCount, 3)
  assert.equal(ASSESSMENT_BAND_SEED.upper_primary.structure.mcqOptionCount, 4)
  assert.equal(ASSESSMENT_BAND_SEED.junior_secondary.structure.mcqOptionCount, 4)
  assert.equal(ASSESSMENT_BAND_SEED.senior_secondary.structure.mcqOptionCount, 4)
})

test('the early-years types disappear as the ladder rises', () => {
  for (const id of ['upper_primary', 'junior_secondary', 'senior_secondary']) {
    for (const early of ['colouring', 'tracing', 'counting']) {
      assert.ok(!ASSESSMENT_BAND_SEED[id].questionTypes.includes(early),
        `${id} must not offer ${early}`)
    }
  }
})

test('Forms 1–2 add multi-step calculation and data interpretation', () => {
  const band = ASSESSMENT_BAND_SEED.junior_secondary
  assert.ok(band.questionTypes.includes('multi_step_calculation'))
  assert.ok(band.questionTypes.includes('data_interpretation'))
  assert.equal(band.structure.sectionScheme, 'A/B')
  assert.equal(band.structure.marksPerSubQuestion, true)
})

test('Forms 3–5 carry the full examination blueprint', () => {
  const band = ASSESSMENT_BAND_SEED.senior_secondary
  for (const expected of [
    'extended_response', 'essay', 'case_study', 'graph_interpretation', 'practical',
  ]) {
    assert.ok(band.questionTypes.includes(expected), `${expected} missing`)
  }
  assert.equal(band.structure.compulsoryAndOptionalGroups, true)
  assert.equal(band.structure.fullExamBlueprint, true)
  assert.equal(band.instructionFormality, 'examination')
})

test('the Grade 7 examination blueprint is available as a preset', () => {
  assert.equal(ASSESSMENT_BAND_SEED.upper_primary.structure.examBlueprintPreset, 'grade-7-exam')
})

test('instruction formality and figure size rise with the ladder', () => {
  const formality = BAND_IDS.map((id) => ASSESSMENT_BAND_SEED[id].instructionFormality)
  assert.deepEqual(formality, ['spoken', 'simple', 'standard', 'formal', 'examination'])
  // Younger learners need bigger figures, so the minimum never rises.
  const sizes = BAND_IDS.map((id) => ASSESSMENT_BAND_SEED[id].minFigureSizeMm)
  assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a))
})

/* ── the generated server copy ──────────────────────────────────────────── */

test('the server copy is not stale', () => {
  // functions/ cannot import from src/, so its copy is generated. If this
  // fails, the picker and the generator disagree about what a level permits —
  // run `npm run sync:assessment-bands`.
  const onDisk = readFileSync(BANDS_JSON_PATH, 'utf8')
  assert.equal(onDisk, renderBandsJson(),
    'functions/data/assessmentBands.json is stale — run `npm run sync:assessment-bands`')
})

test('the server sees the same bands and the same types', () => {
  assert.deepEqual(server.BAND_IDS, BAND_IDS)
  assert.deepEqual(server.ALL_QUESTION_TYPES, ALL_QUESTION_TYPES)
  for (const id of BAND_IDS) {
    assert.deepEqual(server.ASSESSMENT_BAND_SEED[id].questionTypes,
      ASSESSMENT_BAND_SEED[id].questionTypes, id)
  }
})

test('the server validator agrees with the client validator', () => {
  const cases = [
    ASSESSMENT_BAND_SEED.lower_primary,
    { ...ASSESSMENT_BAND_SEED.lower_primary, questionTypes: ['telepathy'] },
    { ...ASSESSMENT_BAND_SEED.lower_primary, bloomDistribution: { remember: 0.5 } },
    null,
  ]
  for (const band of cases) {
    assert.deepEqual(server.validateBand(band), validateBand(band))
  }
})

/* ── the server maps grades to bands the same way the ladder does ───────── */

test('server grade → level matches the ladder', () => {
  const expected = {
    ECE_N: 'nursery', ECE_R: 'reception', G1: 'grade-1', G7: 'grade-7',
    G8: 'form-1', G10: 'form-3', G12: 'form-5',
    // Alternative namings a client may still send.
    4: 'grade-4', 10: 'form-3', 'Form 3': 'form-3', 'Grade 10': 'form-3',
    // Retired ECE spellings still resolve, onto Nursery.
    ECE_B: 'nursery', ECE_M: 'nursery', 'Baby Class': 'nursery',
    'Middle Class': 'nursery', ECE: 'nursery',
  }
  for (const [grade, levelId] of Object.entries(expected)) {
    assert.equal(server.levelIdForGrade(grade), levelId, grade)
  }
  assert.equal(server.levelIdForGrade('nonsense'), '')
  assert.equal(server.levelIdForGrade(''), '')
})

test('client and server resolve every alias to the SAME level', () => {
  // Divergence here means a teacher picks one level and the generator grounds on
  // another — the single worst failure this whole ladder exists to prevent.
  const spellings = [
    'ECE_N', 'ECE_R', 'Nursery', 'Reception', 'Baby Class', 'Middle Class',
    'ECE_B', 'ECE_M', 'ECE', '1', '4', '7', 'G4', 'G8', 'G12',
    'Form 1', 'Form 3', 'Form 5', 'Grade 4', 'Grade 10', 'Grade 12', '10', '12',
  ]
  for (const spelling of spellings) {
    const client = resolveLevel(spelling)
    const serverLevelId = server.levelIdForGrade(spelling)
    assert.equal(serverLevelId, client ? client.id : '',
      `client/server disagree on "${spelling}"`)
  }
})

test('the server reports legacy and ambiguous values rather than hiding them', () => {
  assert.deepEqual(server.levelResolutionForGrade('ECE'),
    {levelId: 'nursery', legacy: true, ambiguous: true})
  assert.deepEqual(server.levelResolutionForGrade('Baby Class'),
    {levelId: 'nursery', legacy: true, ambiguous: false})
  assert.deepEqual(server.levelResolutionForGrade('ECE_N'),
    {levelId: 'nursery', legacy: false, ambiguous: false})
})

test('Baby Class and Middle Class are not level codes on the server either', () => {
  for (const retired of ['ECE_B', 'ECE_M', 'BABYCLASS', 'MIDDLECLASS']) {
    assert.ok(!Object.keys(server.KB_GRADE_TO_LEVEL).includes(retired),
      `${retired} must be legacy-only, not a canonical grade code`)
  }
})

/* ── the ceiling only narrows ───────────────────────────────────────────── */

test('a band never widens what the teacher asked for', () => {
  const band = ASSESSMENT_BAND_SEED.early_childhood
  // A stale or hostile client asking for an essay at Baby Class gets nothing
  // back for it — the intersection is what reaches the generator.
  assert.deepEqual(server.allowedQuestionTypes(band, ['essay']), [])
  assert.deepEqual(server.allowedQuestionTypes(band, ['essay', 'counting']), ['counting'])
})

test('asking for nothing means the whole band, not nothing', () => {
  const band = ASSESSMENT_BAND_SEED.lower_primary
  assert.deepEqual(server.allowedQuestionTypes(band, []), band.questionTypes)
  assert.deepEqual(server.allowedQuestionTypes(band), band.questionTypes)
})

test('no band means no opinion — the request passes through', () => {
  assert.deepEqual(server.allowedQuestionTypes(null, ['essay']), [])
})

/* ── the prompt directive is rendered from the document ─────────────────── */

test('the Early Childhood directive states the no-reading rule outright', () => {
  const text = server.buildBandDirective(ASSESSMENT_BAND_SEED.early_childhood, 'Baby Class')
  assert.match(text, /Baby Class/)
  assert.match(text, /CANNOT be assumed to read/)
  assert.match(text, /figure or a teacher-read script|figure, or from a sentence the teacher reads/)
})

test('the directive carries the band’s own numbers, not hard-coded ones', () => {
  const band = ASSESSMENT_BAND_SEED.lower_primary
  const text = server.buildBandDirective(band, 'Grade 3')
  assert.match(text, new RegExp(`exactly ${band.structure.mcqOptionCount} options`))
  assert.match(text, new RegExp(`${band.minFigureSizeMm}mm`))
  assert.match(text, /remember 45%/)
  // Editing the band must change the directive — that is the whole point of
  // rendering it rather than writing it into the prompt file.
  const edited = { ...band, structure: { ...band.structure, mcqOptionCount: 5 } }
  assert.match(server.buildBandDirective(edited, 'Grade 3'), /exactly 5 options/)
})

test('no band renders no directive', () => {
  assert.equal(server.buildBandDirective(null, 'Grade 3'), '')
})

test('bandDefaults reads the band’s duration and mark range', () => {
  const band = ASSESSMENT_BAND_SEED.senior_secondary
  const defaults = server.bandDefaults(band, 'final_exam')
  assert.equal(defaults.durationMinutes, band.defaultDurations.final_exam)
  assert.deepEqual(defaults.markRange, band.markRanges.final_exam)
  assert.deepEqual(server.bandDefaults(null, 'final_exam'), { durationMinutes: null, markRange: null })
})


/* ── the rules live in one place ────────────────────────────────────────── */

// The brief's acceptance criterion: "no band rule appears anywhere in the
// codebase except its Firestore document". The seed here IS that document's
// content (the collection is created from it, and it is the fallback when
// Firestore cannot be read), so what this guards is the thing that actually
// goes wrong — someone restating a band's rules in a component or, worse, in a
// prompt string, where it would then silently disagree with the band.

// Where the activity → render-type mapping and the per-band type lists may be
// DEFINED. Everything else may reference an activity id (that is the point of a
// shared vocabulary); what must not spread is a second definition of what an
// activity IS or which activities a level may use.
const BAND_RULE_HOMES = [
  'src/config/questionActivities.js',         // the activity registry
  'src/config/assessmentBands.js',            // the band definitions
  'functions/data/assessmentBands.json',      // their generated server copy
]

/** File contents with line comments stripped, so a comment naming an example
 * activity is never mistaken for a restated rule. */
function codeOf(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

function filesDefining(pattern) {
  const listed = execSync(
    'grep -rlE ' + JSON.stringify(pattern) +
    ' src functions --include=*.js --include=*.jsx --include=*.json 2>/dev/null || true',
  ).toString().trim().split('\n').filter(Boolean)
  return listed
    .filter((f) => !/\.(test|spec)\./.test(f))
    .filter((f) => !BAND_RULE_HOMES.includes(f))
    .filter((f) => new RegExp(pattern).test(codeOf(f)))
}

test('only the registry declares what an activity renders as', () => {
  // A second activity → renderType mapping anywhere else would silently
  // disagree with this one about how a tracing task is laid out.
  const offenders = filesDefining('renderType:\\s*["\']')
  assert.deepEqual(offenders, [], `a second activity mapping lives in: ${offenders.join(', ')}`)
})

test('only the band definitions declare a band document', () => {
  // `bloomDistribution` is unique to a band document, so a second one anywhere
  // else is a restated band — the drift this guards. (`questionTypes` alone is
  // too weak a signal: the paper FORMAT profiles in assessmentFormats.js use the
  // same field name for a section's declared types, which is a different thing
  // that predates bands.)
  const offenders = filesDefining('bloomDistribution:\\s*\\{')
  assert.deepEqual(offenders, [], `a second band document lives in: ${offenders.join(', ')}`)
})

test('no prompt file carries a band’s rules', () => {
  const promptFiles = execSync('ls functions/teacherTools/assessmentPrompt*.js').toString()
    .trim().split('\n').filter(Boolean)
  for (const file of promptFiles) {
    const text = readFileSync(file, 'utf8')
    // The directive is rendered from the resolved document at call time; a
    // prompt file naming a band or its fields means that stopped being true.
    for (const token of ['bloomDistribution', 'minFigureSizeMm', 'instructionFormality', 'assessmentBands']) {
      assert.ok(!text.includes(token), `${file} restates band rule "${token}"`)
    }
  }
})

console.log(`✓ assessment bands — ${passed} tests passed`)
