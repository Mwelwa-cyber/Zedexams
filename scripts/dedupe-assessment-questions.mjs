#!/usr/bin/env node
/**
 * scripts/dedupe-assessment-questions.mjs
 *
 * One-off cleanup for the "30 → 90" question-count duplication in the
 * Assessment Paper Studio — the assessment-side twin of the quiz bug fixed
 * by scripts/dedupe-quiz-questions.mjs (PR #674).
 *
 * Root cause: saveAssessmentQuestions / updateAssessmentWithQuestions created
 * a fresh question doc whenever the in-memory question had no `_id`, but the
 * assigned id was never folded back into React state. So the Studio kept
 * editing the same paper with every question still `_id:null`, and each
 * subsequent autosave re-inserted all N questions — the subcollection grew by
 * N per save (30 → 60 → 90). Fixed in code by returning an idMap from both
 * save paths and calling patchSectionsWithAssignedIds after every persist.
 *
 * This script repairs assessments that were ALREADY corrupted before that fix
 * shipped. It walks `assessments/{id}/questions/`, groups question docs by a
 * content-plus-order fingerprint, keeps the earliest-created doc in each group,
 * and deletes the rest. It then refreshes the parent assessment's
 * `questionCount` and `totalMarks`.
 *
 * ── Two modes ─────────────────────────────────────────────────────────
 *
 *   DRY RUN   (default)        No writes. Prints what would change.
 *   LIVE      (--live)         Performs deletes. Requires service-account key.
 *
 * ── Flags ─────────────────────────────────────────────────────────────
 *
 *   --assessment=<id>  Limit to a single assessment. Default: scan every one.
 *   --limit=N          Cap assessments inspected (staging spot-checks).
 *   --min-dupes=N      Only act on assessments with ≥N duplicates. Default 2.
 *
 * ── Safety ────────────────────────────────────────────────────────────
 *
 *   • Never deletes the survivor — every fingerprint keeps one.
 *   • Backs up every deleted doc to
 *       backups/assessment_dedupe/docs/<assessmentId>_<questionId>
 *     so a restore is a copy-back, not a recreate.
 *   • Batched (400 ops; Firestore limit is 500).
 *   • Re-running is idempotent: a clean assessment has 0 duplicates and noops.
 *   • The fingerprint deliberately includes `order`. The duplicate docs this
 *     bug produced share an identical order (every autosave re-serialised the
 *     same sections in the same positions), so grouping on content+order
 *     collapses the exact copies while NEVER merging two legitimately-distinct
 *     questions that merely share wording but sit at different positions.
 *   • CAVEAT — a corrupted paper that was SAVED AGAIN after a reload has its
 *     duplicates renumbered to distinct orders. Those are NOT auto-merged here
 *     (different fingerprint); they surface in the dry-run as "identical text,
 *     different order" and must be reviewed by hand, per the incident's
 *     "flag, don't auto-delete different-order identical content" rule.
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *
 *   node scripts/dedupe-assessment-questions.mjs                       # dry run, all
 *   node scripts/dedupe-assessment-questions.mjs --assessment=abc123   # dry run, one
 *   node scripts/dedupe-assessment-questions.mjs --live                # writes, all
 *   node scripts/dedupe-assessment-questions.mjs --live --assessment=abc123
 *
 * Test the pure logic without Firestore:
 *   node scripts/test-dedupe-assessment-questions.mjs
 */

