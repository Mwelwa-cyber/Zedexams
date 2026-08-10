/**
 * One-off cleanup for profiles resurrected by the account-deletion race
 * (fixed in #2228; these are the documents it left behind).
 *
 *   npm run cleanup:resurrected-profiles:dry            # lists, deletes nothing
 *   npm run cleanup:resurrected-profiles -- --uids A,B,C
 *   npm run cleanup:resurrected-profiles -- --uids A,B,C --live
 *
 * ## Finding the uids — run this FIRST
 *
 * Two populations, and only one of them can be found automatically.
 *
 * **After #2228** every deletion writes `accountPurgeJobs/{uid}`. A uid with a
 * tombstone whose `users/{uid}` still exists is a resurrected profile by
 * definition, and this script finds those on its own.
 *
 * **Before #2228** — which is where the three known production orphans come
 * from — there is no tombstone to match. Nothing in Firestore distinguishes a
 * pre-fix orphan from a live account, so the uids must come from the deletion
 * events in Cloud Logging. This query returns them with their timestamps:
 *
 *     gcloud logging read \
 *       'resource.type="cloud_run_revision"
 *        AND resource.labels.service_name="deletemyaccount"
 *        AND textPayload:"deleteMyAccount uid="
 *        AND timestamp>="2026-08-01T00:00:00Z"' \
 *       --project=examsprepzambia --limit=200 \
 *       --format='table(timestamp, textPayload)'
 *
 * Or, in the Cloud Console Log Explorer (same filter, paste as-is):
 *
 *     resource.type="cloud_run_revision"
 *     resource.labels.service_name="deletemyaccount"
 *     textPayload:"deleteMyAccount uid="
 *     timestamp>="2026-08-01T00:00:00Z"
 *
 * Each matching line reads `deleteMyAccount uid=<UID> summary={…}`. Those uids
 * are the accounts a deletion COMPLETED for — so any of them whose `users/{uid}`
 * still exists was resurrected. Widen the timestamp if the window is wrong;
 * narrow it to the incident if you know when it was.
 *
 * A deliberate non-feature: this script will not go looking for "profiles that
 * look abandoned". A heuristic that guesses which accounts were meant to be
 * deleted, and then deletes them, is worse than the bug it cleans up.
 *
 * ## Safety
 *
 * - Dry run by DEFAULT. `--live` additionally requires typing DELETE.
 * - Every document is written to a timestamped JSON backup BEFORE deletion —
 *   mode 0600 and git-ignored, because it holds the profile data (emails
 *   included) of people who asked to be erased.
 * - The dry run prints the exact targets, so they can be reviewed before any
 *   live pass — which is the intended workflow, not an optional courtesy.
 * - One-off remediation. Never a scheduled sweep.
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

if (!admin.apps.length) admin.initializeApp()
const db = admin.firestore()

/** Post-#2228: a tombstone whose profile is still present. */
async function findTombstoned() {
  const out = []
  let tombstones
  try {
    tombstones = await db.collection('accountPurgeJobs').get()
  } catch (err) {
    // Never report "none found" when the query failed — that reads as clean.
    console.error(`\n! could not read accountPurgeJobs: ${err.message}`)
    console.error('  Tombstoned orphans were NOT checked. Fix this before concluding anything.\n')
    return null
  }
  for (const t of tombstones.docs) {
    const snap = await db.doc(`users/${t.id}`).get()
    if (snap.exists) {
      out.push({
        uid: t.id,
        reason: 'tombstoned by accountPurgeJobs, but users/{uid} still exists',
        profile: snap.data(),
        tombstone: t.data(),
      })
    }
  }
  return out
}

/** Pre-#2228: named explicitly, from the Cloud Logging query above. */
async function findExplicit(uids) {
  const out = []
  for (const uid of uids) {
    const snap = await db.doc(`users/${uid}`).get()
    if (!snap.exists) {
      console.log(`  – ${uid}: no users/${uid} document (already gone, or wrong uid)`)
      continue
    }
    const t = await db.doc(`accountPurgeJobs/${uid}`).get().catch(() => null)
    out.push({
      uid,
      reason: t?.exists ?
        'named explicitly, and tombstoned' :
        'named explicitly — no tombstone, i.e. a pre-#2228 orphan',
      profile: snap.data(),
      tombstone: t?.exists ? t.data() : null,
    })
  }
  return out
}

const tombstoned = await findTombstoned()
const explicit = await findExplicit(explicitUids)
const unique = [...new Map([...(tombstoned ?? []), ...explicit].map((f) => [f.uid, f])).values()]

console.log(`\nresurrected / orphaned profiles found: ${unique.length}`)
if (tombstoned === null) console.log('  (…of the explicitly-named only — the tombstone scan FAILED, see above)')
for (const f of unique) {
  const p = f.profile ?? {}
  console.log(`  • ${f.uid}`)
  console.log(`      role=${p.role ?? '(none)'}  email=${p.email ?? '(none)'}  createdAt=${p.createdAt?.toDate?.()?.toISOString?.() ?? p.createdAt ?? '(none)'}`)
  console.log(`      ${f.reason}`)
}

if (unique.length === 0) {
  console.log('\nnothing to do.')
  process.exit(0)
}

if (!LIVE) {
  console.log('\nDRY RUN — nothing deleted.')
  console.log('Review the targets above, then re-run with --live to delete them.')
  process.exit(0)
}

// A deletion you cannot undo is one you should not run from a script.
//
// Two things about this file, both because of WHAT is in it: the profiles of
// people who asked to be erased, emails included.
//
//   mode 0o600 — default permissions are umask-dependent and typically leave
//   it world-readable. On any shared machine that hands every local account
//   the personal data of users we were told to delete. The chmod after the
//   write is not redundant: writeFileSync's `mode` applies only when it
//   CREATES the file and is ignored outright if one already exists, so a
//   leftover 0644 file at the same path would be rewritten and stay 0644.
//   Verified — fresh file 600, pre-existing file 644 without the chmod.
//
//   It is git-ignored (see .gitignore) and named so the pattern cannot miss
//   it. Written to the repo root, one `git add -A` would otherwise commit
//   deleted users' addresses into a public repository — a worse disclosure
//   than the bug being cleaned up, and permanent.
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = path.resolve(`resurrected-profiles-backup-${stamp}.json`)
writeFileSync(backup, JSON.stringify(unique, null, 2) + '\n', { mode: 0o600 })
chmodSync(backup, 0o600)
console.log(`\nbackup written: ${backup} (mode 0600, git-ignored)`)
console.log('  It holds deleted users\' profile data. Delete it once the cleanup is confirmed.')

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
