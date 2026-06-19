/**
 * One-time backfill for the learner quiz-library mirror (quizSummaries).
 *
 * The onQuizWritten Cloud Function (functions/quizSummary/index.js) keeps a
 * lightweight quizSummaries/{id} mirror — the quiz doc minus the heavy
 * passages[]/parts[]/description — in sync for every FUTURE write. This script
 * populates the mirror for quizzes that already exist, then (separately) flips
 * the read cutover flag so useFirestore.getQuizzes starts reading the mirror.
 *
 * Staged + reversible by design:
 *   node scripts/backfill-quiz-summaries.mjs            # dry run — counts only
 *   node scripts/backfill-quiz-summaries.mjs --apply    # write every mirror doc
 *   node scripts/backfill-quiz-summaries.mjs --enable   # flip the read cutover
 *   node scripts/backfill-quiz-summaries.mjs --apply --enable   # both
 *
 * Recommended order: run --apply, eyeball quizSummaries in the console, THEN
 * run --enable. To roll back instantly at any time, set
 * settings/quizLibrary.useSummaries = false (or --disable here).
 *
 * Run authenticated against examsprepzambia (firebase login OR
 * GOOGLE_APPLICATION_CREDENTIALS), same as the other scripts/*.mjs backfills.
 */

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as fs from 'fs'

const APPLY = process.argv.includes('--apply')
const ENABLE = process.argv.includes('--enable')
const DISABLE = process.argv.includes('--disable')

// Heavy fields dropped from the mirror — must match functions/quizSummary
// (HEAVY_FIELDS). These are the large arrays/strings the library never renders.
const HEAVY_FIELDS = ['passages', 'parts', 'description']

function buildQuizSummary(data) {
  const out = {}
  for (const [key, value] of Object.entries(data || {})) {
    if (HEAVY_FIELDS.includes(key)) continue
    out[key] = value
  }
  return out
}

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

async function backfill() {
  const snap = await db.collection('quizzes').get()
  console.log(`found ${snap.size} quiz doc(s)`)
  if (!APPLY) {
    console.log('dry run — pass --apply to write quizSummaries')
    return
  }
  // Firestore caps writeBatch at 500 ops; chunk well under it.
  let written = 0
  let batch = db.batch()
  let inBatch = 0
  for (const doc of snap.docs) {
    batch.set(db.collection('quizSummaries').doc(doc.id), buildQuizSummary(doc.data()))
    inBatch += 1
    written += 1
    if (inBatch >= 400) {
      await batch.commit()
      batch = db.batch()
      inBatch = 0
      console.log(`  …${written} written`)
    }
  }
  if (inBatch > 0) await batch.commit()
  console.log(`wrote ${written} mirror doc(s) to quizSummaries`)
}

async function flipFlag(value) {
  await db.collection('settings').doc('quizLibrary').set({ useSummaries: value }, { merge: true })
  console.log(`settings/quizLibrary.useSummaries = ${value}  (library now reads ${value ? 'quizSummaries' : 'quizzes'})`)
}

async function main() {
  await backfill()
  if (ENABLE && DISABLE) {
    console.error('pass only one of --enable / --disable')
    process.exit(1)
  }
  if (ENABLE) await flipFlag(true)
  if (DISABLE) await flipFlag(false)
  if (!ENABLE && !DISABLE) {
    console.log('cutover flag unchanged — run with --enable once the mirror looks right')
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('error:', err)
  process.exit(1)
})
