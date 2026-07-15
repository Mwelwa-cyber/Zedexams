#!/usr/bin/env node
/**
 * repair-hospitality-form1-11-content.mjs
 * =======================================
 * Rebuilds the corrupted TOPIC 1.1 block of Hospitality Form 1.
 *
 * The extractor collapsed two source rows (1.1.1 and 1.1.2) into ONE:
 *   - SUB-TOPIC keeps only "1.1.1. Historical Overview";
 *   - the competence cell holds 1.1.2's competence ("1.1.2.1 Apply traditional
 *     and modern hospitality practices…"), so 1.1.1's own competence is lost;
 *   - LEARNING ACTIVITIES concatenates 1.1.1's six bullets AND 1.1.2's four;
 *   - EXPECTED STANDARD concatenates both rows' standard lines.
 * Sub-topic "1.1.2 Traditional and modern hospitality practices in Zambia"
 * therefore has no row at all. Separately, the Benefits row (1.1.3) carries the
 * official PDF's own competence-code typo "1.1.1.1" (should be 1.1.3.1).
 *
 * Verified against HOSPITALITY-MANAGEMENT.pdf pp.1-4, this splits the merged
 * row back into 1.1.1 and 1.1.2 and fixes the 1.1.3 competence code. The
 * activity/standard text is partitioned from the existing merged cells
 * verbatim (1.1.1 = the first six activity bullets + the first standard line;
 * 1.1.2 = the remaining four bullets + the second standard line); the only
 * text supplied from the source is 1.1.1's missing competence
 * ("1.1.1.1. Demonstrate understanding of the historical background of
 * hospitality industry"), transcribed verbatim. Nothing is invented.
 *
 * Signature-matched + idempotent: fires only while row 1.1.1 still carries the
 * merged "1.1.2.1" competence. Keeps both data copies identical. Dry-run by
 * default (pass --apply).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const APPLY = process.argv.includes('--apply')
const FILES = ['public/syllabi/curriculum-data.json', 'functions/data/curriculum-data.json']
const SUBJECT = 'Hospitality Management Syllabus (Forms 1-4)'
const SHEET = 'Form 1'

// 1.1.1's competence — missing from the merged row, transcribed from p.2.
const COMP_111 = '1.1.1.1. Demonstrate understanding of the historical background of hospitality industry'

function run() {
  const primary = JSON.parse(readFileSync(join(ROOT, FILES[0]), 'utf8'))
  const sheet = primary?.[SUBJECT]?.[SHEET]
  if (!Array.isArray(sheet?.rows)) throw new Error(`${SUBJECT} / ${SHEET} not found`)

  const idx = sheet.rows.findIndex((r) =>
    r.type === 'data' &&
    /^1\.1\.1\.\s*Historical Overview/.test(String(r.cells?.['SUB-TOPIC'] || '')) &&
    String(r.cells?.['SPECIFIC COMPETENCES'] || '').startsWith('1.1.2.1'))

  let splitDone = false
  if (idx !== -1) {
    const row = sheet.rows[idx]
    const acts = String(row.cells['LEARNING ACTIVITIES'] || '').split('\n')
    const std = String(row.cells['EXPECTED STANDARD'] || '')
    const comp112 = String(row.cells['SPECIFIC COMPETENCES'] || '') // 1.1.2's competence

    // Activities: first 6 bullets -> 1.1.1; the rest -> 1.1.2 (re-splitting the
    // one bullet the extractor glued onto the "Illustrating…" line).
    const act111 = acts.slice(0, 6).join('\n')
    const act112 = acts.slice(6).join('\n')
      .replace(') Developing Group hospitality norms', ')\n• Developing Group hospitality norms')

    // Standard: split the two concatenated lines.
    const marker = 'Traditional and modern hospitality practices'
    const cut = std.indexOf(marker)
    const std111 = cut > -1 ? std.slice(0, cut).trim() : std
    const std112 = cut > -1 ? '• ' + std.slice(cut).trim() : ''

    // Rewrite the merged row as a clean 1.1.1 …
    row.cells['SPECIFIC COMPETENCES'] = COMP_111
    row.cells['LEARNING ACTIVITIES'] = act111
    row.cells['EXPECTED STANDARD'] = std111

    // … and insert the recovered 1.1.2 row right after it.
    sheet.rows.splice(idx + 1, 0, {
      type: 'data',
      cells: {
        TOPIC: '',
        'SUB-TOPIC': '1.1.2 Traditional and modern hospitality practices in Zambia',
        'SPECIFIC COMPETENCES': comp112,
        'LEARNING ACTIVITIES': act112,
        'EXPECTED STANDARD': std112,
      },
    })
    splitDone = true
  }

  // Fix the 1.1.3 Benefits competence code typo (source prints "1.1.1.1").
  let compFixed = false
  for (const row of sheet.rows) {
    if (row.type !== 'data') continue
    if (/^1\.1\.3\.\s*Benefits/.test(String(row.cells?.['SUB-TOPIC'] || '')) &&
        String(row.cells['SPECIFIC COMPETENCES'] || '').startsWith('1.1.1.1')) {
      row.cells['SPECIFIC COMPETENCES'] = row.cells['SPECIFIC COMPETENCES'].replace(/^1\.1\.1\.1/, '1.1.3.1')
      compFixed = true
    }
  }

  console.log(`\n=== Hospitality Form 1 · TOPIC 1.1 content rebuild ${APPLY ? '(APPLIED)' : '(DRY-RUN)'} ===\n`)
  console.log(`  1.1.1/1.1.2 merged row split : ${splitDone ? 'yes (1.1.2 recovered)' : 'no (already split)'}`)
  console.log(`  1.1.3 competence code fixed  : ${compFixed ? 'yes (1.1.1.1 -> 1.1.3.1)' : 'no (already 1.1.3.1)'}`)

  if (APPLY && (splitDone || compFixed)) {
    const serialized = JSON.stringify(primary, null, 2) + '\n'
    for (const rel of FILES) writeFileSync(join(ROOT, rel), serialized)
    console.log('\nApplied to both file copies.')
  } else if (!APPLY && (splitDone || compFixed)) {
    console.log('\nDry-run — re-run with --apply to write.')
  } else {
    console.log('\nNothing to do (already rebuilt).')
  }
  return { splitDone, compFixed }
}

run()
