#!/usr/bin/env node
/* global console, process */
/**
 * CLI over functionsDeployLog.js, for `deploy-firebase.yml`.
 *
 * Reads the deploy output on stdin and answers one of two questions:
 *
 *   --retry-set   which functions still need retrying (newline-separated, on
 *                 stdout). Pass ONE attempt's output.
 *   --verdict     whether the deploy stands. Pass EVERY attempt's output,
 *                 concatenated in order. Emits ::error:: / ::warning::
 *                 annotations and exits 1 when the deploy must fail.
 *
 * The decision itself lives in the pure module so it can be tested; this file
 * only does I/O and GitHub annotation formatting.
 */
import { classifyFunctionsDeploy, retrySetFromLog } from './functionsDeployLog.js'

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { data += chunk })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

const mode = process.argv[2] || '--verdict'
const log = await readStdin()

if (mode === '--retry-set') {
  const names = retrySetFromLog(log)
  if (names.length) console.log(names.join('\n'))
  process.exit(0)
}

const result = classifyFunctionsDeploy(log)

if (result.recovered.length) {
  console.log(
    `Recovered after a transient failure (firebase-tools retried these itself): `
    + `${result.recovered.join(', ')}`,
  )
}

// A scheduled function whose trigger never upserts deploys its CODE and then
// never fires. Never cosmetic.
if (result.schedulerFailed.length) {
  console.log(
    '::error::Firebase deploy FAILED to create/update Cloud Scheduler triggers — '
    + 'the scheduled function(s) below deployed their CODE but have NO trigger '
    + 'and will NEVER fire:',
  )
  for (const name of result.schedulerFailed) {
    console.log(`::error::  no-trigger: ${name}`)
  }
  if (/cloudscheduler\.jobs\.(create|update|delete)/i.test(log)) {
    console.log(
      '::error::Root cause: the Firebase deploy service account lacks Cloud '
      + 'Scheduler permission (HTTP 403 on cloudscheduler.jobs.*). Grant it '
      + 'roles/cloudscheduler.admin on the project, then re-run this deploy.',
    )
  }
  process.exit(1)
}

if (result.genuine.length) {
  console.log(
    '::error::Firebase deploy failed for function(s) with a non-transient error '
    + '(NOT a cosmetic 409, and NOT recovered by a later retry) — these may be '
    + 'running stale code:',
  )
  for (const name of result.genuine) {
    console.log(`::error::  failed: ${name}`)
  }
  process.exit(1)
}

if (result.cosmetic.length) {
  console.log(
    "::warning::Firebase deploy hit a cosmetic 409 (transient 'unable to queue "
    + "the operation' — incl. bare gen1 failures during that race — and/or "
    + "idempotent 'already exists') on the function(s) below. These operations "
    + 'complete server-side, so this is treated as non-fatal:',
  )
  for (const name of result.cosmetic) {
    console.log(`::warning::  cosmetic-409: ${name}`)
  }
}

console.log('Firebase functions deploy verified — no function left unresolved.')
process.exit(0)
