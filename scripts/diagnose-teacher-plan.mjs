/**
 * Diagnoses why a teacher who paid for Pro/Max still sees the Free studio
 * (free caps, locked tools, "Free" chip) on the teacher dashboard.
 *
 * The dashboard now resolves the plan from users/{uid}.teacherPlan (see
 * src/engines/payment-engine/teacherPlans.js + functions/teacherTools/usageMeter.js). If that
 * field is missing/expired the teacher correctly reads as Free — so this
 * script prints the field, the resolved plan, and the payment history that
 * SHOULD have set it, to pinpoint where provisioning went wrong.
 *
 * Run from a workstation authenticated against the examsprepzambia project:
 *   firebase login   (uses ADC), then:
 *     node scripts/diagnose-teacher-plan.mjs mahengamwelwa1@gmail.com
 *   or:
 *     GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json \
 *       node scripts/diagnose-teacher-plan.mjs mahengamwelwa1@gmail.com
 *
 * READ-ONLY — it never writes. It tells you exactly what to fix; apply the
 * fix via the admin grant flow or a separate write once you've confirmed.
 */

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as fs from 'fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// Reuse the canonical server normalisation so this report agrees with the
// gate exactly (legacy individual/school → pro/max).
const { normalizeTeacherPlan, PLAN_LABELS } = require('../functions/teacherTools/teacherPlans.js')

const email = (process.argv[2] || '').trim().toLowerCase()
if (!email) {
  console.error('usage: node scripts/diagnose-teacher-plan.mjs <email>')
  process.exit(1)
}

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

function hr(title) {
  console.log('\n' + '─'.repeat(72))
  console.log(title)
  console.log('─'.repeat(72))
}

function fmtDate(v) {
  if (!v) return '(unset)'
  const d = typeof v?.toDate === 'function' ? v.toDate() : new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toISOString()
}

// Mirror of functions/teacherTools/usageMeter.js getUserPlanContext() — the
// authoritative gate. Kept inline so the output matches the server exactly.
function resolveTeacherPlan(user) {
  const role = user?.role
  if (role === 'admin' || role === 'superAdmin') return { plan: 'max', reason: 'super-admin role' }
  const plan = normalizeTeacherPlan(user?.teacherPlan)
  if (plan === 'pro' || plan === 'max') {
    const exp = user?.teacherPlanExpiresAt
    const expDate = exp && typeof exp.toDate === 'function' ? exp.toDate() : (exp ? new Date(exp) : null)
    if (expDate && expDate < new Date()) {
      return { plan: 'free', reason: `teacherPlan=${user.teacherPlan} but teacherPlanExpiresAt ${fmtDate(exp)} is in the PAST` }
    }
    return { plan, reason: `teacherPlan=${user.teacherPlan}` }
  }
  return { plan: 'free', reason: user?.teacherPlan ? `teacherPlan="${user.teacherPlan}" is not a recognised pro/max id` : 'teacherPlan is unset' }
}

const TEACHER_PLAN_IDS = new Set(['pro_monthly', 'pro_yearly', 'max_monthly', 'max_yearly'])

async function main() {
  hr(`user lookup: ${email}`)
  const snap = await db.collection('users').where('email', '==', email).limit(5).get()
  if (snap.empty) {
    // emails are sometimes stored with original casing — retry case-sensitive
    const raw = process.argv[2].trim()
    const snap2 = await db.collection('users').where('email', '==', raw).limit(5).get()
    if (snap2.empty) {
      console.log(`No users doc with email == "${email}" (or "${raw}").`)
      console.log('If the account exists, its email field may differ in casing/whitespace.')
      process.exit(0)
    }
    snap.docs.push(...snap2.docs)
  }
  if (snap.docs.length > 1) {
    console.log(`⚠ ${snap.docs.length} user docs share this email — showing all.`)
  }

  for (const doc of snap.docs) {
    const uid = doc.id
    const u = doc.data() || {}
    hr(`users/${uid}`)
    console.log('role                  :', u.role || '(unset)')
    console.log('teacherPlan           :', u.teacherPlan ?? '(unset)   ← studio entitlement the dashboard reads')
    console.log('teacherPlanExpiresAt  :', fmtDate(u.teacherPlanExpiresAt))
    console.log('teacherPlanActivatedAt:', fmtDate(u.teacherPlanActivatedAt))
    console.log('— learner-side premium flags (drive isPremium, NOT studio caps) —')
    console.log('premium / isPremium   :', u.premium ?? '(unset)', '/', u.isPremium ?? '(unset)')
    console.log('paymentStatus         :', u.paymentStatus || '(unset)')
    console.log('subscriptionStatus    :', u.subscriptionStatus || '(unset)')
    console.log('subscriptionPlan      :', u.subscriptionPlan || '(unset)')
    console.log('subscriptionExpiry    :', fmtDate(u.subscriptionExpiry))

    const resolved = resolveTeacherPlan(u)
    console.log('\n→ RESOLVED studio plan :', `${PLAN_LABELS[resolved.plan] || resolved.plan}  (${resolved.reason})`)

    // Payment history — what they actually bought.
    hr(`payments for uid ${uid}`)
    const pays = await db.collection('payments').where('userId', '==', uid).get()
    if (pays.empty) {
      console.log('No payments docs for this uid.')
    } else {
      const rows = pays.docs.map(p => ({ id: p.id, ...(p.data() || {}) }))
        .sort((a, b) => (fmtDate(b.createdAt) > fmtDate(a.createdAt) ? 1 : -1))
      let boughtTeacherPlan = false
      for (const p of rows) {
        const isTeacher = TEACHER_PLAN_IDS.has(p.planId)
        if (isTeacher && (p.status === 'successful' || p.status === 'confirmed')) boughtTeacherPlan = true
        console.log(
          `• ${p.id}  planId=${p.planId || '(none)'}  status=${p.status || '(none)'}` +
          `  amount=${p.amountZMW ?? p.amount ?? '?'} ${p.currency || ''}` +
          `  confirmedAt=${fmtDate(p.confirmedAt)}` +
          (isTeacher ? '  [TEACHER PLAN]' : '')
        )
      }

      // Verdict
      hr('verdict')
      if (resolved.plan !== 'free') {
        console.log('✓ teacherPlan resolves to a paid tier — the dashboard will show it. If the')
        console.log('  user still sees Free, have them hard-refresh (the fix reads the live profile).')
      } else if (boughtTeacherPlan) {
        console.log('✗ PROVISIONING GAP: a successful pro_*/max_* payment exists but teacherPlan is')
        console.log('  not set to pro/max (or is expired). activateSubscriptionFromPayment should')
        console.log('  have set it — check whether activation ran for that payment. Fix: set')
        console.log('  users/' + uid + '.teacherPlan = "pro" (or "max") + teacherPlanExpiresAt to the')
        console.log('  subscriptionExpiry, mirroring functions/subscriptionActivation.js.')
      } else {
        console.log('• No successful TEACHER (pro_*/max_*) payment found. Any premium flags above')
        console.log('  come from a LEARNER subscription, which does not grant studio access — so')
        console.log('  "Free" on the teacher dashboard is correct. If they meant to buy Pro/Max,')
        console.log('  they need to purchase a teacher plan (pro_monthly/yearly, max_monthly/yearly).')
      }
    }
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('error:', err)
  process.exit(1)
})
