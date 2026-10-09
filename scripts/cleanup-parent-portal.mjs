#!/usr/bin/env node
/**
 * scripts/cleanup-parent-portal.mjs
 *
 * One-off cleanup after the logged-in PARENT APP was retired (parent portal
 * 4a → 4b-1 → 4b-2). It deletes the two collections that only that app could
 * ever read or finish, and REPORTS — without touching — everything else the
 * retirement left behind, so the next decision is made from numbers.
 *
 * ── What it deletes (with a backup first) ─────────────────────────────
 *
 *   guardianLinkClaims/{id}   "this guardian address was named by a child but
 *                             had no account yet". The ONLY thing that redeemed
 *                             a claim was `listGuardianChildren` on a parent's
 *                             first sign-in, and that callable is gone. A claim
 *                             is therefore permanently unredeemable, and each
 *                             one is a child's uid indexed by a parent's email
 *                             address — data with no remaining purpose.
 *   guardianInvites/{id}      co-guardian invites. Sent by `inviteCoGuardian`,
 *                             accepted by `acceptCoGuardianInvite`; both gone.
 *
 * ── What it only REPORTS ──────────────────────────────────────────────
 *
 *   parentLinks               counted by status / consent state. These are the
 *                             consent RECORD (see CLAUDE.md, "one record, two
 *                             doors"), still read by `consentGuard` and the
 *                             learner's Guardian panel, so they are never
 *                             deleted here.
 *   users with role 'parent'  counted. Deleting accounts is a different act
 *                             with its own flow; this only tells you how many.
 *   accountDeletionRequests   those still `pending_guardian`. The screen a
 *                             guardian answered them on was removed in 4b-1,
 *                             so each one now waits for the seven-day escalation
 *                             to support. The report lists their ids.
 *   progressShares            live vs expired vs revoked, and the LATEST expiry
 *                             among live ones — the date `weeklyParentDigest`
 *                             has nothing left to send to and can be deleted.
 *                             That date is only final once `createProgressShare`
 *                             refuses (it does, from the deploy of this change);
 *                             before that deploy an old client could still mint
 *                             a 90-day link.
 *
 * ── Two modes ─────────────────────────────────────────────────────────
 *
 *   DRY RUN (default)   No writes. Prints the report and what it would delete.
 *   LIVE  (--live)      Prints the same, then requires you to type DELETE.
 *
 * ── Flags ─────────────────────────────────────────────────────────────
 *
 *   --collection=<name>   Limit the DELETE to guardianLinkClaims|guardianInvites.
 *   --limit=N             Cap documents deleted PER COLLECTION.
 *   --report-only         Print the report and skip the delete section.
 *   --yes                 Skip the typed confirmation (the flag is the confirmation).
 *
 * ── Safety ────────────────────────────────────────────────────────────
 *
 *   • Dry run by default, and --live still asks.
 *   • Every deleted document is copied to
 *       backups/removed_parent_portal/docs/<collection>__<docId>
 *     in the SAME batch as its delete: if the backup cannot be written the
 *     delete does not commit either.
 *   • Re-running is idempotent — a cleaned project finds nothing to delete.
 *   • The deleting scans page on `__name__` with no filter, so they depend on
 *     no index. The REPORT uses two single-field equality queries (role,
 *     state) and an aggregate count; those use the automatic single-field
 *     indexes, and a failure there is printed and skipped rather than fatal —
 *     a report line must never block a cleanup, or the reverse.
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *
 *   node scripts/cleanup-parent-portal.mjs                  # dry run + report
 *   node scripts/cleanup-parent-portal.mjs --report-only    # report only
 *   node scripts/cleanup-parent-portal.mjs --live           # asks first
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS (a service-account JSON path).
 * Without it the script explains what it would do and exits — it never
 * pretends to have scanned anything.
 */

import { loadAdminSdk } from './lib/adminSdk.mjs'
import { confirmByTyping } from './lib/confirmPrompt.mjs'
import { isDirectRun } from './lib/isDirectRun.mjs'

/**
 * Deletion order is irrelevant here (nothing points at anything else), but the
 * list is the whole blast radius, so it is exported and pinned by a test.
 */
export const PORTAL_COLLECTIONS = ['guardianLinkClaims', 'guardianInvites']

/** Backup doc id. Flat, because a doc id is unique only within its collection. */
export function backupDocId(collection, docId) {
  return `${collection}__${docId}`
}

