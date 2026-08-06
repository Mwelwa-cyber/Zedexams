/**
 * The rollout switches — §4's five rules, asserted.
 *
 * The failure this suite is built around is not "the flag does not work". It
 * is the quieter one: the flag works, and means something slightly different
 * from what the person flipping it believes. So the cases below are mostly
 * about the shapes a real `settings/global` document can hold — a string
 * `"true"`, a number, a missing key, an array where an object belongs — and
 * about the two properties the ramp itself depends on (stable, monotonic),
 * neither of which any single-call assertion can see.
 *
 * Plain-node script (`npm run test:engine-flag-resolution`).
 */
import assert from 'node:assert/strict'
import {
  ENGINE_RUNNERS,
  ENGINE_FLAG_KEY,
  FLAG_SOURCES,
  ROLLOUT_BUCKETS,
  normaliseRolloutPercent,
  normaliseRolloutUids,
  resolveEngineDecision,
  rolloutBucket,
} from './flags.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

/** `settings/global.featureFlags` holding the given engine config. */
const flags = (config) => ({ [ENGINE_FLAG_KEY]: config })

/** Shorthand: the decision for one runner under one config. */
const decide = (config, extra = {}) =>
  resolveEngineDecision({ featureFlags: flags(config), runner: 'pastPaperQuiz', ...extra })

console.log('assessment engine — rollout flag resolution')

// ── The wire format ──────────────────────────────────────────────────────────

test('the flag table matches §4.2 exactly — three runners, one namespace', () => {
  // The table in docs/phase3-plan.md is the contract; a fourth runner appearing
  // here without a documented flag is a switch nobody knows exists.
  assert.deepEqual([...ENGINE_RUNNERS], ['pastPaperQuiz', 'quiz', 'game'])
  assert.equal(ENGINE_FLAG_KEY, 'assessmentEngine')
  assert.equal(ROLLOUT_BUCKETS, 100)
})

// ── Rule 2: fail closed ──────────────────────────────────────────────────────

test('every unreadable, absent or wrong-shaped settings document serves the OLD runner', () => {
  const off = [
    undefined,
    null,
    {},
    { featureFlags: undefined },
    { featureFlags: null },
    { featureFlags: {} },
    { featureFlags: { [ENGINE_FLAG_KEY]: null } },
    { featureFlags: { [ENGINE_FLAG_KEY]: 'on' } },
    { featureFlags: { [ENGINE_FLAG_KEY]: true } },
    // An array is an object to `typeof`, and `['pastPaperQuiz'] .pastPaperQuiz`
    // is undefined — but a future shape change could make it truthy, so the
    // refusal is explicit rather than incidental.
    { featureFlags: { [ENGINE_FLAG_KEY]: ['pastPaperQuiz'] } },
  ]
  for (const featureFlags of off) {
    const got = resolveEngineDecision({ ...featureFlags, runner: 'pastPaperQuiz' })
    assert.equal(got.engine, false, JSON.stringify(featureFlags))
    assert.equal(got.source, 'runner-off')
  }
})

test('a switch that is not EXACTLY true is off', () => {
  // The shapes an admin JSON edit actually produces.
  for (const value of ['true', 'yes', 1, 'on', {}, [], 'True']) {
    const got = decide({ pastPaperQuiz: value, rolloutPercent: 100 })
    assert.equal(got.engine, false, `pastPaperQuiz: ${JSON.stringify(value)}`)
    assert.equal(got.source, 'runner-off')
  }
  assert.equal(decide({ pastPaperQuiz: true, rolloutPercent: 100 }).engine, true)
})

test('a runner nobody declared is off, and says so', () => {
  const got = resolveEngineDecision({
    featureFlags: flags({ dailyQuiz: true, rolloutPercent: 100 }),
    runner: 'dailyQuiz',
  })
  assert.equal(got.engine, false)
  assert.equal(got.source, 'unknown-runner')
})

test('resolving with no arguments at all does not throw', () => {
  // A component calling this during an error path must not turn a bad render
  // into a blank page.
  assert.equal(resolveEngineDecision().engine, false)
  assert.equal(resolveEngineDecision({}).engine, false)
})

// ── Rule 1: per-runner, never one master switch ──────────────────────────────

test("one runner's flag cannot move another's", () => {
  const config = { quiz: true, rolloutPercent: 100 }
  const featureFlags = flags(config)
  assert.equal(resolveEngineDecision({ featureFlags, runner: 'quiz' }).engine, true)
  assert.equal(resolveEngineDecision({ featureFlags, runner: 'pastPaperQuiz' }).engine, false)
  assert.equal(resolveEngineDecision({ featureFlags, runner: 'game' }).engine, false)
})

