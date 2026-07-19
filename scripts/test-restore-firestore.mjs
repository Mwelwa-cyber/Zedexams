/**
 * Node test for scripts/restore-firestore.mjs.
 * Run: node scripts/test-restore-firestore.mjs
 *
 * Drives the decision tree + the client-driven import with NO GCP and no
 * @google-cloud/firestore install (the Admin loader is injected). Covers:
 *   • dry run makes no changes;
 *   • scratch-database import request shape;
 *   • default-database refusal without the ack flag;
 *   • live import Admin-client initialization (client constructed + called);
 *   • failed import startup surfaces the error.
 */

import assert from 'node:assert'
import {parseArgs, planRestore, executeRestore} from './restore-firestore.mjs'

let passed = 0
function ok(name, cond) { assert.ok(cond, name); passed++; console.log(`  ok  ${name}`) }

const ENV = {FIRESTORE_BACKUP_BUCKET: 'gs://zedexams-backups', GOOGLE_CLOUD_PROJECT: 'examsprepzambia'}

console.log('restore-firestore')

// ── parseArgs ──────────────────────────────────────────────────────────────
{
  const o = parseArgs(['--date=2026-07-18', '--database=restore-x', '--live'], ENV)
  ok('parseArgs reads date/database/live + env project+bucket',
    o.date === '2026-07-18' && o.database === 'restore-x' && o.live === true &&
    o.project === 'examsprepzambia' && o.bucketRaw === 'gs://zedexams-backups')
  ok('parseArgs defaults database to (default)',
    parseArgs(['--date=2026-07-18'], ENV).database === '(default)')
}

// ── 1. Dry run makes no changes ────────────────────────────────────────────
{
  const plan = planRestore(parseArgs(['--date=2026-07-18'], ENV))
  ok('no --live → dry-run action', plan.action === 'dry-run')
  ok('dry-run still builds the correct import request',
    plan.request.inputUriPrefix === 'gs://zedexams-backups/firestore-exports/2026-07-18')
}

// ── 2. Scratch-database import request shape ───────────────────────────────
{
  const plan = planRestore(parseArgs(['--date=2026-07-18', '--database=restore-20260718', '--live'], ENV))
  ok('live into a scratch db → proceed', plan.action === 'proceed')
  ok('scratch import request targets the scratch database',
    plan.request.name === 'projects/examsprepzambia/databases/restore-20260718' &&
    plan.request.inputUriPrefix === 'gs://zedexams-backups/firestore-exports/2026-07-18' &&
    Array.isArray(plan.request.collectionIds) && plan.request.collectionIds.length === 0)
}

// ── 3. Default-database refusal without the ack flag ───────────────────────
{
  const refused = planRestore(parseArgs(['--date=2026-07-18', '--live'], ENV))
  ok('live into (default) without ack → refuse-default',
    refused.action === 'refuse-default' && /overwrites-production/.test(refused.error))
  const allowed = planRestore(parseArgs(
    ['--date=2026-07-18', '--live', '--i-understand-this-overwrites-production'], ENV))
  ok('live into (default) WITH the ack flag → proceed', allowed.action === 'proceed')
}

// bad/missing inputs → error (no request built)
{
  ok('missing date → error', planRestore(parseArgs(['--live'], ENV)).action === 'error')
  ok('missing bucket → error',
    planRestore(parseArgs(['--date=2026-07-18'], {GOOGLE_CLOUD_PROJECT: 'p'})).action === 'error')
  ok('missing project → error',
    planRestore(parseArgs(['--date=2026-07-18'], {FIRESTORE_BACKUP_BUCKET: 'gs://b'})).action === 'error')
}

// ── 4. Live import Admin-client initialization ─────────────────────────────
await (async () => {
  const calls = {constructed: 0, imported: null}
  const fakeLoad = () => ({
    v1: {
      FirestoreAdminClient: class {
        constructor() { calls.constructed++ }
        async importDocuments(req) { calls.imported = req; return [{name: 'operations/imp-1'}] }
      },
    },
  })
  const plan = planRestore(parseArgs(['--date=2026-07-18', '--database=restore-x', '--live'], ENV))
  const res = await executeRestore(plan.request, {load: fakeLoad, log: () => {}})
  ok('Admin client is constructed exactly once', calls.constructed === 1)
  ok('importDocuments is called with the planned request',
    calls.imported && calls.imported.inputUriPrefix === plan.request.inputUriPrefix)
  ok('executeRestore returns the operation name', res.operationName === 'operations/imp-1')
})()

// loader that doesn't expose v1.FirestoreAdminClient is rejected clearly
await (async () => {
  let threw = false
  try { await executeRestore({}, {load: () => ({v1: {}}), log: () => {}}) }
  catch (e) { threw = /FirestoreAdminClient/.test(e.message) }
  ok('missing FirestoreAdminClient surfaces a clear error', threw)
})()

// ── 5. Failed import startup surfaces the error ────────────────────────────
await (async () => {
  const fakeLoad = () => ({
    v1: {FirestoreAdminClient: class {
      async importDocuments() { throw new Error('PERMISSION_DENIED: missing IAM') }
    }},
  })
  let msg = ''
  try { await executeRestore({name: 'x', inputUriPrefix: 'y'}, {load: fakeLoad, log: () => {}}) }
  catch (e) { msg = e.message }
  ok('a failing importDocuments rejects with the underlying error',
    /PERMISSION_DENIED/.test(msg))
})()

console.log(`\nrestore-firestore: ${passed} checks passed`)
