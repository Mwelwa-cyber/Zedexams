#!/usr/bin/env node
/**
 * scripts/fix-upgrade-expiry.mjs
 *
 * One-off correction for subscriptions whose renewal date was pushed out by
 * the OLD upgrade behaviour. Before the prorated-upgrade change, buying a
 * higher tier (Pro → Max) STACKED the new plan's full duration onto the
 * existing expiry instead of keeping the same renewal date. So an upgraded
 * user's expiry is too late by roughly the upgrade plan's durationDays.
 *
 * This script does NOT guess silently. By default it is a dry run that prints
 * the user's subscription fields + their successful payments + a SUGGESTED
 * corrected expiry (current expiry minus the duration of each Max upgrade that
 * followed an earlier paid subscription). You review that, then re-run with an
 * explicit --expiry to write — the explicit date is required so a human signs
 * off on the exact renewal date.
 *
 * Prereqs:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Usage:
 *   # dry-run: inspect the account + see the suggested corrected date
 *   node scripts/fix-upgrade-expiry.mjs --email teacher@example.com
 *
 *   # write the correction (date you confirmed from the dry-run)
 *   node scripts/fix-upgrade-expiry.mjs --email teacher@example.com --live --expiry 2026-09-11
 *
 * Options:
 *   --email <addr>   Required (or --uid). The account to inspect/fix.
 *   --uid <id>       Firebase Auth UID, instead of --email.
 *   --expiry <date>  Target renewal date, YYYY-MM-DD. Required to write.
 *   --live           Actually write. Default is dry-run.
 */

// Plan durations, mirrored from functions/plans.js (the stacked days == the
// upgrade plan's durationDays under the old behaviour).
const PLAN_DURATION = {
  pro_monthly: 30, pro_yearly: 365, max_monthly: 30, max_yearly: 365,
  monthly: 30, termly: 91, yearly: 365,
  grade7_monthly: 30, grade7_termly: 90, grade12_monthly: 30,
  full_platform_termly: 90, single_subject_monthly: 30,
}
const tierOf = (id) =>
  (id === 'pro_monthly' || id === 'pro_yearly') ? 'pro' :
  (id === 'max_monthly' || id === 'max_yearly') ? 'max' : null

function parseArgs(argv) {
  const args = { live: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--live') args.live = true
    else if (a === '--email') args.email = argv[++i]
    else if (a === '--uid') args.uid = argv[++i]
    else if (a === '--expiry') args.expiry = argv[++i]
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

const toDate = (v) => (typeof v?.toDate === 'function' ? v.toDate() : (v ? new Date(v) : null))
const ymd = (d) => (d ? d.toISOString().slice(0, 10) : '(none)')

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || (!args.email && !args.uid)) {
    console.log('Usage: node scripts/fix-upgrade-expiry.mjs --email <addr> [--live --expiry YYYY-MM-DD]')
    process.exit(args.help ? 0 : 1)
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
  const { Timestamp } = admin.firestore

  // Resolve the user doc.
  let userRef
  if (args.uid) {
    userRef = db.doc(`users/${args.uid}`)
  } else {
    const q = await db.collection('users').where('email', '==', args.email).limit(2).get()
    if (q.empty) { console.error(`ERROR: no user with email ${args.email}`); process.exit(1) }
    if (q.size > 1) { console.error(`ERROR: ${q.size} users share ${args.email} — pass --uid instead.`); process.exit(1) }
    userRef = q.docs[0].ref
  }
  const snap = await userRef.get()
  if (!snap.exists) { console.error(`ERROR: ${userRef.path} does not exist.`); process.exit(1) }
  const user = snap.data() || {}

  const currentExpiry = toDate(user.subscriptionExpiry)
  const teacherExpiry = toDate(user.teacherPlanExpiresAt)
  console.log(`# ${userRef.path}`)
  console.log(`  email:               ${user.email || '(unset)'}`)
  console.log(`  subscriptionPlan:    ${user.subscriptionPlan || '(unset)'}`)
  console.log(`  teacherPlan:         ${user.teacherPlan || '(unset)'}`)
  console.log(`  subscriptionExpiry:  ${ymd(currentExpiry)}`)
  console.log(`  teacherPlanExpiresAt:${ymd(teacherExpiry)}`)

  // Successful payments, oldest first.
  const pays = await db.collection('payments')
    .where('userId', '==', userRef.id)
    .get()
  const rows = pays.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((p) => p.status === 'successful' || p.status === 'confirmed')
    .sort((a, b) => (toDate(a.confirmedAt || a.createdAt)?.getTime() || 0) - (toDate(b.confirmedAt || b.createdAt)?.getTime() || 0))

  console.log(`\n  Successful payments (${rows.length}):`)
  let sawPaidSub = false
  let stackedDays = 0
  for (const p of rows) {
    const when = ymd(toDate(p.confirmedAt || p.createdAt))
    const flaggedUpgrade = p.isUpgrade === true
    // An old-style stacking upgrade = a Max purchase that followed an earlier
    // paid subscription and was NOT already prorated (no isUpgrade flag).
    const looksLikeOldUpgrade = tierOf(p.planId) === 'max' && sawPaidSub && !flaggedUpgrade
    if (looksLikeOldUpgrade) stackedDays += (PLAN_DURATION[p.planId] || 0)
    console.log(`    ${when}  ${p.planId}  K${p.amountZMW}` +
      `${flaggedUpgrade ? '  [prorated upgrade — ok]' : looksLikeOldUpgrade ? `  [old stacking upgrade → -${PLAN_DURATION[p.planId]}d]` : ''}`)
    if (tierOf(p.planId)) sawPaidSub = true
  }

  const suggested = currentExpiry && stackedDays > 0
    ? new Date(currentExpiry.getTime() - stackedDays * 86400000)
    : null
  console.log(`\n  Stacked days detected: ${stackedDays}`)
  console.log(`  Suggested corrected expiry: ${suggested ? ymd(suggested) : '(no correction needed)'}`)

  if (!args.live) {
    console.log('\n— Dry run. Re-run with --live --expiry YYYY-MM-DD to write the date you confirm above. —')
    return
  }
  if (!args.expiry || !/^\d{4}-\d{2}-\d{2}$/.test(args.expiry)) {
    console.error('ERROR: --live requires an explicit --expiry YYYY-MM-DD (review the dry-run first).')
    process.exit(1)
  }

  const target = new Date(`${args.expiry}T00:00:00Z`)
  if (Number.isNaN(target.getTime())) { console.error(`ERROR: bad --expiry ${args.expiry}`); process.exit(1) }

  const update = { subscriptionExpiry: Timestamp.fromDate(target) }
  if (teacherExpiry) update.teacherPlanExpiresAt = Timestamp.fromDate(target)
  update.subscriptionExpiryCorrectedAt = admin.firestore.FieldValue.serverTimestamp()
  update.subscriptionExpiryCorrectedBy = `script:fix-upgrade-expiry@${new Date().toISOString().slice(0, 10)}`

  await userRef.set(update, { merge: true })
  console.log(`\n✓ ${userRef.path} renewal date set to ${args.expiry}` +
    `${teacherExpiry ? ' (subscriptionExpiry + teacherPlanExpiresAt)' : ''}.`)
}

main().catch((err) => { console.error(err); process.exit(1) })
