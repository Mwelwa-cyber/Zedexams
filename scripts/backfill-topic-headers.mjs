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

  // Form 2 COMPOSITION (section 2.3) + SUMMARY (2.5.1) — topic headers dropped
  // by extraction; sub-topics 2.3.2.x-2.3.9.x + 2.5.1.x were filed under the
  // preceding topic. Titles verified against the official Form 2 pages.
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 2', subtopicCode: '2.3.2.1', topic: '2.3.2 Descriptive Writing',
    expectSubtopic: 'Describing a Place' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 2', subtopicCode: '2.3.3.1', topic: '2.3.3 Report Writing',
    expectSubtopic: 'Introduction to Report Writing' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 2', subtopicCode: '2.3.4.1', topic: '2.3.4 Speech Writing',
    expectSubtopic: 'Speech of Introduction' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 2', subtopicCode: '2.3.5.1', topic: '2.3.5 Biography Writing',
    expectSubtopic: 'Auto' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 2', subtopicCode: '2.3.6.1', topic: '2.3.6 Expository Writing',
    expectSubtopic: 'Features of Expository Writing' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 2', subtopicCode: '2.3.7.1', topic: '2.3.7 Persuasive Writing',
    expectSubtopic: 'Argumentative Composition' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 2', subtopicCode: '2.3.8.1', topic: '2.3.8 Diary Writing',
    expectSubtopic: 'Writing Diary Entries' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 2', subtopicCode: '2.3.9.1', topic: '2.3.9 Letter Writing',
    expectSubtopic: 'Semi-Formal Letter' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 2', subtopicCode: '2.5.1.1', topic: '2.5.1 Summary Writing',
    expectSubtopic: 'Title Summary' },

  // Form 3 COMPOSITION (section 3.3) — topic headers dropped by extraction.
  // Titles verified against the official Form 3 pages.
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 3', subtopicCode: '3.3.2.1', topic: '3.3.2 Descriptive Writing',
    expectSubtopic: 'Describing Events' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 3', subtopicCode: '3.3.3.1', topic: '3.3.3 Article Writing',
    expectSubtopic: 'News Article' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 3', subtopicCode: '3.3.4.1', topic: '3.3.4 Report Writing',
    expectSubtopic: 'Detailed or Major Reports' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 3', subtopicCode: '3.3.5.1', topic: '3.3.5 Speech Writing',
    expectSubtopic: 'Main Speech' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 3', subtopicCode: '3.3.6.1', topic: '3.3.6 Minutes Writing',
    expectSubtopic: 'Introduction to Writing Minutes' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 3', subtopicCode: '3.3.11.1', topic: '3.3.11 Letter Writing',
    expectSubtopic: 'Formal Letter' },

  // Form 4 COMPOSITION (section 4.3) — topic headers dropped by extraction.
  // Titles verified against the official Form 4 pages.
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 4', subtopicCode: '4.3.2.1', topic: '4.3.2 Descriptive Writing',
    expectSubtopic: 'Describing Careers/Professions' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 4', subtopicCode: '4.3.4.1', topic: '4.3.4 Report Writing',
    expectSubtopic: 'Detailed (Major) Reports' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 4', subtopicCode: '4.3.5.1', topic: '4.3.5 Speech Writing',
    expectSubtopic: 'Vote of thanks' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 4', subtopicCode: '4.3.6.1', topic: '4.3.6 Persuasive Writing',
    expectSubtopic: 'Discursive Composition' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 4', subtopicCode: '4.3.7.1', topic: '4.3.7 Expository Writing',
    expectSubtopic: 'Compare and Contrast' },
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 4', subtopicCode: '4.3.8.1', topic: '4.3.8 Letter Writing',
    expectSubtopic: 'Formal Letters' },
]

// TOPIC-header TITLE repairs (an existing topic cell whose title the extraction
// mangled). `from`/`to` are the exact text after the code. Verified against source.
const TOPIC_FIXES = [
  // Source prints "ARGUMENTA TIVE" (ARGUMENTATIVE broken across a line).
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 3', code: '3.3.10',
    from: 'Argumenta Tive', to: 'Argumentative' },
]

// Sub-topic TITLE repairs — a title the extraction truncated at a page break or
// broke a word in. `from`/`to` are the exact text after the code. Verified
// against the official source page.
const SUBTOPIC_FIXES = [
  // 1.4.10.1 spanned a page break: "Different Ways of" (p30) + "Expressing
  // Purpose" (p31); parallels 1.4.11.1 "Different Ways of Expressing Result".
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 1', code: '1.4.10.1',
    from: 'Different Ways of', to: 'Different Ways of Expressing Purpose' },
  // OCR split the word "Advertisements".
  { subject: 'English Syllabus (Forms 1-4)', sheet: 'Form 1', code: '1.5.4.1',
    from: 'Types of Advertisement s', to: 'Types of Advertisements' },
]

