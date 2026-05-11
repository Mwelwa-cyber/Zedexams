#!/usr/bin/env node
/**
 * scripts/migrate-grade6-to-grade7.mjs
 *
 * Re-tag every Grade 6 quiz and note as Grade 7.
 *
 * ── Background ────────────────────────────────────────────────────────
 *   Grade 7 was added to the learner dashboard quiz section but does
 *   not yet have its own authored content. To bootstrap it, we move
 *   the existing Grade 6 catalogue across:
 *
 *     • quizzes collection   — docs with grade == '6'    → grade '7'
 *     • lessons collection   — docs with grade == '6'    → grade '7'
 *       (the lessons collection backs both legacy slide lessons and
 *       the new notes feature; see src/features/notes/lib/firestore.js)
 *
 *   This is a re-tag (not a copy): Grade 6 will be empty afterwards.
 *
 * ── What it does ──────────────────────────────────────────────────────
 *   For every quizzes/* and lessons/* doc where grade == '6':
 *     1. Write the ORIGINAL doc to `backups/grade6_to_grade7/<col>/<id>`
 *        so the change is reversible.
 *     2. Update the doc in place: grade -> '7'
 *
 * ── Two modes ─────────────────────────────────────────────────────────
 *   DRY RUN  (default)        No writes. Prints what would change.
 *   LIVE     (--live)         Performs writes. Requires service account.
 *
 * ── Prerequisites for LIVE mode ───────────────────────────────────────
 *   npm install --save-dev firebase-admin
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 *   # Dry run first (safe — prints only):
 *   node scripts/migrate-grade6-to-grade7.mjs
 *
 *   # Then live:
 *   node scripts/migrate-grade6-to-grade7.mjs --live
 *
 * ── Safety guarantees ─────────────────────────────────────────────────
 *   • Always writes a backup before updating.
 *   • Batches writes at 400 ops (Firestore cap is 500).
 *   • Idempotent: re-running finds 0 grade 6 docs and exits cleanly.
 *   • Restricted to the exact value '6' (string) — the schema stores
 *     grade as a string everywhere; numeric grade fields are not
 *     touched.
 */

const LIVE = process.argv.includes('--live')
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : Infinity
const BATCH_SIZE = 400

const COLLECTIONS = ['quizzes', 'lessons']
const FROM_GRADE = '6'
const TO_GRADE = '7'

if (LIVE) {
  await runLive()
} else {
  await runDryRun()
}

async function runLive() {
  console.log('── LIVE migration — writes WILL occur ──\n')

  let admin
  try {
    admin = await import('firebase-admin')
  } catch {
    console.error('firebase-admin not installed. Run:')
    console.error('  npm install --save-dev firebase-admin')
    process.exit(1)
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS is not set.')
    console.error('Point it at a Firebase service-account JSON key:')
    console.error('  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json')
    process.exit(1)
  }

  admin.default.initializeApp()
  const db = admin.default.firestore()

  const totals = { migrated: 0, skipped: 0, inspected: 0 }

  for (const collectionName of COLLECTIONS) {
    if (totals.inspected >= LIMIT) break
    console.log(`\n── ${collectionName} ──`)

    const snap = await db.collection(collectionName).where('grade', '==', FROM_GRADE).get()
    console.log(`  found ${snap.size} ${collectionName} doc(s) at grade ${FROM_GRADE}`)

    let batch = db.batch()
    let batchOps = 0

    for (const docSnap of snap.docs) {
      if (totals.inspected >= LIMIT) break
      totals.inspected++

      const raw = docSnap.data()
      if (raw.grade !== FROM_GRADE) {
        totals.skipped++
        continue
      }

      // 1. Backup the original.
      const backupRef = db.collection('backups')
        .doc('grade6_to_grade7')
        .collection(collectionName)
        .doc(docSnap.id)
      batch.set(backupRef, {
        collection: collectionName,
        docId: docSnap.id,
        original: raw,
        at: admin.default.firestore.FieldValue.serverTimestamp(),
      })
      // 2. Re-tag the original.
      batch.update(docSnap.ref, {
        grade: TO_GRADE,
        regradedAt: admin.default.firestore.FieldValue.serverTimestamp(),
        regradedFrom: FROM_GRADE,
      })
      batchOps += 2
      totals.migrated++
      console.log(`  ok    ${collectionName}/${docSnap.id}`)

      if (batchOps >= BATCH_SIZE) {
        await batch.commit()
        batch = db.batch()
        batchOps = 0
      }
    }

    if (batchOps > 0) await batch.commit()
  }

  console.log('')
  console.log('── live migration complete ──')
  console.log(`  inspected: ${totals.inspected}`)
  console.log(`  migrated:  ${totals.migrated}`)
  console.log(`  skipped:   ${totals.skipped}`)
  console.log('')
  console.log(`Originals are preserved under backups/grade6_to_grade7/<collection>/<id>.`)
  console.log(`To roll back, restore each backup's "original" field to its source doc and set grade back to "${FROM_GRADE}".`)
}

async function runDryRun() {
  console.log('── DRY RUN — no Firestore writes will occur ──\n')
  console.log('Plan:')
  for (const col of COLLECTIONS) {
    console.log(`  • Find docs in "${col}" where grade == "${FROM_GRADE}"`)
    console.log(`    For each: back up to backups/grade6_to_grade7/${col}/<id>,`)
    console.log(`    then set grade -> "${TO_GRADE}" on the original.`)
  }
  console.log('')
  console.log('Run with --live (and a service-account key) to actually perform the migration:')
  console.log('  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json')
  console.log('  node scripts/migrate-grade6-to-grade7.mjs --live')
  console.log('')
  console.log('Optional: --limit=N caps how many docs the live run will touch.')
}
