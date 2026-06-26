#!/usr/bin/env node
/**
 * scripts/migrate-sanitize-generations.mjs
 *
 * One-off cleanup for teacher-generated content saved with characters XML 1.0
 * forbids. AI-generated artifacts (lesson plans, worksheets, assessments, …)
 * occasionally captured a stray C0 control byte or a lone surrogate (from a
 * truncated emoji) in their text. The .docx exporters now strip those at export
 * time (see src/utils/xmlText.js), so NEW downloads are clean — but artifacts
 * already stored in Firestore still carry the bad bytes, and a teacher who
 * re-downloads one before re-saving would still hit Word's "unreadable content"
 * / "alternate formats" error. This script scrubs the stored copies so even an
 * untouched old artifact exports cleanly.
 *
 * ── What it does ──────────────────────────────────────────────────────
 *
 *   For every `aiGenerations` doc:
 *     1. Deep-sanitise the `output` object (the structured artifact the docx
 *        exporters read) and the `outputText` string (the raw LLM response),
 *        stripping XML-illegal control bytes / lone surrogates from every
 *        string while keeping tab/newline/CR and whole emoji.
 *     2. Before any write, save the ORIGINAL doc under
 *        `backups/generations_xml_cleanup/docs/aiGenerations_<docId>` so a
 *        botched run can be rolled back.
 *     3. Write back only the changed fields with { merge: true }.
 *
 *   The cleaning reuses the exact same sanitiser the exporters use
 *   (src/utils/xmlText.js), so "clean here" and "clean at export" can never
 *   drift apart.
 *
 * ── Two modes ─────────────────────────────────────────────────────────
 *
 *   DRY RUN   (default)        No Firestore writes. Reports what WOULD change.
 *   LIVE      (--live)         Performs writes. Requires service-account key.
 *
 * ── Safety guarantees ─────────────────────────────────────────────────
 *
 *   • Never overwrites without first writing a backup.
 *   • Idempotent — re-running after a clean pass is a no-op (sanitising an
 *     already-clean string returns the identical string → nothing to write).
 *   • Skips docs with no illegal characters anywhere (the overwhelming majority).
 *   • Only touches `output` / `outputText`; never timestamps, ids, or metadata.
 *   • Batched writes (Firestore writeBatch cap = 500; we use 400 for headroom).
 *   • Pure cleaning logic exported so the test suite can exercise it.
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *
 *   # Dry run (safe — exercises the cleaning logic on fixtures):
 *   node scripts/migrate-sanitize-generations.mjs
 *
 *   # Live (requires firebase-admin + service-account JSON):
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   node scripts/migrate-sanitize-generations.mjs --live
 *
 *   # Limit to N inspected docs for staging-only checks:
 *   node scripts/migrate-sanitize-generations.mjs --live --limit=50
 */

import { sanitizeXmlText } from '../src/utils/xmlText.js'

