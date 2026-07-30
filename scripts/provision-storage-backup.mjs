#!/usr/bin/env node
/**
 * scripts/provision-storage-backup.mjs
 *
 * Provision the Firebase Storage backup mirror (DR-003) — the half of the
 * disaster-recovery floor that `functions/storageBackup.js` only VERIFIES.
 * Until this runs, `storageBackupCheck` records `misconfigured` and emails an
 * ERROR ops alert every morning at 04:00 Lusaka, correctly: generated images,
 * uploads, exports and past papers have no second copy and a delete is
 * unrecoverable.
 *
 * The cross-region copy belongs in Storage Transfer Service (a managed,
 * scheduled bucket-to-bucket mirror) — not a Cloud Function copying the bucket
 * object-by-object (cost / timeouts / scale). This script is the operator's
 * one command for the setup `docs/production-readiness/runbooks/
 * launch-operator-guide.md` §Step 6 and `14-backup-and-disaster-recovery.md`
 * §D previously spelled out by hand:
 *
 *   1. enable the Storage Transfer API
 *   2. Object Versioning on the PRIMARY bucket (recovers a single overwritten
 *      or deleted object with no mirror involved)
 *   3. a cross-region backup bucket — uniform access, public-access prevention,
 *      versioning
 *   4. a lifecycle rule that expires OLD NON-CURRENT versions only (never live
 *      objects — expiring those would quietly empty the backup)
 *   5. IAM for the STS service agent (read source, write destination) and for
 *      the Functions runtime SA (list the destination, so the health check can
 *      actually see it)
 *   6. the daily transfer job, scheduled to finish before the 04:00 Lusaka
 *      health check
 *
 * SAFETY:
 *   • Dry-run by DEFAULT — prints every command and exits. Runs them only with
 *     --live.
 *   • Every step is create-or-update and re-runnable: a step that fails because
 *     the resource already exists is reported as "already done", not an error.
 *   • Nothing here deletes or overwrites data. The lifecycle rule is scoped to
 *     non-current versions with `numNewerVersions`, so the live mirror is never
 *     touched.
 *
 * USAGE:
 *   node scripts/provision-storage-backup.mjs                       # dry run
 *   node scripts/provision-storage-backup.mjs --live                # provision
 *   node scripts/provision-storage-backup.mjs --location=us-central1 --live
 *
 * FLAGS (an unrecognised --flag is refused, so a typo can't silently fall back
 * to a default — `--locaton=x` would otherwise provision in europe-west1):
 *   --live                 actually run the commands (default: print only)
 *   --project=             GCP project            (default examsprepzambia)
 *   --project-number=      skip the gcloud lookup for the SA email suffixes
 *   --source-bucket=       bucket to mirror FROM  (default the live Storage bucket)
 *   --backup-bucket=       bucket to mirror TO    (default zedexams-storage-backup)
 *   --location=            backup bucket region   (default europe-west1)
 *   --job-name=            STS job name           (default zedexams-storage-mirror)
 *   --schedule-utc=HH:MM   daily transfer start   (default 00:30 UTC)
 *   --noncurrent-days=     non-current version retention (default 30)
 *   --runtime-sa=          the Cloud Functions runtime SA that must be able to
 *                          LIST the backup bucket, when the project does not use
 *                          the default <PROJECT_NUMBER>-compute SA. This flag
 *                          decides who gets read access to every backed-up
 *                          object, so it must be a SERVICE ACCOUNT address and a
 *                          non-default value is echoed for confirmation before
 *                          any binding is applied. It grants nothing the caller
 *                          could not already grant directly — running --live
 *                          requires roles/storage.admin — but a wrong value here
 *                          is a quiet mistake, and quiet is the problem.
 *
 * --live needs `gcloud` on PATH, authenticated as a principal holding
 * roles/storage.admin + roles/storagetransfer.admin + roles/serviceusage.
 * serviceUsageAdmin on the project.
 *
 * AFTERWARDS: set STORAGE_BACKUP_BUCKET in functions/.env.examsprepzambia (the
 * script prints the exact line) and deploy functions. The next 04:00 check
 * records `opsStorageBackups/{today}.status === "fresh"` and the daily alert
 * stops.
 *
 * The planning logic (parseArgs/planProvision) is pure and exported so
 * scripts/test-provision-storage-backup.mjs drives every path with no gcloud
 * and no GCP.
 */

