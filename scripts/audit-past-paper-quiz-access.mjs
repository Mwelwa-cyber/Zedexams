/**
 * audit-past-paper-quiz-access.mjs
 *
 * Answers one question for every published past paper that advertises a quiz:
 * can a signed-OUT visitor actually open it?
 *
 * A paper reaches `/papers/:id/quiz` whenever `derivePaperQuizStatus` says
 * 'attached' — which is `quizId` present. Whether the quiz then LOADS is a
 * different fact, held on the quiz document: the Firestore rule lets an
 * anonymous read through only when `publicAccess == true && isPublished ==
 * true`, and the questions subcollection additionally requires
 * `quizType != 'daily_exam'`. Nothing kept those two facts in step. A quiz
 * unpublished from /admin/content, deleted, or pinned as a daily exam leaves
 * the paper still promising a quiz and the visitor landing on a dead end.
 *
 * States it reports (see PAPER_QUIZ_STATES):
 *   ok               — public, published, has questions. Nothing to do.
 *   not_public       — the quiz exists with questions but one or both public
 *                      flags are off. REPAIRABLE: flip them back on.
 *   daily_exam       — quizType is 'daily_exam', so the questions rule blocks
 *                      every anonymous read. REPORTED, never auto-repaired —
 *                      demoting today's pinned exam is the daily-exam
 *                      picker's decision, not this script's.
 *   empty            — the quiz doc exists but has no questions. REPAIRABLE:
 *                      mark the paper's quiz pending so the hub stops
 *                      advertising it (the quiz itself is left alone, and its
 *                      id is parked in pendingQuizId so the Studio resumes it).
 *   missing          — the linked quiz doc is gone. REPAIRABLE: mark pending.
 *
 * Safety contract (matches the other scripts/*.mjs):
 *   • dry-run by default — no writes unless --live is passed;
 *   • idempotent — a second run finds nothing left to do;
 *   • never deletes a quiz, a question or a paper. The most it does is turn
 *     two booleans back on, or move a paper to the 'quiz pending' state the
 *     Studio itself publishes into;
 *   • every write is logged, with the before-state, one line per paper.
 *
 * Usage (authenticated against examsprepzambia via firebase login OR
 * GOOGLE_APPLICATION_CREDENTIALS, same as the other scripts/*.mjs):
 *   npm run audit:paper-quiz-access          # report only
 *   npm run audit:paper-quiz-access:live     # report + repair
 *
 * The pure core (classifyPaperQuizLink / planQuizAccessRepair) is exported and
 * unit-tested by scripts/test-past-paper-quiz-access.mjs — no Firestore needed.
 */

import {
  QUIZ_STATUSES,
  derivePaperQuizStatus,
} from '../src/utils/pastPaperQuizStatus.js'

const PAPER_STATUS_PUBLISHED = 'published'

export const PAPER_QUIZ_STATES = {
  OK: 'ok',
  NOT_PUBLIC: 'not_public',
  DAILY_EXAM: 'daily_exam',
  EMPTY: 'empty',
  MISSING: 'missing',
}

/**
 * Pure: what a signed-out visitor would get for this paper's linked quiz.
 *
 * `quiz` is null when the document does not exist. `questionCount` is the
 * REAL count from the questions subcollection, not the quiz's cached
 * `questionCount` field — that field is written by several paths and a paper
 * must not be judged runnable on a number nobody re-verified.
 */
export function classifyPaperQuizLink({ paper, quiz, questionCount }) {
  const paperId = paper?.id ?? null
  const quizId = paper?.quizId ?? null
  const base = { paperId, quizId, title: paper?.title ?? null }

  if (!quiz) return { ...base, state: PAPER_QUIZ_STATES.MISSING }
  if (!(questionCount > 0)) return { ...base, state: PAPER_QUIZ_STATES.EMPTY }
  // Checked BEFORE the flags: a daily-exam-typed quiz can carry both public
  // flags and still 403 every question read, so "flags are on" is not the
  // same as "a visitor can take it".
  if (quiz.quizType === 'daily_exam') {
    return { ...base, state: PAPER_QUIZ_STATES.DAILY_EXAM, questionCount }
  }
  if (quiz.isPublished !== true || quiz.publicAccess !== true) {
    return {
      ...base,
      state: PAPER_QUIZ_STATES.NOT_PUBLIC,
      questionCount,
      isPublished: quiz.isPublished === true,
      publicAccess: quiz.publicAccess === true,
    }
  }
  return { ...base, state: PAPER_QUIZ_STATES.OK, questionCount }
}

/**
 * Pure: turn classified rows into the two write plans plus the report.
 *
 * `restore` flips a quiz's public flags back on. `markPending` moves the
 * PAPER to the state the Studio publishes into when the quiz step is skipped
 * — so the hub shows "Quiz coming soon" instead of a Start Quiz button that
 * leads nowhere. `review` needs a human.
 */