const leadingCode = (s) => (String(s || '').trim().match(/^(\d+(?:\.\d+)*)/) || [])[1] || ''

function applyTopicFixes(data, changes) {
  for (const f of TOPIC_FIXES) {
    const sheet = data?.[f.subject]?.[f.sheet]
    if (!sheet) { changes.push({ fix: f, status: 'sheet-missing' }); continue }
    const row = (sheet.rows || []).find(
      (r) => r.type === 'data' && leadingCode(r.cells?.TOPIC) === f.code,
    )
    if (!row) { changes.push({ fix: f, status: 'row-missing' }); continue }
    const current = String(row.cells.TOPIC || '').trim()
    const target = `${f.code} ${f.to}`
    if (current === target) { changes.push({ fix: f, status: 'already' }); continue }
    if (current !== `${f.code} ${f.from}`) { changes.push({ fix: f, status: 'drift', found: current }); continue }
    row.cells.TOPIC = target
    changes.push({ fix: f, status: 'fixed', to: target })
  }
}

function applySubtopicFixes(data, changes) {
  for (const f of SUBTOPIC_FIXES) {
    const sheet = data?.[f.subject]?.[f.sheet]
    if (!sheet) { changes.push({ fix: f, status: 'sheet-missing' }); continue }
    const row = (sheet.rows || []).find(
      (r) => r.type === 'data' && leadingCode(r.cells?.['SUB-TOPIC']) === f.code,
    )
    if (!row) { changes.push({ fix: f, status: 'row-missing' }); continue }
    const current = String(row.cells['SUB-TOPIC'] || '').trim()
    const target = `${f.code} ${f.to}`
    if (current === target) { changes.push({ fix: f, status: 'already' }); continue }
    if (current !== `${f.code} ${f.from}`) { changes.push({ fix: f, status: 'drift', found: current }); continue }
    row.cells['SUB-TOPIC'] = target
    changes.push({ fix: f, status: 'fixed', to: target })
  }
}

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
const topicFixChanges = []
applyTopicFixes(primary, topicFixChanges)
const subChanges = []
applySubtopicFixes(primary, subChanges)

console.log(`\n=== Topic-header backfill ${APPLY ? '(APPLIED)' : '(DRY-RUN)'} ===\n`)
for (const c of changes) {
  const tag = { filled: '✓ FILL', already: '· already present', drift: '⚠ DRIFT (skipped)', conflict: '⚠ CONFLICT (skipped)', 'row-missing': '⚠ row not found', 'sheet-missing': '⚠ sheet not found' }[c.status]
  console.log(`  ${tag}: ${c.b.subject} / ${c.b.sheet} → TOPIC "${c.b.topic}" on sub-topic ${c.b.subtopicCode}`)
  if (c.found) console.log(`        found: ${JSON.stringify(c.found)}`)
}
console.log('\n── topic title repairs ──')
for (const c of topicFixChanges) {
  const tag = { fixed: '✓ FIX', already: '· already correct', drift: '⚠ DRIFT (skipped)', 'row-missing': '⚠ row not found', 'sheet-missing': '⚠ sheet not found' }[c.status]
  console.log(`  ${tag}: ${c.fix.subject} / ${c.fix.sheet} ${c.fix.code} → "${c.fix.to}"`)
  if (c.found) console.log(`        found: ${JSON.stringify(c.found)}`)
}
console.log('\n── sub-topic title repairs ──')
for (const c of subChanges) {
  const tag = { fixed: '✓ FIX', already: '· already correct', drift: '⚠ DRIFT (skipped)', 'row-missing': '⚠ row not found', 'sheet-missing': '⚠ sheet not found' }[c.status]
  console.log(`  ${tag}: ${c.fix.subject} / ${c.fix.sheet} ${c.fix.code} → "${c.fix.to}"`)
  if (c.found) console.log(`        found: ${JSON.stringify(c.found)}`)
}
const filled = changes.filter((c) => c.status === 'filled').length
const topicFixed = topicFixChanges.filter((c) => c.status === 'fixed').length
const fixed = subChanges.filter((c) => c.status === 'fixed').length
const anyChange = filled > 0 || fixed > 0 || topicFixed > 0
console.log(`\n${filled} header(s) to fill, ${topicFixed} topic title(s) + ${fixed} sub-topic title(s) to repair.`)

if (APPLY && anyChange) {
  const serialized = JSON.stringify(primary, null, 2) + '\n'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (const rel of FILES) {
    const abs = join(ROOT, rel)
    writeFileSync(`${abs}.${stamp}.bak`, readFileSync(abs, 'utf8'))
    writeFileSync(abs, serialized)
  }
  console.log('Applied to both file copies (.bak saved).')
} else if (!APPLY && anyChange) {
  console.log('Dry-run — re-run with --apply to write.')
}
