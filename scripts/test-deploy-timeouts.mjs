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

const hostingJobMin = jobTimeoutMinutes(hosting, HOSTING)
const firebaseJobMin = jobTimeoutMinutes(firebase, FIREBASE)
const waitSec = waitWindowSeconds(hosting, HOSTING)

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
  `wait ≥ functions cap ${firebaseJobMin}min + ${QUEUE_MARGIN_MIN}min queueing.`,
)