import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = 'examsprepzambia'
const SOURCE_BUCKET = 'examsprepzambia.firebasestorage.app' // region africa-south1
// Cross-region on purpose: a backup in the primary's region shares its blast
// radius. europe-west1 matches the runbook's worked example.
const DEFAULT_LOCATION = 'europe-west1'
const DEFAULT_BACKUP_BUCKET = 'zedexams-storage-backup'
const DEFAULT_JOB_NAME = 'zedexams-storage-mirror'
// 00:30 UTC = 02:30 Lusaka, comfortably before the 04:00 Lusaka health check.
const DEFAULT_SCHEDULE_UTC = '00:30'
const DEFAULT_NONCURRENT_DAYS = 30
// `tmp-downloads/` is export-staging: saveViaStampedUrl writes there, the
// client deletes ~90s later and tmpDownloadReaper sweeps hourly. Keep the
// matching prefix in functions/storageCleanup/tmpDownloadReaperCore.js.
const STAGING_PREFIX = 'tmp-downloads/'
const STAGING_NONCURRENT_DAYS = 1

// Every flag the script understands. Anything else is refused rather than
// ignored: a silently-dropped `--locaton=us-central1` provisions the backup in
// the default region and reads, from the operator's side, exactly like success.
const VALUE_FLAGS = Object.freeze([
  'project', 'project-number', 'source-bucket', 'backup-bucket', 'location',
  'job-name', 'schedule-utc', 'noncurrent-days', 'runtime-sa',
])
const BARE_FLAGS = Object.freeze(['live'])

/**
 * Flags the script does not understand. Pure — returned rather than thrown so
 * the test can assert the list and main() owns the exit.
 * @param {string[]} argv
 * @returns {string[]}
 */
export function unknownFlags(argv = []) {
  return argv.filter((a) => String(a).startsWith('--')).filter((a) => {
    const name = String(a).slice(2).split('=')[0]
    return a.includes('=') ? !VALUE_FLAGS.includes(name) : !BARE_FLAGS.includes(name)
  })
}

/**
 * Reject anything that is not a Google SERVICE ACCOUNT address before it can be
 * handed to `add-iam-policy-binding` under a `serviceAccount:` prefix.
 *
 * This is not a privilege boundary — `--live` already requires
 * roles/storage.admin, and anyone holding that can grant any binding directly
 * with one gcloud command. What it prevents is a MISTAKE: a human address or a
 * group typed here would be prefixed `serviceAccount:` and either fail
 * confusingly or, worse, bind a principal nobody intended to the bucket holding
 * every backed-up upload and past paper.
 *
 * Deliberately NOT pinned to `<PROJECT_NUMBER>-compute@developer...`: a project
 * running its functions under a dedicated runtime SA is the normal hardened
 * setup, and that is exactly who needs this flag.
 *
 * @param {string} email
 * @returns {{ok: true}|{ok: false, reason: string}}
 */
export function validateServiceAccountEmail(email) {
  const value = String(email || '').trim()
  if (!value) return {ok: false, reason: 'empty'}
  if (!/^[a-z0-9][a-z0-9-]{4,29}@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(value) &&
      !/^\d+-compute@developer\.gserviceaccount\.com$/.test(value) &&
      !/^[a-z0-9-]+@appspot\.gserviceaccount\.com$/.test(value)) {
    return {
      ok: false,
      reason: 'not a Google service-account address (expected ' +
        '<name>@<project>.iam.gserviceaccount.com, ' +
        '<number>-compute@developer.gserviceaccount.com or ' +
        '<project>@appspot.gserviceaccount.com)',
    }
  }
  return {ok: true}
}

