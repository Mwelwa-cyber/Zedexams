/**
 * repair-quiz-subject-integrity.mjs
 *
 * Repository-wide validation + safe repair for the featured/public past-paper
 * quiz subject-mapping defect (a "Social Studies" paper whose linked quiz —
 * and its questions — are actually Mathematics).
 *
 * It scans every PUBLISHED past paper that has a linked quiz, loads that quiz +
 * its questions, and runs the canonical subject-identity validator
 * (src/utils/quizSubjectIntegrity.js). It prints a full report of every
 * mismatch, and — only with --apply — QUARANTINES the offending papers by
 * stamping an `integrityStatus: 'quarantined'` flag (never deletes content) and
 * writing an append-only audit doc.
 *
 * Safety contract (matches the launch-blocker requirements):
 *   • dry-run by default — no writes unless --apply is passed;
 *   • idempotent — re-running produces the same flags; already-quarantined
 *     papers are re-verified, not double-written when unchanged;
 *   • no destructive writes — quarantine is a flag + audit doc, papers/quizzes
 *     are never deleted or unpublished by this script;
 *   • audit logging — every apply writes quizIntegrityAudit/{autoId};
 *   • detailed output — per-paper violation codes + a byCode summary.
 *
 * Usage (authenticated against examsprepzambia via firebase login OR
 * GOOGLE_APPLICATION_CREDENTIALS, same as the other scripts/*.mjs):
 *   node scripts/repair-quiz-subject-integrity.mjs                 # dry run report
 *   node scripts/repair-quiz-subject-integrity.mjs --apply         # quarantine mismatches + audit
 *   node scripts/repair-quiz-subject-integrity.mjs --apply --rebuild-index
 *                                                                  # + clear pastPapersIndex/published
 *                                                                    so the cron rebuilds the featured cache
 *
 * The public app already FAILS CLOSED at render time (PublicQuizRunner) and the
 * featured strip re-validates each card, so a mismatch is never shown even
 * before this script runs; the quarantine flag is for admin visibility + audit.
 *
 * The pure planning core (buildIntegrityReport / planQuarantine) is exported so
 * it can be unit-tested without Firestore (scripts/test-quiz-subject-integrity.mjs
 * exercises the underlying validator directly).
 */

import { validateQuizSubjectIntegrity, INTEGRITY_CODES } from '../src/utils/quizSubjectIntegrity.js'

const PAPER_STATUS_PUBLISHED = 'published'

/**
 * Pure: turn scanned rows into a report. `rows` = [{ paper, quiz, questions }].
 * A row with no quiz is recorded as a `missing_quiz` note (not a hard mismatch —
 * the paper simply has no runnable quiz).
 */
export function buildIntegrityReport(rows, { requirePublished = true } = {}) {
  const byCode = {}
  const details = []
  let okCount = 0
  let missingQuiz = 0

  for (const row of rows) {
    const { paper, quiz, questions } = row
    if (!quiz) { missingQuiz += 1; continue }
    const res = validateQuizSubjectIntegrity({ paper, quiz, questions }, { requirePublished })
    if (res.ok) { okCount += 1; continue }
    const codes = res.violations.map((v) => v.code)
    for (const c of codes) byCode[c] = (byCode[c] || 0) + 1
    details.push({
      paperId: paper?.id ?? null,
      quizId: quiz?.id ?? null,
      paperSubject: paper?.subject ?? null,
      quizSubject: quiz?.subject ?? null,
      violations: codes,
      messages: res.violations.map((v) => v.message),
    })
  }

  return {
    scanned: rows.length,
    ok: okCount,
    missingQuiz,
    mismatched: details.length,
    byCode,
    details,
  }
}

/** Pure: the paper ids that should be quarantined (any hard mismatch). */
export function planQuarantine(report) {
  return report.details.map((d) => d.paperId).filter(Boolean)
}

