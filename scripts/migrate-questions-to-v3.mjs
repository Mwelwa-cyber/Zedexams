#!/usr/bin/env node
/**
 * scripts/migrate-questions-to-v3.mjs
 *
 * Backfill existing quiz questions from HTML-only (contentVersion 1/missing)
 * to the dual HTML + Tiptap JSON format (contentVersion 3).
 *
 * ── What it does ──────────────────────────────────────────────────────
 *
 *   For every question missing `contentVersion: 3`:
 *     1. Write the ORIGINAL record to `backups/questions_pre_v3/<quizId>_<qId>`
 *        so no data is destroyed even if Zod rejects the migrated shape.
 *     2. Derive `textJSON`, `passageJSON`, `explanationJSON`,
 *        `sharedInstructionJSON` from the existing HTML fields using
 *        migrateContent() — the same function the editor uses on load.
 *     3. Validate the assembled record with the Zod schema.
 *     4. Write the merged record back.
 *     5. On Zod failure, record the reason in `migration_failures/<qId>`
 *        and leave the original untouched (fail-open on the data).
 *
 * ── Two modes ─────────────────────────────────────────────────────────
 *
 *   DRY RUN   (default)        No Firestore writes. Prints what would change.
 *   LIVE      (--live)         Performs writes. Requires service account key.
 *
 * ── Safety guarantees ─────────────────────────────────────────────────
 *
 *   • Never overwrites without first writing a backup.
 *   • Runs in batches of 400 (Firestore writeBatch cap is 500; headroom).
 *   • Skips anything already at v3 — re-running is idempotent and cheap.
 *   • On Zod failure, original record is LEFT AS-IS (no partial writes).
 *   • Logs every document touched to stdout for audit.
 *
 * ── Prerequisites for LIVE mode ───────────────────────────────────────
 *
 *   npm install --save-dev firebase-admin
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 *   # Dry run first (safe — prints only):
 *   node scripts/migrate-questions-to-v3.mjs
 *
 *   # Then live:
 *   node scripts/migrate-questions-to-v3.mjs --live
 *
 * ── Testing the migration LOGIC without touching Firestore ────────────
 *
 *   The migration logic itself is pure-function and exercised by
 *   `scripts/test-question-schema.mjs` — run that to confirm the
 *   transformation is correct before going live.
 */

import { loadAdminSdk } from './lib/adminSdk.mjs'
import { JSDOM } from 'jsdom'

// Stand up a DOM global BEFORE importing anything that touches document.
// migrateContent() → htmlToJSON() → generateJSON() requires DOMParser.
const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.DOMParser = dom.window.DOMParser
globalThis.Node = dom.window.Node
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Element = dom.window.Element

const { migrateContent } = await import('../src/editor/utils/migration.js')
const { questionWriteSchema } = await import('../src/editor/schema/question.js')

const LIVE = process.argv.includes('--live')
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : Infinity
const BATCH_SIZE = 400

// ── Pure migration logic — testable without Firestore ───────────────

/**
 * Take a question record as currently stored in Firestore and return the
 * v3 shape. Returns null if the record is already v3 (no-op).
 *
 * Throws on Zod failure — caller is responsible for catching and routing
 * to the migration_failures collection instead of writing.
 */
export function migrateQuestionRecord(raw, order) {
  if (raw?.contentVersion === 3) return null

  const type = raw.type || 'mcq'
  const isShortAnswer = type === 'short_answer' || type === 'diagram'
  const options = isShortAnswer
    ? []
    : Array.isArray(raw.options)
      ? raw.options.map(o => String(o ?? '').trim())
      : []

  const toJSON = (v) => {
    if (v == null) return null
    if (typeof v === 'string' && !v.trim()) return null
    return migrateContent(v)
  }

  const candidate = {
    type,
    detectedType: raw.detectedType || type,
    topic: String(raw.topic ?? '').trim(),
    marks: Number(raw.marks) || 1,
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : (order ?? 0),

    // HTML (unchanged — kept for reader backward-compat)
    sharedInstruction: typeof raw.sharedInstruction === 'string' ? raw.sharedInstruction : '',
    text: typeof raw.text === 'string' ? raw.text : '',
    explanation: typeof raw.explanation === 'string' ? raw.explanation : '',

    // JSON mirrors (new)
    sharedInstructionJSON: toJSON(raw.sharedInstructionJSON ?? raw.sharedInstruction),
    textJSON:              toJSON(raw.textJSON ?? raw.text),
    passageJSON:           toJSON(raw.passageJSON ?? raw.passage),
    explanationJSON:       toJSON(raw.explanationJSON ?? raw.explanation),

    options,
    correctAnswer: isShortAnswer
      ? String(raw.correctAnswer ?? '').trim()
      : Number.isInteger(raw.correctAnswer)
        ? raw.correctAnswer
        : Number(raw.correctAnswer) || 0,

    passageId: raw.passageId || null,
    imageUrl: raw.imageUrl || null,
    diagramText: raw.diagramText || null,
    requiresReview: Boolean(raw.requiresReview),
    reviewNotes: Array.isArray(raw.reviewNotes) ? raw.reviewNotes : [],
    importWarnings: Array.isArray(raw.importWarnings) ? raw.importWarnings : [],
    sourcePage: raw.sourcePage ?? null,

    contentVersion: 3,
  }

  // Preserve `passage` HTML if the record carries it, so a reader that still
  // looks for it doesn't see it disappear after migration.
  if (typeof raw.passage === 'string' && raw.passage.length > 0) {
    candidate.passage = raw.passage
  }

  const cleaned = Object.fromEntries(
    Object.entries(candidate).filter(([, v]) => v !== undefined)
  )

  return questionWriteSchema.parse(cleaned)
}

