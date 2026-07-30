#!/usr/bin/env node
/**
 * Node test for scripts/provision-storage-backup.mjs (DR-003 Storage mirror).
 * Run: node scripts/test-provision-storage-backup.mjs
 *
 * The script's job is to emit the exact gcloud commands that provision a
 * verifiable Storage backup, so what's worth pinning is the shape of that plan:
 * that the backup bucket is cross-region and versioned, that the lifecycle rule
 * can never expire a LIVE object (a mirror that empties itself is the failure
 * the whole subsystem exists to catch), that the IAM bindings include the
 * bucket-metadata roles STS actually needs, and that re-running is safe.
 */

import assert from 'node:assert'
import {
  parseArgs, planProvision, buildLifecycleConfig, stsServiceAgent,
  runtimeServiceAccount, scheduleStartsRfc3339, classifyStepResult,
  resolveProjectNumber, unknownFlags, validateServiceAccountEmail,
} from './provision-storage-backup.mjs'

let passed = 0
function ok(name, cond) { assert.ok(cond, name); passed += 1; console.log(`  ok  ${name}`) }

const plan = (over = {}) => planProvision({projectNumber: '123456', ...over})
const step = (p, id) => p.steps.find((s) => s.id === id)
const cmd = (p, id) => (step(p, id)?.argv || []).join(' ')

console.log('provision-storage-backup (args)')
{
  const d = parseArgs([])
  ok('dry run is the default', d.live === false)
  ok('defaults to the production project', d.project === 'examsprepzambia')
  ok('defaults to the live Storage bucket as the source',
    d.sourceBucket === 'examsprepzambia.firebasestorage.app')
  const l = parseArgs(['--live', '--location=us-central1', '--backup-bucket=other'])
  ok('--live is opt-in', l.live === true)
  ok('--location overrides', l.location === 'us-central1')
  ok('--backup-bucket overrides', l.backupBucket === 'other')
}

console.log('\nprovision-storage-backup (plan)')
{
  const p = plan()
  ok('the transfer API is enabled before the job is created',
    p.steps.findIndex((s) => s.id === 'enable-api') <
    p.steps.findIndex((s) => s.id === 'transfer-job'))
  ok('IAM is granted before the job is created',
    p.steps.findIndex((s) => s.id === 'sts-write-dest') <
    p.steps.findIndex((s) => s.id === 'transfer-job'))
  ok('versioning is turned on for the PRIMARY bucket',
    /buckets update gs:\/\/examsprepzambia\.firebasestorage\.app .*--versioning/
      .test(cmd(p, 'source-versioning')))
  ok('versioning is turned on for the BACKUP bucket',
    /buckets update gs:\/\/zedexams-storage-backup .*--versioning/
      .test(cmd(p, 'backup-versioning')))
  ok('the backup bucket is created outside the primary\'s region',
    cmd(p, 'create-backup-bucket').includes('--location=europe-west1'))
  ok('the backup bucket is created with uniform access + public-access prevention',
    cmd(p, 'create-backup-bucket').includes('--uniform-bucket-level-access') &&
    cmd(p, 'create-backup-bucket').includes('--public-access-prevention'))
  ok('the plan prints the env line that closes the loop',
    p.envLine === 'STORAGE_BACKUP_BUCKET=gs://zedexams-storage-backup')
}

// A default-region backup would share the primary's blast radius; the whole
// point of the mirror is that it does not.
{
  const p = plan({location: 'africa-south1'})
  ok('an explicit location is honoured (operator\'s call)',
    cmd(p, 'create-backup-bucket').includes('--location=africa-south1'))
}

