/**
 * One-off repair: rebuild the derived text fields on existing `questionBank`
 * rows whose stem was stored as a stringified Tiptap doc.
 *
 * The quiz editor saves rich fields as stringified Tiptap JSON
 * (serializeRichField in src/utils/quizSections.js), and the capture path
 * (source `quiz_studio`) banked that verbatim. The old bankPreview/plainify
 * helpers ran it through richTextToPlainText, which doesn't decode Tiptap JSON —
 * so `preview` (and `keywords` / `fingerprint` / `simhashTokens`) captured the
 * raw `{"type":"doc",...}` text instead of the readable stem. The helper is now
 * fixed (extractRichTextPlain); this backfills the already-stored rows so their
 * card titles, search, and dedup fingerprints match what a fresh capture writes.
 *
 * SAFE BY DEFAULT — dry-run, no writes:
 *   GOOGLE_APPLICATION_CREDENTIALS=sa.json node scripts/migrate-repair-question-bank-previews.mjs
 *
 * Apply (re-runs are idempotent — only rows whose derived fields actually
 * change are touched):
 *   … node scripts/migrate-repair-question-bank-previews.mjs --live
 *
 * Flags:
 *   --live       perform writes (default: dry-run, read-only)
 *   --limit=N    cap the number of rows processed
 *   --source=s   only repair rows with this `source` (e.g. quiz_studio)
 */

import {
  bankPreview, extractKeywords, questionFingerprint, questionTokens,
} from '../src/utils/questionBankCore.js'

const ARGV = process.argv.slice(2)
const LIVE = ARGV.includes('--live')
const arg = (name, dflt) => {
  const hit = ARGV.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=')[1] : dflt
}
const LIMIT = Number(arg('limit', '')) || Infinity
const ONLY_SOURCE = arg('source', '')

function parseData(row) {
  try { return JSON.parse(row?.data || 'null') } catch { return null }
}

/** Arrays are compared order-sensitively — keywords/tokens are stored sorted. */
function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

const stats = { scanned: 0, parsed: 0, changed: 0, written: 0, skippedNoData: 0 }

async function run() {
  const admin = (await import('firebase-admin')).default
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('ERROR: set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path.')
    process.exit(1)
  }
  if (!admin.apps.length) admin.initializeApp()
  const db = admin.firestore()
  const FieldValue = admin.firestore.FieldValue

  console.log(`Mode: ${LIVE ? 'LIVE (writing)' : 'DRY-RUN (no writes)'}${ONLY_SOURCE ? `; source=${ONLY_SOURCE}` : ''}.\n`)

  let query = db.collection('questionBank')
  if (ONLY_SOURCE) query = query.where('source', '==', ONLY_SOURCE)
  const snap = await query.get()

  let batch = LIVE ? db.batch() : null
  let batchOps = 0
  const samples = []

  for (const docSnap of snap.docs) {
    if (stats.scanned >= LIMIT) break
    stats.scanned += 1
    const row = docSnap.data() || {}
    const question = parseData(row)
    if (!question) { stats.skippedNoData += 1; continue }
    stats.parsed += 1

    const meta = { subject: row.subject, grade: row.grade, topic: row.topic, subtopic: row.subtopic }
    const next = {
      preview: bankPreview(question),
      keywords: extractKeywords(question, meta),
      fingerprint: questionFingerprint(question),
      simhashTokens: questionTokens(question),
    }

    const changed =
      next.preview !== row.preview ||
      next.fingerprint !== row.fingerprint ||
      !arraysEqual(next.keywords, row.keywords) ||
      !arraysEqual(next.simhashTokens, row.simhashTokens)
    if (!changed) continue
    stats.changed += 1

    if (samples.length < 8) {
      samples.push({ id: docSnap.id, from: String(row.preview || '').slice(0, 50), to: next.preview.slice(0, 50) })
    }

    if (LIVE) {
      batch.update(docSnap.ref, { ...next, updatedAt: FieldValue.serverTimestamp() })
      batchOps += 1
      stats.written += 1
      if (batchOps >= 400) { await batch.commit(); batch = db.batch(); batchOps = 0 }
    }
  }
  if (LIVE && batchOps > 0) await batch.commit()

  console.log('── Sample repairs (preview before → after) ──')
  for (const s of samples) console.log(`  ${s.id}\n    from: ${s.from}…\n    to:   ${s.to}…`)
  console.log('\n── Summary ──')
  console.log(JSON.stringify(stats, null, 2))
  console.log(`\n${LIVE ? `Repaired ${stats.written} rows.` : `DRY-RUN: would repair ${stats.changed} rows. Re-run with --live to apply.`}`)
}

await run()
