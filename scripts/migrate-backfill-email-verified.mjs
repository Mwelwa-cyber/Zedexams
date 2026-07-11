#!/usr/bin/env node
/**
 * scripts/migrate-backfill-email-verified.mjs
 *
 * Email-verification enforcement backfill.
 *
 * The enforcement PR gates route access, Firestore/Storage rules, and Cloud
 * Functions on the Auth token's email_verified claim. Two data jobs must run
 * before/alongside the rules deploy:
 *
 *   1. Mirror each Auth account's emailVerified onto its users/{uid} doc —
 *      display-only (rules never trust it), but it powers the /admin/users
 *      "Unverified" filter and this script's lockout report.
 *   2. Grant existing UNVERIFIED accounts a grace window
 *      (verificationGraceUntil = now + --grace-days) so the rules deploy
 *      doesn't cut them off mid-session; they see the verify banner and
 *      keep access until the window closes. New signups (created after this
 *      run) get no grace and are enforced immediately.
 *
 * The report (printed even in dry-run) lists unverified accounts BY ROLE —
 * any unverified admin/superAdmin/teacher is a pre-deploy blocker: resolve
 * (have them verify) before shipping the rules or they lose their tools.
 *
 * ── Two modes ─────────────────────────────────────────────────────────
 *
 *   DRY RUN   (default)        No writes. Prints the mirror/grace/lockout report.
 *   LIVE      (--live)         Performs writes. Requires service-account key.
 *
 * ── Safety ────────────────────────────────────────────────────────────
 *
 *   • Idempotent — skips docs whose mirror already matches and whose grace
 *     field is already set (never shortens or extends an existing window).
 *   • Backs up originals under backups/email_verified_backfill/docs/<uid>.
 *   • Batched (400 ops; Firestore limit is 500).
 *   • --limit=N caps inspected users for staging spot-checks.
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *
 *   node scripts/migrate-backfill-email-verified.mjs                       # dry run
 *   node scripts/migrate-backfill-email-verified.mjs --live --grace-days=7 # writes
 */

