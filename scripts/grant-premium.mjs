#!/usr/bin/env node
/**
 * scripts/grant-premium.mjs
 *
 * Grant a manual premium subscription to an existing user by UID.
 *
 * Field shape matches buildActiveSubscriptionData() in functions/index.js so
 * the granted state is indistinguishable from a paid MTN MoMo activation.
 *
 * Prereqs:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Usage:
 *   # dry-run (default)
 *   node scripts/grant-premium.mjs --uid Oa6grarqGsbQHntT2pl2N0ycHaF2
 *
 *   # actually write
 *   node scripts/grant-premium.mjs --uid Oa6grarqGsbQHntT2pl2N0ycHaF2 --live
 *
 *   # override plan / duration
 *   node scripts/grant-premium.mjs --uid <UID> --live --plan yearly --days 365
 *
 * Options:
 *   --uid <id>   Required. Firebase Auth UID of the user.
 *   --live       Actually write. Default is dry-run.
 *   --plan <id>  subscriptionPlan id (monthly/termly/yearly/pro_monthly/...).
 *                Default 'yearly'.
 *   --days <n>   Days until expiry. Default 365.
 *   --learner-portal  Also grant teacher learner-portal access (only meaningful
 *                     when the target user is a teacher).
 */

function parseArgs(argv) {
  const args = { live: false, learnerPortal: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--live') args.live = true
    else if (a === '--learner-portal') args.learnerPortal = true
    else if (a === '--uid') args.uid = argv[++i]
    else if (a === '--plan') args.plan = argv[++i]
    else if (a === '--days') args.days = Number(argv[++i])
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || !args.uid) {
    console.log('Usage: node scripts/grant-premium.mjs --uid <UID> [--live] [--plan <id>] [--days <n>] [--learner-portal]')
    process.exit(args.help ? 0 : 1)
  }

  const plan = args.plan || 'yearly'
  const days = Number.isFinite(args.days) ? args.days : 365
  const expiry = new Date()
  expiry.setDate(expiry.getDate() + days)

  console.log(`# grant-premium  uid=${args.uid}  plan=${plan}  days=${days}  expiresAt=${expiry.toISOString()}`)

  if (!args.live) {
    console.log('— Dry run. Pass --live to write to Firestore. —')
    return
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('ERROR: set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path.')
    process.exit(1)
  }

  let admin
  try {
    admin = (await import('firebase-admin')).default
  } catch {
    console.error('ERROR: install firebase-admin first: `npm install --save-dev firebase-admin`')
    process.exit(1)
  }

  admin.initializeApp()
  const db = admin.firestore()
  const { FieldValue, Timestamp } = admin.firestore

  // Verify the user doc exists before touching it.
  const ref = db.doc(`users/${args.uid}`)
  const snap = await ref.get()
  if (!snap.exists) {
    console.error(`ERROR: users/${args.uid} does not exist in Firestore.`)
    process.exit(1)
  }

  const adminId = `script:grant-premium@${new Date().toISOString().slice(0, 10)}`

  const grant = {
    plan: 'premium',
    premium: true,
    isPremium: true,
    paymentStatus: 'active',
    subscriptionStatus: 'active',
    premiumActivatedAt: FieldValue.serverTimestamp(),
    subscriptionPlan: plan,
    subscriptionExpiry: Timestamp.fromDate(expiry),
    subscriptionActivatedBy: adminId,
    subscriptionActivatedAt: FieldValue.serverTimestamp(),
    subscriptionProvider: 'manual_grant',
    subscriptionPaymentId: null,
    subscriptionPhoneNumber: null,
  }

  if (args.learnerPortal) {
    Object.assign(grant, {
      learnerPortalActive: true,
      learnerPortalPlan: plan,
      learnerPortalProvider: 'manual_grant',
      learnerPortalPhoneNumber: null,
      learnerPortalPaymentId: null,
      learnerPortalActivatedAt: FieldValue.serverTimestamp(),
      learnerPortalExpiry: Timestamp.fromDate(expiry),
    })
  }

  await ref.set(grant, { merge: true })

  const after = await ref.get()
  const data = after.data() || {}
  console.log(`✓ users/${args.uid} updated.`)
  console.log(`  role:               ${data.role || '(unset)'}`)
  console.log(`  plan:               ${data.plan}`)
  console.log(`  subscriptionPlan:   ${data.subscriptionPlan}`)
  console.log(`  subscriptionExpiry: ${data.subscriptionExpiry?.toDate?.().toISOString?.() || '(unset)'}`)
  if (args.learnerPortal) {
    console.log(`  learnerPortalActive: ${data.learnerPortalActive}`)
    console.log(`  learnerPortalExpiry: ${data.learnerPortalExpiry?.toDate?.().toISOString?.() || '(unset)'}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
