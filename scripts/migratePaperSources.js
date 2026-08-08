#!/usr/bin/env node
/**
 * scripts/migratePaperSources.js
 *
 * Backfill the structured source identity onto the past-paper archive:
 * `source`, `isOfficial`, `paperNumber`, `paperKey`, `sourceConfidence`,
 * `paperMetaVersion` — and regenerate `title` from them.
 *
 * ── WHY THIS MUST RUN BEFORE THE RULES DEPLOY ─────────────────────────
 *
 * `firestore.rules` refuses a learner read of a published paper whose source
 * is missing or whose confidence is 'unknown', and the published-list index is
 * built with the same filter. Until this migration has run, every un-migrated
 * paper in the archive is admin-only. Run it (dry, then `--apply`), work the
 * "Needs labelling" queue in /admin/papers down, and THEN ship the rules.
 *
 * ── Modes ─────────────────────────────────────────────────────────────
 *
 *   DRY RUN (default)  No writes. Prints a per-document before/after table and
 *                      writes a summary JSON report.
 *   --apply            Writes, in batches, after a typed confirmation.
 *
 * ── Guarantees ────────────────────────────────────────────────────────
 *
 *   Idempotent   Any document already at paperMetaVersion >= 1 is skipped, so
 *                a second run in a row produces zero writes.
 *   Versioned    Every touched document is stamped paperMetaVersion.
 *   Never guesses  A document no pattern matches is written with source: null
 *                and sourceConfidence: 'unknown' — flagged for a human, not
 *                assigned a plausible publisher.
 *   Collisions reported, not written  Two documents deriving the same
 *                paperKey are a genuine duplicate upload or a mislabel. BOTH
 *                are held back and listed; writing one would make the archive
 *                look clean while the duplicate is still in it.
 *
 * ── Flags ─────────────────────────────────────────────────────────────
 *
 *   --apply         Actually write. Without it, nothing is written.
 *   --limit=N       Cap documents read.
 *   --batch=N       Writes per batch commit (default 400, Firestore's cap is 500).
 *   --report=PATH   Where to write the summary JSON (default ./paper-source-migration.json).
 *   --yes           Skip the typed confirmation (non-interactive runs).
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS to touch Firestore. Without it the
 * script exercises the inference against a fixture so the RULES can be
 * reviewed with no project access — the same convention as
 * migrate-diagram-assets.mjs and cleanup-phantom-assessments.
 */

import { writeFileSync } from 'node:fs'
import { planPaperSourceMigration } from '../src/utils/paperSourceMigration.js'
import { confirmByTyping } from './lib/confirmPrompt.mjs'

