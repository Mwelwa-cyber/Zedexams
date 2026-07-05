/**
 * One-time backfill for the daily-exam attempt privacy split.
 *
 * Historical `exam_attempts` docs (submitted before the privacy fix) store
 * the learner's raw `answers` and personal analytics (topicBreakdown /
 * strengths / weaknesses / performanceLevel / feedback) INLINE on the
 * top-level doc. That doc is readable by every signed-in user (it powers the
 * leaderboard + activity feeds), so a top scorer's `answers` effectively
 * leak the daily answer key, and everyone's analytics leak to everyone.
 *
 * The grader now writes those fields to the owner-only
 * `exam_attempts/{id}/private/detail` subcollection instead. This script
 * migrates the existing docs: it copies the sensitive fields into that
 * subcollection (keyed with the owner's userId so the Firestore rule can
 * authorise the owner's read) and then DELETES them from the top-level doc.
 *
 * Idempotent + safe: only touches submitted attempts that still carry a
 * sensitive field at the top level; re-running is a no-op. Leaderboard-safe
 * fields (score / percentage / name / subject / grade / timeTakenSeconds)
 * are never moved or deleted.
 *
 * SAFE BY DEFAULT: dry-run unless you pass --apply.
 *
 * Run authenticated against examsprepzambia (firebase login OR
 * GOOGLE_APPLICATION_CREDENTIALS):
 *   node scripts/backfill-exam-attempt-privacy.mjs            # dry run — preview
 *   node scripts/backfill-exam-attempt-privacy.mjs --apply    # write the changes
 */

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import * as fs from 'fs'

const APPLY = process.argv.includes('--apply')

// Fields that must not remain readable on the cross-user top-level doc.
const SENSITIVE_FIELDS = [
  'answers',
  'topicBreakdown',
  'strengths',
  'weaknesses',
  'performanceLevel',
  'feedback',
]

let db
try {
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (saPath && fs.existsSync(saPath)) {
    initializeApp({ credential: cert(JSON.parse(fs.readFileSync(saPath, 'utf8'))) })
    console.log('auth: service account')
  } else {
    initializeApp()
    console.log('auth: application default')
  }
  db = getFirestore()
  db.settings({ projectId: 'examsprepzambia' })
} catch (err) {
  console.error('firebase init failed:', err.message)
  console.error('try: firebase login   OR   set GOOGLE_APPLICATION_CREDENTIALS')
  process.exit(1)
}

async function main() {
  console.log(APPLY ? '*** APPLY MODE — writing changes ***' : 'dry run — no writes (pass --apply to write)')
  const snap = await db.collection('exam_attempts').where('status', '==', 'submitted').get()
  console.log(`scanning ${snap.size} submitted attempt(s)…`)

  let migrated = 0
  let clean = 0
  let batch = db.batch()
  let batchOps = 0

  for (const doc of snap.docs) {
    const data = doc.data() || {}
    const present = SENSITIVE_FIELDS.filter((f) => data[f] !== undefined)
    if (present.length === 0) { clean++; continue }

    const detail = { userId: data.userId, updatedAt: FieldValue.serverTimestamp() }
    for (const f of present) detail[f] = data[f]

    console.log(`MIGRATE ${doc.id}  owner=${data.userId || '(none)'}  fields=[${present.join(', ')}]`)

    if (APPLY) {
      batch.set(doc.ref.collection('private').doc('detail'), detail, { merge: true })
      const strip = {}
      for (const f of present) strip[f] = FieldValue.delete()
      batch.update(doc.ref, strip)
      batchOps += 2
      // Firestore caps a batch at 500 writes; flush well before that.
      if (batchOps >= 400) {
        await batch.commit()
        batch = db.batch()
        batchOps = 0
      }
    }
    migrated++
  }

  if (APPLY && batchOps > 0) await batch.commit()

  console.log(`\n${APPLY ? 'migrated' : 'would migrate'} ${migrated} attempt(s); ${clean} already clean.`)
  if (!APPLY && migrated > 0) console.log('Re-run with --apply to write the changes above.')
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('error:', err)
  process.exit(1)
})
