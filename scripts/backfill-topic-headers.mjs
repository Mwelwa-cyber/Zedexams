#!/usr/bin/env node
/**
 * backfill-topic-headers.mjs
 * ==========================
 * Restores TOPIC-header rows that the PDF extraction dropped, leaving a
 * sub-topic filed under the wrong (preceding) topic — the "orphaned sub-topic"
 * defect surfaced by scripts/audit-curriculum-hierarchy.mjs.
 *
 * Every entry below carries an AUTHORITATIVE topic title transcribed from the
 * official source document (cited per entry) and verified against the source
 * image — never inferred or paraphrased. The script only writes into a BLANK
 * TOPIC cell whose row's sub-topic code matches, so it:
 *   • never overwrites existing content,
 *   • is idempotent (re-running finds the header already present → no-op),
 *   • fails loudly if the target row's sub-topic no longer matches (drift guard).
 *
 * Titles use the sheet's Title Case house style (its other topics are Title
 * Case: "Basic Writing Skills", "Letter Writing"), not the PDF's ALL CAPS.
 *
 * dry-run by default; --apply writes both file copies (a .bak is saved first).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const APPLY = process.argv.includes('--apply')

const FILES = ['public/syllabi/curriculum-data.json', 'functions/data/curriculum-data.json']

// Authoritative topic headers absent from the extracted JSON.
// Source: ENGLISH LANGUAGE SYLLABUS SECONDARY EDUCATION ORDINARY LEVEL FORM 1-4
// (edu.gov.zm), Form 1 "COMPOSITION" section — verified against the source pages.
const BACKFILL = [
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 1', subtopicCode: '1.3.2.1', topic: '1.3.2 Narrative Writing',
    expectSubtopic: 'Story Writing' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 1', subtopicCode: '1.3.3.1', topic: '1.3.3 Descriptive Writing',
    expectSubtopic: 'Describing a Person' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 1', subtopicCode: '1.3.5.1', topic: '1.3.5 Expository Writing',
    expectSubtopic: 'Writing Expository Essays' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 1', subtopicCode: '1.3.6.1', topic: '1.3.6 Persuasive Writing',
    expectSubtopic: 'An Argumentative Composition' },
]

const leadingCode = (s) => (String(s || '').trim().match(/^(\d+(?:\.\d+)*)/) || [])[1] || ''

function apply(data, changes) {
  for (const b of BACKFILL) {
    const sheet = data?.[b.subject]?.[b.sheet]
    if (!sheet) { changes.push({ b, status: 'sheet-missing' }); continue }
    const row = (sheet.rows || []).find(
      (r) => r.type === 'data' && leadingCode(r.cells?.['SUB-TOPIC']) === b.subtopicCode,
    )
    if (!row) { changes.push({ b, status: 'row-missing' }); continue }
    const sub = String(row.cells['SUB-TOPIC'] || '')
    if (!sub.toLowerCase().includes(b.expectSubtopic.toLowerCase())) {
      changes.push({ b, status: 'drift', found: sub }); continue // guard: don't touch a moved row
    }
    const current = String(row.cells.TOPIC || '').trim()
    if (current === b.topic) { changes.push({ b, status: 'already' }); continue }
    if (current) { changes.push({ b, status: 'conflict', found: current }); continue }
    row.cells.TOPIC = b.topic
    changes.push({ b, status: 'filled' })
  }
}

const primary = JSON.parse(readFileSync(join(ROOT, FILES[0]), 'utf8'))
const changes = []
apply(primary, changes)

console.log(`\n=== Topic-header backfill ${APPLY ? '(APPLIED)' : '(DRY-RUN)'} ===\n`)
for (const c of changes) {
  const tag = { filled: '✓ FILL', already: '· already present', drift: '⚠ DRIFT (skipped)', conflict: '⚠ CONFLICT (skipped)', 'row-missing': '⚠ row not found', 'sheet-missing': '⚠ sheet not found' }[c.status]
  console.log(`  ${tag}: ${c.b.subject} / ${c.b.sheet} → TOPIC "${c.b.topic}" on sub-topic ${c.b.subtopicCode}`)
  if (c.found) console.log(`        found: ${JSON.stringify(c.found)}`)
}
const filled = changes.filter((c) => c.status === 'filled').length
console.log(`\n${filled} header(s) to fill.`)

if (APPLY && filled > 0) {
  const serialized = JSON.stringify(primary, null, 2) + '\n'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (const rel of FILES) {
    const abs = join(ROOT, rel)
    writeFileSync(`${abs}.${stamp}.bak`, readFileSync(abs, 'utf8'))
    writeFileSync(abs, serialized)
  }
  console.log('Applied to both file copies (.bak saved).')
} else if (!APPLY && filled > 0) {
  console.log('Dry-run — re-run with --apply to write.')
}
