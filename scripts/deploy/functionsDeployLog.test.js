#!/usr/bin/env node
/* global console, process */
/**
 * Regression tests for the functions-deploy log classifier.
 *
 * The incident (2026-07-29, after #2005 merged): firebase-tools retried a
 * throttled operation itself and reported BOTH outcomes for the same function —
 * a 429 failure, then a success. The workflow's grep only asked whether the
 * failure text appeared anywhere, so it failed a deploy that had completed.
 * `deploy-hosting.yml` waits on `deploy-firebase.yml`, so the false red skipped
 * the Hosting deploy entirely and the frontend sat unshipped for 35 minutes.
 *
 * Order is the whole point: the same two lines in the other order mean the
 * opposite thing. Every case below is built from real log text.
 *
 * Run: npm run test:deploy-log  (also via npm run test:all)
 */
import {
  classifyFunctionsDeploy,
  retrySetFromLog,
  readDeployEvents,
} from './functionsDeployLog.js'

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function assertSame(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  assert(a === e, `${label}: expected ${e}, got ${a}`)
}

// ── Real log lines, so a format change here fails rather than silently
//    stops matching. Taken verbatim from run 30429274906.
const REGION = 'us-central1'
const PROJECT = 'projects/examsprepzambia/locations/us-central1'

const ok = (name) =>
  `✔  functions[${name}(${REGION})] Successful update operation.`

const failedLine = (name) =>
  `⚠  functions:  failed to update function ${PROJECT}/functions/${name}`

const http429 = (name) =>
  `⚠  functions: Request to https://cloudfunctions.googleapis.com/v2/${PROJECT}`
  + `/functions/${name}?updateMask=name%2CbuildConfig.runtime%2Clabels had HTTP Error: 429, `
  + `Quota exceeded for quota metric 'Per project mutation requests' and limit `
  + `'Per project mutation requests per minute per region' of service `
  + `'cloudfunctions.googleapis.com' for consumer 'project_number:325628669031'.`

const http409Queue = (name) =>
  `⚠  functions: Request to https://cloudfunctions.googleapis.com/v2/${PROJECT}`
  + `/functions/${name}?updateMask=name%2Clabels had HTTP Error: 409, `
  + `unable to queue the operation`

const http409Exists = (name) =>
  `⚠  functions: Request to https://cloudfunctions.googleapis.com/v2/${PROJECT}`
  + `/functions/${name} had HTTP Error: 409, Resource `
  + `'${PROJECT}/functions/${name}' already exists`

const retryNotice = (name) =>
  `⚠  functions: Got "Quota Exceeded" error while trying to update `
  + `${PROJECT}/functions/${name}. Waiting to retry...`

// The full four-line shape firebase-tools emits for a throttled-then-recovered
// function, in the order it emits them.
const throttledThenRecovered = (name) => [
  http429(name),
  retryNotice(name),
  failedLine(name),
  ok(name),
]

console.log('\nfunctions-deploy log classifier — order decides, not presence')

// ── 1. failure followed by success → deployment passes ────────────────
test('1. a failure followed by a success is a recovery, not a failure', () => {
  const log = [
    `i  functions: updating Node.js 22 (2nd Gen) function payments(${REGION})...`,
    failedLine('payments'),
    ok('payments'),
    '✔  Deploy complete!',
  ].join('\n')

  const result = classifyFunctionsDeploy(log)
  assertSame(result.genuine, [], 'genuine')
  assertSame(result.unresolved, [], 'unresolved')
  assertSame(result.recovered, ['payments'], 'recovered')
  assert(result.ok, 'a recovered deploy must pass')
})

// ── 2. failure with no later success → deployment fails ───────────────
test('2. a failure with no later success fails the deploy', () => {
  const log = [
    `i  functions: updating Node.js 22 (2nd Gen) function payments(${REGION})...`,
    failedLine('payments'),
    '✔  Deploy complete!',
  ].join('\n')

  const result = classifyFunctionsDeploy(log)
  assertSame(result.genuine, ['payments'], 'genuine')
  assert(!result.ok, 'an unrecovered failure must fail the deploy')
})

// ── 3. success followed by a LATER failure → deployment fails ─────────
// The mirror image of case 1, and the reason presence testing cannot work:
// both logs contain exactly one success line and one failure line.
test('3. a success followed by a later failure still fails the deploy', () => {
  const log = [
    ok('payments'),
    failedLine('payments'),
    '✔  Deploy complete!',
  ].join('\n')

  const result = classifyFunctionsDeploy(log)
  assertSame(result.genuine, ['payments'], 'genuine')
  assertSame(result.recovered, [], 'recovered')
  assert(!result.ok, 'a re-failure after a success must fail the deploy')
})

