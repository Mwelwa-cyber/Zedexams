/**
 * One-off cleanup for profiles resurrected by the account-deletion race.
 *
 * LIFTED OUT OF #2229 BEFORE THAT PULL REQUEST WAS CLOSED, and re-pointed.
 * #2229 proposed a second tombstone design (`accountDeletions/{uid}`) that
 * production never adopted: run 717 deployed #2236 on top of #2228, so the
 * collection that exists is `accountPurgeJobs/{uid}`. The script is otherwise
 * unchanged — its author's reasoning about what counts as a resurrected profile
 * and why the pre-fix orphans must be named explicitly is intact and correct.
 * Lifted verbatim it would have scanned a collection that does not exist and
 * reported a clean sweep, which is the worst available outcome for a cleanup
 * tool.
 *
 *   npm run cleanup:resurrected-profiles:dry     # default — lists, deletes nothing
 *   npm run cleanup:resurrected-profiles -- --live
 *
 * ## What it looks for, and why that definition is narrow
 *
 * A resurrected profile is a `users/{uid}` document whose uid ALSO has an
 * account-deletion tombstone (`accountPurgeJobs/{uid}`). The user asked for the
 * account to be deleted; the deletion ran; the profile is still here. Nothing
 * else qualifies — this does not go looking for "profiles that look abandoned",
 * because a heuristic that deletes live accounts is far worse than leaving a
 * few orphans behind for a human to look at.
 *
 * Profiles orphaned BEFORE the tombstone existed have no tombstone to match, so
 * they cannot be found this way. Those are the three known production orphans,
 * and they must be passed in explicitly:
 *
 *   npm run cleanup:resurrected-profiles -- --uids uidA,uidB,uidC --live
 *
 * ## Where those uids come from — run this FIRST
 *
 * The pre-fix orphans are only findable in Cloud Logging, because nothing in
 * Firestore distinguishes one from a live account. `deleteMyAccount` logs a
 * line per completed deletion, and this returns them with timestamps:
 *
 *     gcloud logging read \
 *       'resource.type="cloud_run_revision"
 *        AND resource.labels.service_name="deletemyaccount"
 *        AND textPayload:"deleteMyAccount uid="
 *        AND timestamp>="2026-08-01T00:00:00Z"' \
 *       --project=examsprepzambia --limit=200 \
 *       --format='table(timestamp, textPayload)'
 *
 * Or paste this into the Cloud Console Log Explorer, unchanged:
 *
 *     resource.type="cloud_run_revision"
 *     resource.labels.service_name="deletemyaccount"
 *     textPayload:"deleteMyAccount uid="
 *     timestamp>="2026-08-01T00:00:00Z"
 *
 * Each match reads `deleteMyAccount uid=<UID> summary={…}`. Those are uids a
 * deletion COMPLETED for, so any whose `users/{uid}` still exists was
 * resurrected. Widen the timestamp if the window is wrong; narrow it to the
 * incident if you know when it was.
 *
 * The intended order is: query → dry run → review the printed targets → --live.
 *
 * That is deliberate. There is no query that distinguishes a pre-tombstone
 * orphan from a real account, so the only safe source of those uids is the
 * Cloud Logging trail of the deletions that produced them.
 *
 * ## Safety
 *
 * - Dry run by default. `--live` also requires typing DELETE at the prompt.
 * - Every document is written to a timestamped JSON backup BEFORE deletion.
 * - Refuses any uid that has NO tombstone unless it was named with `--uids`,
 *   so a mistyped argument cannot delete an arbitrary live account silently.
 * - It is a one-off remediation, never a scheduled sweep.
 */
import { createRequire } from 'node:module'
import { writeFileSync, chmodSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import path from 'node:path'

const require = createRequire(import.meta.url)
const admin = require('firebase-admin')

const args = process.argv.slice(2)
const LIVE = args.includes('--live')
const explicitUids = (() => {
  const i = args.indexOf('--uids')
  if (i === -1) return []
  return (args[i + 1] || '').split(',').map((s) => s.trim()).filter(Boolean)
})()

// Credentials, checked before anything else. Without them firebase-admin throws
// a raw "Unable to detect a Project Id" from deep inside the SDK, which reads
// like a broken script rather than a missing setup step — and this is a tool
// someone reaches for once, under pressure, to delete production documents.
// `cleanup-classes.mjs` sets the standard: explain and exit, never pretend to
// have scanned anything.
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_CONFIG) {
  console.log(`
cleanup-resurrected-profiles — no credentials, so nothing was scanned.

Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON with Firestore
access and run again:

  GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json npm run cleanup:resurrected-profiles:dry

What it WOULD do: list every uid with an accountPurgeJobs/{uid} tombstone whose
users/{uid} document still exists, plus any uid named with --uids. It deletes
nothing without --live, and --live still asks you to type DELETE.
`)
  process.exit(0)
}

