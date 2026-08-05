/**
 * The screen fixture set's own rules — and proof they can fail.
 *
 * A visual suite's quiet failure is a fixture that stops containing the thing
 * it protects: someone edits the maths fixture, the fraction goes, and it keeps
 * passing because a page with no maths renders consistently too. The suite
 * reports green while watching nothing.
 *
 * So `requires` is checked here, before any renderer exists to run them
 * against, and each rule has a case that FAILS when it is doing its job.
 */
import assert from 'node:assert/strict'
import {
  SCREEN_FIXTURES,
  SCREEN_VIEWPORTS,
  screenFixture,
  screenFixtureProblems,
  validateAllScreenFixtures,
  screenBaselineTargets,
} from './screenFixtures.js'
import { baselineIdentity, assertToolchain, RenderEnvironmentError } from '../renderEnvironment.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('visual — the learner-screen fixture set')

// ── The set is real ──────────────────────────────────────────────────────────

test('the set is non-empty and every fixture validates', () => {
  assert.ok(SCREEN_FIXTURES.length >= 8, `expected at least 8 fixtures, found ${SCREEN_FIXTURES.length}`)
  assert.deepEqual(validateAllScreenFixtures(), [])
})

test('every fixture names what it protects, in words', () => {
  for (const f of SCREEN_FIXTURES) {
    assert.ok(f.protects.length > 0, f.id)
    for (const claim of f.protects) {
      assert.ok(claim.length > 15, `${f.id}: "${claim}" is too thin to tell a reviewer anything`)
    }
  }
})

test('ids are unique and permanent-looking', () => {
  const ids = SCREEN_FIXTURES.map((f) => f.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) assert.match(id, /^scr-\d{3}$/)
})

test('lookup finds a fixture and reports a miss as null', () => {
  assert.equal(screenFixture('scr-001')?.id, 'scr-001')
  assert.equal(screenFixture('scr-999'), null)
})

// ── The §4 contract has fixtures that can see it ─────────────────────────────

test('something covers each part of the §4 layout contract', () => {
  // A set that protects the layout only at four options cannot see the fifth
  // being unlettered, or a sentence-length option truncating.
  const counts = SCREEN_FIXTURES.map((f) => f.question.options.length)
  assert.ok(counts.includes(2), 'no true/false fixture — A/B lettering is unwatched')
  assert.ok(counts.includes(4), 'no ordinary four-option fixture')
  assert.ok(counts.includes(5), 'no five-option fixture — the D4 defect would be unwatched')
  assert.ok(counts.includes(0), 'no unanswerable-question fixture')
  assert.ok(
    SCREEN_FIXTURES.some((f) => f.question.options.some((o) => (o.plainTextFallback ?? '').length > 70)),
    'no long-option fixture — the whole reason the column is vertical is unwatched',
  )
})

test('both interaction states are covered, and the unrevealed one is too', () => {
  // The rule that matters most is about the UNREVEALED state: the answer key
  // must not be visible. A set of only-revealed fixtures could not see it.
  assert.ok(SCREEN_FIXTURES.some((f) => f.revealed === true))
  assert.ok(SCREEN_FIXTURES.some((f) => f.revealed !== true && typeof f.answer === 'number'))
})

test('school notation is covered, and its fixture carries no slash form', () => {
  const maths = SCREEN_FIXTURES.filter((f) => JSON.stringify(f.question).includes('mathFraction'))
  assert.ok(maths.length >= 1, '§4.1 school notation has no fixture')
  for (const f of maths) {
    assert.ok(!JSON.stringify(f.question).includes('/'),
      `${f.id}: the source contains a slash — a renderer that emitted "3/4" could match a baseline `
      + 'recorded from the same source, and the slash form is exactly what §4.1 forbids')
  }
})

// ── Self-validation can fail ─────────────────────────────────────────────────