/** Parse argv into a plain options object. Pure. */
export function parseArgs(argv = []) {
  const arg = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3).trim() : fallback
  }
  return {
    live: argv.includes('--live'),
    project: arg('project', PROJECT),
    sourceBucket: arg('source-bucket', SOURCE_BUCKET),
    backupBucket: arg('backup-bucket', DEFAULT_BACKUP_BUCKET),
    location: arg('location', DEFAULT_LOCATION),
    jobName: arg('job-name', DEFAULT_JOB_NAME),
    scheduleUtc: arg('schedule-utc', DEFAULT_SCHEDULE_UTC),
    noncurrentDays: Number(arg('noncurrent-days', DEFAULT_NONCURRENT_DAYS)),
    projectNumber: arg('project-number', ''),
    runtimeServiceAccount: arg('runtime-sa', ''),
  }
}

/**
 * The lifecycle rule for a versioned bucket — the SAME shape for the primary
 * and the backup, because turning versioning on without one is what turns a
 * delete into an object that is billed forever.
 *
 * Two decisions, both learned the hard way:
 *
 * • **Time only — no `numNewerVersions`.** Lifecycle conditions AND together,
 *   so `{daysSinceNoncurrentTime: 30, numNewerVersions: 3}` deletes a version
 *   only if it is BOTH 30 days noncurrent AND has three newer versions. A
 *   DELETED object has zero newer versions, so it never matches and lives
 *   forever. That is precisely this repo's highest-churn path: every teacher
 *   export stages a file under `tmp-downloads/`, which `tmpDownloadReaper`
 *   sweeps hourly to keep the prefix — in its own words — from growing
 *   unbounded. Under versioning each of those deletes becomes an immortal
 *   noncurrent version, and the extra condition guarantees nothing ever
 *   reclaims it. A bounded time window is the whole policy: you have N days to
 *   recover any version, then it is gone.
 * • **Still cannot touch a live object.** `daysSinceNoncurrentTime` applies by
 *   definition only to versions that have already been superseded or deleted;
 *   there is no `age`/`createdBefore` rule here. A rule that expires live
 *   objects on the primary would delete the app's images, and on the backup
 *   would empty the mirror.
 *
 * The staging prefix gets its own short window: those objects exist for ~90
 * seconds by design and have no recovery value, so holding them 30 days is
 * paying to store nothing.
 *
 * NOTE: `--lifecycle-file` REPLACES a bucket's whole lifecycle configuration.
 * Both buckets have none today; if one later grows a rule added elsewhere,
 * re-running this would drop it. Pure.
 *
 * @param {number} noncurrentDays
 * @returns {object} GCS lifecycle config
 */
export function buildLifecycleConfig(noncurrentDays = DEFAULT_NONCURRENT_DAYS) {
  const days = Number.isFinite(noncurrentDays) && noncurrentDays > 0
    ? Math.floor(noncurrentDays)
    : DEFAULT_NONCURRENT_DAYS
  return {
    lifecycle: {
      rule: [
        {
          action: { type: 'Delete' },
          condition: { daysSinceNoncurrentTime: days },
        },
        {
          action: { type: 'Delete' },
          condition: {
            daysSinceNoncurrentTime: STAGING_NONCURRENT_DAYS,
            matchesPrefix: [STAGING_PREFIX],
          },
        },
      ],
    },
  }
}

/** The Storage Transfer Service agent for a project. Pure. */
export function stsServiceAgent(projectNumber) {
  const n = String(projectNumber || '').trim()
  return `project-${n || '<PROJECT_NUMBER>'}@storage-transfer-service.iam.gserviceaccount.com`
}

/**
 * The Cloud Functions v2 runtime service account — the identity
 * `storageBackupCheck` probes the backup bucket as. It must be able to LIST
 * the destination or the health check reports `error` ("mirror health is
 * UNKNOWN") forever, which looks exactly like a broken mirror. Pure.
 */
export function runtimeServiceAccount(projectNumber, override = '') {
  const explicit = String(override || '').trim()
  if (explicit) return explicit
  const n = String(projectNumber || '').trim()
  return `${n || '<PROJECT_NUMBER>'}-compute@developer.gserviceaccount.com`
}

/**
 * Build the ordered provisioning plan. Pure — takes every value it needs
 * (including the project number, resolved by the caller) and returns steps as
 * argv arrays, so the test asserts on commands without a gcloud binary.
 *
 * Each step: { id, title, argv, tolerate?, writeFile? }
 *   tolerate — substrings that mean "this resource already exists"; matching
 *   stderr is reported as `already done` rather than failing the run.
 *
 * @returns {{steps: Array<object>, envLine: string}}
 */
