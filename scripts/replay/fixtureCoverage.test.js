/**
 * Every canonical question type has a replay fixture — checked, not remembered.
 *
 * ## Why this is a ratchet and not a note in the README
 *
 * The answer-key defect (#2125) got through because fixture coverage was a
 * matter of memory. `ANSWER_KEY_FIELDS` dropped `statements`, `diagramLabels`,
 * `matchingLeft` and `sequenceItems`; four question types would have graded as
 * silent zeros through the engine; and the whole existing fixture set was MCQ,
 * so the comparison harness reported green throughout. The harness was working
 * exactly as designed — it can only compare the shapes it is handed.
 *
 * That is the failure this file exists to make impossible to repeat. The
 * universe of types is DERIVED from `QUESTION_TYPES`, the shared package's
 * registry, so adding a fourteenth type fails this test the moment it is
 * declared — before anything can be built on the assumption that it is covered.
 *
 * ## What "covered" means, and what it deliberately does not
 *
 * Covered means: at least one fixture contains a question of that type, so the
 * type travels the whole `raw → normalise → mark → build → diff` path and any
 * loss along it changes a number. It does NOT mean the type is exhaustively
 * tested — one fixture per type is a floor, not a ceiling.
 *
 * The floor is the useful thing to enforce. A rule demanding N fixtures per
 * type, or per type-and-outcome, would be satisfied by padding; a rule demanding
 * one is satisfied only by exercising the type at all, which is precisely what
 * was missing.
 *
 * ## No exemption list, and that is a decision
 *
 * The obvious escape hatch is `UNCOVERABLE_TYPES` with a reason per entry. There
 * isn't one, because every type in the registry is reachable: `coerceQuestion`
 * accepts each of them, so a stored quiz can hold one, so a learner can meet one.
 * A type that genuinely cannot appear should be removed from the registry rather
 * than exempted here — and if that day comes, deleting it from `QUESTION_TYPES`
 * is the change a reviewer sees, instead of a line in an allow-list nobody
 * re-reads.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QUESTION_TYPES } from '../../functions/shared/assessment/questionTypeCore.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const FIXTURES = join(ROOT, 'tests/fixtures/attempts')

const fixtureNames = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort()
const load = (name) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'))

/** type → the fixtures containing at least one question of it. */
function coverage() {
  const byType = new Map(QUESTION_TYPES.map((t) => [t, []]))
  const unknown = new Map()
  for (const name of fixtureNames) {
    for (const question of load(name).questions ?? []) {
      const type = question.type
      if (byType.has(type)) {
        if (!byType.get(type).includes(name)) byType.get(type).push(name)
      } else {
        if (!unknown.has(type)) unknown.set(type, [])
        unknown.get(type).push(name)
      }
    }
  }
  return { byType, unknown }
}

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('replay — fixture type coverage')

const { byType, unknown } = coverage()

// ── The scanner has to be shown to work ──────────────────────────────────────
//
// "No type is missing" is exactly what a scanner that reads nothing reports, so
// the result below is worthless until the scan is known to see real data.

test('the registry is read and is not empty', () => {
  assert.ok(QUESTION_TYPES.length >= 13, `expected the full registry, got ${QUESTION_TYPES.length}`)
  assert.ok(QUESTION_TYPES.includes('mcq'))
})

test('the fixtures are read and contain questions', () => {
  assert.ok(fixtureNames.length >= 9, `expected at least 9 fixtures, found ${fixtureNames.length}`)
  const total = fixtureNames.reduce((n, name) => n + (load(name).questions?.length ?? 0), 0)
  assert.ok(total >= 20, `expected at least 20 questions across the set, found ${total}`)
})

test('the scan attributes a known type to the fixture that holds it', () => {
  // A concrete, hand-verified fact. If the attribution were broken — every type
  // mapped to every fixture, say — the coverage assertion would still pass.
  assert.ok(byType.get('sequence').includes('typed-answer-keys'))
  assert.ok(!byType.get('sequence').includes('happy-path'))
  assert.ok(byType.get('mcq').includes('happy-path'))
})

// ── The ratchet ──────────────────────────────────────────────────────────────

test('every canonical question type appears in at least one fixture', () => {
  const uncovered = QUESTION_TYPES.filter((t) => byType.get(t).length === 0)
  assert.deepEqual(uncovered, [],
    'a question type the engine can be handed has no replay fixture — it would cross the '
    + 'cutover measured by nothing. Add one to tests/fixtures/attempts/ and name its case '
    + 'in the README table.')
})

test('no fixture carries a type outside the registry', () => {
  // The other direction: a typo'd type in a fixture makes that fixture cover
  // nothing while looking like it covers something, and `canonicalizeQuestionType`
  // returns an unrecognised value UNCHANGED rather than guessing.
  assert.deepEqual([...unknown.keys()], [],
    'a fixture declares a type that is not in QUESTION_TYPES — likely a typo, and it '
    + 'covers nothing')
})

test('the coverage map is complete — every registry entry was considered', () => {
  // Guards the map being built from the fixtures rather than the registry,
  // which would silently drop any type no fixture happens to mention.
  assert.deepEqual([...byType.keys()].sort(), [...QUESTION_TYPES].sort())
})

// ── The ratchet can fail ─────────────────────────────────────────────────────

test('a registry type with no fixture IS reported', () => {
  // The control. Run the same rule against a registry with one extra type and
  // confirm it comes back uncovered — otherwise this file is a green tick over
  // a rule that never fires.
  const withGhost = [...QUESTION_TYPES, 'ghost_type']
  const seen = new Set()
  for (const name of fixtureNames) for (const q of load(name).questions ?? []) seen.add(q.type)
  const uncovered = withGhost.filter((t) => !seen.has(t))
  assert.deepEqual(uncovered, ['ghost_type'])
})

// ── What the set actually covers, printed ────────────────────────────────────

test('coverage is reported, not just asserted', () => {
  // A reviewer should be able to see the distribution without reading nine JSON
  // files — including that some types rest on a single fixture.
  const lines = QUESTION_TYPES.map((t) => `      ${t.padEnd(14)} ${byType.get(t).join(', ')}`)
  console.log(lines.join('\n'))
  const single = QUESTION_TYPES.filter((t) => byType.get(t).length === 1)
  console.log(`      — ${single.length} of ${QUESTION_TYPES.length} types rest on one fixture`)
  assert.ok(true)
})

console.log(`\nreplay fixture coverage: ${passed} passed`)