test('each runner can be reverted alone', () => {
  const all = { pastPaperQuiz: true, quiz: true, game: true, rolloutPercent: 100 }
  for (const runner of ENGINE_RUNNERS) {
    const featureFlags = flags({ ...all, [runner]: false })
    assert.equal(resolveEngineDecision({ featureFlags, runner }).engine, false, runner)
    for (const other of ENGINE_RUNNERS.filter((r) => r !== runner)) {
      assert.equal(resolveEngineDecision({ featureFlags, runner: other }).engine, true, other)
    }
  }
})

// ── The allow-list ───────────────────────────────────────────────────────────

test('an allow-listed uid gets the engine at 0%', () => {
  const got = decide({ pastPaperQuiz: true, rolloutUids: ['staff-1'] }, { uid: 'staff-1' })
  assert.equal(got.engine, true)
  assert.equal(got.source, 'rollout-uid')
})

test('the allow-list does NOT survive flipping the runner off', () => {
  // The rollback must be total. Sparing the allow-list would leave the failure
  // running for exactly the group most likely to notice it had stopped.
  const got = decide({ pastPaperQuiz: false, rolloutUids: ['staff-1'] }, { uid: 'staff-1' })
  assert.equal(got.engine, false)
  assert.equal(got.source, 'runner-off')
})

test('the allow-list matches a uid exactly, and tolerates a pasted space', () => {
  const config = { pastPaperQuiz: true, rolloutUids: ['  staff-1  ', '', 42, null] }
  assert.equal(decide(config, { uid: 'staff-1' }).engine, true)
  assert.equal(decide(config, { uid: 'staff-11' }).engine, false)
  assert.equal(decide(config, { uid: 'STAFF-1' }).engine, false)
  // An anonymous visitor has no uid, so no anon id can be allow-listed by
  // accident — the visitor id is never consulted here.
  assert.equal(decide(config, { uid: null, visitorId: 'staff-1' }).engine, false)
})

test('a malformed allow-list is an EMPTY list, never a partial read', () => {
  for (const rolloutUids of ['staff-1', { 0: 'staff-1' }, 42, null]) {
    assert.deepEqual(normaliseRolloutUids(rolloutUids), [])
    assert.equal(decide({ pastPaperQuiz: true, rolloutUids }, { uid: 'staff-1' }).engine, false)
  }
})

// ── The ramp ─────────────────────────────────────────────────────────────────

test('the percentage normalises the way a settings document can hold it', () => {
  assert.equal(normaliseRolloutPercent(undefined), 0, 'absent → nobody (§4.2 default)')
  assert.equal(normaliseRolloutPercent(null), 0)
  assert.equal(normaliseRolloutPercent(''), 0)
  assert.equal(normaliseRolloutPercent(-5), 0)
  assert.equal(normaliseRolloutPercent(NaN), 0)
  assert.equal(normaliseRolloutPercent('abc'), 0)
  assert.equal(normaliseRolloutPercent(0.5), 0, 'below one bucket rounds to nobody')
  assert.equal(normaliseRolloutPercent(12.9), 12)
  assert.equal(normaliseRolloutPercent('25'), 25, 'the admin number input round-trips through strings')
  assert.equal(normaliseRolloutPercent(150), 100, 'over 100 is everyone, not a refusal')
  // Infinity is corruption rather than an intent, and corruption resolves
  // toward nobody. 150 is a plausible typo for "all of them"; Infinity is not
  // a number anyone typed.
  assert.equal(normaliseRolloutPercent(Infinity), 0)
  assert.equal(normaliseRolloutPercent(-Infinity), 0)
  // `Number(true)` is 1. Accepting it would ship the engine to one percent of
  // visitors on behalf of someone who thought they were flipping a switch.
  assert.equal(normaliseRolloutPercent(true), 0)
  assert.equal(normaliseRolloutPercent(false), 0)
})

test('0% is a distinct answer from losing the draw', () => {
  // "The ramp has not started" and "you are in the control group" are different
  // facts, and only one of them is a reason to go look at the admin page.
  assert.equal(decide({ pastPaperQuiz: true }, { visitorId: 'v-1' }).source, 'rollout-zero')
  assert.equal(decide({ pastPaperQuiz: true, rolloutPercent: 0 }, { visitorId: 'v-1' }).source, 'rollout-zero')
})