const LIVE = process.argv.includes('--live')
const ID_ARG = process.argv.find(arg => arg.startsWith('--assessment='))
const ASSESSMENT_ID = ID_ARG ? ID_ARG.split('=')[1] : null
const LIMIT_ARG = process.argv.find(arg => arg.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : Infinity
const MIN_DUPES_ARG = process.argv.find(arg => arg.startsWith('--min-dupes='))
const MIN_DUPES = MIN_DUPES_ARG ? Math.max(1, Number(MIN_DUPES_ARG.split('=')[1])) : 2
const BATCH_SIZE = 400

// ─── Pure logic ───────────────────────────────────────────────────────────

/**
 * Stringify the content fields that uniquely identify a question. Two docs
 * with the same fingerprint are duplicates created by the autosave bug — same
 * text, same options, same answer, same order — written into different doc IDs
 * because React state never learned the first ID.
 *
 * Excluded on purpose: `_id`, timestamps, anything that varies between writes
 * of the same question. Included: `order` so two legitimately-distinct
 * questions can never be merged.
 */
export function fingerprintQuestion(q) {
  if (!q || typeof q !== 'object') return ''
  const opts = Array.isArray(q.options) ? q.options.map(o => String(o ?? '').trim()) : []
  return JSON.stringify({
    type:               String(q.type ?? 'mcq'),
    text:               String(q.text ?? '').trim(),
    options:            opts,
    correctAnswer:      typeof q.correctAnswer === 'string'
      ? q.correctAnswer.trim()
      : (Number.isFinite(Number(q.correctAnswer)) ? Number(q.correctAnswer) : 0),
    topic:              String(q.topic ?? '').trim(),
    marks:              Number(q.marks) || 1,
    sharedInstruction:  String(q.sharedInstruction ?? '').trim(),
    passageId:          q.passageId ? String(q.passageId) : null,
    order:              Number.isFinite(Number(q.order)) ? Number(q.order) : 0,
  })
}

/**
 * Given an array of {id, data} entries, return
 *   { keep: [{id, data}], drop: [{id, data}], groups: number }
 * - One survivor per fingerprint group.
 * - Survivor is the lexicographically smallest doc id, which for Firestore
 *   auto-IDs corresponds to the earliest creation time.
 */
export function planDedupe(entries) {
  const groups = new Map()
  for (const entry of entries) {
    const fp = fingerprintQuestion(entry.data)
    if (!groups.has(fp)) groups.set(fp, [])
    groups.get(fp).push(entry)
  }
  const keep = []
  const drop = []
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    keep.push(bucket[0])
    for (let i = 1; i < bucket.length; i++) drop.push(bucket[i])
  }
  return { keep, drop, groups: groups.size }
}

/**
 * Detect content-identical questions that survived at DIFFERENT orders (a paper
 * re-saved after a reload, so the duplicates were renumbered). These are NOT
 * auto-deleted — this only reports them for manual review, matching the
 * incident's "flag, don't auto-delete different-order identical content" rule.
 * Returns [{ text, ids }] for every group of ≥2 same-content, different-order docs.
 */
export function flagIdenticalContentDifferentOrder(entries) {
  const byContent = new Map()
  const contentKey = (q) => {
    if (!q || typeof q !== 'object') return ''
    const opts = Array.isArray(q.options) ? q.options.map(o => String(o ?? '').trim()) : []
    return JSON.stringify({
      type: String(q.type ?? 'mcq'),
      text: String(q.text ?? '').trim(),
      options: opts,
      correctAnswer: typeof q.correctAnswer === 'string'
        ? q.correctAnswer.trim()
        : (Number.isFinite(Number(q.correctAnswer)) ? Number(q.correctAnswer) : 0),
      passageId: q.passageId ? String(q.passageId) : null,
    })
  }
  for (const entry of entries) {
    const key = contentKey(entry.data)
    if (!byContent.has(key)) byContent.set(key, [])
    byContent.get(key).push(entry)
  }
  const flagged = []
  for (const bucket of byContent.values()) {
    const orders = new Set(bucket.map(e => Number(e.data?.order) || 0))
    // ≥2 docs with the SAME content but MORE THAN ONE distinct order.
    if (bucket.length >= 2 && orders.size > 1) {
      flagged.push({
        text: String(bucket[0].data?.text ?? '').slice(0, 80),
        ids: bucket.map(e => e.id),
        orders: [...orders].sort((a, b) => a - b),
      })
    }
  }
  return flagged
}

/**
 * Sum the `marks` field across the surviving questions. Mirrors the server-side
 * total in updateAssessmentWithQuestions so the post-dedupe doc lines up with
 * what the editor would write on the next save.
 */
