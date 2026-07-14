#!/usr/bin/env node
/**
 * normalize-child-codes.mjs
 * =========================
 * Normalises sub-topic + specific-competence CODE PREFIXES to match their
 * parent topic, for sheets where the OFFICIAL source mis-numbered them.
 *
 * Grade 3 Creative & Technology (Lower Primary) is such a case: the official
 * PDF itself numbers topic "3.15 CRAFTS" but codes its sub-topics "3.16.1
 * Plaiting…", and the +1 offset repeats through DESIGNING/LETTERING/SWIMMING/
 * ENTREPRENEURSHIP. The extraction copied this faithfully. Per an explicit
 * decision, we normalise the child code prefix to the parent topic so the
 * hierarchy is internally consistent — TITLES ARE NEVER CHANGED, only the
 * leading code's parent segments (e.g. "3.16.1 Plaiting" → "3.15.1 Plaiting").
 *
 * Also applies exact-match sub-topic TITLE merges for titles the extraction
 * split across a page break (e.g. "…(Tumbling" + "and Stunts)").
 *
 * Only rewrites a child code when its parent-depth prefix DIFFERS from the
 * propagated topic code and the child is deeper than the topic (never touches a
 * child that already matches, so it is idempotent and leaves the correct
 * 3.1-3.14 rows alone). dry-run by default; --apply writes both file copies.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const APPLY = process.argv.includes('--apply')
const FILES = ['public/syllabi/curriculum-data.json', 'functions/data/curriculum-data.json']

const TARGETS = [
  {
    subject: 'Lower Primary Syllabi (Grades 1-3)',
    sheet: 'Grade 3 - Creative & Technology',
    // Sub-topic titles the extraction split across a page break → merged form.
    titleMerges: [
      { full: '3.12.3 Educational gymnastics (Tumbling and Stunts)',
        parts: ['3.12.3 Educational gymnastics (Tumbling', 'and Stunts)'] },
    ],
  },
]

const leadingCode = (s) => (String(s || '').trim().match(/^(\d+(?:\.\d+)*)/) || [])[1] || ''

/** Rewrite a cell's leading code so its first `depth` segments equal topicCode. */
function renormCellCode(cell, topicCode) {
  const raw = String(cell || '')
  const code = leadingCode(raw)
  if (!code) return { cell: raw, changed: false }
  const tSegs = topicCode.split('.')
  const cSegs = code.split('.')
  if (cSegs.length <= tSegs.length) return { cell: raw, changed: false }
  if (cSegs.slice(0, tSegs.length).join('.') === topicCode) return { cell: raw, changed: false }
  const newCode = [...tSegs, ...cSegs.slice(tSegs.length)].join('.')
  // Replace only the leading code token, keep the title text verbatim.
  return { cell: raw.replace(code, newCode), changed: true, from: code, to: newCode }
}

function processSheet(sheet, report) {
  const rows = (sheet.rows || []).filter((r) => r.type === 'data')

  // 1) Title merges (exact match on the split parts).
  for (const t of report.titleMerges || []) {
    for (const p of t.parts) {
      const row = rows.find((r) => String(r.cells['SUB-TOPIC'] || '').trim() === p)
      if (row) {
        if (row.cells['SUB-TOPIC'] !== t.full) {
          row.cells['SUB-TOPIC'] = t.full
          report.titleFixes.push({ from: p, to: t.full })
        }
      }
    }
  }

  // 2) Child-code normalisation, propagating the topic code down blank cells.
  let topicCode = ''
  for (const r of sheet.rows || []) {
    if (r.type !== 'data') continue
    const cells = r.cells || {}
    const rawTopic = leadingCode(cells.TOPIC)
    if (rawTopic) topicCode = rawTopic
    if (!topicCode) continue
    for (const col of ['SUB-TOPIC', 'SPECIFIC COMPETENCES']) {
      const res = renormCellCode(cells[col], topicCode)
      if (res.changed) {
        cells[col] = res.cell
        report.codeFixes.push({ col, from: res.from, to: res.to })
      }
    }
  }
}

const primary = JSON.parse(readFileSync(join(ROOT, FILES[0]), 'utf8'))
const reports = []
for (const target of TARGETS) {
  const sheet = primary?.[target.subject]?.[target.sheet]
  const report = { ...target, titleFixes: [], codeFixes: [], missing: !sheet }
  if (sheet) processSheet(sheet, report)
  reports.push(report)
}

console.log(`\n=== Child-code normalisation ${APPLY ? '(APPLIED)' : '(DRY-RUN)'} ===\n`)
let total = 0
for (const r of reports) {
  console.log(`── ${r.subject} / ${r.sheet} ──`)
  if (r.missing) { console.log('   ⚠ sheet not found'); continue }
  for (const t of r.titleFixes) console.log(`   ✓ title merge: ${JSON.stringify(t.from)} → ${JSON.stringify(t.to)}`)
  for (const c of r.codeFixes) console.log(`   ✓ code [${c.col}]: ${c.from} → ${c.to}`)
  total += r.titleFixes.length + r.codeFixes.length
  console.log(`   (${r.titleFixes.length} title merge(s), ${r.codeFixes.length} code fix(es))`)
}
console.log(`\nTOTAL changes: ${total}`)

if (APPLY && total > 0) {
  const serialized = JSON.stringify(primary, null, 2) + '\n'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (const rel of FILES) {
    const abs = join(ROOT, rel)
    writeFileSync(`${abs}.${stamp}.bak`, readFileSync(abs, 'utf8'))
    writeFileSync(abs, serialized)
  }
  console.log('Applied to both file copies (.bak saved).')
} else if (!APPLY && total > 0) {
  console.log('Dry-run — re-run with --apply to write.')
}
