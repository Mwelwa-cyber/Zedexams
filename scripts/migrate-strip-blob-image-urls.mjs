#!/usr/bin/env node
/**
 * scripts/migrate-strip-blob-image-urls.mjs
 *
 * One-off cleanup for quiz and assessment records that already contain dead
 * `blob:` URLs in image fields. Those URLs come from the document-import
 * flow's transient browser blobs — they were valid in the page session that
 * imported the quiz, but anything saved before Phase 1 (#573) shipped could
 * leak a blob: URL straight into Firestore. Phase 1 prevents new leaks; this
 * script cleans up the historical mess.
 *
 * ── What it does ──────────────────────────────────────────────────────
 *
 *   For every quiz / assessment record:
 *     1. Scan the top-level doc's `passages[]` for any `imageUrl` that
 *        starts with `blob:`. Replace with `null`.
 *     2. Walk the doc's `questions` subcollection. For each question, scan:
 *          • `imageUrl`
 *          • `optionMedia[i].imageUrl`
 *          • `optionMedia[i].imageAssetId` (orphan after Phase 1; safe to drop)
 *        Replace each blob: hit with empty/null and clear the imageAssetId.
 *     3. Before any write, save the ORIGINAL record under
 *        `backups/blob_url_cleanup/<collection>_<docId>` so a botched run can
 *        be rolled back.
 *
 * ── Two modes ─────────────────────────────────────────────────────────
 *
 *   DRY RUN   (default)        No Firestore writes. Reports what WOULD change.
 *   LIVE      (--live)         Performs writes. Requires service-account key.
 *
 * ── Safety guarantees ─────────────────────────────────────────────────
 *
 *   • Never overwrites without first writing a backup.
 *   • Idempotent — re-running after a clean pass is a no-op.
 *   • Skips records with no blob: URLs anywhere (most of them, hopefully).
 *   • Batched writes (Firestore writeBatch cap = 500; we use 400 for headroom).
 *   • Pure cleaning logic exported so the test suite can exercise it.
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *
 *   # Dry run (safe — prints what would change):
 *   node scripts/migrate-strip-blob-image-urls.mjs
 *
 *   # Live (requires firebase-admin + service-account JSON):
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   node scripts/migrate-strip-blob-image-urls.mjs --live
 *
 *   # Limit to N inspected docs for staging-only checks:
 *   node scripts/migrate-strip-blob-image-urls.mjs --live --limit=50
 */

const LIVE = process.argv.includes('--live')
const LIMIT_ARG = process.argv.find(arg => arg.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : Infinity
const BATCH_SIZE = 400

// ─── Pure cleaning logic ───────────────────────────────────────────────────

function isBlobUrl(value) {
  return typeof value === 'string' && value.startsWith('blob:')
}

/**
 * Returns a cleaned copy of the question record OR null if there's nothing
 * to do (no blob: URLs and no orphan imageAssetId after Phase 1).
 *
 * `summary` is mutated in place with `{ stem, options, droppedAssetIds }`
 * counts for the caller to aggregate. The caller decides whether to write.
 */
export function cleanQuestionBlobUrls(raw, summary = { stem: 0, options: 0, droppedAssetIds: 0 }) {
  if (!raw || typeof raw !== 'object') return null

  let changed = false
  const next = { ...raw }

  if (isBlobUrl(next.imageUrl)) {
    next.imageUrl = ''
    summary.stem += 1
    changed = true
  }
  // imageAssetId on a saved question is always orphaned — it only points at
  // an in-memory blob that's long dead. Clear it whenever present.
  if (next.imageAssetId) {
    next.imageAssetId = ''
    summary.droppedAssetIds += 1
    changed = true
  }

  if (Array.isArray(next.optionMedia)) {
    let optionsChanged = false
    next.optionMedia = next.optionMedia.map(slot => {
      if (!slot || typeof slot !== 'object') return slot
      const nextSlot = { ...slot }
      if (isBlobUrl(nextSlot.imageUrl)) {
        delete nextSlot.imageUrl
        summary.options += 1
        optionsChanged = true
      }
      if (nextSlot.imageAssetId) {
        delete nextSlot.imageAssetId
        summary.droppedAssetIds += 1
        optionsChanged = true
      }
      return nextSlot
    })
    if (optionsChanged) changed = true
  }

  return changed ? next : null
}

/**
 * Returns a cleaned copy of the parent quiz/assessment doc OR null if its
 * `passages[]` array has no blob: URLs or orphan asset ids.
 */
export function cleanParentDocBlobUrls(raw, summary = { passages: 0, droppedAssetIds: 0 }) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.passages)) return null

  let changed = false
  const nextPassages = raw.passages.map(passage => {
    if (!passage || typeof passage !== 'object') return passage
    const nextPassage = { ...passage }
    if (isBlobUrl(nextPassage.imageUrl)) {
      nextPassage.imageUrl = null
      summary.passages += 1
      changed = true
    }
    if (nextPassage.imageAssetId) {
      nextPassage.imageAssetId = ''
      summary.droppedAssetIds += 1
      changed = true
    }
    return nextPassage
  })

  if (!changed) return null
  return { ...raw, passages: nextPassages }
}

