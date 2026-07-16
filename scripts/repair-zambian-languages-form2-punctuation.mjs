#!/usr/bin/env node
/**
 * repair-zambian-languages-form2-punctuation.mjs
 * ==============================================
 * Fixes the one orphaned sub-topic in Zambian Languages Form 2.
 *
 * The grammar strand's "Punctuation" topic lost its numeric code, while its
 * sub-topic kept one — "2.4.6.1 Punctuation Marks". Because the topic reads as
 * a plain title with no code, that coded sub-topic showed as an orphan in the
 * pickers (a 2.4.6.x sub-topic under a code-less parent). The sub-topic's own
 * code fixes the parent unambiguously: 2.4.6.1 -> topic 2.4.6.
 *
 * Restores the topic header to "2.4.6 Punctuation" (code derived from the
 * sub-topic, verified against ZAMBIAN-LANGUAGES-...-SYLLABUS.pdf). Only the
 * numeric prefix is added; the title is untouched, nothing invented.
 *
 * NOTE (out of scope): like Art & Design before its code restore, most other
 * Zambian Languages topics/sub-topics across all forms are missing their codes
 * too; those aren't orphans (a code-less topic + code-less sub-topic still
 * resolves) and a full code restore across all four forms is a separate job.
 *
 * Idempotent (skips a topic already starting with a digit). Both data copies
 * kept byte-identical. Dry-run by default (pass --apply).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const APPLY = process.argv.includes('--apply')
const FILES = ['public/syllabi/curriculum-data.json', 'functions/data/curriculum-data.json']
const SUBJECT = 'Zambian Languages Syllabus (Forms 1-4)'
const SHEET = 'Form 2'

function run() {
  const primary = JSON.parse(readFileSync(join(ROOT, FILES[0]), 'utf8'))
  const sheet = primary?.[SUBJECT]?.[SHEET]
  if (!Array.isArray(sheet?.rows)) throw new Error(`${SUBJECT} / ${SHEET} not found`)

  let changed = false
  for (const r of sheet.rows) {
    if (r.type !== 'data') continue
    if (String(r.cells?.TOPIC || '').trim() === 'Punctuation' &&
        /^2\.4\.6\.1\b/.test(String(r.cells?.['SUB-TOPIC'] || ''))) {
      r.cells.TOPIC = '2.4.6 Punctuation'
      changed = true
    }
  }

  console.log(`\n=== Zambian Languages Form 2 · Punctuation ${APPLY ? '(APPLIED)' : '(DRY-RUN)'} ===\n`)
  console.log(`  ${changed ? '✓ topic "Punctuation" -> "2.4.6 Punctuation" (from sub-topic 2.4.6.1)' : 'nothing to do (already coded)'}`)

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
