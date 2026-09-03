#!/usr/bin/env node
/**
 * scripts/backfill-existing-teacher-trial-offer.mjs
 *
 * Marks genuinely eligible EXISTING teacher accounts as able to claim the
 * existing-teacher trial offer — stamping `users/{uid}.teacherTrialOffer =
 * {status: 'available'|'ineligible', offeredAt, source}`. It never activates
 * anything: the offer is a card the teacher chooses to act on, and this
 * script only decides who gets shown it.
 *
 *   npm run backfill:existing-teacher-trial-offer:dry     # counts only
 *   npm run backfill:existing-teacher-trial-offer:live    # writes
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * The 7-day trial has, since its launch, been granted automatically on
 * signup (functions/teacherTrial/onUserCreated.js). Every teacher account
 * created BEFORE that shipped — and any created since whose grant trigger
 * failed — never received one. This script is the one-time (and safe to
 * re-run) pass that finds those accounts and offers them the same trial,
 * through the same activateExistingTeacherTrialOffer callable a teacher
 * presses "Start Free Trial" against.
 *
 * All the actual eligibility reasoning lives in ONE place —
 * resolveTeacherTrialOfferBackfillDecision in
 * functions/teacherTrial/teacherTrialCore.js — imported here rather than
 * re-implemented, so this script and the activation callable's own live
 * re-check can never disagree about who qualifies.
 *
 * ── Safety properties ────────────────────────────────────────────────────
 *
 *   • NEVER overwrites an active subscription, a live trial, or a previously
 *     recorded teacherTrialOffer of any kind — the core decision function
 *     treats a document that already carries teacherTrialOffer as 'skip',
 *     full stop, whatever status it holds.
 *   • NEVER activates a trial. Only ever writes status 'available' or
 *     'ineligible' — teacherPlan / teacherTrialEndsAt / teacherTrialStartedAt
 *     are untouched by this script.
 *   • Idempotent — a second run sees every previously-marked doc as 'skip'
 *     and writes nothing for it.
 *   • Paginated by document id (PAGE_SIZE at a time) rather than loading the
 *     whole `users` collection into memory — this project has learners,
 *     teachers, parents and admins in one collection, and the ordering used
 *     here needs no composite index (a plain `__name__` cursor), so it never
 *     depends on one existing.
 *   • Ambiguous records (an unreadable teacherPlan value) are reported, not
 *     guessed into eligibility — see the `ambiguous` bucket in the summary.
 *
 * Run authenticated against examsprepzambia (firebase login OR
 * GOOGLE_APPLICATION_CREDENTIALS).
 */

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import * as fs from 'fs'

import { resolveTeacherTrialOfferBackfillDecision } from '../functions/teacherTrial/teacherTrialCore.js'

const LIVE = process.argv.includes('--live')
const PAGE_SIZE = 300

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

/**
 * Page through `users` ordered by document id — no `where`, deliberately,
 * so this never depends on a composite index existing. Filtering to
 * role === 'teacher' happens per-document below instead.
 */
async function* pagesOfUsers() {
  let cursor = null
  for (;;) {
    let q = db.collection('users').orderBy('__name__').limit(PAGE_SIZE)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) return
    yield snap.docs
    if (snap.docs.length < PAGE_SIZE) return
    cursor = snap.docs[snap.docs.length - 1]
  }
}

async function main() {
  console.log(LIVE ? '*** LIVE MODE — writing changes ***' : 'dry run — no writes (pass --live to write)')

  const counts = { examined: 0, teachers: 0, skipped: 0, eligible: 0, ineligible: 0, ambiguous: 0, failed: 0 }
  const ambiguousSample = []
  const failedSample = []
  const now = new Date()

  for await (const page of pagesOfUsers()) {
    let batch = LIVE ? db.batch() : null
    let batchOps = 0

    for (const doc of page) {
      counts.examined += 1
      const uid = doc.id
      const user = doc.data() || {}
      if (user.role === 'teacher') counts.teachers += 1

      let decision
      try {
        decision = resolveTeacherTrialOfferBackfillDecision(user, now)
      } catch (err) {
        counts.failed += 1
        if (failedSample.length < 10) failedSample.push({ uid, error: err.message })
        continue
      }

      if (decision.decision === 'skip') {
        counts.skipped += 1
        continue
      }
      if (decision.decision === 'ambiguous') {
        counts.ambiguous += 1
        // No email/PII — just the uid and the reason, so the report is safe
        // to paste into a ticket.
        if (ambiguousSample.length < 20) ambiguousSample.push({ uid, reason: decision.reason })
        continue
      }

      const status = decision.decision === 'eligible' ? 'available' : 'ineligible'
      if (decision.decision === 'eligible') counts.eligible += 1
      else counts.ineligible += 1

      if (LIVE) {
        batch.set(doc.ref, {
          teacherTrialOffer: {
            status,
            offeredAt: FieldValue.serverTimestamp(),
            startedAt: null,
            expiresAt: null,
            redeemedAt: null,
            source: 'existing_teacher_offer',
            // Ineligible teachers are stamped too — not to hide anything
            // from them (there is no client surface that reads this value
            // for a non-'available' teacher), but so a re-run never has to
            // re-derive the same answer, and so the reason is on record if
            // a support ticket asks "why doesn't my colleague see this".
            ...(status === 'ineligible' ? { ineligibleReason: decision.reason } : {}),
          },
        }, { merge: true })
        batchOps += 1
        if (batchOps >= 400) {
          await batch.commit()
          batch = db.batch()
          batchOps = 0
        }
      }
    }

    if (LIVE && batchOps > 0) await batch.commit()
    console.log(`  … examined ${counts.examined} so far (${counts.eligible} eligible)`)
  }

  console.log('\n── summary ──────────────────────────────────────────')
  console.log(`  examined:            ${counts.examined}`)
  console.log(`  teacher accounts:    ${counts.teachers}`)
  console.log(`  skipped (not a fresh candidate): ${counts.skipped}`)
  console.log(`  marked eligible ('available'):   ${counts.eligible}`)
  console.log(`  marked ineligible:               ${counts.ineligible}`)
  console.log(`  ambiguous (NOT written):          ${counts.ambiguous}`)
  console.log(`  failed (NOT written):             ${counts.failed}`)

  if (ambiguousSample.length) {
    console.log('\n  ambiguous sample (unreadable teacherPlan — resolve by hand, then re-run):')
    for (const row of ambiguousSample) console.log(`    ${row.uid}  ${row.reason}`)
    if (counts.ambiguous > ambiguousSample.length) console.log(`    … and ${counts.ambiguous - ambiguousSample.length} more`)
  }
  if (failedSample.length) {
    console.log('\n  failed sample:')
    for (const row of failedSample) console.log(`    ${row.uid}  ${row.error}`)
  }

  if (!LIVE && counts.eligible + counts.ineligible > 0) {
    console.log('\nRe-run with --live to write the changes above.')
  }
  if (counts.ambiguous > 0 || counts.failed > 0) process.exitCode = 1
}

main().then(() => {
  if (!process.exitCode) process.exit(0)
}).catch((err) => {
  console.error('error:', err)
  process.exit(1)
})
