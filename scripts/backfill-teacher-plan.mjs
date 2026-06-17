/**
 * One-time backfill for the teacher-studio provisioning gap.
 *
 * Pro/Max subscriptions activated BETWEEN the Lenco integration (#1041) and
 * the teacherPlan grant fix (#1044, 2026-06-16) set the learner-side premium
 * flags + subscriptionPlan=pro_monthly/etc. but never wrote users.teacherPlan.
 * Those teachers paid for Pro/Max yet the studio resolves them to Free.
 *
 * This script finds every user whose subscriptionPlan is a teacher tier
 * (pro/max monthly or yearly) with an ACTIVE (non-expired) subscription but
 * whose teacherPlan is missing/lower, and sets teacherPlan +
 * teacherPlanExpiresAt to match — exactly what
 * functions/subscriptionActivation.js does now.
 *
 * SAFE BY DEFAULT: dry-run unless you pass --apply. Never downgrades a tier,
 * never touches users without a successful teacher subscription, never
 * shortens an existing teacherPlanExpiresAt.
 *
 * Run authenticated against examsprepzambia (firebase login OR
 * GOOGLE_APPLICATION_CREDENTIALS):
 *   node scripts/backfill-teacher-plan.mjs            # dry run — preview only
 *   node scripts/backfill-teacher-plan.mjs --apply    # write the changes
 *   node scripts/backfill-teacher-plan.mjs --uid <uid> [--apply]   # one user
 */

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import * as fs from 'fs'

const APPLY = process.argv.includes('--apply')
const uidArgIdx = process.argv.indexOf('--uid')
const ONLY_UID = uidArgIdx !== -1 ? process.argv[uidArgIdx + 1] : null

// subscriptionPlan id → canonical teacher tier. Mirror of the mapping in
// functions/subscriptionActivation.js.
const PLAN_TO_TIER = {
  pro_monthly: 'pro',
  pro_yearly: 'pro',
  max_monthly: 'max',
  max_yearly: 'max',
}
const TIER_RANK = { free: 0, pro: 1, max: 2 }

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

function toDate(v) {
  if (!v) return null
  const d = typeof v?.toDate === 'function' ? v.toDate() : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function normalizeTier(raw) {
  if (raw === 'pro' || raw === 'max') return raw
  if (raw === 'individual') return 'pro'
  if (raw === 'school') return 'max'
  return null
}

async function loadCandidates() {
  if (ONLY_UID) {
    const s = await db.collection('users').doc(ONLY_UID).get()
    return s.exists ? [s] : []
  }
  // One query per teacher plan id (Firestore '==' — no OR across values).
  const out = []
  for (const planId of Object.keys(PLAN_TO_TIER)) {
    const snap = await db.collection('users').where('subscriptionPlan', '==', planId).get()
    out.push(...snap.docs)
  }
  return out
}

async function main() {
  console.log(APPLY ? '*** APPLY MODE — writing changes ***' : 'dry run — no writes (pass --apply to write)')
  const docs = await loadCandidates()
  const now = new Date()
  let fixed = 0
  let skipped = 0

  for (const doc of docs) {
    const uid = doc.id
    const u = doc.data() || {}
    const paidTier = PLAN_TO_TIER[u.subscriptionPlan]
    if (!paidTier) { continue }

    const subExpiry = toDate(u.subscriptionExpiry)
    const active = !subExpiry || subExpiry > now
    if (!active) {
      console.log(`skip ${uid}  subscriptionPlan=${u.subscriptionPlan} but subscription EXPIRED ${subExpiry?.toISOString()}`)
      skipped++
      continue
    }

    const currentTier = normalizeTier(u.teacherPlan)
    // Already at or above what they paid for, with a still-valid teacher expiry → nothing to do.
    const teacherExpiry = toDate(u.teacherPlanExpiresAt)
    const teacherActive = currentTier && (!teacherExpiry || teacherExpiry > now)
    if (currentTier && teacherActive && TIER_RANK[currentTier] >= TIER_RANK[paidTier]) {
      skipped++
      continue
    }

    // Don't shorten an existing further-out teacher expiry.
    const newExpiry = (teacherExpiry && subExpiry && teacherExpiry > subExpiry) ? teacherExpiry : subExpiry
    const update = {
      teacherPlan: paidTier,
      teacherPlanActivatedAt: FieldValue.serverTimestamp(),
    }
    if (newExpiry) update.teacherPlanExpiresAt = Timestamp.fromDate(newExpiry)

    console.log(
      `FIX  ${uid}  ${u.email || '(no email)'}  ` +
      `${currentTier || 'unset'} → ${paidTier}  ` +
      `expiry=${newExpiry ? newExpiry.toISOString() : '(none)'}`,
    )

    if (APPLY) {
      await db.collection('users').doc(uid).update(update)
    }
    fixed++
  }

  console.log(`\n${APPLY ? 'wrote' : 'would write'} ${fixed} fix(es); skipped ${skipped}.`)
  if (!APPLY && fixed > 0) console.log('Re-run with --apply to write the changes above.')
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('error:', err)
  process.exit(1)
})
