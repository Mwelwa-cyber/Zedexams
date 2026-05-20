#!/usr/bin/env node
/**
 * scripts/grant-superadmin.mjs
 *
 * Promote an existing account to a full-access super admin: sets the role,
 * unlimited premium subscription state, and every permission flag, then
 * mirrors the role into a Firebase Auth custom claim. The admin account is
 * never deleted or recreated — only updated in place.
 *
 * Audits before writing:
 *   - Firebase Auth user exists for the email/uid.
 *   - The Firestore users/{uid} doc exists and its id == the Auth UID.
 *
 * Prereqs:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Usage:
 *   # dry-run (default) — audits + prints the diff, writes nothing
 *   node scripts/grant-superadmin.mjs --email admin@zedexams.com
 *   node scripts/grant-superadmin.mjs --uid <UID>
 *
 *   # actually write
 *   node scripts/grant-superadmin.mjs --email admin@zedexams.com --live
 *
 * Options:
 *   --uid <id>     Firebase Auth UID of the admin (or use --email).
 *   --email <addr> Look the user up by email instead of UID.
 *   --role <r>     'superAdmin' (default) or 'admin'.
 *   --live         Actually write. Default is dry-run.
 */

function parseArgs(argv) {
  const args = { live: false, role: 'superAdmin' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--live') args.live = true
    else if (a === '--uid') args.uid = argv[++i]
    else if (a === '--email') args.email = argv[++i]
    else if (a === '--role') args.role = argv[++i]
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || (!args.uid && !args.email)) {
    console.log('Usage: node scripts/grant-superadmin.mjs (--uid <UID> | --email <addr>) [--role superAdmin|admin] [--live]')
    process.exit(args.help ? 0 : 1)
  }

  if (!['superAdmin', 'admin'].includes(args.role)) {
    console.error(`ERROR: --role must be 'superAdmin' or 'admin' (got '${args.role}')`)
    process.exit(1)
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
  const auth = admin.auth()
  const db = admin.firestore()
  const { FieldValue, Timestamp } = admin.firestore

  // ── 1. Firebase Auth user audit ───────────────────────────────────────
  let authUser
  try {
    authUser = args.uid
      ? await auth.getUser(args.uid)
      : await auth.getUserByEmail(args.email)
  } catch (err) {
    console.error(`ERROR: no Firebase Auth user for ${args.uid || args.email}: ${err.message}`)
    process.exit(1)
  }
  const uid = authUser.uid
  console.log(`# auth user OK  uid=${uid}  email=${authUser.email}`)

  // ── 2. Firestore profile audit (uid must match doc id) ────────────────
  const ref = db.doc(`users/${uid}`)
  const snap = await ref.get()
  if (!snap.exists) {
    console.error(`ERROR: users/${uid} does not exist in Firestore. Sign in once to bootstrap it, then re-run.`)
    process.exit(1)
  }
  if (snap.id !== uid) {
    console.error(`ERROR: doc id ${snap.id} != Auth UID ${uid}. Aborting.`)
    process.exit(1)
  }
  const before = snap.data() || {}
  console.log(`# firestore profile OK  doc id matches uid`)
  console.log(`  before: role=${before.role || '(unset)'}  plan=${before.subscriptionPlan || '(unset)'}  status=${before.status || '(unset)'}`)

  const expiry = new Date()
  expiry.setFullYear(expiry.getFullYear() + 10)

  const update = {
    role: args.role,
    accountType: 'admin',
    accessLevel: 'unlimited',
    status: 'active',
    // Unlimited premium — indistinguishable from a paid activation.
    plan: 'premium',
    premium: true,
    isPremium: true,
    paymentStatus: 'active',
    subscriptionStatus: 'active',
    subscriptionPlan: 'premium',
    subscriptionExpiry: Timestamp.fromDate(expiry),
    subscriptionActivatedBy: `script:grant-superadmin@${new Date().toISOString().slice(0, 10)}`,
    subscriptionActivatedAt: FieldValue.serverTimestamp(),
    subscriptionProvider: 'manual_grant',
    premiumActivatedAt: FieldValue.serverTimestamp(),
    // Teacher learner-portal access too, so admin can preview learner side.
    learnerPortalActive: true,
    learnerPortalExpiry: Timestamp.fromDate(expiry),
    // Explicit permission flags (the code also forces these on for admins,
    // but persisting them keeps Firestore self-describing).
    canAccessAllGrades: true,
    canAccessAllSubjects: true,
    canCreateContent: true,
    canPublishContent: true,
    canAssignQuizzes: true,
    canManageUsers: true,
    canViewReports: true,
  }

  console.log(`# planned write to users/${uid}:`)
  for (const [k, v] of Object.entries(update)) {
    const val = v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v
    console.log(`  ${k}: ${String(val)}`)
  }
  console.log(`# planned Auth custom claim: { role: '${args.role}' }`)

  if (!args.live) {
    console.log('— Dry run. Pass --live to write to Firestore + set the custom claim. —')
    return
  }

  await ref.set(update, { merge: true })
  await auth.setCustomUserClaims(uid, { ...(authUser.customClaims || {}), role: args.role })
  await auth.revokeRefreshTokens(uid)

  const after = (await ref.get()).data() || {}
  console.log(`✓ users/${uid} updated.`)
  console.log(`  role:            ${after.role}`)
  console.log(`  accountType:     ${after.accountType}`)
  console.log(`  accessLevel:     ${after.accessLevel}`)
  console.log(`  subscriptionPlan:${after.subscriptionPlan}`)
  console.log(`  isPremium:       ${after.isPremium}`)
  console.log(`  status:          ${after.status}`)
  console.log(`✓ custom claim role=${args.role} set; refresh tokens revoked (user must re-login once).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