console.log('\nprovision-storage-backup (lifecycle safety)')
{
  const rules = buildLifecycleConfig(30).lifecycle.rule
  ok('a general rule plus a staging rule', rules.length === 2)
  ok('the general rule expires non-current versions on time alone',
    rules[0].condition.daysSinceNoncurrentTime === 30)
  // Conditions AND together, so numNewerVersions makes a DELETED object (zero
  // newer versions) immortal — the exact case tmpDownloadReaper generates
  // hourly. Its absence is the fix, so its absence is the assertion.
  ok('NO rule carries numNewerVersions (it would make deletes immortal)',
    rules.every((r) => r.condition.numNewerVersions === undefined))
  ok('no rule can expire a live object (no age/createdBefore condition)',
    rules.every((r) => r.condition.age === undefined &&
      r.condition.createdBefore === undefined &&
      r.condition.daysSinceNoncurrentTime !== undefined))
  ok('export staging gets a short window, not the full retention',
    rules[1].condition.matchesPrefix.join() === 'tmp-downloads/' &&
    rules[1].condition.daysSinceNoncurrentTime === 1)
  ok('a nonsense retention falls back to the default, never 0',
    buildLifecycleConfig(0).lifecycle.rule[0].condition.daysSinceNoncurrentTime === 30 &&
    buildLifecycleConfig(NaN).lifecycle.rule[0].condition.daysSinceNoncurrentTime === 30)
  const p = plan({
    noncurrentDays: 90, lifecycleFile: '/tmp/lc.json', sourceLifecycleFile: '/tmp/src.json',
  })
  ok('the backup lifecycle step writes the config it then applies',
    step(p, 'backup-lifecycle').writeFile.path === '/tmp/lc.json' &&
    cmd(p, 'backup-lifecycle').includes('--lifecycle-file=/tmp/lc.json') &&
    step(p, 'backup-lifecycle').writeFile.contents.lifecycle.rule[0]
      .condition.daysSinceNoncurrentTime === 90)

  // Versioning without an expiry rule is what bills a delete forever. The two
  // are one decision, so the plan must never contain the first without the
  // second, and never in the other order.
  ok('the PRIMARY bucket gets a lifecycle rule too',
    cmd(p, 'source-lifecycle').includes('gs://examsprepzambia.firebasestorage.app') &&
    cmd(p, 'source-lifecycle').includes('--lifecycle-file=/tmp/src.json'))
  ok('the primary rule is the same bounded rule as the backup\'s',
    JSON.stringify(step(p, 'source-lifecycle').writeFile.contents) ===
    JSON.stringify(step(p, 'backup-lifecycle').writeFile.contents))
  ok('the primary\'s expiry lands in the same run as its versioning',
    p.steps.findIndex((s) => s.id === 'source-versioning') <
    p.steps.findIndex((s) => s.id === 'source-lifecycle'))
  ok('every bucket the plan versions, the plan also expires',
    p.steps.filter((s) => (s.argv || []).includes('--versioning'))
      .map((s) => s.argv[4])
      .every((bucket) => p.steps.some((s) =>
        s.id.endsWith('-lifecycle') && s.argv.includes(bucket))))
  ok('the two lifecycle files are distinct (one cannot clobber the other)',
    step(p, 'source-lifecycle').writeFile.path !==
    step(p, 'backup-lifecycle').writeFile.path)
}

console.log('\nprovision-storage-backup (IAM)')
{
  const p = plan()
  const agent = 'project-123456@storage-transfer-service.iam.gserviceaccount.com'
  ok('the STS service agent is derived from the project number',
    stsServiceAgent('123456') === agent)
  ok('a missing project number is a visible placeholder, not a wrong email',
    stsServiceAgent('').includes('<PROJECT_NUMBER>'))
  ok('STS reads the source', cmd(p, 'sts-read-source').includes('roles/storage.objectViewer') &&
    cmd(p, 'sts-read-source').includes(agent))
  ok('STS writes the destination', cmd(p, 'sts-write-dest').includes('roles/storage.objectAdmin'))
  // objectViewer/objectAdmin carry no storage.buckets.get; without the legacy
  // roles every transfer run fails PERMISSION_DENIED after the job "succeeds".
  ok('STS can read the SOURCE bucket metadata',
    cmd(p, 'sts-get-source').includes('roles/storage.legacyBucketReader'))
  ok('STS can read the DESTINATION bucket metadata',
    cmd(p, 'sts-get-dest').includes('roles/storage.legacyBucketWriter'))
  ok('the source grants are on the source bucket',
    cmd(p, 'sts-read-source').includes('gs://examsprepzambia.firebasestorage.app') &&
    cmd(p, 'sts-get-source').includes('gs://examsprepzambia.firebasestorage.app'))
  ok('the destination grants are on the backup bucket',
    cmd(p, 'sts-write-dest').includes('gs://zedexams-storage-backup') &&
    cmd(p, 'sts-get-dest').includes('gs://zedexams-storage-backup'))
  // Without this the health check reads `error` forever, which is
  // indistinguishable from a genuinely broken mirror.
  ok('the Functions runtime SA can list the backup bucket',
    cmd(p, 'runtime-read-dest').includes('123456-compute@developer.gserviceaccount.com') &&
    cmd(p, 'runtime-read-dest').includes('gs://zedexams-storage-backup'))
  ok('an explicit runtime SA overrides the default',
    runtimeServiceAccount('123456', 'svc@x.iam.gserviceaccount.com') === 'svc@x.iam.gserviceaccount.com')
}

