#!/usr/bin/env node
/**
 * repair-fashion-fabrics-codes.mjs
 * ================================
 * Fixes the mis-numbered topic/sub-topic codes and a leaked recap table in the
 * Fashion & Fabrics syllabus (Forms 3-4), verified against
 * FASHION-AND-FABRICS-SYLABUS-O-LEVEL-FORMS-1-4.pdf (pp.36-49).
 *
 * FORM 3
 *   - Millinery: the source prints a spurious topic header "3.2 WARDROBE
 *     PLANNING" on the "3.1.2 Millinery" row, but the code 3.1.2 puts Millinery
 *     under "3.1 GROOMING AND PERSONAL HYGIENE", and the real 3.2 is "TOOLS AND
 *     EQUIPMENT" (3.2.1 Knitting). Topics 3.3-3.12 are all correctly numbered,
 *     so the only consistent fix (no cascade) is to drop the spurious header so
 *     Millinery falls under 3.1 GROOMING per its own code. No title invented.
 *   - Hem: sub-topic printed "3.7.5 Hem and Hem Edge Finishes" sits under
 *     "3.6 CONSTRUCTION PROCESS" after 3.6.4 Collars (the PDF jumps 3.6 -> 3.8);
 *     "3.7.5" is a typo for 3.6.5.
 *
 * FORM 4
 *   - Blending: sub-topic "4.3.1 Blending and Mixing" sits under "4.2 FIBRES,
 *     YARNS AND FABRICS" with no 4.3 topic header (the PDF jumps 4.2 -> 4.4).
 *     Blending/mixing fabrics is the second sub-topic of FIBRES, so it folds to
 *     4.2.2 (same pattern as History Form 3's 3.6.x -> 3.5.x).
 *   - Recap leak: the trailing rows are the syllabus's "Scope and Sequence"
 *     grid (FASHION A / ND FABRIC, For / m 1, "Introduction to textile and
 *     clothing"...) pulled into the topic table; they surface as garbage topics
 *     in the pickers. Everything after the last real 4.x.y row is removed.
 *
 * Only numeric codes / a spurious header / leaked rows change; every real title
 * and activity is untouched, nothing invented. Idempotent; both data copies
 * kept byte-identical. Dry-run by default (pass --apply).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const APPLY = process.argv.includes('--apply')
const FILES = ['public/syllabi/curriculum-data.json', 'functions/data/curriculum-data.json']
const SUBJECT = 'Fashion & Fabrics Syllabus (Forms 1-4)'

function run() {
  const primary = JSON.parse(readFileSync(join(ROOT, FILES[0]), 'utf8'))
  const log = []

  // ── FORM 3 ──────────────────────────────────────────────────────────────
  const f3 = primary?.[SUBJECT]?.['Form 3']
  if (!Array.isArray(f3?.rows)) throw new Error('Fashion & Fabrics / Form 3 not found')
  for (const row of f3.rows) {
    if (row.type !== 'data') continue
    const sub = String(row.cells?.['SUB-TOPIC'] || '')
    // Millinery: drop the spurious "3.2 WARDROBE PLANNING" header.
    if (/^3\.1\.2 Millinery/.test(sub) && /WARDROBE PLANNING/i.test(String(row.cells.TOPIC || ''))) {
      row.cells.TOPIC = ''
      log.push('F3  drop spurious topic "3.2 WARDROBE PLANNING" -> Millinery (3.1.2) now under 3.1 GROOMING')
    }
    // Hem: 3.7.5 -> 3.6.5 (5th sub-topic of 3.6 CONSTRUCTION PROCESS).
    if (/^3\.7\.5 Hem/.test(sub)) {
      row.cells['SUB-TOPIC'] = sub.replace(/^3\.7\.5/, '3.6.5')
      const comp = String(row.cells['SPECIFIC COMPETENCES'] || '')
      if (comp.startsWith('3.7.5')) row.cells['SPECIFIC COMPETENCES'] = comp.replace(/^3\.7\.5/, '3.6.5')
      log.push('F3  3.7.5 Hem and Hem Edge Finishes -> 3.6.5')
    }
  }

  // ── FORM 4 ──────────────────────────────────────────────────────────────
  const f4 = primary?.[SUBJECT]?.['Form 4']
  if (!Array.isArray(f4?.rows)) throw new Error('Fashion & Fabrics / Form 4 not found')
  for (const row of f4.rows) {
    if (row.type !== 'data') continue
    const sub = String(row.cells?.['SUB-TOPIC'] || '')
    // Blending: 4.3.1 -> 4.2.2 (fold under 4.2 FIBRES, YARNS AND FABRICS).
    if (/^4\.3\.1 Blend/.test(sub)) {
      row.cells['SUB-TOPIC'] = sub.replace(/^4\.3\.1/, '4.2.2')
      const comp = String(row.cells['SPECIFIC COMPETENCES'] || '')
      if (comp.startsWith('4.3.1')) row.cells['SPECIFIC COMPETENCES'] = comp.replace(/^4\.3\.1/, '4.2.2')
      log.push('F4  4.3.1 Blending and Mixing -> 4.2.2 (under 4.2 FIBRES)')
    }
  }
  // Remove the trailing "Scope and Sequence" recap: everything after the last
  // row carrying a real Form-4 sub-topic code.
  let lastLegit = -1
  f4.rows.forEach((r, i) => { if (r.type === 'data' && /^\s*4\.\d+\.\d+/.test(String(r.cells?.['SUB-TOPIC'] || ''))) lastLegit = i })
  const before = f4.rows.length
  if (lastLegit > -1 && lastLegit + 1 < f4.rows.length) {
    const dropped = f4.rows.length - (lastLegit + 1)
    f4.rows = f4.rows.slice(0, lastLegit + 1)
    log.push(`F4  removed ${dropped} leaked Scope-and-Sequence recap row(s)`)
  }

  console.log(`\n=== Fashion & Fabrics code repair ${APPLY ? '(APPLIED)' : '(DRY-RUN)'} ===\n`)
  for (const l of log) console.log(`  ✓ ${l}`)
  console.log(`\n  ${log.length} change group(s).`)

  if (APPLY && log.length > 0) {
    const serialized = JSON.stringify(primary, null, 2) + '\n'
    for (const rel of FILES) writeFileSync(join(ROOT, rel), serialized)
    console.log('\nApplied to both file copies.')
  } else if (!APPLY && log.length > 0) {
    console.log('\nDry-run — re-run with --apply to write.')
  } else {
    console.log('\nNothing to do (already repaired).')
  }
  void before
  return log.length
}

run()