// ── I/O layer (only runs when executed directly) ────────────────────────────
async function main() {
  const { initializeApp, cert } = await import('firebase-admin/app')
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore')
  const fs = await import('fs')

  const APPLY = process.argv.includes('--apply')
  const REBUILD_INDEX = process.argv.includes('--rebuild-index')

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

  console.log('Scanning published past papers with a linked quiz…')
  const papersSnap = await db.collection('pastPapers').where('status', '==', PAPER_STATUS_PUBLISHED).get()
  const rows = []
  for (const doc of papersSnap.docs) {
    const paper = { id: doc.id, ...doc.data() }
    if (!paper.quizId) continue
    let quiz = null
    let questions = []
    try {
      const quizSnap = await db.collection('quizzes').doc(paper.quizId).get()
      if (quizSnap.exists) {
        quiz = { id: quizSnap.id, ...quizSnap.data() }
        const qSnap = await db.collection('quizzes').doc(paper.quizId).collection('questions').get()
        questions = qSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      }
    } catch (err) {
      console.warn(`  ! could not read quiz ${paper.quizId} for paper ${paper.id}: ${err.message}`)
    }
    rows.push({ paper, quiz, questions })
  }

  const report = buildIntegrityReport(rows)
  console.log('\n──────── Integrity report ────────')
  console.log(`scanned:     ${report.scanned} published paper(s) with a quizId`)
  console.log(`ok:          ${report.ok}`)
  console.log(`missingQuiz: ${report.missingQuiz} (linked quiz doc not found)`)
  console.log(`mismatched:  ${report.mismatched}`)
  console.log('byCode:', JSON.stringify(report.byCode))
  for (const d of report.details) {
    console.log(`  ✗ paper ${d.paperId} (${d.paperSubject}) → quiz ${d.quizId} (${d.quizSubject}) :: ${d.violations.join(', ')}`)
  }

  if (!APPLY) {
    console.log('\nDRY RUN — pass --apply to quarantine the mismatched papers + write audit docs.')
    return
  }

  const toQuarantine = planQuarantine(report)
  console.log(`\nApplying: quarantining ${toQuarantine.length} paper(s)…`)
  let changed = 0
  for (const d of report.details) {
    if (!d.paperId) continue
    const ref = db.collection('pastPapers').doc(d.paperId)
    const snap = await ref.get()
    const existing = snap.exists ? (snap.data() || {}) : {}
    // Idempotent: skip a paper already quarantined with the same violation set.
    const sameCodes = Array.isArray(existing.integrityViolations) &&
      existing.integrityViolations.slice().sort().join(',') === d.violations.slice().sort().join(',')
    if (existing.integrityStatus === 'quarantined' && sameCodes) {
      console.log(`  = paper ${d.paperId} already quarantined (unchanged) — skipping`)
      continue
    }
    await ref.set({
      integrityStatus: 'quarantined',
      integrityViolations: d.violations,
      integrityCheckedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    await db.collection('quizIntegrityAudit').add({
      paperId: d.paperId,
      quizId: d.quizId,
      paperSubject: d.paperSubject,
      quizSubject: d.quizSubject,
      violations: d.violations,
      messages: d.messages,
      action: 'quarantined',
      at: FieldValue.serverTimestamp(),
    })
    changed += 1
    console.log(`  ✓ quarantined paper ${d.paperId}`)
  }
  console.log(`Done. ${changed} paper(s) newly quarantined, ${toQuarantine.length - changed} unchanged.`)

  if (REBUILD_INDEX) {
    // Clear the denormalised featured-index doc so rebuildPastPapersIndexCron
    // rebuilds it. loadPublishedPapers falls back to a direct query while it's
    // absent, so this is safe (no gap in the hub).
    try {
      await db.collection('pastPapersIndex').doc('published').delete()
      console.log('Cleared pastPapersIndex/published — the cron will rebuild it.')
    } catch (err) {
      console.warn('Could not clear the featured index:', err.message)
    }
  }
}

// Only touch Firestore when run directly, so tests can import the pure core.
const isMain = process.argv[1] && process.argv[1].endsWith('repair-quiz-subject-integrity.mjs')
if (isMain) {
  main().catch((err) => { console.error(err); process.exit(1) })
}

// Re-export for convenience / discoverability.
export { INTEGRITY_CODES }