const LIVE = process.argv.includes('--live')
const LIMIT_ARG = process.argv.find(arg => arg.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : Infinity
const BATCH_SIZE = 400

// ─── Pure cleaning logic ───────────────────────────────────────────────────

// A plain JSON container we're safe to clone and recurse into. Firestore admin
// values like Timestamp / GeoPoint / DocumentReference are class instances with
// a non-Object prototype, so this leaves them untouched — though in practice we
// only ever walk `output` / `outputText`, which are plain JSON.
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Deep-sanitise every string inside `value`. Returns `{ value, changed, count }`
 * where `count` is how many string values were altered. Non-string, non-plain
 * values pass through unchanged; arrays and plain objects are rebuilt only when
 * something below them changed (so unchanged subtrees keep their identity).
 */
export function deepSanitizeStrings(value) {
  if (typeof value === 'string') {
    const next = sanitizeXmlText(value)
    return { value: next, changed: next !== value, count: next !== value ? 1 : 0 }
  }
  if (Array.isArray(value)) {
    let changed = false
    let count = 0
    const next = value.map((item) => {
      const r = deepSanitizeStrings(item)
      if (r.changed) { changed = true; count += r.count }
      return r.value
    })
    return { value: changed ? next : value, changed, count }
  }
  if (isPlainObject(value)) {
    let changed = false
    let count = 0
    const next = {}
    for (const [k, v] of Object.entries(value)) {
      const r = deepSanitizeStrings(v)
      if (r.changed) { changed = true; count += r.count }
      next[k] = r.value
    }
    return { value: changed ? next : value, changed, count }
  }
  return { value, changed: false, count: 0 }
}

/**
 * Returns `{ patch, count }` for an aiGenerations doc — a merge patch containing
 * only the changed fields (`output` and/or `outputText`) — or null when the doc
 * carries no XML-illegal characters (the common case).
 */
export function cleanGenerationXml(raw) {
  if (!raw || typeof raw !== 'object') return null
  const patch = {}
  let count = 0

  if ('output' in raw && raw.output != null) {
    const r = deepSanitizeStrings(raw.output)
    if (r.changed) { patch.output = r.value; count += r.count }
  }
  if (typeof raw.outputText === 'string') {
    const next = sanitizeXmlText(raw.outputText)
    if (next !== raw.outputText) { patch.outputText = next; count += 1 }
  }

  return count > 0 ? { patch, count } : null
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

  const totals = { inspected: 0, cleaned: 0, stringHits: 0 }

  console.log('\n── Scanning aiGenerations ──')
  const snap = await db.collection('aiGenerations').get()
  console.log(`Found ${snap.size} aiGenerations docs.`)

  let batch = db.batch()
  let batchOps = 0

  for (const doc of snap.docs) {
    if (totals.inspected >= LIMIT) break
    totals.inspected += 1

    const raw = doc.data()
    const result = cleanGenerationXml(raw)
    if (!result) continue

    const backupRef = db.collection('backups')
      .doc('generations_xml_cleanup')
      .collection('docs')
      .doc(`aiGenerations_${doc.id}`)
    batch.set(backupRef, {
      collection: 'aiGenerations',
      docId: doc.id,
      original: raw,
      at: admin.default.firestore.FieldValue.serverTimestamp(),
    })
    batch.set(doc.ref, result.patch, { merge: true })
    batchOps += 2
    totals.cleaned += 1
    totals.stringHits += result.count
    console.log(`  ok   aiGenerations/${doc.id}  tool:${raw.tool || '—'}  strings:${result.count}`)

    if (batchOps >= BATCH_SIZE) {
      await batch.commit()
      batch = db.batch()
      batchOps = 0
    }
  }

  if (batchOps > 0) await batch.commit()

  console.log('\n── live migration complete ──')
  Object.entries(totals).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`)
  })
}

async function runDryRun() {
  console.log('── DRY RUN — no Firestore writes will occur ──\n')
  console.log('Run with --live to actually perform the migration.')
  console.log('Run `npm run test:migrate-sanitize-generations` to exercise the cleaning logic.\n')

  // Illegal characters built via fromCharCode so this file holds no raw control
  // bytes / lone surrogates. NUL=0x00, US=0x1F, lone high surrogate = 0xD83E.
  const cc = (n) => String.fromCharCode(n)
  const NUL = cc(0x00)
  const US = cc(0x1f)
  const LONE_HI = cc(0xd83e)

  const fixtures = [
    {
      label: 'lesson_plan with control byte in a stage activity',
      record: {
        tool: 'lesson_plan',
        output: {
          header: { subject: `Mathematics${NUL}`, topic: 'Exploring My World' },
          stages: [{ name: `Introduction${US}`, teacherActivities: [`Show objects${NUL}`] }],
        },
        outputText: `Lesson plan${US} text`,
      },
    },
    {
      label: 'worksheet with a lone surrogate in outputText only',
      record: { tool: 'worksheet', output: { title: 'Clean' }, outputText: `Trunc emoji${LONE_HI}` },
    },
    {
      label: 'clean lesson_plan (no-op)',
      record: { tool: 'lesson_plan', output: { header: { subject: 'Science' }, stages: [] }, outputText: 'all good' },
    },
    {
      label: 'doc with no output field (no-op)',
      record: { tool: 'flashcards', status: 'generating' },
    },
  ]

  let cleaned = 0
  let noop = 0
  for (const { label, record } of fixtures) {
    const result = cleanGenerationXml(record)
    if (result) {
      console.log(`  clean ${label}`)
      console.log(`        strings:${result.count} fields:${Object.keys(result.patch).join(',')}`)
      cleaned += 1
    } else {
      console.log(`  noop  ${label}`)
      noop += 1
    }
  }

  console.log('\n── dry run summary ──')
  console.log(`  cleaned: ${cleaned}`)
  console.log(`  no-op:   ${noop}`)
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
