#!/usr/bin/env node
/**
 * scripts/migrate-normalize-subjects.mjs
 *
 * One-off back-repair for quiz/lesson/note records whose `subject` field
 * holds a curriculum *id/slug* (e.g. "mathematics", "social-studies")
 * instead of the canonical display label ("Mathematics", "Social Studies").
 *
 * Background: the document importer (and some legacy docs) stamped the
 * curriculum id into `subject`. The editor <select>, the quiz write schema,
 * and every learner-facing subject filter key off the display label, so a
 * slug silently mis-classifies the record — it never lists for learners.
 * The app now self-heals on read/write via normalizeSubject() (see
 * src/config/curriculum.js), but a record nobody opens keeps its slug until
 * someone edits it. This script repairs the historical docs in bulk.
 *
 * ── What it does ──────────────────────────────────────────────────────
 *
 *   For every quizzes / lessons / notes doc:
 *     1. Run normalizeSubject() on the top-level `subject`.
 *     2. If it changed (slug -> label), back up the ORIGINAL under
 *        `backups/subject_normalize/docs/<collection>_<docId>` then write
 *        the repaired `subject` (a single-field merge update — nothing else
 *        on the doc is touched).
 *     3. Untouched docs (already a label, empty, or unrecognised) are skipped.
 *
 * ── Two modes ─────────────────────────────────────────────────────────
 *
 *   DRY RUN   (default)        No Firestore writes. Reports what WOULD change.
 *   LIVE      (--live)         Performs writes. Requires service-account key.
 *
 * ── Safety guarantees ─────────────────────────────────────────────────
 *
 *   • Never overwrites without first writing a backup.
 *   • Single-field merge — leaves every other field on the doc untouched.
 *   • Idempotent — re-running after a clean pass is a no-op (a label
 *     normalizes to itself).
 *   • Only rewrites RECOGNISED slugs; an unknown subject is left as-is so a
 *     human can decide, never silently mangled.
 *   • Batched writes (Firestore writeBatch cap = 500; we use 400 for headroom).
 *   • Pure repair logic exported so the test suite can exercise it.
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *
 *   # Dry run (safe — prints what would change):
 *   node scripts/migrate-normalize-subjects.mjs
 *
 *   # Live (requires firebase-admin + service-account JSON):
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   node scripts/migrate-normalize-subjects.mjs --live
 *
 *   # Limit to N inspected docs per collection for staging-only checks:
 *   node scripts/migrate-normalize-subjects.mjs --live --limit=50
 */

import { normalizeSubject } from '../src/config/curriculum.js'

const LIVE = process.argv.includes('--live')
const LIMIT_ARG = process.argv.find(arg => arg.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : Infinity
const BATCH_SIZE = 400

// Collections that carry a `subject` display label and can have been seeded
// with a slug by the importer or legacy writes.
const COLLECTIONS = ['quizzes', 'lessons', 'notes']

// ─── Pure repair logic ──────────────────────────────────────────────────────

/**
 * Returns `{ subject }` with the repaired display label, OR null when there
 * is nothing to do — i.e. the value is missing, already a canonical label,
 * or an unrecognised string that normalizeSubject leaves unchanged.
 *
 * `summary` is mutated in place with `{ from, to }` for the caller to log.
 */
export function repairSubject(raw, summary = {}) {
  if (!raw || typeof raw !== 'object') return null
  const current = raw.subject
  if (typeof current !== 'string' || !current) return null

  const repaired = normalizeSubject(current)
  if (repaired === current) return null

  summary.from = current
  summary.to = repaired
  return { subject: repaired }
}

// ─── Firestore runner ──────────────────────────────────────────────────────

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
    docsInspected: 0,
    docsRepaired: 0,
  }

  for (const collectionName of COLLECTIONS) {
    console.log(`\n── Scanning ${collectionName} ──`)
    const docs = await db.collection(collectionName).get()
    console.log(`Found ${docs.size} ${collectionName} docs.`)

    let batch = db.batch()
    let batchOps = 0

    for (const doc of docs.docs) {
      if (totals.docsInspected >= LIMIT) break
      totals.docsInspected += 1

      const raw = doc.data()
      const summary = {}
      const patch = repairSubject(raw, summary)
      if (!patch) continue

      const backupRef = db.collection('backups')
        .doc('subject_normalize')
        .collection('docs')
        .doc(`${collectionName}_${doc.id}`)
      batch.set(backupRef, {
        collection: collectionName,
        docId: doc.id,
        original: raw,
        at: admin.default.firestore.FieldValue.serverTimestamp(),
      })
      // Single-field merge — never clobber the rest of the doc.
      batch.set(doc.ref, patch, { merge: true })
      batchOps += 2
      totals.docsRepaired += 1
      console.log(`  ok   ${collectionName}/${doc.id}  "${summary.from}" -> "${summary.to}"`)

      if (batchOps >= BATCH_SIZE) {
        await batch.commit()
        batch = db.batch()
        batchOps = 0
      }
    }

    if (batchOps > 0) await batch.commit()
  }

  console.log('\n── live migration complete ──')
  Object.entries(totals).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`)
  })
}

async function runDryRun() {
  console.log('── DRY RUN — no Firestore writes will occur ──\n')
  console.log('Run with --live to actually perform the migration.')
  console.log('Run `npm run test:migrate-normalize-subjects` to exercise the repair logic.\n')

  // Synthetic fixtures representing the shapes seen in the wild: importer
  // output (curriculum id), already-correct labels, and odd cases.
  const fixtures = [
    { label: 'quiz with slug subject "mathematics"', record: { subject: 'mathematics' } },
    { label: 'lesson with multi-word slug "social-studies"', record: { subject: 'social-studies' } },
    { label: 'note with curriculum id "science"', record: { subject: 'science' } },
    { label: 'already-canonical label (no-op)', record: { subject: 'Mathematics' } },
    { label: 'empty subject (no-op)', record: { subject: '' } },
    { label: 'missing subject (no-op)', record: { title: 'No subject field' } },
    { label: 'unrecognised subject left as-is (no-op)', record: { subject: 'Underwater Basket Weaving' } },
  ]

  let repaired = 0
  let noop = 0
  for (const { label, record } of fixtures) {
    const summary = {}
    const patch = repairSubject(record, summary)
    if (patch) {
      console.log(`  fix   ${label}`)
      console.log(`        "${summary.from}" -> "${summary.to}"`)
      repaired += 1
    } else {
      console.log(`  noop  ${label}`)
      noop += 1
    }
  }

  console.log('\n── dry run summary ──')
  console.log(`  repaired: ${repaired}`)
  console.log(`  no-op:    ${noop}`)
}

// Only run when invoked as a CLI entry point — not when imported by tests.
const invokedAsScript = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
  || import.meta.url.endsWith(process.argv[1]?.split(/[\\/]/).pop() ?? '')
if (invokedAsScript) {
  if (LIVE) {
    await runLive()
  } else {
    await runDryRun()
  }
}