const LIVE = process.argv.includes('--live')
const LIMIT_ARG = process.argv.find(arg => arg.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : Infinity
const GRACE_ARG = process.argv.find(arg => arg.startsWith('--grace-days='))
const GRACE_DAYS = GRACE_ARG ? Number(GRACE_ARG.split('=')[1]) : 0
const BATCH_SIZE = 400
const DAY_MS = 24 * 60 * 60 * 1000

// ─── Pure logic ───────────────────────────────────────────────────────────

/**
 * Decide the backfill writes for one account.
 *
 * @param {{uid: string, email?: string|null, emailVerified?: boolean}} authUser
 *   The Firebase Auth record (from admin.auth().listUsers()).
 * @param {object|null} docData The users/{uid} Firestore doc data (null if missing).
 * @param {{graceDays?: number, now?: number}} opts
 * @returns {{shouldWrite: boolean, fields: object, reasons: string[]}}
 */
export function decideEmailVerifiedBackfill(authUser, docData, opts = {}) {
  const reasons = []
  const fields = {}
  if (!authUser || !docData) {
    // No profile doc — nothing to mirror onto (bootstrapUserProfile will
    // stamp the mirror if/when the profile is repaired).
    return { shouldWrite: false, fields, reasons: ['no-profile-doc'] }
  }

  const verified = authUser.emailVerified === true
  // Accounts with no email at all (future custom-token learners) are treated
  // as exempt from verification — mirror them as verified so admin filters
  // don't flag accounts that have nothing to verify.
  const effectiveVerified = verified || !authUser.email

  if (docData.emailVerified !== effectiveVerified) {
    fields.emailVerified = effectiveVerified
    reasons.push(`mirror:${effectiveVerified}`)
  }

  const graceDays = Number(opts.graceDays) || 0
  const hasGrace = docData.verificationGraceUntil != null
  if (!effectiveVerified && graceDays > 0 && !hasGrace) {
    const now = Number.isFinite(opts.now) ? opts.now : Date.now()
    fields.verificationGraceUntil = new Date(now + graceDays * DAY_MS)
    reasons.push(`grace:${graceDays}d`)
  }

  return { shouldWrite: Object.keys(fields).length > 0, fields, reasons }
}

/**
 * Classify one account for the lockout report.
 * @returns {'verified'|'no-email'|'unverified'}
 */
export function classifyAccount(authUser) {
  if (!authUser?.email) return 'no-email'
  return authUser.emailVerified === true ? 'verified' : 'unverified'
}

// ─── Firestore runner ─────────────────────────────────────────────────────

async function runLive() {
  let admin
  try {
    admin = await import('firebase-admin')
  } catch {
    console.error('ERROR: --live requires `npm install --save-dev firebase-admin`')
    process.exit(1)
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('ERROR: set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path')
    process.exit(1)
  }

  admin.default.initializeApp()
  const db = admin.default.firestore()
  const auth = admin.default.auth()

  const totals = {
    accountsInspected: 0,
    mirrorsWritten: 0,
    graceGranted: 0,
    alreadyCurrent: 0,
    missingProfileDoc: 0,
  }
  // Lockout report: unverified accounts grouped by role.
  const unverifiedByRole = new Map()
  const staffBlockers = []

  console.log(`\n── Scanning Auth accounts (grace-days=${GRACE_DAYS}) ──`)

  let batch = db.batch()
  let batchOps = 0
  let pageToken = undefined

  do {
    const page = await auth.listUsers(1000, pageToken)
    pageToken = page.pageToken

    for (const authUser of page.users) {
      if (totals.accountsInspected >= LIMIT) { pageToken = undefined; break }
      totals.accountsInspected += 1

      const docRef = db.collection('users').doc(authUser.uid)
      const snap = await docRef.get()
      const docData = snap.exists ? snap.data() : null

      if (classifyAccount(authUser) === 'unverified' && docData) {
        const role = docData.role || 'unknown'
        unverifiedByRole.set(role, (unverifiedByRole.get(role) || 0) + 1)
        if (['admin', 'superAdmin', 'teacher'].includes(role)) {
          staffBlockers.push(`${authUser.uid} <${authUser.email}> role=${role}`)
        }
      }

      const { shouldWrite, fields, reasons } =
        decideEmailVerifiedBackfill(authUser, docData, { graceDays: GRACE_DAYS })

      if (!shouldWrite) {
        if (!docData) totals.missingProfileDoc += 1
        else totals.alreadyCurrent += 1
        continue
      }

      const backupRef = db.collection('backups')
        .doc('email_verified_backfill')
        .collection('docs')
        .doc(authUser.uid)
      batch.set(backupRef, {
        uid: authUser.uid,
        previousEmailVerified: docData.emailVerified ?? null,
        previousGraceUntil: docData.verificationGraceUntil ?? null,
        at: admin.default.firestore.FieldValue.serverTimestamp(),
      })
      batch.update(docRef, fields)
      batchOps += 2
      if ('emailVerified' in fields) totals.mirrorsWritten += 1
      if ('verificationGraceUntil' in fields) totals.graceGranted += 1
      console.log(`  ok   users/${authUser.uid}  ${reasons.join(', ')}`)

      if (batchOps >= BATCH_SIZE) {
        await batch.commit()
        batch = db.batch()
        batchOps = 0
      }
    }
  } while (pageToken)

  if (batchOps > 0) await batch.commit()

  console.log('\n── live backfill complete ──')
  Object.entries(totals).forEach(([key, value]) => console.log(`  ${key}: ${value}`))
  printLockoutReport(unverifiedByRole, staffBlockers)
}

function printLockoutReport(unverifiedByRole, staffBlockers) {
  console.log('\n── lockout report (unverified accounts by role) ──')
  if (unverifiedByRole.size === 0) {
    console.log('  none 🎉')
  } else {
    for (const [role, count] of unverifiedByRole) console.log(`  ${role}: ${count}`)
  }
  if (staffBlockers.length) {
    console.log('\n⚠ PRE-DEPLOY BLOCKERS — unverified STAFF accounts (they lose access when rules ship):')
    staffBlockers.forEach(line => console.log(`  ${line}`))
  }
}

async function runDryRun() {
  console.log('── DRY RUN — no Firestore writes will occur ──\n')
  console.log('Run with --live --grace-days=7 to perform the backfill.')
  console.log('Run `npm run test:migrate-email-verified` to exercise the pure logic.\n')

  const now = Date.now()
  const fixtures = [
    {
      label: 'legacy unverified learner, no mirror, grace requested',
      authUser: { uid: 'u1', email: 'a@x.zm', emailVerified: false },
      docData: { role: 'learner' },
      opts: { graceDays: 7, now },
    },
    {
      label: 'verified teacher, no mirror yet',
      authUser: { uid: 'u2', email: 'b@x.zm', emailVerified: true },
      docData: { role: 'teacher' },
      opts: { graceDays: 7, now },
    },
    {
      label: 'mirror already current (no-op)',
      authUser: { uid: 'u3', email: 'c@x.zm', emailVerified: true },
      docData: { role: 'learner', emailVerified: true },
      opts: { graceDays: 7, now },
    },
    {
      label: 'unverified but grace already granted (no re-grant)',
      authUser: { uid: 'u4', email: 'd@x.zm', emailVerified: false },
      docData: { role: 'learner', emailVerified: false, verificationGraceUntil: new Date(now + DAY_MS) },
      opts: { graceDays: 7, now },
    },
    {
      label: 'auth account with no profile doc (no-op)',
      authUser: { uid: 'u5', email: 'e@x.zm', emailVerified: false },
      docData: null,
      opts: { graceDays: 7, now },
    },
  ]

  for (const { label, authUser, docData, opts } of fixtures) {
    const { shouldWrite, reasons } = decideEmailVerifiedBackfill(authUser, docData, opts)
    console.log(`  ${shouldWrite ? 'write' : 'noop '} ${label}  (${reasons.join(', ') || 'no-change'})`)
  }
}

// Only run as a CLI entry point.
const invokedAsScript = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
  || import.meta.url.endsWith(process.argv[1]?.split(/[\\/]/).pop() ?? '')
if (invokedAsScript) {
  if (LIVE) {
    await runLive()
  } else {
    await runDryRun()
  }
}
