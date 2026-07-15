#!/usr/bin/env node
/**
 * remove-garbled-recap-rows.mjs
 * =============================
 * Removes garbled "revision recap" rows the PDF extraction scrambled into the
 * curriculum data. A few Form 4 sheets end with a multi-column recap of the
 * Forms 1-4 content ("Form 1 Content", "Form 2 Content", …); the extractor
 * collapsed those columns into single cells and split words mid-token
 * ("For" + "m 1 Content"), leaving rows whose TOPIC cell contains the leaked
 * "SUB-TOPIC" column header — something no real topic title ever does. Those
 * rows surface in the studio pickers as garbage "topics".
 *
 * The recap only repeats content that already exists correctly in Forms 1-3,
 * so (per an explicit decision) these rows are removed rather than rebuilt.
 *
 * Signature: a `data` row whose TOPIC cell matches /sub\s*-?\s*topic/i. This is
 * a leaked column header and cannot appear in a legitimate topic title, so the
 * match is exact to the garbled rows. Idempotent; dry-run by default.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const APPLY = process.argv.includes('--apply')
const FILES = ['public/syllabi/curriculum-data.json', 'functions/data/curriculum-data.json']

// A leaked column-header fragment in the TOPIC cell — the tell of a garbled
// recap row. Real topic titles never contain "sub-topic".
export const GARBLED_TOPIC = /sub\s*-?\s*topic/i

const primary = JSON.parse(readFileSync(join(ROOT, FILES[0]), 'utf8'))
const removed = []

for (const [subject, sheets] of Object.entries(primary || {})) {
  for (const [sheetName, sheet] of Object.entries(sheets || {})) {
    if (!Array.isArray(sheet?.rows)) continue
    const kept = []
    for (const row of sheet.rows) {
      if (row?.type === 'data' && GARBLED_TOPIC.test(String(row.cells?.TOPIC || ''))) {
        removed.push({ subject, sheet: sheetName, topic: String(row.cells.TOPIC || '').slice(0, 70) })
        continue
      }
      kept.push(row)
    }
    sheet.rows = kept
  }
}

console.log(`\n=== Garbled recap-row removal ${APPLY ? '(APPLIED)' : '(DRY-RUN)'} ===\n`)
for (const r of removed) {
  console.log(`  ✗ remove [${r.subject} / ${r.sheet}]  TOPIC=${JSON.stringify(r.topic)}…`)
}
console.log(`\n${removed.length} garbled row(s) removed.`)

if (APPLY && removed.length > 0) {
  const serialized = JSON.stringify(primary, null, 2) + '\n'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (const rel of FILES) {
    const abs = join(ROOT, rel)
    writeFileSync(`${abs}.${stamp}.bak`, readFileSync(abs, 'utf8'))
    writeFileSync(abs, serialized)
  }
  console.log('Applied to both file copies (.bak saved).')
} else if (!APPLY && removed.length > 0) {
  console.log('Dry-run — re-run with --apply to write.')
}
