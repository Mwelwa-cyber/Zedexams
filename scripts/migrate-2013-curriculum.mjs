/**
 * migrate-2013-curriculum.mjs
 * ===========================
 *
 * Normalizes the 2013 Zambian curriculum into the canonical, independently-
 * addressable record shape (one record per specific outcome) and writes a
 * detailed migration report.
 *
 *   node scripts/migrate-2013-curriculum.mjs --dry-run          (default)
 *   node scripts/migrate-2013-curriculum.mjs --apply
 *   node scripts/migrate-2013-curriculum.mjs --rollback=<id>
 *   node scripts/migrate-2013-curriculum.mjs --report=path.json  (write full report)
 *
 * WHY A FILE, NOT FIRESTORE. The 2013 ("previous") curriculum is not stored in
 * Firestore — it ships as a static JSON asset read at runtime by the Syllabi
 * Studio and every studio picker:
 *   • public/syllabi/curriculum-data-2013.json   (client fetch)
 *   • functions/data/curriculum-data-2013.json   (Cloud Functions copy)
 * The *current* (2023 CBC) curriculum lives in Firestore under
 * cbcKnowledgeBase/{version}/… and its own upload/activate flow, and is NEVER
 * touched here — this script only ever reads/writes the 2013 files, satisfying
 * the "Current Curriculum isolation" requirement structurally.
 *
 * This migration is:
 *   • non-destructive  — the raw source files are left in place; the normalized
 *                        records are written to a SEPARATE companion artifact
 *                        (public/syllabi/curriculum-2013-normalized.json).
 *   • backed up        — --apply first copies any existing companion artifact to
 *                        a timestamped backup and records a manifest for rollback.
 *   • idempotent       — deterministic ids; re-running --apply reproduces byte-
 *                        identical output.
 *   • fail-soft        — a sheet that throws is recorded in the report and
 *                        skipped; the run continues.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parseSheet } from '../src/utils/curriculum2013Parser.js'
import { STUDIO_SUBJECT_TO_KB_2013 } from '../src/utils/syllabus2013Topics.js'
import { sheetNameToGrade } from '../src/utils/syllabusMapping.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_FILES = [
  path.join(ROOT, 'functions', 'data', 'curriculum-data-2013.json'),
  path.join(ROOT, 'public', 'syllabi', 'curriculum-data-2013.json'),
]
const OUTPUT_FILES = [
  path.join(ROOT, 'public', 'syllabi', 'curriculum-2013-normalized.json'),
  path.join(ROOT, 'functions', 'data', 'curriculum-2013-normalized.json'),
]
const BACKUP_DIR = path.join(ROOT, 'public', 'syllabi', '_backups')
const CURRICULUM_ID = '2013'

// A fixed timestamp keeps --apply idempotent; pass --stamp=<iso> to override.
function argVal(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const MODE = process.argv.includes('--apply') ? 'apply'
  : process.argv.find((a) => a.startsWith('--rollback=')) ? 'rollback'
    : 'dry-run'
const ROLLBACK_ID = argVal('rollback', null)
const REPORT_PATH = argVal('report', null)
const STAMP = argVal('stamp', 'migration-2013-v2')

function loadSource() {
  for (const f of SOURCE_FILES) {
    if (existsSync(f)) return { file: f, raw: JSON.parse(readFileSync(f, 'utf8')) }
  }
  throw new Error(`No 2013 source file found (looked in ${SOURCE_FILES.join(', ')})`)
}

export function resolveGrade(sheetName) {
  const code = sheetNameToGrade(sheetName)
  return { gradeId: code ? code.toLowerCase() : path.basename(String(sheetName)).toLowerCase().replace(/[^a-z0-9]+/g, '-'), gradeName: sheetName }
}
export function resolveSubject(subjectName) {
  const kb = STUDIO_SUBJECT_TO_KB_2013[subjectName]
  return { subjectId: kb || subjectName.toLowerCase().replace(/[^a-z0-9]+/g, '-'), subjectName }
}

/** Parse the whole raw object, collecting records + a per-record audit trail. */
export function migrate(raw) {
  const report = {
    curriculumId: CURRICULUM_ID,
    generatedFrom: null,
    totals: {
      recordsInspected: 0, topicsFound: 0, subtopicsFound: 0, specificOutcomesFound: 0,
      combinedOutcomesDetected: 0, combinedOutcomesSplit: 0,
      outcomesMisclassifiedAsSubtopics: 0, outcomesMisclassifiedAsTopics: 0,
      continuationRowsRepaired: 0, mergedCellsInherited: 0,
      duplicatesSkipped: 0, headingRowsRemoved: 0,
      ambiguousRows: 0, recordsNeedingReview: 0, recordsMigrated: 0, recordsFailed: 0,
    },
    sheetsFailed: [],
    reviewQueue: [],  // records requiring human confirmation (section 5 / 11)
    records: [],
  }
  const seenIds = new Set()
  const seenOutcomeKeys = new Set()  // dup detection: grade|subject|outcomeCode

  for (const [subjectName, sheets] of Object.entries(raw || {})) {
    const { subjectId, subjectName: sName } = resolveSubject(subjectName)
    for (const [sheetName, sheet] of Object.entries(sheets || {})) {
      const { gradeId, gradeName } = resolveGrade(sheetName)
      let parsed
      try {
        parsed = parseSheet(sheet, { sheetName, gradeId, gradeName, subjectId, subjectName: sName, curriculumId: CURRICULUM_ID })
      } catch (err) {
        report.sheetsFailed.push({ subject: sName, sheet: sheetName, error: String(err && err.message || err) })
        report.totals.recordsFailed++
        continue
      }
      const s = parsed.stats
      report.totals.recordsInspected += s.rowsInspected
      report.totals.topicsFound += s.topics
      report.totals.subtopicsFound += s.subtopics
      report.totals.combinedOutcomesDetected += s.combinedOutcomesDetected
      report.totals.combinedOutcomesSplit += s.combinedOutcomesSplit
      report.totals.continuationRowsRepaired += s.continuationRowsJoined
      report.totals.mergedCellsInherited += s.mergedCellsInherited
      report.totals.headingRowsRemoved += s.headerRowsRemoved

      for (const rec of parsed.records) {
        // Deterministic id + de-dupe across the whole set (idempotency).
        let id = rec.id
        let n = 2
        while (seenIds.has(id)) { id = `${rec.id}-${n++}` }
        if (id !== rec.id) report.totals.duplicatesSkipped++
        seenIds.add(id)
        rec.id = id

        if (rec.specificOutcome?.code) {
          const key = `${gradeId}|${subjectId}|${rec.specificOutcome.code}`
          if (seenOutcomeKeys.has(key)) report.totals.duplicatesSkipped++
          else seenOutcomeKeys.add(key)
          report.totals.specificOutcomesFound++
        }
        // Column-shift diagnostics (section 11 counters).
        for (const reason of rec.reviewReasons) {
          if (/subtopic .* is outcome-shaped/.test(reason)) report.totals.outcomesMisclassifiedAsSubtopics++
          if (/topic .* is outcome-shaped/.test(reason)) report.totals.outcomesMisclassifiedAsTopics++
        }
        if (rec.needsReview) {
          report.totals.recordsNeedingReview++
          report.totals.ambiguousRows++
          report.reviewQueue.push({
            id: rec.id, grade: gradeName, subject: sName,
            topic: rec.topic, subtopic: rec.subtopic, specificOutcome: rec.specificOutcome,
            problems: rec.reviewReasons, rawText: rec.source.rawText,
          })
        }
        report.totals.recordsMigrated++
        report.records.push(rec)
      }
    }
  }
  return report
}