/**
 * Which collections a run deletes from, given a --collection value.
 * Returns [] for a name outside the list — the caller reports that as an error
 * rather than falling back to "everything", which would turn a typo into a
 * full purge.
 */
export function resolveCollections(only) {
  if (!only) return [...PORTAL_COLLECTIONS]
  return PORTAL_COLLECTIONS.filter((c) => c === only)
}

const toMillis = (v) => {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v.toMillis === 'function') return v.toMillis()
  if (typeof v.toDate === 'function') return v.toDate().getTime()
  const parsed = Date.parse(String(v))
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * parentLinks → counts keyed "<status> / <consent state>". A link with no
 * `consent` object is the grandfathered legacy shape and is labelled as such
 * rather than lumped in with a recorded answer.
 */
export function summariseLinks(links) {
  const byState = {}
  for (const l of links) {
    const status = l?.status || 'unknown'
    const consent = l?.consent?.state || (l?.consent ? 'unknown' : 'legacy (no consent record)')
    const key = `${status} / ${consent}`
    byState[key] = (byState[key] || 0) + 1
  }
  return { total: links.length, byState }
}

/**
 * progressShares → live / expired / revoked, plus the latest expiry among the
 * live ones. A share is revoked if `revokedAt` is set (checked first, as the
 * server does), expired if `expiresAt` has passed, otherwise live.
 */
export function summariseShares(shares, nowMs) {
  const out = { total: shares.length, live: 0, expired: 0, revoked: 0, latestLiveExpiryMs: null }
  for (const s of shares) {
    if (s?.revokedAt) { out.revoked += 1; continue }
    const exp = toMillis(s?.expiresAt)
    if (exp != null && exp < nowMs) { out.expired += 1; continue }
    out.live += 1
    if (exp != null && (out.latestLiveExpiryMs == null || exp > out.latestLiveExpiryMs)) {
      out.latestLiveExpiryMs = exp
    }
  }
  return out
}

const PAGE_SIZE = 300
const BATCH_SIZE = 400 // Firestore caps a batch at 500 ops; we write 2 per doc.

