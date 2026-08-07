/**
 * The screen family's scope rules, and its half of the required check.
 *
 * Both are things that can wedge the whole repository if they are wrong, in
 * opposite directions:
 *
 *   • the classifier says a change cannot affect the screen when it can, and a
 *     changed screen ships behind a green gate;
 *   • the verdict passes on an absence, and the gate becomes decoration.
 *
 * Neither failure announces itself, so both are asserted here rather than
 * expressed as a workflow `if:` nobody can test.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { SCREEN_AFFECTING_PATHS, isScreenAffecting, classifyScreenScope } from './screenAffectingPaths.js'
import { isPrintAffecting } from '../printAffectingPaths.js'
import { gateVerdict } from '../gateVerdict.js'

let passed = 0
const test = (name, fn) => { fn(); passed += 1; console.log(`  ✓ ${name}`) }

console.log('visual — screen scope and the gate verdict')

// ── The classifier ───────────────────────────────────────────────────────────

test('the engine renderers are screen-affecting', () => {
  for (const f of [
    'src/engines/assessment-engine/render/ChoiceQuestion.jsx',
    'src/engines/assessment-engine/render/choiceRows.js',
    'src/engines/assessment-engine/normalise/fromQuiz.js',
  ]) assert.equal(isScreenAffecting(f), true, f)
})

test('the shipping classes the renderers REUSE are screen-affecting', () => {
  // The reuse is deliberate — .opt-grid is the single-column rule — and it
  // means this stylesheet is upstream of every fixture. A list that covered
  // only the engine would miss a restyle of every option row.
  assert.equal(isScreenAffecting('src/index.css'), true)
  assert.equal(isScreenAffecting('tailwind.config.js'), true)
})

test('school notation is screen-affecting — the fraction bug\'s own path', () => {
  // #2128: the stacking CSS moved to mathNotation.css and safeRender imports
  // it. Both must trigger a render, or the regression that started this could
  // recur behind a green gate.
  assert.equal(isScreenAffecting('src/editor/mathNotation.css'), true)
  assert.equal(isScreenAffecting('src/editor/utils/safeRender.js'), true)
  assert.equal(isScreenAffecting('src/editor/RichContent.jsx'), true)
})

test('the letters come from a shared module, and it is listed', () => {
  assert.equal(isScreenAffecting('functions/shared/assessment/answerChoicesCore.js'), true)
})

test('the gate\'s own machinery is screen-affecting', () => {
  for (const f of [
    'scripts/visual/screen/screenStage.mjs',
    'scripts/visual/gateVerdict.js',
    'tests/visual/baselines/screen/chromium-140/scr-001/phone.png',
    '.github/workflows/visual-regression.yml',
  ]) assert.equal(isScreenAffecting(f), true, f)
})

test('an unrelated change is NOT screen-affecting', () => {
  for (const f of ['README.md', 'functions/lencoService.js', 'docs/architecture.md', 'src/utils/invoicePdf.js']) {
    assert.equal(isScreenAffecting(f), false, f)
  }
})

test('the two families are genuinely different lists', () => {
  // If they were the same, every paper change would render screens and every
  // screen change would render papers — sixteen minutes of CI on every PR.
  assert.equal(isPrintAffecting('src/engines/assessment-engine/render/ChoiceQuestion.jsx'), false,
    'an engine renderer cannot change a printed paper')
  assert.equal(isScreenAffecting('src/utils/assessmentToDocx.js'), false,
    'the Word exporter cannot change the learner screen')
  // …but they legitimately overlap where one file feeds both.
  assert.equal(isPrintAffecting('src/editor/utils/safeRender.js'), true)
  assert.equal(isScreenAffecting('src/editor/utils/safeRender.js'), true)
})

test('every non-glob entry names a file that exists', () => {
  // A pattern for a moved file protects nothing and reads exactly like one
  // that works — the failure the print list already hit once.
  const missing = SCREEN_AFFECTING_PATHS
    .filter((p) => !p.includes('*'))
    .filter((p) => !existsSync(new URL(`../../../${p}`, import.meta.url)))
  assert.deepEqual(missing, [])
})

// ── Classification of a whole set ────────────────────────────────────────────

test('an empty changed-file set RENDERS rather than assuming nothing changed', () => {
  const r = classifyScreenScope([])
  assert.equal(r.requiresScreen, true)
  assert.equal(r.reason, 'no-changed-files')
})

test('a matched set names the files that made it render', () => {
  const r = classifyScreenScope(['README.md', 'src/index.css'])
  assert.equal(r.requiresScreen, true)
  assert.deepEqual(r.matched, ['src/index.css'])
  assert.match(r.summary, /src\/index\.css/)
})

test('an unmatched set declines, and says it looked', () => {
  const r = classifyScreenScope(['README.md', 'docs/architecture.md'])
  assert.equal(r.requiresScreen, false)
  assert.match(r.summary, /none of the 2 changed files/)
})

// ── The verdict: the screen half ─────────────────────────────────────────────

const base = { scopeResult: 'success', visualResult: 'skipped', requiresVisual: 'false' }

test('a required screen render that SUCCEEDED passes', () => {
  assert.equal(gateVerdict({ ...base, screenResult: 'success', requiresScreen: 'true' }).passed, true)
})

test('a required screen render that was SKIPPED fails', () => {
  // The dangerous one: a tidy grey "skipped" on the run page is not a pass.
  const v = gateVerdict({ ...base, screenResult: 'skipped', requiresScreen: 'true' })
  assert.equal(v.passed, false)
  assert.equal(v.conclusion, 'screen-skipped')
})

test('a required screen render that FAILED or was CANCELLED fails', () => {
  assert.equal(gateVerdict({ ...base, screenResult: 'failure', requiresScreen: 'true' }).conclusion, 'screen-failed')
  assert.equal(gateVerdict({ ...base, screenResult: 'cancelled', requiresScreen: 'true' }).conclusion, 'screen-cancelled')
})

test('an UNREQUIRED screen render that ran and failed still fails', () => {
  // The output it rendered is the output this pull request produces.
  assert.equal(gateVerdict({ ...base, screenResult: 'failure', requiresScreen: 'false' }).passed, false)
})

test('an unrequired, unrun screen family passes', () => {
  assert.equal(gateVerdict({ ...base, screenResult: 'skipped', requiresScreen: 'false' }).passed, true)
})

test('BOTH families must be acceptable', () => {
  // A screen failure is a failure even when papers are untouched, and a paper
  // failure is a failure even when screens are.
  assert.equal(gateVerdict({
    scopeResult: 'success', visualResult: 'success', requiresVisual: 'true',
    screenResult: 'failure', requiresScreen: 'true',
  }).passed, false)
  assert.equal(gateVerdict({
    scopeResult: 'success', visualResult: 'failure', requiresVisual: 'true',
    screenResult: 'success', requiresScreen: 'true',
  }).passed, false)
  assert.equal(gateVerdict({
    scopeResult: 'success', visualResult: 'success', requiresVisual: 'true',
    screenResult: 'success', requiresScreen: 'true',
  }).passed, true)
})

test('scope failing still overrides everything', () => {
  assert.equal(gateVerdict({
    scopeResult: 'failure', visualResult: 'success', requiresVisual: 'true',
    screenResult: 'success', requiresScreen: 'true',
  }).passed, false)
})

test('ABSENT screen inputs read as a family that was not required and did not run', () => {
  // What an older workflow produces during the changeover. It must not fail
  // every pull request.
  assert.equal(gateVerdict({ scopeResult: 'success', visualResult: 'success', requiresVisual: 'true' }).passed, true)
  assert.equal(gateVerdict({ scopeResult: 'success', visualResult: 'skipped', requiresVisual: 'false' }).passed, true)
})

console.log(`\nvisual screen scope: ${passed} passed`)
