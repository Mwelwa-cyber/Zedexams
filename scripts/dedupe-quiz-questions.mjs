#!/usr/bin/env node
/**
 * scripts/dedupe-quiz-questions.mjs
 *
 * One-off cleanup for the "60 → 2000" question-count explosion fixed in
 * PR #674 (commit f7a331e). Before the fix, every auto-save of a freshly
 * imported quiz re-created every question instead of updating in place,
 * so the questions subcollection accumulated N × the real count.
 *
 * This script walks `quizzes/{quizId}/questions/`, groups the question
 * docs by a content fingerprint, keeps the earliest-created doc in each
 * group, and deletes the rest. It then refreshes the parent quiz's
 * `questionCount` and `totalMarks` so the Studio counter ("2280 questions
 * in the linked quiz") drops back to the truth.
 *
 * ── Two modes ─────────────────────────────────────────────────────────
 *
 *   DRY RUN   (default)        No writes. Prints what would change.
 *   LIVE      (--live)         Performs deletes. Requires service-account key.
 *
 * ── Flags ─────────────────────────────────────────────────────────────
 *
 *   --quiz=<id>      Limit to a single quiz. Default: scan every quiz.
 *   --limit=N        Cap quizzes inspected (staging spot-checks).
 *   --min-dupes=N    Only act on quizzes with ≥N duplicates. Default 2.
 *
 * ── Safety ────────────────────────────────────────────────────────────
 *
 *   • Never deletes the survivor — by definition every fingerprint keeps one.
 *   • Backs up every deleted doc to
 *       backups/question_dedupe/<quizId>_<questionId>
 *     so a restore is a copy-back, not a recreate.
 *   • Batched (400 ops; Firestore limit is 500).
 *   • Re-running is idempotent: a clean quiz has 0 duplicates and noops.
 *   • The fingerprint deliberately includes `order` so two legitimately
 *     distinct questions that happen to share text but sit at different
 *     positions are NEVER collapsed.
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *
 *   node scripts/dedupe-quiz-questions.mjs                  # dry run, all quizzes
 *   node scripts/dedupe-quiz-questions.mjs --quiz=abc123    # dry run, one quiz
 *   node scripts/dedupe-quiz-questions.mjs --live           # writes, all quizzes
 *   node scripts/dedupe-quiz-questions.mjs --live --quiz=abc123
 *
 * Test the pure logic without Firestore:
 *   node scripts/test-dedupe-quiz-questions.mjs
 */

const LIVE = process.argv.includes('--live')
const QUIZ_ARG = process.argv.find(arg => arg.startsWith('--quiz='))
const QUIZ_ID = QUIZ_ARG ? QUIZ_ARG.split('=')[1] : null
const LIMIT_ARG = process.argv.find(arg => arg.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : Infinity
const MIN_DUPES_ARG = process.argv.find(arg => arg.startsWith('--min-dupes='))
const MIN_DUPES = MIN_DUPES_ARG ? Math.max(1, Number(MIN_DUPES_ARG.split('=')[1])) : 2
const BATCH_SIZE = 400

// ─── Pure logic ───────────────────────────────────────────────────────────

/**
 * Stringify the content fields that uniquely identify a question. Two
 * docs with the same fingerprint are duplicates created by the auto-save
 * bug — same text, same options, same answer, same order, written into
 * different doc IDs because the React state never learned its first ID.
 *
 * Excluded on purpose: `_id`, timestamps, anything that varies between
 * Firestore writes of the same question. Included: `order` so that two
 * legitimately distinct questions can never be merged.
 */
export function fingerprintQuestion(q) {
  if (!q || typeof q !== 'object') return ''
  const opts = Array.isArray(q.options) ? q.options.map(o => String(o ?? '').trim()) : []
  // Stable, order-preserving JSON so equal questions hash identical.
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
 * Given an array of {id, data} entries, return:
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
 * Sum the `marks` field across the surviving questions. Mirrors the
 * server-side total computed in useFirestore.updateQuizWithQuestions so
 * the post-dedupe quiz doc lines up with what the editor would write on
 * the next save.
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
    quizzesInspected: 0,
    quizzesWithDuplicates: 0,
    questionDocsBefore: 0,
    questionDocsDeleted: 0,
    questionDocsAfter: 0,
  }

  const quizDocs = QUIZ_ID
    ? [await db.collection('quizzes').doc(QUIZ_ID).get()]
    : (await db.collection('quizzes').select().get()).docs

  if (QUIZ_ID && !quizDocs[0].exists) {
    console.error(`ERROR: quiz ${QUIZ_ID} not found`)
    process.exit(1)
  }

  console.log(`Scanning ${quizDocs.length} quiz${quizDocs.length === 1 ? '' : 'es'}…`)

  for (const quizDoc of quizDocs) {
    if (totals.quizzesInspected >= LIMIT) break
    totals.quizzesInspected += 1

    const questionsSnap = await db
      .collection('quizzes').doc(quizDoc.id)
      .collection('questions').get()

    const entries = questionsSnap.docs.map(d => ({ id: d.id, data: d.data() }))
    totals.questionDocsBefore += entries.length

    const { keep, drop, groups } = planDedupe(entries)
    if (drop.length < MIN_DUPES) {
      totals.questionDocsAfter += entries.length
      continue
    }

    totals.quizzesWithDuplicates += 1
    console.log(
      `  ${quizDoc.id}  ${entries.length} → ${keep.length} `
      + `(${groups} unique, ${drop.length} duplicates to remove)`,
    )

    let batch = db.batch()
    let batchOps = 0
    for (const dropEntry of drop) {
      const ref = db.collection('quizzes').doc(quizDoc.id)
        .collection('questions').doc(dropEntry.id)
      const backupRef = db.collection('backups')
        .doc('question_dedupe')
        .collection('docs')
        .doc(`${quizDoc.id}_${dropEntry.id}`)
      batch.set(backupRef, {
        quizId: quizDoc.id,
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

    // Refresh the parent quiz's count / total so the Studio "Refresh count"
    // button and any cached UI line up with reality.
    batch.update(quizDoc.ref, {
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
  console.log('Run `node scripts/test-dedupe-quiz-questions.mjs` to exercise the pure logic.\n')

  // Fixture mirrors the production shape: 3 distinct questions, each
  // repeated 4× as the auto-save bug would have created them.
  const base = (order, text, correctAnswer) => ({
    type: 'mcq', topic: 'Fractions', marks: 1, order,
    text, options: ['1/2', '1/3', '1/4', '1/5'], correctAnswer,
  })
  const distinct = [
    base(1, '<p>What is half of 4?</p>', 0),
    base(2, '<p>What is a third of 9?</p>', 1),
    base(3, '<p>What is a quarter of 8?</p>', 2),
  ]
  const entries = []
  for (let copy = 0; copy < 4; copy++) {
    for (const q of distinct) {
      // Doc id mimics Firestore auto-IDs (lexicographic time order).
      entries.push({ id: `auto_${String(entries.length).padStart(4, '0')}`, data: { ...q } })
    }
  }

  const { keep, drop, groups } = planDedupe(entries)
  console.log(`  fixture: ${entries.length} question docs → ${keep.length} kept (${groups} unique)`)
  console.log(`  would delete ${drop.length} duplicate docs`)
  console.log(`  survivors (smallest doc id per group):`)
  for (const k of keep) {
    console.log(`    keep ${k.id}  order=${k.data.order}  marks=${k.data.marks}`)
  }
  console.log(`\n  post-dedupe totalMarks: ${totalMarksFor(keep)}`)
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