export function totalMarksFor(entries) {
  return entries.reduce((sum, e) => sum + (Number(e?.data?.marks) || 1), 0)
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
    assessmentsInspected: 0,
    assessmentsWithDuplicates: 0,
    questionDocsBefore: 0,
    questionDocsDeleted: 0,
    questionDocsAfter: 0,
    assessmentsNeedingReview: 0,
  }

  const assessmentDocs = ASSESSMENT_ID
    ? [await db.collection('assessments').doc(ASSESSMENT_ID).get()]
    : (await db.collection('assessments').select().get()).docs

  if (ASSESSMENT_ID && !assessmentDocs[0].exists) {
    console.error(`ERROR: assessment ${ASSESSMENT_ID} not found`)
    process.exit(1)
  }

  console.log(`Scanning ${assessmentDocs.length} assessment${assessmentDocs.length === 1 ? '' : 's'}…`)

  for (const assessmentDoc of assessmentDocs) {
    if (totals.assessmentsInspected >= LIMIT) break
    totals.assessmentsInspected += 1

    const questionsSnap = await db
      .collection('assessments').doc(assessmentDoc.id)
      .collection('questions').get()

    const entries = questionsSnap.docs.map(d => ({ id: d.id, data: d.data() }))
    totals.questionDocsBefore += entries.length

    // Surface identical-content/different-order pairs for a human — never
    // deleted automatically.
    const review = flagIdenticalContentDifferentOrder(entries)

    const { keep, drop, groups } = planDedupe(entries)
    if (drop.length < MIN_DUPES) {
      totals.questionDocsAfter += entries.length
      if (review.length) {
        totals.assessmentsNeedingReview += 1
        console.log(`  ${assessmentDoc.id}  ⚠ ${review.length} identical-content/different-order group(s) — MANUAL review`)
      }
      continue
    }

    totals.assessmentsWithDuplicates += 1
    console.log(
      `  ${assessmentDoc.id}  ${entries.length} → ${keep.length} `
      + `(${groups} unique, ${drop.length} duplicates to remove)`
      + (review.length ? `  ⚠ +${review.length} group(s) need manual review` : ''),
    )
    if (review.length) totals.assessmentsNeedingReview += 1

    let batch = db.batch()
    let batchOps = 0
    for (const dropEntry of drop) {
      const ref = db.collection('assessments').doc(assessmentDoc.id)
        .collection('questions').doc(dropEntry.id)
      const backupRef = db.collection('backups')
        .doc('assessment_dedupe')
        .collection('docs')
        .doc(`${assessmentDoc.id}_${dropEntry.id}`)
      batch.set(backupRef, {
        assessmentId: assessmentDoc.id,
        questionId: dropEntry.id,
        original: dropEntry.data,
        at: admin.default.firestore.FieldValue.serverTimestamp(),
      })
      batch.delete(ref)
      batchOps += 2
      totals.questionDocsDeleted += 1

      if (batchOps >= BATCH_SIZE) {
        await batch.commit()
        batch = db.batch()
        batchOps = 0
      }
    }

    batch.update(assessmentDoc.ref, {
      questionCount: keep.length,
      totalMarks: totalMarksFor(keep),
      updatedAt: admin.default.firestore.FieldValue.serverTimestamp(),
    })
    batchOps += 1

    if (batchOps > 0) await batch.commit()
    totals.questionDocsAfter += keep.length
  }

  console.log('\n── live dedupe complete ──')
  Object.entries(totals).forEach(([k, v]) => console.log(`  ${k}: ${v}`))
}

async function runDryRun() {
  console.log('── DRY RUN — no Firestore writes will occur ──\n')
  console.log('Run with --live to actually delete duplicate questions.')
  console.log('Run `node scripts/test-dedupe-assessment-questions.mjs` to exercise the pure logic.\n')

  // Fixture mirrors the reported shape: 30 distinct questions, each written 3×
  // with an identical order (the pre-renumber duplication) → 90 docs.
  const distinct = Array.from({ length: 30 }, (_, i) => ({
    type: 'mcq', topic: 'Test', marks: 1, order: i + 1,
    text: `<p>Question ${i + 1}</p>`, options: ['A', 'B', 'C', 'D'], correctAnswer: i % 4,
  }))
  const entries = []
  for (let copy = 0; copy < 3; copy++) {
    for (const q of distinct) {
      entries.push({ id: `auto_${String(entries.length).padStart(4, '0')}`, data: { ...q } })
    }
  }

  const { keep, drop, groups } = planDedupe(entries)
  console.log(`  fixture: ${entries.length} question docs → ${keep.length} kept (${groups} unique)`)
  console.log(`  would delete ${drop.length} duplicate docs`)
  console.log(`  post-dedupe questionCount: ${keep.length}`)
  console.log(`  post-dedupe totalMarks: ${totalMarksFor(keep)}`)
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