test('100% needs no visitor id; a partial ramp refuses without one', () => {
  const on = { pastPaperQuiz: true, rolloutPercent: 100 }
  assert.equal(decide(on, { visitorId: null }).source, 'rollout-all')
  const partial = { pastPaperQuiz: true, rolloutPercent: 50 }
  for (const visitorId of [null, undefined, '', '   ', 42, {}]) {
    const got = decide(partial, { visitorId })
    assert.equal(got.engine, false, JSON.stringify(visitorId))
    assert.equal(got.source, 'no-visitor-id')
  }
})

test('a bucket is stable for an id, and lands in range', () => {
  for (const id of ['anon-abc123', 'learner-1', 'x', 'a'.repeat(200)]) {
    const bucket = rolloutBucket(id)
    assert.ok(Number.isInteger(bucket) && bucket >= 0 && bucket < ROLLOUT_BUCKETS, `${id} → ${bucket}`)
    assert.equal(rolloutBucket(id), bucket, 'the same id must bucket the same way every page view')
  }
})

test('the ramp is MONOTONIC — raising the percentage only adds visitors', () => {
  // The property that makes "did the engine cause this" answerable: the
  // population at 25% contains the population at 10%. A ramp that reshuffled
  // would change what was being measured at the moment it was measured.
  const ids = Array.from({ length: 500 }, (_, i) => `anon-${i}`)
  for (const visitorId of ids) {
    let wasIn = false
    for (let percent = 1; percent < 100; percent += 1) {
      const isIn = decide({ pastPaperQuiz: true, rolloutPercent: percent }, { visitorId }).engine
      assert.ok(!wasIn || isIn, `${visitorId} dropped out of the rollout at ${percent}%`)
      wasIn = isIn
    }
  }
})

test('the bucket is NOT salted per runner — one percentage, one population', () => {
  // §4.2: `rolloutPercent: 10` has to mean ten percent of visitors, not ten
  // percent per surface adding up to something nobody reports.
  const config = { pastPaperQuiz: true, quiz: true, game: true, rolloutPercent: 37 }
  for (let i = 0; i < 200; i += 1) {
    const visitorId = `anon-${i}`
    const answers = ENGINE_RUNNERS.map((runner) =>
      resolveEngineDecision({ featureFlags: flags(config), runner, visitorId }).engine)
    assert.equal(new Set(answers).size, 1, `${visitorId} is on the engine for some runners and not others`)
  }
})

test('the distribution is close enough for a percentage to mean something', () => {
  // Not a statistics test: the failure it rules out is a hash that clumps —
  // sequential anon ids all landing in a handful of buckets, so "10%" is
  // really 0% or 40% depending on the day's traffic.
  const ids = Array.from({ length: 20_000 }, (_, i) => `anon-${i.toString(36)}-${i}`)
  const buckets = new Set(ids.map(rolloutBucket))
  assert.equal(buckets.size, ROLLOUT_BUCKETS, `only ${buckets.size} of 100 buckets are reachable`)
  for (const percent of [10, 50, 90]) {
    const share = ids.filter((id) => rolloutBucket(id) < percent).length / ids.length * 100
    assert.ok(Math.abs(share - percent) < 3, `at ${percent}% the real share is ${share.toFixed(1)}%`)
  }
})

// ── The telemetry vocabulary ─────────────────────────────────────────────────

test('every source the resolver can return is declared, and every declared one is reachable', () => {
  // Both directions. An undeclared source appears in PostHog as a category
  // nobody can interpret; a declared one that cannot occur is a category that
  // never appears and is never missed.
  const reached = new Set([
    resolveEngineDecision({ runner: 'nope' }).source,
    decide({}).source,
    decide({ pastPaperQuiz: true, rolloutUids: ['s'] }, { uid: 's' }).source,
    decide({ pastPaperQuiz: true }).source,
    decide({ pastPaperQuiz: true, rolloutPercent: 100 }).source,
    decide({ pastPaperQuiz: true, rolloutPercent: 50 }, { visitorId: null }).source,
  ])
  // The two bucket outcomes need ids on either side of the line.
  const ids = Array.from({ length: 200 }, (_, i) => `anon-${i}`)
  for (const visitorId of ids) {
    reached.add(decide({ pastPaperQuiz: true, rolloutPercent: 50 }, { visitorId }).source)
  }
  assert.deepEqual([...reached].sort(), [...FLAG_SOURCES].sort())
})

test('a decision is frozen — it is a telemetry payload, not a scratchpad', () => {
  const got = decide({ pastPaperQuiz: true, rolloutPercent: 100 })
  assert.throws(() => { got.engine = false }, TypeError)
  assert.deepEqual(Object.keys(got).sort(), ['engine', 'runner', 'source'])
})

console.log(`\nassessment engine flags: ${passed} passed`)