test('3b. the two orders are genuinely distinguished (same lines, both ways)', () => {
  const recovery = classifyFunctionsDeploy([failedLine('x'), ok('x')].join('\n'))
  const refailure = classifyFunctionsDeploy([ok('x'), failedLine('x')].join('\n'))
  assert(
    recovery.ok && !refailure.ok,
    'the classifier must not be order-insensitive — a presence test passes both',
  )
})

// ── 4. many functions, one unresolved → fail, naming ONLY that one ────
test('4. with many functions, only the unresolved one is reported', () => {
  const log = [
    ...throttledThenRecovered('generateAssessment'),
    ok('generateQuiz'),
    ...throttledThenRecovered('weeklyParentDigest'),
    http429('importPastPaperQuestions'),
    retryNotice('importPastPaperQuestions'),
    failedLine('importPastPaperQuestions'),
    ok('setUserRole'),
    '✔  Deploy complete!',
  ].join('\n')

  const result = classifyFunctionsDeploy(log)
  assertSame(result.genuine, ['importPastPaperQuestions'], 'genuine')
  assertSame(
    result.recovered,
    ['generateAssessment', 'weeklyParentDigest'],
    'recovered',
  )
  assert(!result.ok, 'one unresolved function must fail the deploy')
  assert(
    !result.genuine.includes('generateAssessment')
      && !result.genuine.includes('weeklyParentDigest'),
    'recovered functions must never be reported as failures',
  )
})

// ── 5. overlapping / interleaved updates from closely merged PRs ──────
// Cloud Functions throttles project-wide, so during a burst the failure and
// success lines for different functions are interleaved rather than grouped.
test('5. interleaved per-function events are attributed correctly', () => {
  const log = [
    `i  functions: updating Node.js 22 (2nd Gen) function alpha(${REGION})...`,
    `i  functions: updating Node.js 22 (2nd Gen) function beta(${REGION})...`,
    `i  functions: updating Node.js 22 (2nd Gen) function gamma(${REGION})...`,
    http429('alpha'),
    failedLine('alpha'),
    http429('beta'),
    ok('gamma'),
    failedLine('beta'),
    ok('alpha'),          // alpha recovers…
    http429('gamma'),
    failedLine('gamma'),  // …while gamma fails AFTER its success
    '✔  Deploy complete!',
  ].join('\n')

  const result = classifyFunctionsDeploy(log)
  assertSame(result.recovered, ['alpha'], 'recovered')
  assertSame(result.genuine, ['beta', 'gamma'], 'genuine')
  assert(!result.ok, 'two unresolved functions must fail the deploy')
})

test('5b. events are recorded in log order', () => {
  const events = readDeployEvents([failedLine('a'), ok('b'), ok('a')].join('\n'))
  assertSame(
    events.map((e) => `${e.name}:${e.kind}`),
    ['a:failure', 'b:success', 'a:success'],
    'events',
  )
})

// ── 6. the exact incident: triggerWeeklyParentDigest ──────────────────
// Reproduced from run 30429274906, including the second in-deploy retry and
// the narrowed second attempt, concatenated the way the workflow accumulates
// every attempt's output.
test('6. the triggerWeeklyParentDigest 429-then-retry-success case passes', () => {
  const attempt1 = [
    '✔  functions[setUserRole(us-central1)] Successful update operation.',
    '✔  functions[generateRubric(us-central1)] Successful update operation.',
    ...throttledThenRecovered('triggerWeeklyParentDigest').slice(0, 3),
    ok('weeklyParentDigest'),
    // firebase-tools retried it a second time inside the same attempt.
    http429('triggerWeeklyParentDigest'),
    retryNotice('triggerWeeklyParentDigest'),
    failedLine('triggerWeeklyParentDigest'),
    ok('triggerWeeklyParentDigest'),
  ].join('\n')

  const attempt2 = [
    'i  functions: updating Node.js 22 (2nd Gen) function sendActivationConfirmation(us-central1)...',
    ok('sendActivationConfirmation'),
    http429('triggerWeeklyParentDigest'),
    retryNotice('triggerWeeklyParentDigest'),
    failedLine('triggerWeeklyParentDigest'),
    ok('weeklyParentDigest'),
    ok('triggerWeeklyParentDigest'),
    '✔  Deploy complete!',
  ].join('\n')

  const result = classifyFunctionsDeploy(`${attempt1}\n${attempt2}`)
  assertSame(result.genuine, [], 'genuine')
  assert(
    result.recovered.includes('triggerWeeklyParentDigest'),
    'triggerWeeklyParentDigest must be reported as recovered',
  )
  assert(
    result.ok,
    'THE REGRESSION: this exact log failed the job and skipped the Hosting deploy',
  )
})

test('6b. a 429 that never recovers is still genuine (no weakening)', () => {
  const log = [
    http429('triggerWeeklyParentDigest'),
    retryNotice('triggerWeeklyParentDigest'),
    failedLine('triggerWeeklyParentDigest'),
    '✔  Deploy complete!',
  ].join('\n')

  const result = classifyFunctionsDeploy(log)
  assertSame(result.genuine, ['triggerWeeklyParentDigest'], 'genuine')
  assert(!result.ok, 'quota exhaustion with no recovery leaves stale code — must fail')
})

