#!/usr/bin/env node
/**
 * repair-history-form1-iron-age.mjs
 * =================================
 * Repairs the corrupted TOPIC 1.5 block in History Form 1.
 *
 * TOPIC "1.5 THE BEGINNING AND SPREAD OF IRON-WORKING AND FARMING" spans a
 * page break in the source PDF (page 8 → 9). The extractor emitted the clean
 * sub-topic row once, then three phantom fragments from the split:
 *   • a duplicate topic row with the OCR typo "SPEAD" whose LEARNING
 *     ACTIVITIES / EXPECTED STANDARD cells hold the leaked running page header
 *     ("HISTORY SYLLABUS SECON" / "DARY EDUCATION ORDINARY FORM 1-4");
 *   • a fragment row "IRO" / "and Farming" / "working" / "accordingly";
 *   • an empty-topic row carrying the CONTINUATION learning-activity bullets
 *     that belong to 1.5.1 (Relating In'gombe Ilede…, Analysing the importance
 *     of Iron technology…).
 *
 * The clean 1.5.1 row already exists but its LEARNING ACTIVITIES were cut off
 * at the page break (only the first two bullets). This script:
 *   1. rebuilds the clean row's LEARNING ACTIVITIES to the full four bullets
 *      exactly as the source prints them (no fabrication — the tail bullets are
 *      recovered verbatim from the phantom continuation row), fixing the
 *      "Kalo mo"/"Iron- working" mid-word breaks; then
 *   2. removes the three phantom fragment rows.
 *
 * Signature-matched, not index-matched: it only fires when the exact phantom
 * fragments are present, so it is idempotent and a no-op once applied. Keeps
 * both data copies identical. Dry-run by default (pass --apply to write).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const APPLY = process.argv.includes('--apply')
const FILES = ['public/syllabi/curriculum-data.json', 'functions/data/curriculum-data.json']
const SUBJECT = 'History Syllabus (Forms 1-4)'
const SHEET = 'Form 1'

// The full, source-verified LEARNING ACTIVITIES for sub-topic 1.5.1 (page 8→9).
const FULL_1_5_1_ACTIVITIES = [
  '• Locating on the map early areas of farming and Iron-working (In the Middle East and Africa)',
  '• Identifying settlement areas of Iron Age farmers in Zambia (Kalundu, Isamu Pati in Kalomo and In’gombe Ilede).',
  '• Relating In’gombe Ilede in to the global trade environment.',
  '• Analysing the importance of Iron technology (agriculture, trade, and hunting, fishing...)',
].join('\n')

// A phantom fragment row: the "SPEAD" typo duplicate, the "IRO"/"and Farming"
// splinter, or the empty-topic continuation-bullet row.
function isPhantomRow(row) {
  if (row?.type !== 'data') return false
  const c = row.cells || {}
  const topic = String(c.TOPIC || '').trim()
  const sub = String(c['SUB-TOPIC'] || '').trim()
  const act = String(c['LEARNING ACTIVITIES'] || '')
  // (a) duplicate topic row with the SPEAD typo + leaked page header
  if (/^1\.5\s+THE BEGINNING AND SPEAD OF/i.test(topic)) return true
  // (b) "IRO" / "and Farming" splinter
  if (topic === 'IRO' && /^and Farming$/i.test(sub)) return true
  // (c) empty-topic row whose activities are the 1.5.1 continuation bullets
  if (!topic && !sub && /Relating In’gombe Ilede in to the global trade/i.test(act)) return true
  return false
}

function isCleanIronRow(row) {
  if (row?.type !== 'data') return false
  const topic = String(row.cells?.TOPIC || '')
  const sub = String(row.cells?.['SUB-TOPIC'] || '')
  return /^1\.5\s+THE BEGINNING AND SPREAD OF IRON-WORKING AND FARMING/i.test(topic) &&
    /^1\.5\.1\s+Development of Iron-Technology and Farming/i.test(sub)
}

function run() {
  const primary = JSON.parse(readFileSync(join(ROOT, FILES[0]), 'utf8'))
  const sheet = primary?.[SUBJECT]?.[SHEET]
  if (!Array.isArray(sheet?.rows)) throw new Error(`${SUBJECT} / ${SHEET} not found`)

  let rebuilt = 0
  const kept = []
  for (const row of sheet.rows) {
    if (isPhantomRow(row)) continue // drop the fragment
    if (isCleanIronRow(row) && row.cells['LEARNING ACTIVITIES'] !== FULL_1_5_1_ACTIVITIES) {
      row.cells['LEARNING ACTIVITIES'] = FULL_1_5_1_ACTIVITIES
      rebuilt++
    }
    kept.push(row)
  }
  const dropped = sheet.rows.length - kept.length
  sheet.rows = kept

  console.log(`\n=== History Form 1 · TOPIC 1.5 repair ${APPLY ? '(APPLIED)' : '(DRY-RUN)'} ===\n`)
  console.log(`  phantom fragment rows removed : ${dropped}`)
  console.log(`  clean 1.5.1 activities rebuilt: ${rebuilt}`)

  if (APPLY && (dropped > 0 || rebuilt > 0)) {
    const serialized = JSON.stringify(primary, null, 2) + '\n'
    for (const rel of FILES) writeFileSync(join(ROOT, rel), serialized)
    console.log('\nApplied to both file copies.')
  } else if (!APPLY && (dropped > 0 || rebuilt > 0)) {
    console.log('\nDry-run — re-run with --apply to write.')
  } else {
    console.log('\nNothing to do (already clean).')
  }
  return { dropped, rebuilt }
}

run()
