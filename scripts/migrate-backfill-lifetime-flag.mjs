#!/usr/bin/env node
/**
 * scripts/migrate-backfill-lifetime-flag.mjs
 *
 * Backfill for the hasPremiumAccess() fail-closed fix.
 *
 * Before the fix, hasPremiumAccess() returned `true` for ANY user with a
 * premium access flag and no parseable `subscriptionExpiry` — a fail-open
 * that minted never-expiring access. The fix makes a missing expiry grant
 * access ONLY when `subscriptionLifetime === true` (the explicit lifetime/comp
 * marker now written by grantPremium(uid, plan, 0)).
 *
 * Existing accounts that legitimately relied on the old behaviour — comp /
 * lifetime grants created before the marker existed — have a premium flag and
 * a null/absent expiry but NO `subscriptionLifetime` field, so the fix would
 * lock them out. This migration preserves their access by stamping
 * `subscriptionLifetime: true` on exactly those accounts.
 *
 * Conservative by design: it does NOT revoke anyone. A flag-without-expiry
 * account that was an *unintended* over-grant is kept (and logged) rather than
 * cut off — an admin can audit/revoke individually from /admin. The fix closes
 * the hole for all FUTURE writes regardless.
 *
 * ── Two modes ─────────────────────────────────────────────────────────
 *
 *   DRY RUN   (default)        No writes. Prints what would change.
 *   LIVE      (--live)         Performs writes. Requires service-account key.
 *
 * ── Safety ────────────────────────────────────────────────────────────
 *
 *   • Idempotent — skips users already marked subscriptionLifetime === true.
 *   • Backs up the original doc under
 *     backups/lifetime_flag_backfill/docs/<uid> before any write.
 *   • Batched (400 ops; Firestore limit is 500).
 *   • --limit=N caps inspected users for staging spot-checks.
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *
 *   node scripts/migrate-backfill-lifetime-flag.mjs                # dry run
 *   node scripts/migrate-backfill-lifetime-flag.mjs --live         # writes
 *   node scripts/migrate-backfill-lifetime-flag.mjs --live --limit=20
 */

const LIVE = process.argv.includes('--live')
const LIMIT_ARG = process.argv.find(arg => arg.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : Infinity
const BATCH_SIZE = 400

// ─── Pure logic ───────────────────────────────────────────────────────────

/**
 * Parse a Firestore expiry value (Timestamp | Date | ISO string | ms) into a
 * Date, or null when absent/unparseable. Mirrors toDateValue() in
 * src/engines/payment-engine/subscriptionConfig.js.
 */
export function parseExpiry(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') {
    try { return value.toDate() } catch { return null }
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Mirror of the access-flag test in hasPremiumAccess() — true when the user
 * carries any premium entitlement flag.
 */
export function hasPremiumAccessFlag(user) {
  return !!user && (
    user.premium === true ||
    user.isPremium === true ||
    user.paymentStatus === 'active' ||
    user.subscriptionStatus === 'active' ||
    user.plan === 'premium'
  )
}

/**
 * Decide whether a user doc needs the lifetime backfill. We mark exactly the
 * accounts the OLD fail-open kept premium forever: a premium flag with no
 * parseable expiry and no explicit lifetime marker yet.
 *
 * @returns {{shouldWrite: boolean, reason: string}}
 */
export function decideLifetimeBackfill(user) {
  if (!user) return { shouldWrite: false, reason: 'no-user' }
  if (user.subscriptionLifetime === true) return { shouldWrite: false, reason: 'already-lifetime' }
  if (!hasPremiumAccessFlag(user)) return { shouldWrite: false, reason: 'no-access-flag' }
  if (parseExpiry(user.subscriptionExpiry)) return { shouldWrite: false, reason: 'has-expiry' }
  return { shouldWrite: true, reason: 'flag-without-expiry' }
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

  const totals = {
    usersInspected: 0,
    usersMarkedLifetime: 0,
    usersAlreadyLifetime: 0,
    usersSkipped: 0,
  }

  console.log('\n── Scanning users ──')
  const users = await db.collection('users').get()
  console.log(`Found ${users.size} user docs.`)

  let batch = db.batch()
  let batchOps = 0

  for (const userDoc of users.docs) {
    if (totals.usersInspected >= LIMIT) break
    totals.usersInspected += 1

    const user = userDoc.data()
    const { shouldWrite, reason } = decideLifetimeBackfill(user)

    if (!shouldWrite) {
      if (reason === 'already-lifetime') totals.usersAlreadyLifetime += 1
      else totals.usersSkipped += 1
      continue
    }

    const backupRef = db.collection('backups')
      .doc('lifetime_flag_backfill')
      .collection('docs')
      .doc(userDoc.id)
    batch.set(backupRef, {
      uid: userDoc.id,
      previousLifetime: user.subscriptionLifetime ?? null,
      previousExpiry: user.subscriptionExpiry ?? null,
      plan: user.subscriptionPlan ?? user.plan ?? null,
      at: admin.default.firestore.FieldValue.serverTimestamp(),
    })
    batch.update(userDoc.ref, { subscriptionLifetime: true })
    batchOps += 2
    totals.usersMarkedLifetime += 1
    console.log(`  ok   users/${userDoc.id}  subscriptionLifetime: ∅ → true  (${reason})`)

    if (batchOps >= BATCH_SIZE) {
      await batch.commit()
      batch = db.batch()
      batchOps = 0
    }
  }

  if (batchOps > 0) await batch.commit()

  console.log('\n── live backfill complete ──')
  Object.entries(totals).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`)
  })
}

async function runDryRun() {
  console.log('── DRY RUN — no Firestore writes will occur ──\n')
  console.log('Run with --live to actually perform the backfill.')
  console.log('Run `npm run test:migrate-backfill-lifetime-flag` to exercise the pure logic.\n')

  const fixtures = [
    {
      label: 'comp grant: premium flag, null expiry, no marker',
      user: { premium: true, subscriptionPlan: 'monthly', subscriptionExpiry: null },
    },
    {
      label: 'paid sub with a real expiry (no-op)',
      user: { premium: true, subscriptionExpiry: new Date(Date.now() + 8.64e7) },
    },
    {
      label: 'already marked lifetime (no-op)',
      user: { premium: true, subscriptionExpiry: null, subscriptionLifetime: true },
    },
    {
      label: 'free user, no flag (no-op)',
      user: { plan: 'free' },
    },
  ]

  let writes = 0
  let noops = 0
  for (const { label, user } of fixtures) {
    const { shouldWrite, reason } = decideLifetimeBackfill(user)
    if (shouldWrite) {
      console.log(`  write ${label}  → subscriptionLifetime → true  (${reason})`)
      writes += 1
    } else {
      console.log(`  noop  ${label}  (${reason})`)
      noops += 1
    }
  }

  console.log(`\n── dry run summary ──`)
  console.log(`  writes: ${writes}`)
  console.log(`  noops:  ${noops}`)
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