export function planProvision(opts = {}) {
  const {
    project = PROJECT,
    sourceBucket = SOURCE_BUCKET,
    backupBucket = DEFAULT_BACKUP_BUCKET,
    location = DEFAULT_LOCATION,
    jobName = DEFAULT_JOB_NAME,
    scheduleUtc = DEFAULT_SCHEDULE_UTC,
    noncurrentDays = DEFAULT_NONCURRENT_DAYS,
    projectNumber = '',
    runtimeServiceAccount: runtimeSaOverride = '',
    lifecycleFile = '<generated at run time>',
    sourceLifecycleFile = '<generated at run time>',
  } = opts

  const src = `gs://${sourceBucket}`
  const dst = `gs://${backupBucket}`
  const sts = `serviceAccount:${stsServiceAgent(projectNumber)}`
  const runtimeSa = `serviceAccount:${runtimeServiceAccount(projectNumber, runtimeSaOverride)}`
  const P = `--project=${project}`

  const binding = (bucket, member, role) => [
    'gcloud', 'storage', 'buckets', 'add-iam-policy-binding', bucket,
    `--member=${member}`, `--role=${role}`, P,
  ]

  const steps = [
    {
      id: 'enable-api',
      title: 'Enable the Storage Transfer API',
      argv: ['gcloud', 'services', 'enable', 'storagetransfer.googleapis.com', P],
    },
    {
      id: 'source-versioning',
      title: `Object Versioning ON for the primary bucket (${src})`,
      argv: ['gcloud', 'storage', 'buckets', 'update', src, '--versioning', P],
    },
    {
      // Versioning and its expiry rule are ONE decision, applied in one run.
      // Versioning alone means every delete on the primary — and this repo
      // deletes constantly: tmpDownloadReaper hourly, orphanReaper, the
      // lesson/question/user cascade triggers — leaves a noncurrent version
      // that is billed forever. The reapers whose entire job is reclaiming
      // space would stop reclaiming any.
      id: 'source-lifecycle',
      title: `Expire NON-CURRENT versions on the PRIMARY after ${noncurrentDays}d ` +
        `(${STAGING_PREFIX} after ${STAGING_NONCURRENT_DAYS}d; live objects untouched)`,
      writeFile: {path: sourceLifecycleFile, contents: buildLifecycleConfig(noncurrentDays)},
      argv: [
        'gcloud', 'storage', 'buckets', 'update', src,
        `--lifecycle-file=${sourceLifecycleFile}`, P,
      ],
    },
    {
      id: 'create-backup-bucket',
      title: `Create the cross-region backup bucket (${dst}, ${location})`,
      argv: [
        'gcloud', 'storage', 'buckets', 'create', dst,
        `--location=${location}`,
        '--uniform-bucket-level-access',
        '--public-access-prevention',
        P,
      ],
      tolerate: ['already exists', 'HTTPError 409', 'already own it'],
    },
    {
      id: 'backup-versioning',
      title: 'Object Versioning ON for the backup bucket',
      argv: ['gcloud', 'storage', 'buckets', 'update', dst, '--versioning', P],
    },
    {
      id: 'backup-lifecycle',
      title: `Expire NON-CURRENT versions after ${noncurrentDays}d (live objects untouched)`,
      writeFile: { path: lifecycleFile, contents: buildLifecycleConfig(noncurrentDays) },
      argv: [
        'gcloud', 'storage', 'buckets', 'update', dst,
        `--lifecycle-file=${lifecycleFile}`, P,
      ],
    },
    {
      id: 'sts-read-source',
      title: 'STS agent may READ the primary bucket',
      argv: binding(src, sts, 'roles/storage.objectViewer'),
    },
    {
      // objectViewer/objectAdmin do NOT include storage.buckets.get, which STS
      // needs to resolve each bucket. The legacy* roles are what supply it —
      // omitting them is the classic "transfer job created, every run fails
      // with PERMISSION_DENIED" setup.
      id: 'sts-get-source',
      title: 'STS agent may GET the primary bucket metadata',
      argv: binding(src, sts, 'roles/storage.legacyBucketReader'),
    },
    {
      id: 'sts-write-dest',
      title: 'STS agent may WRITE the backup bucket',
      argv: binding(dst, sts, 'roles/storage.objectAdmin'),
    },
    {
      id: 'sts-get-dest',
      title: 'STS agent may GET the backup bucket metadata',
      argv: binding(dst, sts, 'roles/storage.legacyBucketWriter'),
    },
    {
      id: 'runtime-read-dest',
      title: 'Functions runtime SA may LIST the backup bucket (health check)',
      argv: binding(dst, runtimeSa, 'roles/storage.objectViewer'),
    },
    {
      id: 'transfer-job',
      title: `Daily mirror ${src} → ${dst} at ${scheduleUtc} UTC`,
      argv: [
        'gcloud', 'transfer', 'jobs', 'create', src, dst,
        `--name=transferJobs/${jobName}`,
        '--description=ZedExams daily Storage mirror (DR-003)',
        '--schedule-repeats-every=24h',
        `--schedule-starts=${scheduleStartsRfc3339(scheduleUtc)}`,
        // Copy changed objects; never delete at the destination. A mirror that
        // propagates a source delete is not a backup.
        '--overwrite-when=different',
        P,
      ],
      tolerate: ['already exists', 'ALREADY_EXISTS'],
    },
  ]

  return { steps, envLine: `STORAGE_BACKUP_BUCKET=${dst}` }
}

