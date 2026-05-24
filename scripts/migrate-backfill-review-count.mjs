#!/usr/bin/env node
/**
 * scripts/migrate-backfill-review-count.mjs
 *
 * Phase 10 backfill. Walks every quiz / assessment doc, counts the number
 * of questions in its `questions` subcollection whose `requiresReview` is
 * true, and writes that number back to the parent doc as `reviewCount`.
 *
 * Why we need it: Phase 10 wires every save path to persist reviewCount,
 * but existing docs (saved before Phase 10) have no value set. The badge,
 * chip, and banner all fall back to the legacy boolean signal in that
 * case — fine, but the new "X to review" labels never appear until each
 * doc is touched again. This script kicks every parent into the new
 * shape so the UI lights up immediately for everyone.
 *
 * ── Two modes ─────────────────────────────────────────────────────────
 *
 *   DRY RUN   (default)        No writes. Prints what would change.
 *   LIVE      (--live)         Performs writes. Requires service-account key.
 *
 * ── Safety ────────────────────────────────────────────────────────────
 *
 *   • Skips parents that already have a numeric reviewCount AND no
 *     question-level discrepancy — re-running is idempotent.
 *   • Backs up the original doc under
 *     backups/review_count_backfill/<collection>_<docId> before any write.
 *   • Batched (400 ops; Firestore limit is 500).
 *   • --limit=N caps inspected parents for staging spot-checks.
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *
 *   node scripts/migrate-backfill-review-count.mjs                # dry run
 *   node scripts/migrate-backfill-review-count.mjs --live         # writes
 *   node scripts/migrate-backfill-review-count.mjs --live --limit=20
 */

const LIVE = process.argv.includes('--live')
const LIMIT_ARG = process.argv.find(arg => arg.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : Infinity
const BATCH_SIZE = 400

// ─── Pure logic ───────────────────────────────────────────────────────────

/**
 * Returns the number of questions in the array that still carry
 * requiresReview === true. Defensive against non-object entries.
 */
export function countQuestionsNeedingReview(questions = []) {
  if (!Array.isArray(questions)) return 0
  return questions.reduce((count, q) => (q && q.requiresReview === true ? count + 1 : count), 0)
}

/**
 * Returns the {reviewCount, shouldWrite} verdict for a parent doc. We
 * skip the write when the persisted value already matches the freshly
 * counted one — keeps re-runs cheap and idempotent.
 */
export function decideBackfill(parentRaw, questions = []) {
  const fresh = countQuestionsNeedingReview(questions)
  const persisted = parentRaw && Number.isFinite(Number(parentRaw.reviewCount))
    ? Number(parentRaw.reviewCount)
    : null
  return {
    reviewCount: fresh,
    shouldWrite: persisted !== fresh,
  }
}

// ─── Firestore runner ─────────────────────────────────────────────────────

async function runLive() {
  let admin
  try {
    admin = await import('firebase-admin')
  } catch {
    console.error('ERROR: --live requires `npm install --save-dev firebase-admin`')
    process.exit(1)
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('ERROR: set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path')
    process.exit(1)
  }

  admin.default.initializeApp()
  const db = admin.default.firestore()

  const totals = {
    parentDocsInspected: 0,
    parentDocsWritten: 0,
    parentDocsAlreadyClean: 0,
    totalFlaggedQuestionsFound: 0,
  }

  for (const collectionName of ['quizzes', 'assessments']) {
    console.log(`\n── Scanning ${collectionName} ──`)
    const parents = await db.collection(collectionName).get()
    console.log(`Found ${parents.size} ${collectionName} docs.`)

    let batch = db.batch()
    let batchOps = 0

    for (const parentDoc of parents.docs) {
      if (totals.parentDocsInspected >= LIMIT) break
      totals.parentDocsInspected += 1

      const parentRaw = parentDoc.data()
      const questionsSnap = await parentDoc.ref.collection('questions').get()
      const questions = questionsSnap.docs.map(d => d.data())
      const { reviewCount, shouldWrite } = decideBackfill(parentRaw, questions)

      if (!shouldWrite) {
        totals.parentDocsAlreadyClean += 1
        continue
      }

      const backupRef = db.collection('backups')
        .doc('review_count_backfill')
        .collection('docs')
        .doc(`${collectionName}_${parentDoc.id}`)
      batch.set(backupRef, {
        collection: collectionName,
        docId: parentDoc.id,
        previousReviewCount: parentRaw.reviewCount ?? null,
        newReviewCount: reviewCount,
        questionCount: questions.length,
        at: admin.default.firestore.FieldValue.serverTimestamp(),
      })
      batch.update(parentDoc.ref, { reviewCount })
      batchOps += 2
      totals.parentDocsWritten += 1
      totals.totalFlaggedQuestionsFound += reviewCount
      console.log(
        `  ok   ${collectionName}/${parentDoc.id}  reviewCount: `
        + `${parentRaw.reviewCount ?? '∅'} → ${reviewCount}`,
      )

      if (batchOps >= BATCH_SIZE) {
        await batch.commit()
        batch = db.batch()
        batchOps = 0
      }
    }

    if (batchOps > 0) await batch.commit()
  }

  console.log('\n── live backfill complete ──')
  Object.entries(totals).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`)
  })
}

async function runDryRun() {
  console.log('── DRY RUN — no Firestore writes will occur ──\n')
  console.log('Run with --live to actually perform the backfill.')
  console.log('Run `npm run test:migrate-backfill-review-count` to exercise the pure logic.\n')

  const fixtures = [
    {
      label: 'parent missing reviewCount, 3 questions flagged',
      parent: { title: 'Q1', mode: 'imported_document', importStatus: 'needs_review' },
      questions: [
        { requiresReview: true }, { requiresReview: true }, { requiresReview: false },
        { requiresReview: true }, { requiresReview: false },
      ],
    },
    {
      label: 'parent already at the right count (no-op)',
      parent: { title: 'Q2', mode: 'imported_document', reviewCount: 2 },
      questions: [{ requiresReview: true }, { requiresReview: true }, {}],
    },
    {
      label: 'all flags cleared since last save',
      parent: { title: 'Q3', mode: 'imported_document', reviewCount: 4 },
      questions: [{}, {}, { requiresReview: false }, {}],
    },
  ]

  let writes = 0
  let noops = 0
  for (const { label, parent, questions } of fixtures) {
    const { reviewCount, shouldWrite } = decideBackfill(parent, questions)
    if (shouldWrite) {
      console.log(`  write ${label}  → reviewCount ${parent.reviewCount ?? '∅'} → ${reviewCount}`)
      writes += 1
    } else {
      console.log(`  noop  ${label}  (already at ${reviewCount})`)
      noops += 1
    }
  }

  console.log(`\n── dry run summary ──`)
  console.log(`  writes: ${writes}`)
  console.log(`  noops:  ${noops}`)
}

// Only run as a CLI entry point.
const invokedAsScript = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
  || import.meta.url.endsWith(process.argv[1]?.split(/[\\/]/).pop() ?? '')
if (invokedAsScript) {
  if (LIVE) {
    await runLive()
  } else {
    await runDryRun()
  }
}
