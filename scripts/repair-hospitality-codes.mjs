#!/usr/bin/env node
/**
 * repair-hospitality-codes.mjs
 * ============================
 * Normalises the mis-numbered TOPIC / SUB-TOPIC codes in the Hospitality
 * Management syllabus (Forms 1-4) so every sub-topic sits under a parent whose
 * code it actually extends. The official PDF itself carries the numbering
 * typos (it prints "2.21", a second "4.1 GASTRONOMY", sub-topics jumping
 * 4.1.1 -> 4.4.2, duplicate "4.5.1/4.5.2"...), which the extractor captured
 * faithfully — so in the studio pickers these render as orphans, duplicate
 * codes, and a topic collision.
 *
 * Every edit below was verified against HOSPITALITY-MANAGEMENT.pdf (Forms 1-2
 * pp.1-30, Form 4 pp.39-46 incl. the Scope & Sequence table). The Form 3
 * Entrepreneurship topic (3.2 -> 3.8) and its two positional sub-topic fixes
 * (Barriers -> 3.6.2, Security Risks -> 3.7.2) are normalised from the existing
 * topic sequence (3.1..3.7 then Entrepreneurship): only the numeric codes are
 * corrected, the titles already came from the source and are untouched. No
 * wording is invented.
 *
 * Each edit is matched on the row's CURRENT exact SUB-TOPIC text (plus TOPIC
 * where needed for uniqueness), so it is idempotent and a no-op once applied.
 * A competence code is corrected only when it starts with the known-wrong
 * prefix. Keeps both data copies byte-identical. Dry-run by default (--apply).
 *
 * NOTE (out of scope, flagged separately): Form 1 topic 1.1 also has a content
 * defect — sub-topic "1.1.2 Traditional and modern hospitality practices" is
 * missing and row 1.1.1's competence is cross-wired. That is a content rebuild,
 * not a code fix, and is intentionally NOT handled here.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const APPLY = process.argv.includes('--apply')
const FILES = ['public/syllabi/curriculum-data.json', 'functions/data/curriculum-data.json']
const SUBJECT = 'Hospitality Management Syllabus (Forms 1-4)'

// form -> [ { sub, topic?, newTopic?, newSub, compFrom?, compTo? } ]
// `sub`/`topic` match the row's CURRENT cell text; `compFrom` is corrected only
// when the competence starts with it.
const EDITS = {
  'Form 1': [
    { sub: '1.1.1. Ethics', newSub: '1.6.1. Ethics' }, // under 1.6 ENTREPRENEURSHIP (comp already 1.6.1.1)
  ],
  'Form 2': [
    { sub: '2.2.1. Front office operations', topic: '2.21. Front office', newTopic: '2.2. Front office', newSub: '2.2.1. Front office operations' },
    { sub: '2.3.2.1 Cleaning areas and processes', newSub: '2.3.2 Cleaning areas and processes', compFrom: '2..1.1.', compTo: '2.3.2.1.' },
    { sub: '2.3.1 Laundry in hospitality facility', newSub: '2.3.3 Laundry in hospitality facility' }, // comp already 2.3.3.1
    { sub: '2.5.1.Types of Businesses', newSub: '2.6.1.Types of Businesses', compFrom: '2.5.1.1.', compTo: '2.6.1.1.' },
  ],
  'Form 3': [
    { sub: 'Barriers to Communication', newSub: '3.6.2. Barriers to Communication', compFrom: '3.1.2.1.', compTo: '3.6.2.1.' },
    { sub: '3.1.1.Security Risks in Hospitality Facility', newSub: '3.7.2. Security Risks in Hospitality Facility', compFrom: 'SPECIFIC COMPETENCIES 3.1.1.1.', compTo: '3.7.2.1. ' },
    { sub: '3.2.1. Business Plan', topic: '3.2. ENTREPRENEURSHIP', newTopic: '3.8. ENTREPRENEURSHIP', newSub: '3.8.1. Business Plan', compFrom: '3.2.1.1.', compTo: '3.8.1.1.' },
  ],
  'Form 4': [
    { sub: '4.1.1. Culinary Techniques and Methods', topic: '4.1. GASTRONOMY', newTopic: '4.3. GASTRONOMY', newSub: '4.3.1. Culinary Techniques and Methods', compFrom: '4.1.1.1.', compTo: '4.3.1.1.' },
    { sub: '4.4.2. Sous-Vide Cooking Technique (vacuum packaging)', newSub: '4.3.2. Sous-Vide Cooking Technique (vacuum packaging)', compFrom: '4.4.2', compTo: '4.3.2' },
    { sub: '4.4.3. Food and Culture', newSub: '4.3.3. Food and Culture', compFrom: '4.4.3', compTo: '4.3.3' },
    { sub: '4.4.4. Gastronomy and Innovation', newSub: '4.3.4. Gastronomy and Innovation', compFrom: '4.4.4', compTo: '4.3.4' },
    { sub: '4.4.5. Food Preservation', newSub: '4.3.5. Food Preservation', compFrom: '4.4.5', compTo: '4.3.5' },
    { sub: '4.5.1. Barbering', newSub: '4.5.4. Barbering', compFrom: '4.5.1', compTo: '4.5.4' },
    { sub: '4.5.2. Spa Services', newSub: '4.5.5. Spa Services', compFrom: '4.5.2', compTo: '4.5.5' },
  ],
}

function run() {
  const primary = JSON.parse(readFileSync(join(ROOT, FILES[0]), 'utf8'))
  const applied = []
  const unmatched = []

  for (const [form, edits] of Object.entries(EDITS)) {
    const sheet = primary?.[SUBJECT]?.[form]
    if (!Array.isArray(sheet?.rows)) throw new Error(`${SUBJECT} / ${form} not found`)
    for (const e of edits) {
      const row = sheet.rows.find((r) =>
        r.type === 'data' &&
        String(r.cells?.['SUB-TOPIC'] || '') === e.sub &&
        (e.topic === undefined || String(r.cells?.TOPIC || '') === e.topic))
      if (!row) { unmatched.push(`${form}: ${JSON.stringify(e.sub)}`); continue }
      const before = { t: row.cells.TOPIC, s: row.cells['SUB-TOPIC'] }
      if (e.newTopic !== undefined) row.cells.TOPIC = e.newTopic
      row.cells['SUB-TOPIC'] = e.newSub
      if (e.compFrom) {
        const comp = String(row.cells['SPECIFIC COMPETENCES'] || '')
        if (comp.startsWith(e.compFrom)) {
          row.cells['SPECIFIC COMPETENCES'] = e.compTo + comp.slice(e.compFrom.length)
        }
      }
      applied.push(`${form}: [${before.t || '—'}] ${before.s}  ->  [${row.cells.TOPIC}] ${e.newSub}`)
    }
  }

  console.log(`\n=== Hospitality code normalisation ${APPLY ? '(APPLIED)' : '(DRY-RUN)'} ===\n`)
  for (const a of applied) console.log(`  ✓ ${a}`)
  if (unmatched.length) {
    console.log('\n  (already normalised / not found — no-op):')
    for (const u of unmatched) console.log(`    · ${u}`)
  }
  console.log(`\n  ${applied.length} row(s) edited, ${unmatched.length} no-op.`)

  if (APPLY && applied.length > 0) {
    const serialized = JSON.stringify(primary, null, 2) + '\n'
    for (const rel of FILES) writeFileSync(join(ROOT, rel), serialized)
    console.log('\nApplied to both file copies.')
  } else if (!APPLY && applied.length > 0) {
    console.log('\nDry-run — re-run with --apply to write.')
  }
  return { applied: applied.length, unmatched: unmatched.length }
}

run()