/**
 * Turn an "HH:MM" UTC time into the RFC3339 start instant STS wants: the next
 * occurrence at or after now, so a job created at 09:00 doesn't get a start
 * time in the past. Pure given `now`.
 *
 * @param {string} hhmm
 * @param {Date} [now]
 * @returns {string}
 */
export function scheduleStartsRfc3339(hhmm = DEFAULT_SCHEDULE_UTC, now = new Date()) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim())
  const hours = m ? Math.min(23, Number(m[1])) : 0
  const minutes = m ? Math.min(59, Number(m[2])) : 30
  const start = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes, 0, 0,
  ))
  if (start.getTime() <= now.getTime()) start.setUTCDate(start.getUTCDate() + 1)
  return start.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Classify one command result. Pure — separated from the spawn so the test can
 * assert the "already exists is not a failure" rule without running anything.
 *
 * @param {{status: number, stderr?: string}} result
 * @param {string[]} [tolerate]
 * @returns {'ok'|'already-done'|'failed'}
 */
export function classifyStepResult(result, tolerate = []) {
  if (!result || result.status === 0) return 'ok'
  const stderr = String((result && result.stderr) || '').toLowerCase()
  const matched = (tolerate || []).some((t) => stderr.includes(String(t).toLowerCase()))
  return matched ? 'already-done' : 'failed'
}

/** Resolve the project number via gcloud. Returns '' when gcloud is absent. */
export function resolveProjectNumber(project, run = spawnSync) {
  const res = run('gcloud', [
    'projects', 'describe', project, '--format=value(projectNumber)',
  ], { encoding: 'utf8' })
  if (!res || res.error || res.status !== 0) return ''
  return String(res.stdout || '').trim()
}

function quote(argv) {
  return argv.map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ')
}

