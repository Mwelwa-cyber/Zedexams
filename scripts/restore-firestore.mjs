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
 * The decision logic (parseArgs/planRestore) and the client-driven step
 * (executeRestore, with an injectable admin loader) are exported so
 * scripts/test-restore-firestore.mjs can drive every path — dry run, scratch
 * request, default-db refusal, live client init, failed startup — with no GCP.
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
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)
const { resolveBackupBucket, buildImportRequest } =
  require('../functions/firestoreBackupCore.js')

const HERE = dirname(fileURLToPath(import.meta.url))

// `@google-cloud/firestore` (the Admin client used for the actual import) is a
// `functions/` dependency, NOT a repo-root one, so a bare import from this
// script's location fails with ERR_MODULE_NOT_FOUND. Resolve it against
// functions/node_modules via a require anchored at the functions package.
// Exported + injectable so the test never needs the real package or GCP.
export function loadFirestoreAdmin() {
  const functionsRequire = createRequire(
    join(HERE, '..', 'functions', 'package.json'),
  )
  try {
    return functionsRequire('@google-cloud/firestore')
  } catch (err) {
    throw new Error(
      'Could not load @google-cloud/firestore (a functions/ dependency). ' +
      'Run `npm --prefix functions ci` first, then re-run. ' +
      `Underlying error: ${err && err.message}`,
    )
  }
}

/** Parse the CLI argv into a plain options object. Pure. */
export function parseArgs(argv = [], env = {}) {
  const arg = (name, fallback = '') => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.split('=').slice(1).join('=') : fallback
  }
  const has = (name) => argv.includes(`--${name}`)
  return {
    live: has('live'),
    date: arg('date'),
    database: arg('database', '(default)'),
    project:
      arg('project') || env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || '',
    bucketRaw: arg('bucket') || env.FIRESTORE_BACKUP_BUCKET || '',
    ackProd: has('i-understand-this-overwrites-production'),
  }
}

/**
 * Decide what the run should do, WITHOUT any I/O. Returns one of:
 *   {action:'error',  error}                     — bad/missing inputs
 *   {action:'dry-run', request, meta}            — default; caller prints + exits 0
 *   {action:'refuse-default', error}             — live into (default) without ack
 *   {action:'proceed', request, meta}            — live into a safe target
 * Pure — the whole decision tree is unit-testable.
 */
export function planRestore(opts) {
  const {live, date, database, project, bucketRaw, ackProd} = opts
  const bucketUri = resolveBackupBucket(bucketRaw)
  if (!bucketUri) {
    return {action: 'error',
      error: 'No backup bucket. Pass --bucket=gs://<name> or set FIRESTORE_BACKUP_BUCKET.'}
  }
  if (!project) {
    return {action: 'error',
      error: 'No project id. Pass --project=<id> or set GOOGLE_CLOUD_PROJECT.'}
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return {action: 'error',
      error: 'Pass --date=YYYY-MM-DD naming the export folder to restore from.'}
  }
  let request
  try {
    request = buildImportRequest({projectId: project, bucketUri, dateKey: date, databaseId: database})
  } catch (err) {
    return {action: 'error', error: `Could not build import request: ${err.message}`}
  }
  const meta = {project, database, inputUriPrefix: request.inputUriPrefix, live}
  if (!live) return {action: 'dry-run', request, meta}
  if (database === '(default)' && !ackProd) {
    return {action: 'refuse-default',
      error: 'Refusing to import into the "(default)" database without ' +
        '--i-understand-this-overwrites-production. Restore into a scratch ' +
        'database first: --database=restore-YYYYMMDD'}
  }
  return {action: 'proceed', request, meta}
}

/**
 * Start the import operation. Constructs the Admin client via the injected
 * loader (default: the real functions/ dependency) and calls importDocuments.
 * Returns {operationName}. Injectable so tests exercise client construction +
 * failure without GCP.
 */
export async function executeRestore(request, {load = loadFirestoreAdmin, log = console.log} = {}) {
  const {v1} = load()
  if (!v1 || typeof v1.FirestoreAdminClient !== 'function') {
    throw new Error('@google-cloud/firestore did not expose v1.FirestoreAdminClient')
  }
  const client = new v1.FirestoreAdminClient()
  log('\nStarting import operation…')
  const [operation] = await client.importDocuments(request)
  const operationName = (operation && operation.name) || '(no name)'
  log('✓ Import operation accepted:', operationName)
  return {operationName}
}

async function main() {
  const fail = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1) }
  const opts = parseArgs(process.argv.slice(2), process.env)
  const plan = planRestore(opts)

  if (plan.action === 'error' || plan.action === 'refuse-default') fail(plan.error)

  console.log('\nFirestore restore (importDocuments)')
  console.log('  project      :', plan.meta.project)
  console.log('  target db    :', plan.meta.database)
  console.log('  reading from :', plan.meta.inputUriPrefix)
  console.log('  collections  : ALL')
  console.log('  mode         :', plan.meta.live ? 'LIVE (will start the import)' : 'DRY RUN')

  if (plan.action === 'dry-run') {
    console.log('\nDry run only — no import started. Re-run with --live to execute.\n')
    process.exit(0)
  }

  try {
    await executeRestore(plan.request)
    console.log(
      '  It continues server-side. Track it with:\n' +
      `  gcloud firestore operations list --project=${plan.meta.project}\n`,
    )
  } catch (err) {
    fail(`Import failed to start: ${(err && err.message) || err}`)
  }
}

// Only run the CLI when invoked directly (not when imported by the test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