test('a fixture that LOST what it protects is reported', () => {
  // The control for the whole idea. Strip the fraction out of the maths
  // fixture and its own requirement must catch it.
  const maths = SCREEN_FIXTURES.find((f) => f.id === 'scr-006')
  const gutted = {
    ...maths,
    question: { ...maths.question, prompt: { version: 1, tiptapDoc: null, plainTextFallback: 'Simplify.' } },
  }
  const problems = screenFixtureProblems(gutted)
  assert.ok(problems.some((p) => p.includes('stacked fraction')), problems.join('; '))
})

test('a fixture that lost its options is reported', () => {
  const four = SCREEN_FIXTURES.find((f) => f.id === 'scr-001')
  const problems = screenFixtureProblems({ ...four, question: { ...four.question, options: [] } })
  assert.ok(problems.some((p) => p.includes('4 answer choices')))
})

test('a fixture declaring nothing it protects is reported', () => {
  const problems = screenFixtureProblems({ ...SCREEN_FIXTURES[0], protects: [] })
  assert.ok(problems.some((p) => p.includes('protects')))
})

test('a fixture with no requirement is reported — it could never fail', () => {
  const problems = screenFixtureProblems({ ...SCREEN_FIXTURES[0], requires: [] })
  assert.ok(problems.some((p) => p.includes('no requirement')))
})

test('a requirement that THROWS is reported, not swallowed', () => {
  // A broken predicate must not read as a satisfied one.
  const problems = screenFixtureProblems({
    ...SCREEN_FIXTURES[0],
    requires: [{ name: 'broken', test: () => { throw new Error('boom') } }],
  })
  assert.ok(problems.some((p) => p.includes('threw')))
})

test('duplicate ids are reported — baselines key on them', () => {
  const one = SCREEN_FIXTURES[0]
  assert.ok(validateAllScreenFixtures([one, { ...one }]).some((p) => p.includes('duplicated')))
})

// ── Viewports ────────────────────────────────────────────────────────────────

test('a phone viewport is captured, and it is genuinely narrow', () => {
  // The §4 claim is about long options wrapping, which only fails at a narrow
  // width. A desktop-only set would pass with a two-column grid.
  const phone = SCREEN_VIEWPORTS.find((v) => v.id === 'phone')
  assert.ok(phone, 'no phone viewport')
  assert.ok(phone.width <= 430, `phone viewport is ${phone.width}px — too wide to see the failure`)
  assert.ok(SCREEN_VIEWPORTS.some((v) => v.width >= 1000), 'no desktop viewport')
})

test('every fixture is captured at every viewport', () => {
  const targets = screenBaselineTargets()
  assert.equal(targets.length, SCREEN_FIXTURES.length * SCREEN_VIEWPORTS.length)
  assert.ok(targets.includes('scr-006/phone'))
  assert.equal(new Set(targets).size, targets.length)
})

// ── The baseline identity this family files under ────────────────────────────

test('the screen family has its OWN baseline identity', () => {
  // Sharing `browser-print`'s would let a print baseline satisfy a screen
  // comparison the day someone passed the wrong stage string.
  assert.equal(baselineIdentity('screen', { chromium: '1.2.3' }), 'screen/chromium-1.2.3')
  assert.notEqual(
    baselineIdentity('screen', { chromium: '1.2.3' }),
    baselineIdentity('browser-print', { chromium: '1.2.3' }),
  )
})

test('a screen baseline cannot be filed without a Chromium version', () => {
  assert.throws(() => baselineIdentity('screen', {}), RenderEnvironmentError)
})

test('a missing Chromium is an INFRASTRUCTURE refusal, not a blank baseline', () => {
  // The failure this prevents: no browser, nothing rendered, a screenshot of
  // an empty page accepted as the reference.
  assert.throws(() => assertToolchain(['screen'], {}), /infrastructure failure/)
  assert.doesNotThrow(() => assertToolchain(['screen'], { chromium: '1.2.3' }))
})

console.log(`\nvisual screen fixtures: ${passed} passed`)
