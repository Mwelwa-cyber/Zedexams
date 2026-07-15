#!/usr/bin/env node
/**
 * remove-competence-appendix-rows.mjs
 * ===================================
 * Removes the generic "cross-cutting competences" appendix rows the PDF
 * extraction leaked into the topic tables of a couple of Form 3 sheets.
 *
 * Every CBC syllabus ends with a boilerplate appendix listing the generic
 * 21st-century competences in an S/N | COMPETENCE | DESCRIPTORS grid
 * (Analytical Thinking, Citizenship, Collaboration, Critical Thinking,
 * Digital, Entrepreneurship, Environmental Sustainability…). In History and
 * Geography Form 3 the extractor pulled that grid into the syllabus's own
 * topic table, so those competence names now surface in the studio pickers as
 * if they were History/Geography *sub-topics* — a teacher choosing a topic
 * sees "Critical Thinking", "Digital", "Problem Solving".
 *
 * Signature of a leaked appendix row: a `data` row whose SUB-TOPIC cell is
 * either the literal column header "S/N" or a bare 1–2 digit serial number
 * ("6", "10"), with an empty TOPIC cell and a SPECIFIC COMPETENCES cell that
 * is a competence *label*, not a dotted competence code. A real sub-topic cell
 * always carries a dotted code ("3.6.1 …") and its competence a "3.6.1.1 …"
 * code, so this never matches legitimate curriculum rows. Idempotent;
 * dry-run by default (pass --apply to write). Keeps both data copies identical.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const APPLY = process.argv.includes('--apply')
const FILES = ['public/syllabi/curriculum-data.json', 'functions/data/curriculum-data.json']

// A leaked competence-appendix row: SUB-TOPIC is "S/N" or a bare serial number,
// TOPIC is empty, and SPECIFIC COMPETENCES is a plain label (no dotted code).
export function isCompetenceAppendixRow(row) {
  if (row?.type !== 'data') return false
  const sub = String(row.cells?.['SUB-TOPIC'] || '').trim()
  const topic = String(row.cells?.TOPIC || '').trim()
  const comp = String(row.cells?.['SPECIFIC COMPETENCES'] || '').trim()
  if (topic) return false
  if (!/^(S\/N|\d{1,2})$/.test(sub)) return false
  if (/^\d/.test(comp)) return false // a real competence starts with its code
  return true
}

function run() {
  const primary = JSON.parse(readFileSync(join(ROOT, FILES[0]), 'utf8'))
  const removed = []
  for (const [subject, sheets] of Object.entries(primary || {})) {
    for (const [sheetName, sheet] of Object.entries(sheets || {})) {
      if (!Array.isArray(sheet?.rows)) continue
      const kept = []
      for (const row of sheet.rows) {
        if (isCompetenceAppendixRow(row)) {
          removed.push({
            subject,
            sheet: sheetName,
            sub: String(row.cells['SUB-TOPIC'] || ''),
            comp: String(row.cells['SPECIFIC COMPETENCES'] || '').slice(0, 40),
          })
          continue
        }
        kept.push(row)
      }
      sheet.rows = kept
    }
  }

  console.log(`\n=== Competence-appendix row removal ${APPLY ? '(APPLIED)' : '(DRY-RUN)'} ===\n`)
  for (const r of removed) {
    console.log(`  ✗ [${r.subject} / ${r.sheet}]  SUB=${JSON.stringify(r.sub)}  COMP=${JSON.stringify(r.comp)}`)
  }
  console.log(`\n${removed.length} appendix row(s) removed.`)

  if (APPLY && removed.length > 0) {
    const serialized = JSON.stringify(primary, null, 2) + '\n'
    for (const rel of FILES) writeFileSync(join(ROOT, rel), serialized)
    console.log('Applied to both file copies.')
  } else if (!APPLY && removed.length > 0) {
    console.log('Dry-run — re-run with --apply to write.')
  }
  return removed
}

run()
