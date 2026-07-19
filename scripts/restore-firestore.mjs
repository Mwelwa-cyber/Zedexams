#!/usr/bin/env node
/**
 * scripts/restore-firestore.mjs
 *
 * Restore a Firestore database from a daily export produced by
 * functions/firestoreBackup.js (`dailyFirestoreBackup`). This is the tested
 * inverse of the backup: it kicks off a Firestore Admin `importDocuments`
 * long-running operation reading the SAME `gs://<bucket>/firestore-exports/
 * <YYYY-MM-DD>/` folder the export wrote. See
 * docs/production-readiness/runbooks/firestore-restore.md for the full
 * disaster-recovery runbook.
 *
 * ⚠️  RESTORE IS A MERGE-BY-OVERWRITE, NOT A CLEAN REPLACE.
 *   importDocuments writes every document from the export INTO the target
 *   database, overwriting any doc with the same path and leaving docs that
 *   exist only in the target untouched. Restoring into a live database can
 *   therefore resurrect deleted docs and clobber newer writes. ALWAYS restore
 *   into a fresh scratch database first (`--database=restore-YYYYMMDD`),
 *   validate it, and only then decide how to reconcile with production.
 *
 * SAFETY:
 *   • Dry-run by DEFAULT — prints the exact import request and exits. Writes
 *     (starts the operation) only with --live.
 *   • Importing into the "(default)" database with --live additionally
 *     requires the explicit --i-understand-this-overwrites-production flag.
 *   • Reuses functions/firestoreBackupCore.js#buildImportRequest (unit-tested
 *     in functions/firestoreBackup.test.js) so the request shape can't drift
 *     from the backup.
 *
 * USAGE:
 *   node scripts/restore-firestore.mjs --date=2026-07-18                 # dry run
 *   node scripts/restore-firestore.mjs --date=2026-07-18 \
 *     --database=restore-20260718 --live                                 # restore to scratch db
 *   FIRESTORE_BACKUP_BUCKET=gs://zedexams-backups \
 *     node scripts/restore-firestore.mjs --date=2026-07-18 --live \
 *     --database=restore-20260718
 *
 * --live requires a service-account (GOOGLE_APPLICATION_CREDENTIALS) with
 * roles/datastore.importExportAdmin and read access to the backup bucket.
 */

import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { resolveBackupBucket, buildImportRequest } =
  require('../functions/firestoreBackupCore.js')

function arg(name, fallback = '') {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : fallback
}
const has = (name) => process.argv.includes(`--${name}`)

const LIVE = has('live')
const DATE = arg('date')
const DATABASE = arg('database', '(default)')
const PROJECT =
  arg('project') ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  ''
const BUCKET_RAW = arg('bucket') || process.env.FIRESTORE_BACKUP_BUCKET || ''
const ACK_PROD = has('i-understand-this-overwrites-production')

function fail(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

const bucketUri = resolveBackupBucket(BUCKET_RAW)
if (!bucketUri) {
  fail(
    'No backup bucket. Pass --bucket=gs://<name> or set FIRESTORE_BACKUP_BUCKET.'
  )
}
if (!PROJECT) {
  fail('No project id. Pass --project=<id> or set GOOGLE_CLOUD_PROJECT.')
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  fail('Pass --date=YYYY-MM-DD naming the export folder to restore from.')
}

let request
try {
  request = buildImportRequest({
    projectId: PROJECT,
    bucketUri,
    dateKey: DATE,
    databaseId: DATABASE,
  })
} catch (err) {
  fail(`Could not build import request: ${err.message}`)
}

console.log('\nFirestore restore (importDocuments)')
console.log('  project      :', PROJECT)
console.log('  target db    :', DATABASE)
console.log('  reading from :', request.inputUriPrefix)
console.log('  collections  : ALL')
console.log('  mode         :', LIVE ? 'LIVE (will start the import)' : 'DRY RUN')

if (!LIVE) {
  console.log(
    '\nDry run only — no import started. Re-run with --live to execute.\n'
  )
  process.exit(0)
}

if (DATABASE === '(default)' && !ACK_PROD) {
  fail(
    'Refusing to import into the "(default)" database without ' +
      '--i-understand-this-overwrites-production. Restore into a scratch ' +
      'database first: --database=restore-YYYYMMDD'
  )
}

const run = async () => {
  const { v1 } = await import('@google-cloud/firestore')
  const client = new v1.FirestoreAdminClient()
  console.log('\nStarting import operation…')
  const [operation] = await client.importDocuments(request)
  console.log('✓ Import operation accepted:', operation?.name || '(no name)')
  console.log(
    '  It continues server-side. Track it with:\n' +
      `  gcloud firestore operations list --project=${PROJECT}\n`
  )
}

run().catch((err) => {
  fail(`Import failed to start: ${err?.message || err}`)
})
