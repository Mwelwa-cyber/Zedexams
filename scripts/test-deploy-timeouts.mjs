/**
 * The deploy workflows' timeout budgets have to be consistent with each other,
 * because one WAITS for the other.
 *
 * What went wrong on 2026-07-27: `deploy-hosting.yml` capped its job at 15
 * minutes while its own "Wait for Deploy Firebase run" step was allowed to wait
 * 12 of them — and the lint/test/build/prerender steps before the wait already
 * take ~4. So whenever a functions deploy ran long, GitHub cancelled the
 * Hosting job mid-wait. Nothing failed loudly: the run showed `cancelled`,
 * Cloud Functions shipped, and the frontend silently stayed on the previous
 * commit. That is the one skew direction that breaks users — a deployed client
 * older than the API it calls.
 *
 * What went wrong on 2026-08-20, which this file did NOT catch: it only ever
 * compared the two workflows to EACH OTHER. Nothing checked that the functions
 * deploy's own cap covered the functions deploy's own work. It did not — the
 * pre-deploy steps take ~4min of a 20min job and a full deploy of ~190
 * functions measurably takes 15m29s, so run #783 finished with 23 SECONDS of
 * headroom and run #784 (the spelling merge, 40s longer) was killed mid-deploy.
 * GitHub reports a timeout kill as `cancelled`, deploy-hosting refused to ship
 * a frontend over functions that might not have landed, and production stayed
 * on the previous commit with every check looking merely "cancelled".
 *
 * So the budget is now checked from the INSIDE OUT: each attempt's cap must fit
 * inside the job's cap along with everything around it, the wait must outlast
 * the job, and the waiting job must outlast the wait.
 *
 * These are inequalities between numbers in two files, so nothing at runtime can
 * catch a regression; only a check like this can.
 *
 *   node scripts/test-deploy-timeouts.mjs
 */
import assert from 'node:assert'
import { readFileSync } from 'node:fs'

const HOSTING = '.github/workflows/deploy-hosting.yml'
const FIREBASE = '.github/workflows/deploy-firebase.yml'

const hosting = readFileSync(HOSTING, 'utf8')
const firebase = readFileSync(FIREBASE, 'utf8')

/** First `timeout-minutes: N` under jobs — the job's own cap. */
function jobTimeoutMinutes(source, file) {
  const match = /^\s*timeout-minutes:\s*(\d+)\s*$/m.exec(source)
  assert.ok(match, `${file}: no job-level timeout-minutes found`)
  return Number(match[1])
}

function waitWindowSeconds(source, file) {
  const match = /FIREBASE_DEPLOY_TIMEOUT_SECONDS:\s*"?(\d+)"?/.exec(source)
  assert.ok(match, `${file}: no FIREBASE_DEPLOY_TIMEOUT_SECONDS found`)
  return Number(match[1])
}

/** A per-attempt deploy cap, in minutes, from the deploy step's env block. */
function attemptCapMinutes(source, file, name) {
  const match = new RegExp(`${name}:\\s*"?(\\d+)"?`).exec(source)
  assert.ok(match, `${file}: no ${name} found`)
  return Number(match[1])
}

const hostingJobMin = jobTimeoutMinutes(hosting, HOSTING)
const firebaseJobMin = jobTimeoutMinutes(firebase, FIREBASE)
const waitSec = waitWindowSeconds(hosting, HOSTING)

// ---------------------------------------------------------------------------
// The functions deploy's cap must cover the functions deploy's own work.
//
// This is the inequality that was missing on 2026-08-20, and it is the one that
// actually decides whether a deploy can finish. The two attempts are wrapped in
// `timeout` so an over-running deploy fails with a readable diagnosis, but that
// only helps if the JOB outlives both of them — otherwise GitHub kills the job
// first and we are back to a `cancelled` run that explains nothing.
const firebaseAttemptMin = attemptCapMinutes(
  firebase,
  FIREBASE,
  'FIREBASE_ATTEMPT_TIMEOUT_MINUTES',
)
const firebaseRetryMin = attemptCapMinutes(
  firebase,
  FIREBASE,
  'FIREBASE_RETRY_TIMEOUT_MINUTES',
)

// Measured on green runs: ~4min of lint + test:all + both npm ci before the
// deploy starts, and the Storage rules read-back plus teardown after it. Held
// at 5 + 2 so a slow runner does not sit exactly on the line.
const FIREBASE_PRE_DEPLOY_MIN = 5
const FIREBASE_POST_DEPLOY_MIN = 2
const RETRY_BACKOFF_MIN = 1 // the `sleep 30` between attempts, rounded up

const requiredFirebaseJobMin =
  FIREBASE_PRE_DEPLOY_MIN +
  firebaseAttemptMin +
  RETRY_BACKOFF_MIN +
  firebaseRetryMin +
  FIREBASE_POST_DEPLOY_MIN