function backupExisting() {
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true })
  const manifest = { id: `${STAMP}-${process.pid}`, stamp: STAMP, backedUp: [] }
  for (const out of OUTPUT_FILES) {
    if (existsSync(out)) {
      const dest = path.join(BACKUP_DIR, `${path.basename(out)}.${STAMP}.bak`)
      copyFileSync(out, dest)
      manifest.backedUp.push({ original: out, backup: dest })
    }
  }
  writeFileSync(path.join(BACKUP_DIR, `manifest.${STAMP}.json`), JSON.stringify(manifest, null, 2))
  return manifest
}

// Migration ids are `${STAMP}-${pid}` — letters, digits, dots, dashes,
// underscores only. Anything else (path separators, "..") is rejected so the
// id can never traverse out of BACKUP_DIR.
const SAFE_ID = /^[A-Za-z0-9._-]+$/

/** True when `child` resolves to a path inside `dir`. */
function isInsideDir(dir, child) {
  const rel = path.relative(path.resolve(dir), path.resolve(child))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function rollback(id) {
  if (!id || !SAFE_ID.test(id) || id.includes('..')) {
    console.error(`Invalid rollback id "${id}" — expected letters/digits/dot/dash/underscore only`)
    process.exit(1)
  }
  const manifestPath = path.join(BACKUP_DIR, `manifest.${id}.json`)
  const altPath = path.join(BACKUP_DIR, `manifest.${STAMP}.json`)
  const p = existsSync(manifestPath) ? manifestPath : (existsSync(altPath) ? altPath : null)
  if (!p) { console.error(`No backup manifest for "${id}" in ${BACKUP_DIR}`); process.exit(1) }
  const manifest = JSON.parse(readFileSync(p, 'utf8'))
  for (const { original, backup } of manifest.backedUp || []) {
    // Only restore FROM inside the backup dir TO one of this script's own
    // output files — a tampered manifest can't be used to write elsewhere.
    if (!isInsideDir(BACKUP_DIR, backup)) {
      console.error(`skipping ${backup}: backup path is outside ${BACKUP_DIR}`)
      continue
    }
    if (!OUTPUT_FILES.some((out) => path.resolve(out) === path.resolve(original))) {
      console.error(`skipping ${original}: not one of this migration's output files`)
      continue
    }
    if (existsSync(backup)) { copyFileSync(backup, original); console.log(`restored ${original}`) }
  }
  console.log(`Rollback complete for ${manifest.id}. Delete curriculum-2013-normalized.json manually if the backup pre-dated it.`)
}

function summarize(report) {
  const t = report.totals
  console.log('\n=== 2013 Curriculum Migration Report ===')
  console.log(`mode:                              ${MODE}`)
  console.log(`records inspected (data rows):     ${t.recordsInspected}`)
  console.log(`topics found:                      ${t.topicsFound}`)
  console.log(`subtopics found:                   ${t.subtopicsFound}`)
  console.log(`specific outcomes found:           ${t.specificOutcomesFound}`)
  console.log(`combined-outcome cells detected:   ${t.combinedOutcomesDetected}`)
  console.log(`  → outcomes after splitting:      ${t.combinedOutcomesSplit}`)
  console.log(`outcomes mis-filed as subtopics:   ${t.outcomesMisclassifiedAsSubtopics}`)
  console.log(`outcomes mis-filed as topics:      ${t.outcomesMisclassifiedAsTopics}`)
  console.log(`continuation rows repaired:        ${t.continuationRowsRepaired}`)
  console.log(`merged cells inherited:            ${t.mergedCellsInherited}`)
  console.log(`table-heading rows removed:        ${t.headingRowsRemoved}`)
  console.log(`duplicate records skipped:         ${t.duplicatesSkipped}`)
  console.log(`records requiring manual review:   ${t.recordsNeedingReview}`)
  console.log(`sheets failed:                     ${report.sheetsFailed.length}`)
  console.log(`records migrated (total):          ${t.recordsMigrated}`)
  if (report.sheetsFailed.length) {
    console.log('\nfailed sheets:')
    for (const f of report.sheetsFailed) console.log(`  - ${f.subject} / ${f.sheet}: ${f.error}`)
  }
  console.log('\nsample review-queue entries (first 5 of ' + report.reviewQueue.length + '):')
  for (const r of report.reviewQueue.slice(0, 5)) {
    console.log(`  [${r.grade} · ${String(r.subject).slice(0, 24)}] ${r.specificOutcome.code || '—'} :: ${r.problems.join('; ')}`)
  }
}

// ── main (only when run directly, not when imported by a test) ───────────────
const RUN_DIRECTLY = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (!RUN_DIRECTLY) {
  // imported — expose helpers, run nothing
} else if (MODE === 'rollback') {
  rollback(ROLLBACK_ID)
} else {
  const { file, raw } = loadSource()
  const report = migrate(raw)
  report.generatedFrom = file
  summarize(report)

  const reportOut = REPORT_PATH || path.join(ROOT, 'public', 'syllabi', 'migration-2013-report.json')
  if (MODE === 'apply') {
    const manifest = backupExisting()
    const payload = {
      curriculumId: CURRICULUM_ID,
      version: 2,
      generatedFrom: path.relative(ROOT, file),
      migrationId: manifest.id,
      recordCount: report.records.length,
      records: report.records,
    }
    for (const out of OUTPUT_FILES) {
      if (!existsSync(path.dirname(out))) mkdirSync(path.dirname(out), { recursive: true })
      writeFileSync(out, JSON.stringify(payload, null, 2))
      console.log(`\nwrote ${path.relative(ROOT, out)} (${payload.recordCount} records)`)
    }
    // The review queue + counters are always emitted (never publish ambiguous
    // corrections silently — section 5).
    writeFileSync(reportOut, JSON.stringify({ ...report, records: undefined }, null, 2))
    console.log(`wrote report ${path.relative(ROOT, reportOut)} · rollback id: ${manifest.id}`)
    console.log(`rollback with: node scripts/migrate-2013-curriculum.mjs --rollback=${manifest.id}`)
  } else {
    // Dry-run: emit the report only, no data-file writes.
    writeFileSync(reportOut, JSON.stringify({ ...report, records: undefined }, null, 2))
    console.log(`\n[dry-run] no data files written. Report: ${path.relative(ROOT, reportOut)}`)
    console.log('Run with --apply to write the normalized artifact + a rollback backup.')
  }
}