console.log('\nprovision-storage-backup (schedule)')
{
  const p = plan()
  ok('the mirror repeats daily', cmd(p, 'transfer-job').includes('--schedule-repeats-every=24h'))
  ok('the job never deletes at the destination',
    !cmd(p, 'transfer-job').includes('--delete-from') &&
    cmd(p, 'transfer-job').includes('--overwrite-when=different'))
  ok('the job is named so a re-run finds it instead of duplicating it',
    cmd(p, 'transfer-job').includes('--name=transferJobs/zedexams-storage-mirror'))

  const now = new Date('2030-01-02T09:00:00Z')
  ok('a time already past today starts tomorrow, never in the past',
    scheduleStartsRfc3339('00:30', now) === '2030-01-03T00:30:00Z')
  ok('a time still ahead starts today',
    scheduleStartsRfc3339('23:30', now) === '2030-01-02T23:30:00Z')
  // 00:30 UTC is 02:30 Lusaka — the mirror must finish before the 04:00 Lusaka
  // health check or every morning's first read is a false `stale`.
  const start = scheduleStartsRfc3339('00:30', now)
  ok('the default start leaves headroom before the 04:00 Lusaka check',
    Number(start.slice(11, 13)) + 2 < 4)
}

console.log('\nprovision-storage-backup (re-runnable)')
{
  const p = plan()
  ok('creating an existing bucket is tolerated',
    (step(p, 'create-backup-bucket').tolerate || []).some((t) => /already exists/i.test(t)))
  ok('creating an existing transfer job is tolerated',
    (step(p, 'transfer-job').tolerate || []).some((t) => /already.?exists/i.test(t)))
  ok('a zero exit is ok', classifyStepResult({status: 0}) === 'ok')
  ok('a tolerated failure reads as already done',
    classifyStepResult({status: 1, stderr: 'ERROR: bucket already exists'},
      ['already exists']) === 'already-done')
  ok('an untolerated failure still fails',
    classifyStepResult({status: 1, stderr: 'PERMISSION_DENIED'},
      ['already exists']) === 'failed')
  ok('a failure with no tolerate list fails',
    classifyStepResult({status: 1, stderr: 'boom'}) === 'failed')
}

console.log('\nprovision-storage-backup (project number)')
{
  ok('a project number is read from gcloud',
    resolveProjectNumber('p', () => ({status: 0, stdout: '123456\n'})) === '123456')
  ok('a missing gcloud yields no number rather than throwing',
    resolveProjectNumber('p', () => ({error: new Error('ENOENT')})) === '')
  ok('a failed lookup yields no number',
    resolveProjectNumber('p', () => ({status: 1, stdout: ''})) === '')
}

console.log('\nprovision-storage-backup (argument hygiene)')
{
  ok('the documented flags are accepted',
    unknownFlags(['--live', '--location=us-central1', '--project-number=1',
      '--runtime-sa=a@b.iam.gserviceaccount.com', '--noncurrent-days=90']).length === 0)
  // A dropped flag reads exactly like success from the operator's side: the
  // script prints a plan and provisions — just not where they asked.
  ok('a typo is refused, not silently ignored',
    unknownFlags(['--locaton=us-central1']).join() === '--locaton=us-central1')
  ok('a bare flag used as a value flag is refused',
    unknownFlags(['--location']).length === 1)
  ok('a value flag used bare is refused', unknownFlags(['--live=yes']).length === 1)
  ok('non-flag arguments are left alone', unknownFlags(['live', 'x']).length === 0)
}

console.log('\nprovision-storage-backup (--runtime-sa)')
{
  // Not a privilege boundary — --live already needs roles/storage.admin, which
  // can grant any binding directly. This catches the MISTAKE: a value that is
  // not a service account would be bound under a `serviceAccount:` prefix to
  // the bucket holding every backed-up upload.
  ok('the default compute SA is accepted',
    validateServiceAccountEmail('123456-compute@developer.gserviceaccount.com').ok)
  // The hardened setup — a dedicated runtime SA — is exactly who needs the flag,
  // so it must NOT be pinned to the default compute address.
  ok('a dedicated runtime SA is accepted',
    validateServiceAccountEmail('functions-runtime@examsprepzambia.iam.gserviceaccount.com').ok)
  ok('the App Engine default SA is accepted',
    validateServiceAccountEmail('examsprepzambia@appspot.gserviceaccount.com').ok)
  ok('a human address is refused',
    validateServiceAccountEmail('mahengamwelwa@gmail.com').ok === false)
  ok('a look-alike domain is refused',
    validateServiceAccountEmail('sa@evil-gserviceaccount.com').ok === false)
  ok('a non-Google domain is refused',
    validateServiceAccountEmail('attacker@evil.com').ok === false)
  ok('an empty value is refused', validateServiceAccountEmail('').ok === false)
  ok('a refusal says why', /service-account/.test(
    validateServiceAccountEmail('x@evil.com').reason))
  ok('a rejected value still parses (main owns the exit)',
    parseArgs(['--runtime-sa=x@evil.com']).runtimeServiceAccount === 'x@evil.com')
}

console.log(`\n─── ${passed} assertions · all passed ───`)