assert.ok(
  firebaseJobMin >= requiredFirebaseJobMin,
  `deploy-firebase job cap is ${firebaseJobMin}min but the work inside it can ` +
    `take ${requiredFirebaseJobMin}min (${FIREBASE_PRE_DEPLOY_MIN}min lint/test/install + ` +
    `${firebaseAttemptMin}min attempt 1 + ${RETRY_BACKOFF_MIN}min backoff + ` +
    `${firebaseRetryMin}min retry + ${FIREBASE_POST_DEPLOY_MIN}min read-back/teardown) ` +
    `— the job is killed mid-deploy, which reports as 'cancelled' and silently ` +
    `leaves production on the previous commit.`,
)

// A full deploy of ~190 functions measured 15m29s on 2026-08-20. An attempt cap
// at or below that is a cap that cannot pass, so it is pinned as a floor rather
// than left to be rediscovered by a red deploy.
const MEASURED_FULL_DEPLOY_MIN = 16
assert.ok(
  firebaseAttemptMin > MEASURED_FULL_DEPLOY_MIN,
  `FIREBASE_ATTEMPT_TIMEOUT_MINUTES is ${firebaseAttemptMin}min, but a full ` +
    `deploy measured ${MEASURED_FULL_DEPLOY_MIN}min on 2026-08-20 — leave real ` +
    `headroom above the measurement, not a coin toss on it.`,
)

// The per-attempt caps only bound the job if the step actually applies them.
assert.ok(
  /timeout --kill-after=30s "\$\{attempt_minutes\}m"/.test(firebase),
  'deploy-firebase: each deploy attempt must run under `timeout`, or the ' +
    'per-attempt caps above are decorative and the job cap is the only clock.',
)

// A buffered log dies with the process it was buffering. Streaming it is what
// made #784 diagnosable at all; `out=$(npx firebase-tools ... )` would silently
// take that away again.
assert.ok(
  /\| tee "\$\{logfile\}"/.test(firebase),
  'deploy-firebase: the deploy output must be streamed through tee — captured ' +
    'in a command substitution it is lost entirely when an attempt is killed, ' +
    'which is exactly when it is needed.',
)

// The wait must outlast the run it waits for, plus queueing time before that run
// starts. Otherwise Hosting abandons a functions deploy that was still going to
// succeed, and reports it as a Hosting failure.
const QUEUE_MARGIN_MIN = 2
const requiredWaitSec = (firebaseJobMin + QUEUE_MARGIN_MIN) * 60
assert.ok(
  waitSec >= requiredWaitSec,
  `deploy-hosting waits ${waitSec}s for a functions deploy capped at ` +
    `${firebaseJobMin}min — needs at least ${requiredWaitSec}s ` +
    `(cap + ${QUEUE_MARGIN_MIN}min queueing).`,
)

// The job cap must cover its own work on BOTH sides of the wait — the ~4min of
// lint/test/build/prerender before it and the ~4min Hosting deploy after it.
// This is the inequality that was violated (15 < 12 + 8).
const OWN_WORK_MIN = 8
const requiredJobMin = Math.ceil(waitSec / 60) + OWN_WORK_MIN
assert.ok(
  hostingJobMin >= requiredJobMin,
  `deploy-hosting job cap is ${hostingJobMin}min but it can spend ` +
    `${Math.ceil(waitSec / 60)}min waiting plus ~${OWN_WORK_MIN}min of its own ` +
    `steps — needs at least ${requiredJobMin}min, or the job is cancelled ` +
    `mid-wait and the frontend silently stays behind the functions.`,
)

// A cancelled wait is only silent because the wait is conditional; if the step
// ever loses its guard the whole thing changes shape, so pin the structure too.
assert.ok(
  /- name: Wait for Deploy Firebase run\n\s+if: steps\.firebase_changes\.outputs\.required == 'true'/.test(hosting),
  'deploy-hosting: the wait step must stay gated on firebase_changes.required',
)

console.log(
  `Deploy timeout budgets are consistent: hosting job ${hostingJobMin}min ≥ ` +
  `wait ${Math.ceil(waitSec / 60)}min + ${OWN_WORK_MIN}min own work; ` +
  `wait ≥ functions cap ${firebaseJobMin}min + ${QUEUE_MARGIN_MIN}min queueing; ` +
  `functions cap ${firebaseJobMin}min ≥ ${requiredFirebaseJobMin}min of work ` +
  `inside it (attempt ${firebaseAttemptMin}min + retry ${firebaseRetryMin}min ` +
  `+ ${FIREBASE_PRE_DEPLOY_MIN + RETRY_BACKOFF_MIN + FIREBASE_POST_DEPLOY_MIN}min around them).`,
)
