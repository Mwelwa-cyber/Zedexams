#!/usr/bin/env node
/**
 * scripts/backfill-link-consent.mjs
 *
 * Stamp `consent` onto every `parentLinks` document written before consent
 * moved onto the link.
 *
 *   npm run backfill:link-consent:dry     # counts only, writes nothing
 *   npm run backfill:link-consent:live    # writes
 *
 * ── Why this exists ───────────────────────────────────────────────────
 *
 * A link with no `consent` object is read as APPROVED by
 * guardianLinkCore.linkIsApproved while `enforceMigration` is false. That
 * grace is what stops the deploy that shipped consent-on-links from
 * locking every existing parent out of their own dashboard — but it is a
 * standing exception, and a standing exception that nobody ever closes is
 * indistinguishable from a bug. This script closes it: once every legacy
 * link states its own consent, the flag can be flipped and a link with no
 * record stops being trusted.
 *
 * ── What it writes, and what it deliberately does not ────────────────
 *
 * A legacy link is stamped `state: 'approved'`, `method: 'family_code'`,
 * and `grandfathered: true`.
 *
 *   • `approved` because that is what the link has BEEN doing. Every one
 *     of these was created by a parent successfully redeeming a code the
 *     child minted, and the portal has been serving that parent their
 *     child's progress ever since. Writing `pending` instead would not be
 *     more careful — it would silently revoke thousands of live guardian
 *     relationships and present it as a migration.
 *
 *   • `family_code` because it is the only door that existed when these
 *     were written. The email-consent door did not create links at all.
 *
 *   • `grandfathered: true` because "approved" here means "inferred from
 *     a successful redemption", NOT "a child tapped yes on their own
 *     device". Those are different strengths of evidence and a support
 *     agent — or a regulator — must be able to tell them apart. It is
 *     also what a future prompt-the-child-to-reconfirm campaign would
 *     query on.
 *
 * `grantedAt` is taken from the link's own `createdAt`, never from now:
 * a consent record dated the day of the migration would misreport every
 * one of these relationships as having started this week.
 *
 * A link that ALREADY states a consent — including `pending` — is never
 * touched. The grace is for silence, not for a recorded answer.
 *
 * Idempotent. Safe to re-run.
 */

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import * as fs from 'fs'

import { LINK_CONSENT, LINK_METHOD, normalizeLink } from '../functions/shared/guardian/guardianLinkCore.js'

const LIVE = process.argv.includes('--live')

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

const snap = await db.collection('parentLinks').get()
console.log(`parentLinks: ${snap.size} documents`)

const legacy = []
let alreadyStated = 0
for (const doc of snap.docs) {
  const data = doc.data() || {}
  if (normalizeLink(data).hasConsentRecord) { alreadyStated += 1; continue }
  legacy.push({ ref: doc.ref, id: doc.id, data })
}

console.log(`  already state their consent: ${alreadyStated}`)
console.log(`  legacy, to be grandfathered: ${legacy.length}`)

if (legacy.length === 0) {
  console.log('\nNothing to do. The migration grace in guardianLinkCore can be')
  console.log('switched off (enforceMigration) once this reports zero on a live run.')
  process.exit(0)
}

for (const row of legacy.slice(0, 10)) {
  console.log(`    ${row.id}  parent=${row.data.parentUid} learner=${row.data.learnerUid}`)
}
if (legacy.length > 10) console.log(`    … and ${legacy.length - 10} more`)

if (!LIVE) {
  console.log('\ndry run — pass --live to write')
  process.exit(0)
}

let written = 0
let failed = 0
// Batched in 400s: Firestore's limit is 500 writes and leaving headroom
// beats discovering the boundary on the run that matters.
for (let i = 0; i < legacy.length; i += 400) {
  const chunk = legacy.slice(i, i + 400)
  const batch = db.batch()
  for (const row of chunk) {
    batch.set(row.ref, {
      consent: {
        state: LINK_CONSENT.APPROVED,
        method: LINK_METHOD.FAMILY_CODE,
        // The link's own creation time, not the migration's. See header.
        grantedAt: row.data.createdAt || null,
        withdrawnAt: null,
        grandfathered: true,
        grandfatheredAt: FieldValue.serverTimestamp(),
      },
    }, { merge: true })
  }
  try {
    await batch.commit()
    written += chunk.length
    console.log(`  committed ${written}/${legacy.length}`)
  } catch (err) {
    failed += chunk.length
    console.error(`  batch at ${i} FAILED:`, err.message)
  }
}

console.log(`\nwritten: ${written}   failed: ${failed}`)
if (failed) process.exitCode = 1