// ── Firestore runner (only imports firebase-admin when --live) ──────

async function runLive() {
  let admin
  try {
    admin = await loadAdminSdk()
  } catch {
    console.error('ERROR: --live requires `npm install --save-dev firebase-admin`')
    process.exit(1)
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('ERROR: set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path')
    process.exit(1)
  }

  admin.initializeApp()
  const db = admin.getFirestore()

  let migrated = 0
  let skipped = 0
  let failed = 0
  let inspected = 0

  // Walk every quiz's questions subcollection.
  const quizzes = await db.collection('quizzes').select().get()
  console.log(`Found ${quizzes.size} quizzes. Walking questions…`)

  for (const quizDoc of quizzes.docs) {
    if (inspected >= LIMIT) break
    const questions = await db
      .collection('quizzes').doc(quizDoc.id)
      .collection('questions').get()

    let batch = db.batch()
    let batchOps = 0

    for (const qDoc of questions.docs) {
      if (inspected >= LIMIT) break
      inspected++
      const raw = qDoc.data()

      if (raw.contentVersion === 3) { skipped++; continue }

      let migratedRecord
      try {
        migratedRecord = migrateQuestionRecord(raw, raw.order ?? 0)
        if (migratedRecord == null) { skipped++; continue }
      } catch (err) {
        failed++
        const failRef = db.collection('migration_failures').doc(`${quizDoc.id}_${qDoc.id}`)
        batch.set(failRef, {
          quizId: quizDoc.id,
          questionId: qDoc.id,
          error: String(err?.message || err),
          original: raw,
          at: admin.FieldValue.serverTimestamp(),
        })
        batchOps++
        console.log(`  FAIL  ${quizDoc.id}/${qDoc.id}  ${err?.message || err}`)
        continue
      }

      // 1. Backup the ORIGINAL first.
      const backupRef = db.collection('backups')
        .doc('questions_pre_v3')
        .collection('docs')
        .doc(`${quizDoc.id}_${qDoc.id}`)
      batch.set(backupRef, {
        quizId: quizDoc.id,
        questionId: qDoc.id,
        original: raw,
        at: admin.FieldValue.serverTimestamp(),
      })
      // 2. Write the migrated record over the original.
      batch.set(qDoc.ref, migratedRecord)
      batchOps += 2
      migrated++
      console.log(`  ok    ${quizDoc.id}/${qDoc.id}`)

      if (batchOps >= BATCH_SIZE) {
        await batch.commit()
        batch = db.batch()
        batchOps = 0
      }
    }

    if (batchOps > 0) await batch.commit()
  }

  console.log('')
  console.log(`── live migration complete ──`)
  console.log(`  inspected: ${inspected}`)
  console.log(`  migrated:  ${migrated}`)
  console.log(`  skipped:   ${skipped} (already v3 or no-op)`)
  console.log(`  failed:    ${failed} (see migration_failures collection)`)
}

async function runDryRun() {
  console.log('── DRY RUN — no Firestore writes will occur ──\n')
  console.log('Run with --live to actually perform the migration.')
  console.log('Run `npm run test:schema` to exercise migration logic against fixtures.\n')

  // Synthetic fixtures representing the shapes we've seen in production.
  const fixtures = [
    {
      label: 'legacy HTML-only mcq',
      raw: {
        type: 'mcq', marks: 2, order: 1, topic: 'Fractions',
        text: '<p>What is <strong>1/2</strong>?</p>',
        explanation: '<p>Half.</p>',
        sharedInstruction: '',
        options: ['0.5', '0.25', '0.75', '1'],
        correctAnswer: 0,
      },
    },
    {
      label: 'legacy with math node',
      raw: {
        type: 'mcq', marks: 3, order: 2, topic: 'Algebra',
        text: '<p>Solve <span class="mnode" data-latex="x^2=4">x^2=4</span></p>',
        explanation: '<p>x = ±2</p>',
        options: ['2', '-2', 'both', 'neither'],
        correctAnswer: 2,
      },
    },
    {
      label: 'short_answer with plain text',
      raw: {
        type: 'short_answer', marks: 5, order: 3, topic: 'Essay',
        text: 'Describe photosynthesis.',
        explanation: 'Light → chemical energy.',
        correctAnswer: 'photosynthesis',
      },
    },
    {
      label: 'already v3 (should be skipped)',
      raw: {
        type: 'mcq', marks: 1, order: 4, topic: 't',
        text: '<p>x</p>', explanation: '', sharedInstruction: '',
        textJSON: { type: 'doc', content: [] },
        sharedInstructionJSON: null, explanationJSON: null, passageJSON: null,
        options: ['a','b'], correctAnswer: 0, contentVersion: 3,
      },
    },
  ]

  let ok = 0, skipped = 0, failed = 0
  for (const { label, raw } of fixtures) {
    try {
      const result = migrateQuestionRecord(raw, raw.order)
      if (result == null) {
        console.log(`  skip  ${label}  (already v3)`)
        skipped++
        continue
      }
      console.log(`  ok    ${label}`)
      console.log(`        textJSON nodes: ${result.textJSON?.content?.length ?? 0}`)
      console.log(`        contentVersion: ${result.contentVersion}`)
      ok++
    } catch (err) {
      console.log(`  FAIL  ${label}  ${err?.message || err}`)
      failed++
    }
  }

  console.log('')
  console.log(`── dry run summary ──`)
  console.log(`  ok:      ${ok}`)
  console.log(`  skipped: ${skipped}`)
  console.log(`  failed:  ${failed}`)
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
