/**
 * retire-daily-exams — return every still-pinned Daily Exam to the library.
 *
 *   npm run retire:daily-exams:dry     # report only (the default)
 *   npm run retire:daily-exams:live    # apply
 *
 * ── Why this has to be run once ──────────────────────────────────────
 *
 * The Daily Exam rotation worked in two halves: each morning
 * `autoPickDailyExams` PROMOTED one exam paper per grade into the day's slot
 * (`quizType: 'daily_exam'`, `isDailyExam: true`, `dailyExamDate: today`) and
 * DEMOTED the previous day's pick back to its resting classification.
 *
 * The Daily Quiz replaced that cron, so the demote half stopped running too —
 * and whatever was pinned on the last morning it fired is pinned FOREVER.
 * That is not cosmetic. `firestore.rules` blocks all client reads of a
 * daily-exam quiz's questions (the answer-key closure the daily exam needed),
 * so a paper left in that state is unreachable from the practice library: a
 * learner who opens it gets a permission error, not a quiz. Nothing else will
 * ever clear it, because the code that used to has been deleted.
 *
 * This applies the same demotion patch the retired picker used, so the
 * outcome is identical to the one those documents would have had on the next
 * morning that never came:
 *
 *   • an exam paper (questionCount >= 50, or examOnly === true) →
 *     `quizType: null` — the exam-only pool. NOT 'practice', which would leak
 *     a 50-plus-question paper into the short-quiz library.
 *   • a short quiz an admin once pinned by hand → `quizType: 'practice'`.
 *
 * `lastDailyExamDate` is deliberately KEPT. It is a record of what was
 * served and when, it is what the old rotation used for fairness, and
 * deleting history is not part of retiring a mechanism.
 */
import process from 'node:process'
import admin from 'firebase-admin'

const LIVE = process.argv.includes('--live')
const EXAM_QUESTION_THRESHOLD = 50

/**
 * Mirrors the retired `dailyExamPickerCore.isExamPaper`. An explicit boolean
 * `examOnly` flag is authoritative (an admin can declassify a long quiz or
 * classify a short one); legacy docs without it fall back to the count.
 *
 * It is inlined rather than imported because that module was deleted with the
 * feature — copying seven lines into a one-off script is better than keeping
 * a dead module alive to serve it.
 */
function isExamPaper(data) {
  if (typeof data?.examOnly === 'boolean') return data.examOnly
  return Number(data?.questionCount) >= EXAM_QUESTION_THRESHOLD
}

function demotionPatch(data) {
  return {
    quizType: isExamPaper(data) ? null : 'practice',
    isDailyExam: false,
    dailyExamDate: null,
  }
}

async function main() {
  if (!admin.apps.length) admin.initializeApp()
  const db = admin.firestore()

  // Two queries, because a half-cleared document is exactly what a crashed
  // run leaves behind and it must still be findable. A doc with
  // `quizType: 'daily_exam'` but `isDailyExam: false` is invisible to the
  // other query and is still broken.
  const seen = new Map()
  for (const [field, value] of [['quizType', 'daily_exam'], ['isDailyExam', true]]) {
    const snap = await db.collection('quizzes').where(field, '==', value).get()
    for (const d of snap.docs) seen.set(d.id, d)
  }

  if (seen.size === 0) {
    console.log('retire-daily-exams: nothing pinned — already clear.')
    return
  }

  console.log(`retire-daily-exams: ${seen.size} pinned quiz(zes) found`)
  console.log(LIVE ? '  MODE: LIVE — writing changes' : '  MODE: DRY RUN — no writes (pass --live to apply)')
  console.log('')

  let exams = 0
  let practice = 0
  const batchLimit = 400
  let batch = db.batch()
  let pending = 0

  for (const doc of seen.values()) {
    const data = doc.data() || {}
    const patch = demotionPatch(data)
    if (patch.quizType === null) exams += 1
    else practice += 1

    console.log(
      `  ${doc.id}  grade=${data.grade ?? '?'}  q=${data.questionCount ?? '?'}  ` +
      `pinned=${data.dailyExamDate ?? '?'}  →  quizType=${patch.quizType ?? 'null (exam-only)'}`,
    )

    if (LIVE) {
      batch.update(doc.ref, patch)
      pending += 1
      if (pending >= batchLimit) {
        await batch.commit()
        batch = db.batch()
        pending = 0
      }
    }
  }
  if (LIVE && pending > 0) await batch.commit()

  console.log('')
  console.log(`  ${exams} returned to the exam-only pool, ${practice} to practice`)
  console.log(LIVE ? '  Done.' : '  Dry run — nothing was written.')
}

main().catch((err) => {
  console.error('retire-daily-exams failed:', err)
  process.exit(1)
})
