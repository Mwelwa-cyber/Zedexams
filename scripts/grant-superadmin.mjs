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
 * Credentials — EITHER of these works, no service-account key required:
 *
 *   # (a) your own Google account, via Application Default Credentials.
 *   #     Preferred: nothing long-lived lands on disk.
 *   gcloud auth application-default login
 *   gcloud auth application-default set-quota-project examsprepzambia
 *
 *   # (b) a service-account key, if you have one already.
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * With (a) your user needs roles/firebase.admin on the project (Owner
 * subsumes it) — getUserByEmail, setCustomUserClaims, revokeRefreshTokens and
 * the users/{uid} read+write all sit under it. The default ADC login grants
 * the cloud-platform scope, which covers both Identity Toolkit and Firestore;
 * if a call fails on scope, re-login with an explicit --scopes.
 *
 * NOT every Admin SDK call works on ADC user credentials: createCustomToken
 * has to SIGN a JWT and needs either a service account or an explicit
 * serviceAccountId plus IAM SignBlob. This script never signs anything —
 * don't generalise from it to code paths that do.
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
 *   --project <id> Firebase project id. Defaults to .firebaserc's projects.default.
 *   --live         Actually write. Default is dry-run.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function parseArgs(argv) {
  const args = { live: false, role: 'superAdmin' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--live') args.live = true
    else if (a === '--uid') args.uid = argv[++i]
    else if (a === '--email') args.email = argv[++i]
    else if (a === '--role') args.role = argv[++i]
    else if (a === '--project') args.project = argv[++i]
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

/**
 * Which credential the SDK is about to pick up, named before we use it.
 *
 * A script that silently adopts whatever ADC happens to be logged in as, and
 * then writes to production, should say whose credential it took — the whole
 * point of dropping the hard GOOGLE_APPLICATION_CREDENTIALS guard is that the
 * credential is now implicit.
 */
export function resolveCredentialSource(env = process.env, adcPathExists = null) {
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { kind: 'service-account-key', detail: env.GOOGLE_APPLICATION_CREDENTIALS }
  }
  const home = env.HOME || env.USERPROFILE
  const adcPath = env.CLOUDSDK_CONFIG
    ? resolve(env.CLOUDSDK_CONFIG, 'application_default_credentials.json')
    : home
      ? resolve(home, '.config/gcloud/application_default_credentials.json')
      : null
  const exists = adcPathExists ?? (adcPath ? fileExists(adcPath) : false)
  if (exists) return { kind: 'adc-user', detail: adcPath }
  return { kind: 'none', detail: null }
}

function fileExists(p) {
  try { readFileSync(p); return true } catch { return false }
}

/**
 * A service-account JSON carries its own project_id; `gcloud auth
 * application-default login` credentials do NOT, and firebase-admin then
 * throws "Unable to detect a Project Id". So resolve it ourselves, most
 * explicit first, and fall back to the project the repo already declares.
 */
export function resolveProjectId({ flag, env = process.env, firebaserc = null } = {}) {
  if (flag) return { projectId: flag, from: '--project' }
  if (env.GOOGLE_CLOUD_PROJECT) return { projectId: env.GOOGLE_CLOUD_PROJECT, from: 'GOOGLE_CLOUD_PROJECT' }
  if (env.GCLOUD_PROJECT) return { projectId: env.GCLOUD_PROJECT, from: 'GCLOUD_PROJECT' }
  const fromRc = (firebaserc ?? readFirebaserc())?.projects?.default
  if (fromRc) return { projectId: fromRc, from: '.firebaserc' }
  return { projectId: null, from: null }
}

function readFirebaserc() {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    return JSON.parse(readFileSync(resolve(here, '..', '.firebaserc'), 'utf8'))
  } catch { return null }
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

  // Either credential is fine; neither is not. initializeApp() throws
  // opaquely when nothing resolves, so preflight and name both options.
  const credential = resolveCredentialSource()
  if (credential.kind === 'none') {
    console.error('ERROR: no credentials. Use EITHER of:')
    console.error('  gcloud auth application-default login')
    console.error(`  gcloud auth application-default set-quota-project ${resolveProjectId().projectId || '<project-id>'}`)
    console.error('or:')
    console.error('  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json')
    process.exit(1)
  }

  const { projectId, from: projectFrom } = resolveProjectId({ flag: args.project })
  if (!projectId) {
    console.error('ERROR: could not resolve a project id. Pass --project <id>, or set GOOGLE_CLOUD_PROJECT.')
    process.exit(1)
  }

  let admin
  try {
    admin = (await import('firebase-admin')).default
  } catch {
    console.error('ERROR: install firebase-admin first: `npm install --save-dev firebase-admin`')
    process.exit(1)
  }

  // projectId is passed explicitly because ADC user credentials carry none.
  admin.initializeApp({ projectId })
  console.log(`# credential:    ${credential.kind}${credential.detail ? ` (${credential.detail})` : ''}`)
  console.log(`# project:       ${projectId} (from ${projectFrom})`)
  console.log(`# mode:          ${args.live ? 'LIVE — will write' : 'dry-run — writes nothing'}`)
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
  const claimPreview = args.role === 'superAdmin'
    ? `{ role: 'superAdmin', superAdmin: true, admin: true }`
    : `{ role: 'admin', admin: true }`
  console.log(`# planned Auth custom claims: ${claimPreview}`)

  if (!args.live) {
    console.log('— Dry run. Pass --live to write to Firestore + set the custom claim. —')
    return
  }

  await ref.set(update, { merge: true })
  // Mint role + boolean admin/superAdmin claims (the MFA guard reads the
  // booleans). superAdmin → { role, superAdmin:true, admin:true }; admin →
  // { role, admin:true }. Preserves any unrelated existing claims.
  const nextClaims = { ...(authUser.customClaims || {}) }
  delete nextClaims.admin
  delete nextClaims.superAdmin
  nextClaims.role = args.role
  if (args.role === 'superAdmin') { nextClaims.superAdmin = true; nextClaims.admin = true }
  else if (args.role === 'admin') { nextClaims.admin = true }
  await auth.setCustomUserClaims(uid, nextClaims)
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

// Only run the CLI when invoked directly — the resolvers above are imported
// by scripts/test-grant-superadmin-config.mjs, and importing this file must
// not start writing to production.
const invokedDirectly = !!process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) main().catch((err) => {
  // ADC user credentials commonly fail Firestore / Identity Toolkit with
  // USER_PROJECT_DENIED until a quota project is set. The raw error does not
  // say that, so name the remedy rather than leaving it to be googled.
  const text = `${err?.code || ''} ${err?.message || ''}`
  if (/USER_PROJECT_DENIED|quota project|serviceusage/i.test(text)) {
    const { projectId } = resolveProjectId()
    console.error('ERROR: the credential has no quota project set for this API.')
    console.error(`  gcloud auth application-default set-quota-project ${projectId || '<project-id>'}`)
    console.error('')
  }
  console.error(err)
  process.exit(1)
})