// ── 7. the pre-existing 409 special cases still behave ────────────────
test('7a. an unrecovered "unable to queue" 409 is cosmetic, not genuine', () => {
  const log = [
    http409Queue('agentJobsOnCreate'),
    failedLine('agentJobsOnCreate'),
    '✔  Deploy complete!',
  ].join('\n')

  const result = classifyFunctionsDeploy(log)
  assertSame(result.cosmetic, ['agentJobsOnCreate'], 'cosmetic')
  assertSame(result.genuine, [], 'genuine')
  assert(result.ok, 'the cosmetic queue race must not fail the deploy')
})

test('7b. an unrecovered "already exists" 409 is cosmetic', () => {
  const log = [
    http409Exists('dailyPracticeReminders'),
    `⚠  functions:  failed to create function ${PROJECT}/functions/dailyPracticeReminders`,
    '✔  Deploy complete!',
  ].join('\n')

  const result = classifyFunctionsDeploy(log)
  assertSame(result.cosmetic, ['dailyPracticeReminders'], 'cosmetic')
  assert(result.ok, 'the idempotent create race must not fail the deploy')
})

test('7c. a bare gen1 failure DURING a live queue race is cosmetic', () => {
  const log = [
    http409Queue('generateAssessment'),
    failedLine('generateAssessment'),
    failedLine('setUserRole'),   // gen1: no HTTP detail line at all
    '✔  Deploy complete!',
  ].join('\n')

  const result = classifyFunctionsDeploy(log)
  assertSame(result.cosmetic, ['generateAssessment', 'setUserRole'], 'cosmetic')
  assertSame(result.genuine, [], 'genuine')
  assert(result.ok, 'a bare gen1 failure during the race must not fail the deploy')
})

test('7d. a bare failure with NO race present stays genuine (fails closed)', () => {
  const log = [failedLine('setUserRole'), '✔  Deploy complete!'].join('\n')

  const result = classifyFunctionsDeploy(log)
  assertSame(result.genuine, ['setUserRole'], 'genuine')
  assert(!result.ok, 'with no race in the log, a bare failure must stay genuine')
})

test('7e. a recovered function is never labelled cosmetic — it is not a failure', () => {
  const log = [
    http409Queue('agentJobsOnCreate'),
    failedLine('agentJobsOnCreate'),
    ok('agentJobsOnCreate'),
  ].join('\n')

  const result = classifyFunctionsDeploy(log)
  assertSame(result.cosmetic, [], 'cosmetic')
  assertSame(result.recovered, ['agentJobsOnCreate'], 'recovered')
})

// ── Scheduler-trigger failures are fatal, recovery or not ─────────────
// A scheduled function whose trigger never upserts deploys its CODE and then
// never fires. The "no changes detected" retry masks it, which is how the
// backup checkers shipped green-but-dead.
test('scheduler-trigger failures stay fatal even alongside a recovery', () => {
  const log = [
    ...throttledThenRecovered('weeklyParentDigest'),
    '⚠  functions: Failed to upsert schedule function backupCompletionCheck in region us-central1',
    '✔  Deploy complete!',
  ].join('\n')

  const result = classifyFunctionsDeploy(log)
  assertSame(result.schedulerFailed, ['backupCompletionCheck'], 'schedulerFailed')
  assert(!result.ok, 'a function with no trigger never fires — must fail')
})

// ── A wholly clean deploy ─────────────────────────────────────────────
test('a clean deploy reports nothing and passes', () => {
  const log = [ok('alpha'), ok('beta'), '✔  Deploy complete!'].join('\n')
  const result = classifyFunctionsDeploy(log)
  assertSame(result.genuine, [], 'genuine')
  assertSame(result.unresolved, [], 'unresolved')
  assertSame(result.recovered, [], 'recovered')
  assert(result.ok, 'a clean deploy passes')
})

test('empty / absent output is not silently treated as success-with-failures', () => {
  for (const input of ['', null, undefined]) {
    const result = classifyFunctionsDeploy(input)
    assertSame(result.genuine, [], `genuine for ${JSON.stringify(input)}`)
    assert(result.ok, 'no function markers at all → no per-function verdict')
  }
})

// ── The retry set ─────────────────────────────────────────────────────
// Retrying an already-recovered function spends mutation quota on work already
// done — during the very incident where that quota had run out.
test('the retry set contains only unresolved functions', () => {
  const log = [
    ...throttledThenRecovered('alpha'),
    http429('beta'),
    failedLine('beta'),
    ok('gamma'),
  ].join('\n')

  assertSame(retrySetFromLog(log), ['beta'], 'retry set')
})

// ── Report ──────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
