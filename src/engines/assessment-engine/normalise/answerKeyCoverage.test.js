/**
 * The bridge between what the normaliser CARRIES and what marking READS.
 *
 * `fromQuiz`'s `ANSWER_KEY_FIELDS` decides which question fields survive into
 * the canonical model. The grading modules decide which ones they need. Nothing
 * connected the two, and they disagreed in four places the moment anything
 * consumed the result:
 *
 *   carried, never read   →  `blanks`, `labels`
 *   read, never carried   →  `statements`, `diagramLabels`,
 *                            `matchingLeft`, `sequenceItems`
 *
 * The consequence is worth stating plainly, because it is why this file exists
 * rather than a comment: an absent answer key does not throw. `gradeFillBlanks`
 * on a question with no `statements` returns `allCorrect: false`, and
 * `matchingMatches` with no `matchingLeft` compares against an empty array. So
 * a fill-in-the-blanks, diagram-label, matching or sequence question would have
 * been marked WRONG — silently, for every learner, at full confidence — the day
 * `persist/` started writing engine-marked results.
 *
 * ## Why this scans source instead of importing
 *
 * The obvious test is "grade a question of each type and check the mark". That
 * is worth having and `marking.test.js` has it, but it only covers the types
 * somebody remembered to write a case for — and the failure here is precisely a
 * field nobody remembered. Scanning derives the requirement from the graders
 * themselves, so a NEW grading module that reads a new field fails this test
 * without anyone thinking to update it.
 *
 * Same technique as `test:monochrome` (which scans the renderers for the
 * colours they actually print) and `purity.test.js` (which scans the engine for
 * imports it must not have). Its limit is the same: it sees `question.foo`, not
 * a field reached through a variable. Both directions are asserted, so the list
 * cannot grow dead entries either — that is the half that would have caught
 * `blanks` and `labels` on the day they were written.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ANSWER_KEY_FIELDS } from './fromQuiz.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

/**
 * Every module on the marking path, and it must stay every one.
 *
 * `quizScoring.js` is the entry point; the rest are the per-type graders it
 * delegates to. `fillBlanks` is listed at its shared-package source because
 * `src/utils/fillBlanks.js` is a re-export shim with no rules in it.
 */
const GRADING_MODULES = [
  'src/utils/quizScoring.js',
  'src/utils/numericGrading.js',
  'src/utils/hotspotGrading.js',
  'src/utils/diagramLabelGrading.js',
  'src/utils/matchingGrading.js',
  'src/utils/sequenceGrading.js',
  'functions/shared/assessment/fillBlanksCore.js',
]

/**
 * Fields the marking projection supplies from the canonical model itself, so a
 * grader reading one of them needs nothing from the answer key.
 *
 * `topic` is the odd one: the canonical model holds `topicIds`, and the
 * projection collapses it to the single `topic` string `computeQuizScore`
 * groups by. That mapping is asserted in `marking.test.js`.
 */
const CANONICAL_FIELDS = Object.freeze(['id', 'type', 'marks', 'topic'])

/** Comments describe fields; they must not be read as evidence one is used. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Every `question.X` / `question?.X` / `q.X` read in one module. */
function fieldsReadBy(relativePath) {
  const source = stripComments(readFileSync(join(ROOT, relativePath), 'utf8'))
  const found = new Set()
  for (const m of source.matchAll(/\bquestion\s*\??\.\s*([A-Za-z_$][\w$]*)/g)) found.add(m[1])
  for (const m of source.matchAll(/\bq\s*\??\.\s*([A-Za-z_$][\w$]*)/g)) found.add(m[1])
  return found
}

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('engine — answer-key coverage')

// The scan has to be shown to work before anything is concluded from it. A
// regex that matched nothing would make every assertion below vacuously true,
// and "no field is missing" is exactly what a broken scanner reports.
const readByModule = new Map(GRADING_MODULES.map((m) => [m, fieldsReadBy(m)]))

test('the scanner finds the reads it is pointed at', () => {
  assert.ok(readByModule.get('src/utils/matchingGrading.js').has('matchingLeft'),
    'the scanner failed to see a read it is known to contain — every result below would be vacuous')
  assert.ok(readByModule.get('functions/shared/assessment/fillBlanksCore.js').has('statements'))
  assert.ok(readByModule.get('src/utils/quizScoring.js').has('correctAnswer'))
})

test('the scanner does NOT count a field named only in a comment', () => {
  // `blanks` appears in fillBlanksCore's prose. If comments counted, the list
  // could keep a dead field forever on the strength of being described.
  const raw = readFileSync(join(ROOT, 'functions/shared/assessment/fillBlanksCore.js'), 'utf8')
  assert.ok(/blanks/.test(raw), 'the fixture for this control is gone — pick another word')
  assert.equal(readByModule.get('functions/shared/assessment/fillBlanksCore.js').has('blanks'), false)
})

test('every module on the marking path is scanned', () => {
  // A grader added to the marking path but not to this list is invisible to
  // every assertion here, which is the quiet way this guard stops guarding.
  for (const m of GRADING_MODULES) {
    assert.ok(readByModule.get(m) instanceof Set, `${m}: not scanned`)
  }
  assert.ok(GRADING_MODULES.length >= 7)
})

// ── The two directions ───────────────────────────────────────────────────────

test('every field a grader reads is either canonical or carried in the answer key', () => {
  const carried = new Set([...ANSWER_KEY_FIELDS, ...CANONICAL_FIELDS])
  const missing = []
  for (const [module, fields] of readByModule) {
    for (const field of fields) {
      if (!carried.has(field)) missing.push(`${field} (read by ${module})`)
    }
  }
  assert.deepEqual(missing, [],
    'a grader reads a question field the normaliser drops — that question type marks as a silent zero')
})

test('every field the answer key carries is read by some grader', () => {
  const read = new Set()
  for (const fields of readByModule.values()) for (const f of fields) read.add(f)
  const dead = ANSWER_KEY_FIELDS.filter((f) => !read.has(f))
  assert.deepEqual(dead, [],
    'the answer key carries a field nothing grades — the half of this check that caught `blanks` and `labels`')
})

test('the canonical list and the answer key do not overlap', () => {
  // A field in both is ambiguous about where its value comes from, and the two
  // sources can disagree.
  const overlap = ANSWER_KEY_FIELDS.filter((f) => CANONICAL_FIELDS.includes(f))
  assert.deepEqual(overlap, [])
})

console.log(`\nengine answer-key coverage: ${passed} passed`)
