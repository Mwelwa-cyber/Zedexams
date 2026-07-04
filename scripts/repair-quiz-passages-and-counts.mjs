/**
 * Non-destructive repair for quizzes whose cached counts / passages drifted out
 * of sync with their authoritative questions subcollection.
 *
 * Symptom this fixes: a past-paper quiz shows "0 Q" in /admin/content while its
 * "Needs review · N to review" badge (and the questions subcollection) says it
 * still has N questions — and its comprehension passages look lost. The card
 * reads the denormalised questionCount / passages[] on the parent doc, which
 * can go stale; the real questions and their passageId links survive in
 * quizzes/{id}/questions.
 *
 * What it does, per quiz:
 *   - Recounts questionCount / totalMarks / reviewCount / passageCount from the
 *     questions subcollection (the source of truth).
 *   - Rebuilds any passage a question still references but the parent doc has
 *     dropped, restoring the passage text from inline question copies where they
 *     survive (else a labelled stub so the questions stay grouped).
 *
 * It is STRICTLY ADDITIVE — it never deletes a quiz, a question, a passage, or
 * any other field. It only fixes counts and restores missing/blank passages.
 *
 * Staged + reversible by design:
 *   node scripts/repair-quiz-passages-and-counts.mjs                 # dry run — report only
 *   node scripts/repair-quiz-passages-and-counts.mjs --apply         # write the repairs
 *   node scripts/repair-quiz-passages-and-counts.mjs --quiz <id>     # scope to one quiz (dry run)
 *   node scripts/repair-quiz-passages-and-counts.mjs --quiz <id> --apply
 *
 * Run authenticated against examsprepzambia (firebase login OR
 * GOOGLE_APPLICATION_CREDENTIALS), same as the other scripts/*.mjs backfills.
 */

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as fs from 'fs'
import { planQuizRepair } from './repairQuizPassagesCore.mjs'

const APPLY = process.argv.includes('--apply')
const quizFlagIndex = process.argv.indexOf('--quiz')
const ONLY_QUIZ = quizFlagIndex >= 0 ? process.argv[quizFlagIndex + 1] : null

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

async function loadQuestions(quizId) {
  const snap = await db.collection('quizzes').doc(quizId).collection('questions').get()
  return snap.docs.map(d => ({ _id: d.id, ...d.data() }))
}

async function repairOne(doc) {
  const quizId = doc.id
  const quizData = doc.data()
  const questions = await loadQuestions(quizId)
  const plan = planQuizRepair(quizData, questions)

  if (!plan.changed) {
    return { quizId, changed: false, questions: questions.length }
  }

  const title = quizData.title || '(untitled)'
  console.log(`\n• ${quizId} — ${title}`)
  console.log(
    `    questions in subcollection: ${questions.length}` +
    `   |  card was showing: ${plan.before.questionCount} Q`,
  )
  const diff = (label, b, a) => (b !== a ? `    ${label}: ${b} → ${a}` : null)
  ;[
    diff('questionCount', plan.before.questionCount, plan.after.questionCount),
    diff('totalMarks', plan.before.totalMarks, plan.after.totalMarks),
    diff('reviewCount', plan.before.reviewCount, plan.after.reviewCount),
    diff('passageCount', plan.before.passageCount, plan.after.passageCount),
  ].filter(Boolean).forEach(line => console.log(line))

  for (const p of plan.passageReport) {
    if (p.action === 'recreated') {
      console.log(
        `    passage ${p.id}: RESTORED (${p.linkedQuestions} linked question(s)` +
        `, text ${p.textRecovered ? 'recovered from a question' : 'NOT recoverable — stub only, needs manual/source text'})`,
      )
    } else if (p.action === 'refilled-text') {
      console.log(`    passage ${p.id}: text refilled from a linked question`)
    }
  }

  if (questions.length === 0) {
    console.log(
      '    ⚠ no questions in the subcollection — counts corrected but the paper\'s ' +
      'content can only be rebuilt by re-importing its source PDF ' +
      `(sourcePastPaperPdfPath: ${quizData.sourcePastPaperPdfPath || 'none on file'}).`,
    )
  }

  if (APPLY) {
    await db.collection('quizzes').doc(quizId).update(plan.updates)
    console.log('    ✓ written')
  }
  return { quizId, changed: true, questions: questions.length }
}

async function main() {
  let docs
  if (ONLY_QUIZ) {
    const snap = await db.collection('quizzes').doc(ONLY_QUIZ).get()
    if (!snap.exists) {
      console.error(`quiz ${ONLY_QUIZ} not found`)
      process.exit(1)
    }
    docs = [snap]
  } else {
    const snap = await db.collection('quizzes').get()
    docs = snap.docs
  }
  console.log(`scanning ${docs.length} quiz doc(s)${APPLY ? '' : '  (dry run — pass --apply to write)'}`)

  let repaired = 0
  for (const doc of docs) {
    const res = await repairOne(doc)
    if (res.changed) repaired += 1
  }

  console.log(
    `\ndone — ${repaired} quiz(zes) ${APPLY ? 'repaired' : 'would be repaired'}` +
    ` out of ${docs.length} scanned.`,
  )
  if (!APPLY && repaired > 0) console.log('re-run with --apply to write the repairs.')
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('error:', err)
  process.exit(1)
})