export function planQuizAccessRepair(rows) {
  const restore = []
  const markPending = []
  const review = []
  const byState = {}
  for (const row of rows) {
    byState[row.state] = (byState[row.state] || 0) + 1
    if (row.state === PAPER_QUIZ_STATES.NOT_PUBLIC) restore.push(row)
    else if (row.state === PAPER_QUIZ_STATES.EMPTY || row.state === PAPER_QUIZ_STATES.MISSING) {
      markPending.push(row)
    } else if (row.state === PAPER_QUIZ_STATES.DAILY_EXAM) review.push(row)
  }
  return {
    scanned: rows.length,
    ok: byState[PAPER_QUIZ_STATES.OK] || 0,
    broken: restore.length + markPending.length + review.length,
    byState,
    restore,
    markPending,
    review,
    rows,
  }
}

/**
 * Pure: the field patch that re-opens a quiz to anonymous visitors. Only the
 * two flags — the title, subject and link are whatever the Studio last wrote
 * and are not this script's to restate.
 */
export function restorePublicAccessPatch() {
  return { isPublished: true, publicAccess: true }
}

/**
 * Pure: the field patch that stops a paper advertising a quiz that cannot be
 * taken. `pendingQuizId` keeps the id so the Studio resumes that quiz rather
 * than minting a second one; a quiz that no longer exists parks nothing.
 */
export function markPendingPatch(row) {
  return {
    quizId: null,
    quizStatus: QUIZ_STATUSES.PENDING,
    pendingQuizId: row.state === PAPER_QUIZ_STATES.EMPTY ? (row.quizId || null) : null,
  }
}

async function main() {
  const LIVE = process.argv.includes('--live')

  const { initializeApp, cert } = await import('firebase-admin/app')
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore')
  const fs = await import('node:fs')

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

  console.log('Scanning published past papers that advertise a quiz…\n')
  const papersSnap = await db.collection('pastPapers')
    .where('status', '==', PAPER_STATUS_PUBLISHED).get()

  const rows = []
  for (const docSnap of papersSnap.docs) {
    const paper = { id: docSnap.id, ...docSnap.data() }
    // Only papers a learner can actually be routed into. A pending paper
    // showing "Quiz coming soon" is working as designed, not a defect.
    if (derivePaperQuizStatus(paper) !== QUIZ_STATUSES.ATTACHED) continue

    let quiz = null
    let questionCount = 0
    const quizSnap = await db.collection('quizzes').doc(paper.quizId).get()
    if (quizSnap.exists) {
      quiz = { id: quizSnap.id, ...quizSnap.data() }
      // count() rather than a full read: we need the number, not the bodies.
      const agg = await db.collection('quizzes').doc(paper.quizId)
        .collection('questions').count().get()
      questionCount = agg.data().count
    }
    rows.push(classifyPaperQuizLink({ paper, quiz, questionCount }))
  }

  const plan = planQuizAccessRepair(rows)

  console.log('──────── Past-paper quiz access ────────')
  console.log(`scanned: ${plan.scanned} published paper(s) advertising a quiz`)
  console.log(`ok:      ${plan.ok}`)
  console.log(`broken:  ${plan.broken}`)
  console.log('byState:', JSON.stringify(plan.byState))
  for (const r of plan.rows) {
    if (r.state === PAPER_QUIZ_STATES.OK) continue
    const detail = r.state === PAPER_QUIZ_STATES.NOT_PUBLIC
      ? ` (isPublished=${r.isPublished}, publicAccess=${r.publicAccess}, ${r.questionCount} question(s))`
      : r.state === PAPER_QUIZ_STATES.DAILY_EXAM ? ' (quizType=daily_exam — questions are blocked for everyone)' : ''
    console.log(`  ✗ ${r.state.padEnd(10)} paper ${r.paperId} → quiz ${r.quizId}${detail}  ${r.title || ''}`)
  }

  if (plan.review.length) {
    console.log(`\n${plan.review.length} paper(s) need a human: a past-paper quiz is pinned as a daily exam.`)
    console.log('Demote it from /admin/content (or let the daily-exam picker re-run) — this script will not.')
  }

  if (!LIVE) {
    console.log(`\nDRY RUN — pass --live to restore ${plan.restore.length} quiz(zes) and mark ${plan.markPending.length} paper(s) pending.`)
    return
  }

  let restored = 0
  for (const r of plan.restore) {
    await db.collection('quizzes').doc(r.quizId).set({
      ...restorePublicAccessPatch(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    restored += 1
    console.log(`  ✓ re-opened quiz ${r.quizId} (paper ${r.paperId}) — was isPublished=${r.isPublished}, publicAccess=${r.publicAccess}`)
  }

  let pended = 0
  for (const r of plan.markPending) {
    await db.collection('pastPapers').doc(r.paperId).set({
      ...markPendingPatch(r),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    pended += 1
    console.log(`  ✓ paper ${r.paperId} now reads 'quiz pending' (linked quiz was ${r.state})`)
  }

  console.log(`\nDone. ${restored} quiz(zes) re-opened, ${pended} paper(s) marked pending, ${plan.review.length} left for review.`)
}

// Only touch Firestore when run directly, so the tests can import the core.
const isMain = process.argv[1] && process.argv[1].endsWith('audit-past-paper-quiz-access.mjs')
if (isMain) {
  main().catch((err) => { console.error(err); process.exit(1) })
}
