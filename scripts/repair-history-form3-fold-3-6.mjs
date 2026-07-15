#!/usr/bin/env node
/**
 * repair-history-form3-fold-3-6.mjs
 * =================================
 * Folds History Form 3 sub-topics 3.6.1-3.6.7 into their real parent topic 3.5.
 *
 * The official HISTORY-SYLLABUS-FORMS-1-4.pdf (pp.33-37) declares topic
 * "3.5 POLITICAL AND SOCIO-ECONOMIC DEVELOPMENTS IN ZAMBIA (1964 TO DATE)"
 * with sub-topics 3.5.1, 3.5.2, then continues 3.6.1 ... 3.6.7 (Lumpa Church,
 * Adamson Mushala, military coups, UNIP foreign policy, MMD, PF, UPND) — but
 * every one of those rows has a BLANK topic cell: the PDF never declares a
 * "3.6" topic. The 3.5 title's "1964 to date" scope already covers the whole
 * UNIP->MMD->PF->UPND arc, so the "3.6.x" codes are the source's own numbering
 * slip. Per an explicit decision (and since the source supplies no 3.6 title to
 * invent), these are renumbered as the continuation of topic 3.5:
 *
 *   3.6.1 -> 3.5.3   3.6.2 -> 3.5.4   3.6.3 -> 3.5.5   3.6.4 -> 3.5.6
 *   3.6.5 -> 3.5.7   3.6.6 -> 3.5.8   3.6.7 -> 3.5.9
 *
 * Only the numeric codes change (in SUB-TOPIC and the matching competence
 * code); every title and activity is untouched, nothing invented. After this,
 * topic 3.5 runs 3.5.1..3.5.9 with no orphaned 3.6.x rows. Idempotent (no-op
 * once no 3.6.x remains). Keeps both data copies identical. Dry-run by default.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const APPLY = process.argv.includes('--apply')
const FILES = ['public/syllabi/curriculum-data.json', 'functions/data/curriculum-data.json']
const SUBJECT = 'History Syllabus (Forms 1-4)'
const SHEET = 'Form 3'

function run() {
  const primary = JSON.parse(readFileSync(join(ROOT, FILES[0]), 'utf8'))
  const sheet = primary?.[SUBJECT]?.[SHEET]
  if (!Array.isArray(sheet?.rows)) throw new Error(`${SUBJECT} / ${SHEET} not found`)

  const changes = []
  for (const row of sheet.rows) {
    if (row.type !== 'data') continue
    const sub = String(row.cells?.['SUB-TOPIC'] || '')
    const m = sub.match(/^\s*3\.6\.([1-7])\b/)
    if (!m) continue
    const n = Number(m[1])
    const oldCode = `3.6.${n}`
    const newCode = `3.5.${n + 2}`
    row.cells['SUB-TOPIC'] = sub.replace(oldCode, newCode)
    const comp = String(row.cells['SPECIFIC COMPETENCES'] || '')
    if (comp.startsWith(oldCode)) row.cells['SPECIFIC COMPETENCES'] = newCode + comp.slice(oldCode.length)
    changes.push(`${oldCode} -> ${newCode}   ${sub.replace(oldCode, '').trim().slice(0, 44)}`)
  }

  console.log(`\n=== History Form 3 · fold 3.6.x into 3.5 ${APPLY ? '(APPLIED)' : '(DRY-RUN)'} ===\n`)
  for (const c of changes) console.log(`  ✓ ${c}`)
  console.log(`\n  ${changes.length} sub-topic(s) renumbered.`)

  if (APPLY && changes.length > 0) {
    const serialized = JSON.stringify(primary, null, 2) + '\n'
    for (const rel of FILES) writeFileSync(join(ROOT, rel), serialized)
    console.log('\nApplied to both file copies.')
  } else if (!APPLY && changes.length > 0) {
    console.log('\nDry-run — re-run with --apply to write.')
  } else {
    console.log('\nNothing to do (already folded).')
  }
  return changes.length
}

run()