const APPLY = process.argv.includes('--apply')
const ASSUME_YES = process.argv.includes('--yes')
const arg = (name) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`))
  return found ? found.split('=').slice(1).join('=') : null
}
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity
const BATCH_SIZE = arg('batch') ? Number(arg('batch')) : 400
const REPORT_PATH = arg('report') || './paper-source-migration.json'
const COLLECTION = 'pastPapers'

async function loadAdmin() {
  let admin
  try {
    admin = await import('firebase-admin')
  } catch {
    console.error('ERROR: this script needs `npm install --save-dev firebase-admin`')
    process.exit(1)
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) return null
  admin.default.initializeApp()
  return admin.default
}

// ── Reporting ─────────────────────────────────────────────────────────

const cell = (v) => (v === null || v === undefined ? '—' : String(v))

function printPlan(plan) {
  console.log('\n── Per-document changes ───────────────────────────────────────')
  for (const row of plan.writes) {
    const b = row.before
    const a = row.after
    console.log(
      `  ${row.action === 'flag' ? 'FLAG ' : 'LABEL'} ${row.id}\n`
      + `        source   ${cell(b.source)} → ${cell(a.source)}\n`
      + `        official ${cell(b.isOfficial)} → ${cell(a.isOfficial)}\n`
      + `        number   ${cell(b.paperNumber)} → ${cell(a.paperNumber)}\n`
      + `        key      ${cell(b.paperKey)} → ${cell(a.paperKey)}\n`
      + `        title    ${cell(b.title)} → ${cell(a.title ?? b.title)}\n`
      + `        why      ${row.reason}`,
    )
  }
  if (plan.blocked.length) {
    console.log('\n── HELD BACK — a human must look at these ──────────────────────')
    for (const row of plan.blocked) {
      console.log(`  BLOCKED ${row.id}  ${row.reason}  ("${cell(row.before.title)}")`)
    }
  }
  if (plan.collisions.length) {
    console.log('\n── paperKey collisions ────────────────────────────────────────')
    for (const c of plan.collisions) {
      console.log(`  ${c.paperKey}\n      ${c.ids.join('\n      ')}`)
    }
    console.log(
      '\n  A collision means two documents claim to be the same paper. Either\n'
      + '  one is a duplicate upload (delete it) or one is mislabelled (fix its\n'
      + '  source, year or paper number in /admin/papers), then re-run.',
    )
  }
  const s = plan.summary
  console.log(
    `\n  read ${s.read} · label ${s.labelled} · flag ${s.flagged}`
    + ` · blocked ${s.blocked} · skipped ${s.skipped} · collisions ${s.collisions}`,
  )
}

function writeReport(plan, { applied }) {
  const report = {
    // The caller stamps the time; the planner is pure and never reads a clock.
    generatedAt: new Date().toISOString(),
    applied,
    summary: plan.summary,
    collisions: plan.collisions,
    blocked: plan.blocked.map((r) => ({ id: r.id, reason: r.reason, title: r.before.title })),
    changes: plan.writes.map((r) => ({
      id: r.id, action: r.action, reason: r.reason, before: r.before, after: r.after,
    })),
  }
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`\n  Report written to ${REPORT_PATH}`)
}

// ── Fixture mode (no credentials) ─────────────────────────────────────

const FIXTURE = [
  { id: 'f1', title: 'ECZ Grade 7 Mathematics Paper 1 2025', grade: '7', subject: 'mathematics', year: 2025 },
  { id: 'f2', title: 'In 2025 Integrated Science', grade: '7', subject: 'science', year: 2025, pdfFilename: 'PRISCA-SCI-2025.pdf' },
  { id: 'f3', title: 'Grade 7 Social Studies 2024', grade: '7', subject: 'social-studies', year: 2024 },
  { id: 'f4', title: 'Grade 7 Special Paper 1 2022', grade: '7', subject: 'special-paper-1', year: 2022, pdfPath: 'papers/x/ecz-special-2022.pdf' },
  { id: 'f5', title: 'Already done', grade: '7', subject: 'english', year: 2023, paperMetaVersion: 1 },
  // f6 and f7 derive the SAME key — a genuine duplicate upload.
  { id: 'f6', title: 'ECZ Grade 12 English Paper 1 2021', grade: '12', subject: 'english', year: 2021 },
  { id: 'f7', title: 'ECZ English Paper 1 (2021) Grade 12', grade: '12', subject: 'english', year: 2021 },
]

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const admin = await loadAdmin()

  if (!admin) {
    console.log('No GOOGLE_APPLICATION_CREDENTIALS — running the inference against a fixture.\n')
    printPlan(planPaperSourceMigration(FIXTURE))
    console.log('\nSet GOOGLE_APPLICATION_CREDENTIALS for a real run.')
    return
  }

  const db = admin.firestore()
  const snap = await db.collection(COLLECTION).get()
  const papers = []
  const existingKeys = new Map()
  for (const doc of snap.docs) {
    const data = { id: doc.id, ...doc.data() }
    // A paper already carrying a key is not re-planned, but its key still
    // occupies the namespace — otherwise this run would happily mint a second
    // document onto a key the wizard already assigned.
    if (data.paperKey && Number(data.paperMetaVersion) >= 1) {
      existingKeys.set(data.paperKey, doc.id)
    }
    if (papers.length < LIMIT) papers.push(data)
  }
  console.log(`Read ${snap.size} ${COLLECTION} docs (${papers.length} in scope).`)

  const plan = planPaperSourceMigration(papers, { existingKeys })
  printPlan(plan)

  if (!APPLY) {
    writeReport(plan, { applied: false })
    console.log('\nDry run — nothing written. Re-run with --apply to migrate.')
    return
  }
  if (!plan.writes.length) {
    writeReport(plan, { applied: false })
    console.log('\nNothing to write.')
    return
  }
  if (!ASSUME_YES) {
    const ok = await confirmByTyping(
      `About to update ${plan.writes.length} ${COLLECTION} docs `
      + `(${plan.summary.flagged} of them flagged for manual labelling).`,
      'MIGRATE',
    )
    if (!ok) { console.log('Not confirmed — nothing written.'); return }
  }

  let batch = db.batch()
  let ops = 0
  const flush = async () => {
    if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0 }
  }
  for (const row of plan.writes) {
    batch.update(db.collection(COLLECTION).doc(row.id), {
      ...row.after,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    ops += 1
    if (ops >= BATCH_SIZE) await flush()
  }
  await flush()

  writeReport(plan, { applied: true })
  console.log(`\nUpdated ${plan.writes.length} docs.`)
  if (plan.summary.flagged) {
    console.log(
      `  ${plan.summary.flagged} could not be inferred and are now in the\n`
      + '  "Needs labelling" queue at /admin/papers. They are NOT visible to\n'
      + '  learners until somebody chooses a source.',
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