async function main(argv) {
  const unknown = unknownFlags(argv)
  if (unknown.length) {
    console.error(`Unrecognised flag(s): ${unknown.join(', ')}`)
    console.error('Run with no arguments to see the dry-run plan, or read the')
    console.error('FLAGS block at the top of scripts/provision-storage-backup.mjs.')
    return 1
  }

  const opts = parseArgs(argv)

  if (opts.runtimeServiceAccount) {
    const verdict = validateServiceAccountEmail(opts.runtimeServiceAccount)
    if (!verdict.ok) {
      console.error(`--runtime-sa=${opts.runtimeServiceAccount} is ${verdict.reason}.`)
      console.error('This value receives READ access to every backed-up object; refusing.')
      return 1
    }
  }

  let projectNumber = opts.projectNumber
  if (!projectNumber) projectNumber = resolveProjectNumber(opts.project)

  const lifecycleDir = opts.live
    ? mkdtempSync(join(tmpdir(), 'zedexams-lifecycle-'))
    : '/tmp'
  const lifecycleFile = join(lifecycleDir, 'backup-lifecycle.json')
  const sourceLifecycleFile = join(lifecycleDir, 'primary-lifecycle.json')

  const { steps, envLine } = planProvision({
    ...opts, projectNumber, lifecycleFile, sourceLifecycleFile,
  })

  console.log('\nZedExams — Storage backup mirror (DR-003)')
  console.log(`  project         ${opts.project}${projectNumber ? ` (#${projectNumber})` : ' (project number UNRESOLVED — is gcloud installed and authenticated?)'}`)
  console.log(`  primary bucket  gs://${opts.sourceBucket}`)
  console.log(`  backup bucket   gs://${opts.backupBucket} (${opts.location})`)
  console.log(`  mode            ${opts.live ? 'LIVE — commands will run' : 'DRY RUN — nothing will run'}`)

  // A non-default runtime SA is legitimate (a hardened project runs functions
  // under a dedicated one) but it decides who can read every backed-up object,
  // so it is never applied silently — it is named back before step 1 runs.
  const resolvedRuntimeSa = runtimeServiceAccount(projectNumber, opts.runtimeServiceAccount)
  const defaultRuntimeSa = runtimeServiceAccount(projectNumber, '')
  if (resolvedRuntimeSa !== defaultRuntimeSa) {
    console.log(`\n  ⚠️  NON-DEFAULT runtime service account — this principal will be`)
    console.log(`      granted roles/storage.objectViewer on gs://${opts.backupBucket},`)
    console.log('      i.e. read access to every backed-up upload, export and past paper:')
    console.log(`        ${resolvedRuntimeSa}`)
    console.log(`      (the default for this project is ${defaultRuntimeSa})`)
    console.log('      Ctrl-C now if that is not the Cloud Functions runtime SA.')
  }
  console.log('')

  if (!projectNumber) {
    console.log('  ⚠️  Without the project number the IAM bindings below carry a')
    console.log('      <PROJECT_NUMBER> placeholder and will NOT work as printed.')
    console.log('      Pass --project-number=<n> or authenticate gcloud.\n')
    if (opts.live) {
      console.error('Refusing to run with an unresolved project number.')
      return 1
    }
  }

  let failed = 0
  for (const [i, step] of steps.entries()) {
    const label = `${String(i + 1).padStart(2, ' ')}. ${step.title}`
    if (!opts.live) {
      console.log(label)
      if (step.writeFile) {
        console.log(`    write ${step.writeFile.path}:`)
        console.log(`    ${JSON.stringify(step.writeFile.contents)}`)
      }
      console.log(`    $ ${quote(step.argv)}\n`)
      continue
    }

    process.stdout.write(`${label} ... `)
    if (step.writeFile) {
      writeFileSync(step.writeFile.path, `${JSON.stringify(step.writeFile.contents, null, 2)}\n`)
    }
    const [cmd, ...rest] = step.argv
    const res = spawnSync(cmd, rest, { encoding: 'utf8' })
    const verdict = res && res.error
      ? 'failed'
      : classifyStepResult(res, step.tolerate)
    if (verdict === 'ok') console.log('done')
    else if (verdict === 'already-done') console.log('already done')
    else {
      failed += 1
      console.log('FAILED')
      console.log(`    $ ${quote(step.argv)}`)
      console.log(`    ${String((res && (res.stderr || res.error?.message)) || '').trim().split('\n').slice(0, 4).join('\n    ')}`)
    }
  }

  if (failed) {
    console.log(`\n${failed} step(s) failed — the mirror is NOT provisioned. Fix and re-run (every step is re-runnable).`)
    return 1
  }

  console.log('\nNext, to stop the daily "Storage backup MISCONFIGURED" alert:')
  console.log('  1. Add this line to functions/.env.examsprepzambia (uncomment the stub already there):')
  console.log(`       ${envLine}`)
  console.log('  2. Open a PR and merge — deploy-firebase.yml ships the Functions change.')
  console.log('  3. After the next 04:00 Africa/Lusaka run, opsStorageBackups/{today}.status')
  console.log('     must read "fresh". Until the first transfer completes it reads "empty".\n')
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code })
    .catch((err) => {
      console.error(err && err.stack ? err.stack : err)
      process.exitCode = 1
    })
}
