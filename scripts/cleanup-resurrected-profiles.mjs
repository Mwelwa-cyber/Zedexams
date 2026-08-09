/**
 * One-off cleanup for profiles resurrected by the account-deletion race.
 *
 *   npm run cleanup:resurrected-profiles:dry     # default — lists, deletes nothing
 *   npm run cleanup:resurrected-profiles -- --live
 *
 * ## What it looks for, and why that definition is narrow
 *
 * A resurrected profile is a `users/{uid}` document whose uid ALSO has an
 * account-deletion tombstone (`accountDeletions/{uid}`). The user asked for the
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
import { writeFileSync } from 'node:fs'
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

/** Candidates: every uid with a tombstone whose users/{uid} still exists. */
async function findResurrected() {
  const out = []
  const tombstones = await db.collection('accountDeletions').get()
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
    const t = await db.doc(`accountDeletions/${uid}`).get()
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
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = path.resolve(`resurrected-profiles-backup-${stamp}.json`)
writeFileSync(backup, JSON.stringify(unique, null, 2) + '\n')
console.log(`\nbackup written: ${backup}`)

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