const LIVE = process.argv.includes('--live')
const ASSUME_YES = process.argv.includes('--yes')
const REPORT_ONLY = process.argv.includes('--report-only')
const arg = (name) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`))
  return found ? found.split('=').slice(1).join('=') : null
}
const ONLY = arg('collection')
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity

async function loadAdmin() {
  let admin
  try {
    admin = await loadAdminSdk()
  } catch {
    console.error('ERROR: this script needs `npm install --save-dev firebase-admin`')
    process.exit(1)
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) return null
  admin.initializeApp()
  return admin
}

/** Page through a collection on `__name__` so no index is needed. */
async function* pagesOf(db, collection, cap = Infinity) {
  let cursor = null
  let seen = 0
  for (;;) {
    let q = db.collection(collection).orderBy('__name__').limit(PAGE_SIZE)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) return
    const docs = snap.docs.slice(0, Math.max(0, cap - seen))
    if (docs.length) yield docs
    seen += docs.length
    if (seen >= cap || snap.docs.length < PAGE_SIZE) return
    cursor = snap.docs[snap.docs.length - 1]
  }
}

async function readAll(db, collection) {
  const rows = []
  for await (const docs of pagesOf(db, collection)) for (const d of docs) rows.push({ id: d.id, ...d.data() })
  return rows
}

async function countCollections(db, collections) {
  const counts = {}
  for (const collection of collections) {
    let n = 0
    for await (const docs of pagesOf(db, collection, LIMIT)) n += docs.length
    counts[collection] = n
  }
  return counts
}

/** Back up then delete, in one batch per chunk so a failed backup blocks its delete. */
async function purgeCollection(admin, db, collection) {
  const backupRoot = db.collection('backups').doc('removed_parent_portal').collection('docs')
  let deleted = 0
  for await (const docs of pagesOf(db, collection, LIMIT)) {
    let batch = db.batch()
    let ops = 0
    for (const doc of docs) {
      batch.set(backupRoot.doc(backupDocId(collection, doc.id)), {
        collection,
        docId: doc.id,
        original: doc.data(),
        at: admin.FieldValue.serverTimestamp(),
      })
      batch.delete(doc.ref)
      ops += 2
      if (ops >= BATCH_SIZE) {
        await batch.commit()
        batch = db.batch()
        ops = 0
      }
    }
    if (ops > 0) await batch.commit()
    deleted += docs.length
  }
  return deleted
}

/** Run one report section; a failure is printed, never fatal. */
async function section(title, fn) {
  console.log(`── ${title} ──`)
  try {
    await fn()
  } catch (err) {
    console.log(`  (could not read: ${err?.message || err})`)
  }
  console.log('')
}

async function printReport(db) {
  const now = Date.now()

  await section('parentLinks (the consent record — never deleted here)', async () => {
    const s = summariseLinks(await readAll(db, 'parentLinks'))
    console.log(`  total ${s.total}`)
    for (const [k, n] of Object.entries(s.byState).sort()) console.log(`  ${String(n).padStart(5)}  ${k}`)
  })

  await section("users with role 'parent' (not deleted here)", async () => {
    const snap = await db.collection('users').where('role', '==', 'parent').count().get()
    console.log(`  ${snap.data().count}`)
  })

  await section('accountDeletionRequests still waiting on a guardian', async () => {
    const snap = await db.collection('accountDeletionRequests').where('state', '==', 'pending_guardian').get()
    console.log(`  ${snap.size}`)
    for (const d of snap.docs) console.log(`    ${d.id}  (learner ${d.data()?.learnerId || '?'})`)
    if (snap.size) console.log('  The screen a guardian answered these on is gone; they escalate to support after 7 days.')
  })

  await section('progressShares (old parent links; weeklyParentDigest reads these)', async () => {
    const s = summariseShares(await readAll(db, 'progressShares'), now)
    console.log(`  total ${s.total}  live ${s.live}  expired ${s.expired}  revoked ${s.revoked}`)
    if (s.latestLiveExpiryMs) {
      console.log(`  latest live expiry: ${new Date(s.latestLiveExpiryMs).toISOString().slice(0, 10)}`
        + ' — after this date weeklyParentDigest has nothing to send and can be deleted.')
    } else {
      console.log('  no live shares — weeklyParentDigest has nothing to send and can be deleted now.')
    }
  })
}

async function runAgainstFirestore(admin) {
  const db = admin.getFirestore()
  const collections = resolveCollections(ONLY)
  if (collections.length === 0) {
    console.error(
      `ERROR: --collection=${ONLY} is not one this script deletes from. `
      + `Expected one of: ${PORTAL_COLLECTIONS.join(', ')}.`,
    )
    process.exitCode = 1
    return
  }

  await printReport(db)
  if (REPORT_ONLY) return

  console.log(`Scanning ${collections.join(', ')}…\n`)
  const counts = await countCollections(db, collections)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  console.log('── documents to delete ──')
  for (const collection of collections) console.log(`  ${collection.padEnd(20)} ${counts[collection]}`)
  console.log(`  ${'TOTAL'.padEnd(20)} ${total}`)

  if (total === 0) {
    console.log('\nNothing to delete — already clean.')
    return
  }
  if (!LIVE) {
    console.log('\n── DRY RUN — nothing was written. Re-run with --live to delete. ──')
    return
  }

  const ok = ASSUME_YES || await confirmByTyping(
    `About to DELETE ${total} document${total === 1 ? '' : 's'} from ${collections.join(', ')}. `
    + 'A copy of each is written to backups/removed_parent_portal first.',
  )
  if (!ok) {
    console.log('\nAborted — nothing was deleted.')
    process.exitCode = 1
    return
  }

  let deleted = 0
  for (const collection of collections) {
    const n = await purgeCollection(admin, db, collection)
    console.log(`  deleted ${n} from ${collection}`)
    deleted += n
  }
  console.log(`\nDeleted ${deleted} document${deleted === 1 ? '' : 's'}. Backups are in backups/removed_parent_portal.`)
}

function explainWithoutCredentials() {
  console.log('No GOOGLE_APPLICATION_CREDENTIALS — not scanning anything.\n')
  console.log('This script deletes every document in:\n')
  for (const c of PORTAL_COLLECTIONS) console.log(`  ${c}`)
  console.log('\nand prints a read-only report on parentLinks, parent accounts,')
  console.log('pending guardian deletion requests and progressShares. It does NOT')
  console.log('delete parentLinks, users, or accountDeletionRequests.')
  console.log('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON path,')
  console.log('then re-run for a dry run — and again with --live to delete.')
}

// Only run the CLI when this file IS the entry point, so importing it for its
// exported helpers (the test does) cannot connect to Firestore.
if (isDirectRun(import.meta.url)) {
  const admin = await loadAdmin()
  if (admin) await runAgainstFirestore(admin)
  else explainWithoutCredentials()
}