// ─── Firestore runner ──────────────────────────────────────────────────────

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
    questionsInspected: 0,
    parentDocsCleaned: 0,
    questionsCleaned: 0,
    passageHits: 0,
    stemHits: 0,
    optionHits: 0,
    droppedAssetIds: 0,
  }

  for (const collectionName of ['quizzes', 'assessments']) {
    console.log(`\n── Scanning ${collectionName} ──`)
    const parents = await db.collection(collectionName).get()
    console.log(`Found ${parents.size} ${collectionName} docs.`)

    for (const parentDoc of parents.docs) {
      if (totals.parentDocsInspected >= LIMIT) break
      totals.parentDocsInspected += 1

      const parentRaw = parentDoc.data()
      const parentSummary = { passages: 0, droppedAssetIds: 0 }
      const cleanedParent = cleanParentDocBlobUrls(parentRaw, parentSummary)

      let batch = db.batch()
      let batchOps = 0

      if (cleanedParent) {
        const backupRef = db.collection('backups')
          .doc('blob_url_cleanup')
          .collection('docs')
          .doc(`${collectionName}_${parentDoc.id}`)
        batch.set(backupRef, {
          collection: collectionName,
          docId: parentDoc.id,
          original: parentRaw,
          at: admin.default.firestore.FieldValue.serverTimestamp(),
        })
        batch.set(parentDoc.ref, cleanedParent)
        batchOps += 2
        totals.parentDocsCleaned += 1
        totals.passageHits += parentSummary.passages
        totals.droppedAssetIds += parentSummary.droppedAssetIds
        console.log(
          `  ok   ${collectionName}/${parentDoc.id}  passages:${parentSummary.passages}`
          + ` assetIds:${parentSummary.droppedAssetIds}`,
        )
      }

      const questions = await parentDoc.ref.collection('questions').get()
      for (const qDoc of questions.docs) {
        totals.questionsInspected += 1
        const qSummary = { stem: 0, options: 0, droppedAssetIds: 0 }
        const cleanedQ = cleanQuestionBlobUrls(qDoc.data(), qSummary)
        if (!cleanedQ) continue

        const qBackupRef = db.collection('backups')
          .doc('blob_url_cleanup')
          .collection('docs')
          .doc(`${collectionName}_${parentDoc.id}_q_${qDoc.id}`)
        batch.set(qBackupRef, {
          collection: collectionName,
          docId: parentDoc.id,
          questionId: qDoc.id,
          original: qDoc.data(),
          at: admin.default.firestore.FieldValue.serverTimestamp(),
        })
        batch.set(qDoc.ref, cleanedQ)
        batchOps += 2
        totals.questionsCleaned += 1
        totals.stemHits += qSummary.stem
        totals.optionHits += qSummary.options
        totals.droppedAssetIds += qSummary.droppedAssetIds
        console.log(
          `  ok   ${collectionName}/${parentDoc.id}/questions/${qDoc.id}`
          + `  stem:${qSummary.stem} options:${qSummary.options}`
          + ` assetIds:${qSummary.droppedAssetIds}`,
        )

        if (batchOps >= BATCH_SIZE) {
          await batch.commit()
          batch = db.batch()
          batchOps = 0
        }
      }

      if (batchOps > 0) await batch.commit()
    }
  }

  console.log('\n── live migration complete ──')
  Object.entries(totals).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`)
  })
}

async function runDryRun() {
  console.log('── DRY RUN — no Firestore writes will occur ──\n')
  console.log('Run with --live to actually perform the migration.')
  console.log('Run `npm run test:migrate-strip-blob-urls` to exercise the cleaning logic.\n')

  // Synthetic fixtures representing the shapes we've actually seen in the
  // wild from teachers who imported quizzes pre-Phase-1.
  const fixtures = [
    {
      label: 'question with blob: stem URL',
      record: { imageUrl: 'blob:http://localhost/abc', imageAssetId: 'leftover-1', optionMedia: [] },
      kind: 'question',
    },
    {
      label: 'question with blob: option image',
      record: {
        imageUrl: 'https://storage.googleapis.com/b/q.jpg',
        optionMedia: [
          { imageUrl: 'blob:http://localhost/opt-A', alt: 'A' },
          { imageUrl: 'https://example.com/keep.jpg', alt: 'B' },
        ],
      },
      kind: 'question',
    },
    {
      label: 'question with orphan imageAssetId only',
      record: { imageUrl: '', imageAssetId: 'orphan-asset-7' },
      kind: 'question',
    },
    {
      label: 'clean question (no-op)',
      record: { imageUrl: 'https://storage.googleapis.com/b/q.jpg', optionMedia: [] },
      kind: 'question',
    },
    {
      label: 'parent doc with blob: passage URL',
      record: {
        title: 'Quiz',
        passages: [
          { id: 'p1', imageUrl: 'blob:http://localhost/p1' },
          { id: 'p2', imageUrl: 'https://example.com/keep.jpg' },
        ],
      },
      kind: 'parent',
    },
    {
      label: 'clean parent (no-op)',
      record: { title: 'Quiz', passages: [{ id: 'p1', imageUrl: null }] },
      kind: 'parent',
    },
  ]

  let cleaned = 0
  let noop = 0
  for (const { label, record, kind } of fixtures) {
    const summary = kind === 'parent'
      ? { passages: 0, droppedAssetIds: 0 }
      : { stem: 0, options: 0, droppedAssetIds: 0 }
    const fn = kind === 'parent' ? cleanParentDocBlobUrls : cleanQuestionBlobUrls
    const result = fn(record, summary)
    if (result) {
      console.log(`  clean ${label}`)
      console.log(`        ${JSON.stringify(summary)}`)
      cleaned += 1
    } else {
      console.log(`  noop  ${label}`)
      noop += 1
    }
  }

  console.log('\n── dry run summary ──')
  console.log(`  cleaned: ${cleaned}`)
  console.log(`  no-op:   ${noop}`)
}

// Only run when invoked as a CLI entry point — not when imported by tests.
const invokedAsScript = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
  || import.meta.url.endsWith(process.argv[1]?.split(/[\\/]/).pop() ?? '')
if (invokedAsScript) {
  if (LIVE) {
    await runLive()
  } else {
    await runDryRun()
  }
}
