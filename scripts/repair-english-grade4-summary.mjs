#!/usr/bin/env node
/**
 * repair-english-grade4-summary.mjs
 * =================================
 * Fixes the one mis-parented row in the English (Grades 4-6) Grade 4 sheet.
 *
 * The Grade 4 syllabus is a week-interleaved layout that cycles through the
 * four language strands (4.1 speaking, 4.2 reading, 4.3 writing, 4.4 grammar),
 * so the same topic header recurs across weeks. In one week the extractor
 * stamped the reading topic "4.2.3 READING FLUENCY" onto the WRITING-strand row
 * whose sub-topic is "4.3.5.2 Note Making" (competence 4.3.5.2.1). The sub-topic
 * code 4.3.5.2 belongs to topic "4.3.5 SUMMARY" (which already appears in this
 * same sheet carrying 4.3.5.1 Note-taking), so in the pickers Note Making
 * showed as an orphan under READING FLUENCY.
 *
 * Restores that row's topic header to "4.3.5 SUMMARY" (verbatim from the sheet's
 * own existing SUMMARY topic — nothing invented). Sub-topic and competence codes
 * are already correct and untouched. Idempotent; both data copies kept
 * byte-identical. Dry-run by default (pass --apply).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const APPLY = process.argv.includes('--apply')
const FILES = ['public/syllabi/curriculum-data.json', 'functions/data/curriculum-data.json']
const SUBJECT = 'English Language Syllabus (Grades 4-6)'
const SHEET = 'Grade 4'
const CORRECT_TOPIC = '4.3.5 SUMMARY'

function run() {
  const primary = JSON.parse(readFileSync(join(ROOT, FILES[0]), 'utf8'))
  const sheet = primary?.[SUBJECT]?.[SHEET]
  if (!Array.isArray(sheet?.rows)) throw new Error(`${SUBJECT} / ${SHEET} not found`)

  let changed = false
  for (const r of sheet.rows) {
    if (r.type !== 'data') continue
    if (/^4\.3\.5\.2 Note Making/.test(String(r.cells?.['SUB-TOPIC'] || '')) &&
        /^4\.2\.3\b/.test(String(r.cells?.TOPIC || ''))) {
      r.cells.TOPIC = CORRECT_TOPIC
      changed = true
    }
  }

  console.log(`\n=== English Grade 4 · 4.3.5.2 Note Making topic ${APPLY ? '(APPLIED)' : '(DRY-RUN)'} ===\n`)
  console.log(`  ${changed ? '✓ topic "4.2.3 READING FLUENCY" -> "4.3.5 SUMMARY" on the Note Making row' : 'nothing to do (already under 4.3.5 SUMMARY)'}`)

  if (APPLY && changed) {
    const serialized = JSON.stringify(primary, null, 2) + '\n'
    for (const rel of FILES) writeFileSync(join(ROOT, rel), serialized)
    console.log('\nApplied to both file copies.')
  } else if (!APPLY && changed) {
    console.log('\nDry-run — re-run with --apply to write.')
  }
  return changed
}

run()