if (!admin.apps.length) admin.initializeApp()
const db = admin.firestore()

/** Candidates: every uid with a tombstone whose users/{uid} still exists. */
async function findResurrected() {
  const out = []
  const tombstones = await db.collection('accountPurgeJobs').get()
  for (const t of tombstones.docs) {
    const snap = await db.doc(`users/${t.id}`).get()
    if (snap.exists) {
      out.push({ uid: t.id, reason: 'tombstoned but profile present', profile: snap.data(), tombstone: t.data() })
    }
  }
  return out
}

/** Explicitly named uids — the pre-tombstone orphans. Reported, never guessed at. */
async function findExplicit(uids) {
  const out = []
  for (const uid of uids) {
    const snap = await db.doc(`users/${uid}`).get()
    if (!snap.exists) {
      console.log(`  – ${uid}: no users/${uid} document (already gone, or wrong uid)`)
      continue
    }
    const t = await db.doc(`accountPurgeJobs/${uid}`).get()
    out.push({
      uid,
      reason: t.exists ? 'named + tombstoned' : 'named explicitly (no tombstone — pre-fix orphan)',
      profile: snap.data(),
      tombstone: t.exists ? t.data() : null,
    })
  }
  return out
}

const found = [...await findResurrected(), ...await findExplicit(explicitUids)]
const unique = [...new Map(found.map((f) => [f.uid, f])).values()]

console.log(`\nresurrected/orphaned profiles found: ${unique.length}`)
for (const f of unique) {
  console.log(`  • ${f.uid}  role=${f.profile?.role ?? '(none)'}  email=${f.profile?.email ?? '(none)'}`)
  console.log(`      ${f.reason}`)
}

if (unique.length === 0) {
  console.log('\nnothing to do.')
  process.exit(0)
}

if (!LIVE) {
  console.log('\nDRY RUN — nothing deleted. Re-run with --live to delete.')
  process.exit(0)
}

// Back up before touching anything: a deletion you cannot undo is one you
// should not run from a script.
//
// Two protections on the file itself, both because of WHAT is in it — the
// profile data, emails included, of people who asked to be erased.
//
//   mode 0o600. Default permissions are umask-dependent and typically leave it
//   world-readable, which on a shared machine hands every local account exactly
//   the data we were told to delete. The chmod is NOT redundant with the mode
//   option: writeFileSync's `mode` applies only when it CREATES the file and is
//   ignored outright when one already exists, so a leftover 0644 file at this
//   path would be rewritten and stay 0644. Measured: fresh file 600,
//   pre-existing file 644 without the chmod.
//
//   Git-ignored (.gitignore). It is written to the REPO ROOT, so one
//   `git add -A` would commit deleted users' addresses into a public
//   repository — a worse disclosure than the bug this script cleans up, and a
//   permanent one.
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = path.resolve(`resurrected-profiles-backup-${stamp}.json`)
writeFileSync(backup, JSON.stringify(unique, null, 2) + '\n', { mode: 0o600 })
chmodSync(backup, 0o600)
console.log(`\nbackup written: ${backup} (mode 0600, git-ignored)`)
console.log('  It holds deleted users\' profile data — delete it once the cleanup is confirmed.')

const rl = createInterface({ input: process.stdin, output: process.stdout })
const answer = await rl.question(`\nType DELETE to remove ${unique.length} profile document(s): `)
rl.close()
if (answer !== 'DELETE') {
  console.log('aborted — nothing deleted.')
  process.exit(1)
}

let deleted = 0
for (const f of unique) {
  try {
    await db.recursiveDelete(db.doc(`users/${f.uid}`))
    deleted += 1
    console.log(`  ✔ deleted users/${f.uid}`)
  } catch (err) {
    console.error(`  ✘ users/${f.uid}: ${err.message}`)
  }
}
console.log(`\ndone: ${deleted}/${unique.length} deleted. Backup: ${backup}`)
