#!/usr/bin/env node
/**
 * scripts/grant-generation-credit.mjs
 *
 * Goodwill fix for a teacher stuck on a monthly tool quota they've already
 * spent — most commonly after upgrading mid-month to a plan whose limit for
 * that one tool is no higher than what they'd already used (e.g. Pro's
 * scheme_of_work cap was 2/month, identical to Free's, until this was raised
 * — see functions/teacherTools/teacherPlans.js). The monthly counter in
 * usageMeters/{uid}/periods/{yyyymm} is plan-independent, so upgrading alone
 * never un-blocks a teacher already at that number.
 *
 * This grants `users/{uid}.generationCredits` — the SAME K25 top-up credit
 * mechanism functions/teacherTools/usageMeter.js already spends automatically
 * the next time the teacher is blocked on ANY tool (monthly or daily cap). It
 * does not touch teacherPlan, subscriptionExpiry, or the usageMeters counters
 * themselves — the teacher's plan and usage history are left exactly as they
 * were; only their store of ready-to-spend bonus generations increases.
 *
 * Read-only first: prints the teacher's current plan, this month's usage for
 * the tool named by --tool (if given), and their current credit balance —
 * so you can confirm you're crediting the right person before writing.
 *
 * Credentials — EITHER of these works, no service-account key required:
 *
 *   # (a) your own Google account, via Application Default Credentials.
 *   gcloud auth application-default login
 *   gcloud auth application-default set-quota-project examsprepzambia
 *
 *   # (b) a service-account key, if you have one already.
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Usage:
 *   # dry-run (default) — audits + prints the diff, writes nothing
 *   node scripts/grant-generation-credit.mjs --email teacher@example.com
 *   node scripts/grant-generation-credit.mjs --uid <UID> --tool scheme_of_work
 *
 *   # actually write
 *   node scripts/grant-generation-credit.mjs --email teacher@example.com --live
 *
 *   # grant more than one credit / leave an audit note
 *   node scripts/grant-generation-credit.mjs --email teacher@example.com \
 *     --credits 2 --reason "SoW cap == Free cap before the Pro bump" --live
 *
 * Options:
 *   --uid <id>       Firebase Auth UID of the teacher (or use --email).
 *   --email <addr>   Look the user up by email instead of UID.
 *   --credits <n>    Number of bonus generations to grant. Default 1.
 *   --tool <name>    Tool id to show this-month usage for (e.g. scheme_of_work).
 *                     Display only — the credit itself works on any tool.
 *   --reason <text>  Free-text note stamped onto the grant for the audit trail.
 *   --project <id>   Firebase project id. Defaults to .firebaserc's projects.default.
 *   --live           Actually write. Default is dry-run.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function parseArgs(argv) {
  const args = { live: false, credits: 1 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--live') args.live = true
    else if (a === '--uid') args.uid = argv[++i]
    else if (a === '--email') args.email = argv[++i]
    else if (a === '--credits') args.credits = Number(argv[++i])
    else if (a === '--tool') args.tool = argv[++i]
    else if (a === '--reason') args.reason = argv[++i]
    else if (a === '--project') args.project = argv[++i]
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

// Same resolvers as scripts/grant-superadmin.mjs, duplicated deliberately —
// each admin script stays self-contained and independently runnable rather
// than sharing a module that could drift under one script and not the other.
function resolveCredentialSource(env = process.env, adcPathExists = null) {
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

function resolveProjectId({ flag, env = process.env, firebaserc = null } = {}) {
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

function yyyymm(d = new Date()) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}${m}`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || (!args.uid && !args.email)) {
    console.log('Usage: node scripts/grant-generation-credit.mjs (--uid <UID> | --email <addr>) [--credits <n>] [--tool <name>] [--reason <text>] [--live]')
    process.exit(args.help ? 0 : 1)
  }

  if (!Number.isInteger(args.credits) || args.credits < 1) {
    console.error(`ERROR: --credits must be a positive integer (got '${args.credits}')`)
    process.exit(1)
  }

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

  admin.initializeApp({ projectId })
  console.log(`# credential:    ${credential.kind}${credential.detail ? ` (${credential.detail})` : ''}`)
  console.log(`# project:       ${projectId} (from ${projectFrom})`)
  console.log(`# mode:          ${args.live ? 'LIVE — will write' : 'dry-run — writes nothing'}`)
  const auth = admin.auth()
  const db = admin.firestore()
  const { FieldValue } = admin.firestore

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

  // ── 2. Firestore profile audit ────────────────────────────────────────
  const ref = db.doc(`users/${uid}`)
  const snap = await ref.get()
  if (!snap.exists) {
    console.error(`ERROR: users/${uid} does not exist in Firestore. Aborting.`)
    process.exit(1)
  }
  const before = snap.data() || {}
  const currentCredits = Number(before.generationCredits || 0)
  console.log(`# firestore profile OK`)
  console.log(`  role:              ${before.role || 'learner/teacher (unset)'}`)
  console.log(`  teacherPlan:       ${before.teacherPlan || '(none — free)'}`)
  console.log(`  teacherPlanExpiresAt: ${before.teacherPlanExpiresAt?.toDate?.()?.toISOString?.() || '(none)'}`)
  console.log(`  generationCredits (before): ${currentCredits}`)

  // ── 3. This month's usage for --tool, read-only, for context ──────────
  if (args.tool) {
    const period = yyyymm()
    const meterSnap = await db.doc(`usageMeters/${uid}/periods/${period}`).get()
    const counters = meterSnap.exists ? (meterSnap.data()?.counters || {}) : {}
    const used = Number(counters[args.tool] || 0)
    console.log(`  usage this period (${period}) for '${args.tool}': ${used}`)
  }

  console.log(`# planned write to users/${uid}:`)
  console.log(`  generationCredits: ${currentCredits} -> ${currentCredits + args.credits}  (+${args.credits})`)
  if (args.reason) console.log(`  reason: ${args.reason}`)

  if (!args.live) {
    console.log('— Dry run. Pass --live to write to Firestore. —')
    return
  }

  await ref.set({
    generationCredits: FieldValue.increment(args.credits),
    generationCreditsUpdatedAt: FieldValue.serverTimestamp(),
    lastManualCreditGrant: {
      amount: args.credits,
      reason: args.reason || null,
      grantedBy: `script:grant-generation-credit@${new Date().toISOString().slice(0, 10)}`,
      grantedAt: FieldValue.serverTimestamp(),
    },
  }, { merge: true })

  const after = (await ref.get()).data() || {}
  console.log(`✓ users/${uid} updated.`)
  console.log(`  generationCredits (after): ${after.generationCredits}`)
  console.log('The teacher will consume one credit automatically the next time they hit a monthly or daily cap on any tool — no other action needed on their end.')
}

const invokedDirectly = !!process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) main().catch((err) => {
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
