#!/usr/bin/env node
/**
 * repair-physics-form4-renewable.mjs
 * ==================================
 * Fixes the mis-numbered sub-topic under Physics Form 4 topic "4.4 RENEWABLE
 * ENERGY SYSTEM". The official PDF (PHYSICS-SYLLABUS-O-LEVEL-FORM-1-4.pdf p.33)
 * prints the topic as 4.4 but codes its only sub-topic "4.2.1 Renewable Energy
 * Systems" (competence "4.2.1.1") — a copy-paste typo, since the sub-topic of
 * topic 4.4 must be 4.4.1. In the studio pickers this shows as an orphan
 * (sub-topic 4.2.1 under topic 4.4).
 *
 * Renumbers the sub-topic 4.2.1 -> 4.4.1 and its competence 4.2.1.1 -> 4.4.1.1.
 * Only the numeric codes change; the title and activities are untouched,
 * nothing invented. Idempotent (no-op once renumbered). Keeps both data copies
 * byte-identical. Dry-run by default (pass --apply).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const APPLY = process.argv.includes('--apply')
const FILES = ['public/syllabi/curriculum-data.json', 'functions/data/curriculum-data.json']
const SUBJECT = 'Physics Syllabus (Forms 1-4)'
const SHEET = 'Form 4'

function run() {
  const primary = JSON.parse(readFileSync(join(ROOT, FILES[0]), 'utf8'))
  const sheet = primary?.[SUBJECT]?.[SHEET]
  if (!Array.isArray(sheet?.rows)) throw new Error(`${SUBJECT} / ${SHEET} not found`)

  let changed = false
  for (const r of sheet.rows) {
    if (r.type !== 'data') continue
    if (/^4\.4\b/.test(String(r.cells?.TOPIC || '')) &&
        /^4\.2\.1 Renewable Energy Systems/.test(String(r.cells?.['SUB-TOPIC'] || ''))) {
      r.cells['SUB-TOPIC'] = r.cells['SUB-TOPIC'].replace(/^4\.2\.1/, '4.4.1')
      const comp = String(r.cells['SPECIFIC COMPETENCES'] || '')
      if (comp.startsWith('4.2.1')) r.cells['SPECIFIC COMPETENCES'] = comp.replace(/^4\.2\.1/, '4.4.1')
      changed = true
    }
  }

  console.log(`\n=== Physics Form 4 · 4.4 RENEWABLE ENERGY SYSTEM ${APPLY ? '(APPLIED)' : '(DRY-RUN)'} ===\n`)
  console.log(`  ${changed ? '✓ 4.2.1 Renewable Energy Systems -> 4.4.1 (comp 4.2.1.1 -> 4.4.1.1)' : 'nothing to do (already 4.4.1)'}`)

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
