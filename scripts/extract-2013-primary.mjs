#!/usr/bin/env node
/**
 * Re-extract the broken grades of four 2013 Primary syllabi from their source
 * CDC PDFs, using the shared position-based extractor in
 * scripts/lib/syllabusPdfTable.mjs. These grades came out of the original
 * XLSX→JSON conversion with data-value column headers / swapped columns, the
 * same class of damage already fixed for English (#1354) and Maths G12
 * (#1359); only re-extraction from source repairs them.
 *
 * Only the grades listed in each config's `replace` are rewritten — the clean
 * grades are left untouched.
 *
 * The PDFs are not committed. Pass them by subject key:
 *
 *   node scripts/extract-2013-primary.mjs \
 *     math=/path/Maths_1-7.pdf science=/path/IntSci_1-7.pdf \
 *     social=/path/SocialStudies_1-7.pdf zambian=/path/ZambianLang_5-7.pdf
 *
 * Add --dry to print samples without writing.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPages, detectGradePages, extractSheet } from './lib/syllabusPdfTable.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const TARGET_FILES = [
  'public/syllabi/curriculum-data-2013.json',
  'functions/data/curriculum-data-2013.json',
]
const NOISE = ['topic', 'subtopic', 'sub-topic', 'sub topic', 'specific', 'outcomes', 'outcome',
  'specific outcomes', 'specific outcome', 'knowledge', 'skills', 'values', 'content', 'component']

export const CONFIGS = {
  math: {
    arg: 'math',
    subjectKey: 'Mathematics Syllabus (Grades 1-7, 2013)',
    titlePrefix: 'MATHEMATICS SYLLABUS  —  GRADE',
    replace: [1, 2, 4, 5, 6, 7],
    columns: ['TOPIC', 'SPECIFIC OUTCOMES', 'KNOWLEDGE', 'SKILLS', 'VALUES'],
    labels: ['topic', 'specific outcomes', 'knowledge', 'skills', 'values'],
    anchorLabel: 'topic', rowCol: 0, outcomeCol: 1, noiseWords: NOISE,
  },
  science: {
    arg: 'science',
    subjectKey: 'Integrated Science Syllabus (Grades 1-7, 2013)',
    titlePrefix: 'INTEGRATED SCIENCE SYLLABUS  —  GRADE',
    replace: [5],
    columns: ['TOPIC', 'SUBTOPIC', 'SPECIFIC OUTCOMES', 'CONTENT', 'SKILLS', 'VALUES'],
    labels: ['topic', 'subtopic', 'specific outcomes', 'content'],
    boundaries: [110, 180, 330, 495, 605], // CONTENT is a centred super-header
    anchorLabel: 'topic', rowCol: 1, outcomeCol: 2, bulletGlyph: '?', noiseWords: NOISE,
  },
  social: {
    arg: 'social',
    subjectKey: 'Social Studies Syllabus (Grades 1-7, 2013)',
    titlePrefix: 'SOCIAL STUDIES SYLLABUS  —  GRADE',
    replace: [5, 6],
    columns: ['TOPIC', 'SUBTOPIC', 'SPECIFIC OUTCOMES', 'KNOWLEDGE', 'SKILLS', 'VALUES'],
    labels: ['topic', 'sub-topic', 'specific outcomes', 'knowledge', 'skills', 'values'],
    anchorLabel: 'topic', rowCol: 1, outcomeCol: 2, noiseWords: NOISE,
  },
  zambian: {
    arg: 'zambian',
    subjectKey: 'Zambian Language Syllabus (Grades 5-7, 2013)',
    titlePrefix: 'ZAMBIAN LANGUAGE SYLLABUS  —  GRADE',
    replace: [6, 7],
    // The output's CONTENT column carries the PDF's "Knowledge" sub-column
    // (the clean Grade 5 already labels it CONTENT) — so we anchor on the real
    // "knowledge" sub-header but emit it as CONTENT. Label-based anchoring
    // re-derives the columns per grade, which matters because Grade 6 and 7
    // have different x-layouts.
    columns: ['COMPONENT', 'TOPIC', 'SPECIFIC OUTCOMES', 'CONTENT', 'SKILLS', 'VALUES'],
    labels: ['component', 'topic', 'specific outcomes', 'knowledge', 'skills', 'values'],
    anchorLabel: 'topic', rowCol: 1, outcomeCol: 2, noiseWords: NOISE,
  },
}

export async function extractSubject(cfg, pdfPath) {
  const pages = await loadPages(pdfPath)
  const gradePages = detectGradePages(pages, cfg)
  const out = {}
  for (const g of cfg.replace) {
    const pageNums = gradePages[String(g)]
    if (!pageNums || !pageNums.length) throw new Error(`${cfg.arg}: no pages found for grade ${g}`)
    const sheet = extractSheet(pages, pageNums, cfg)
    sheet.title = `${cfg.titlePrefix} ${g}`
    out[`Grade ${g}`] = sheet
  }
  return out
}

async function main() {
  const args = process.argv.slice(2)
  const dry = args.includes('--dry')
  const paths = {}
  for (const a of args) {
    const m = /^(\w+)=(.+)$/.exec(a)
    if (m) paths[m[1]] = m[2]
  }
  const extracted = {}
  for (const cfg of Object.values(CONFIGS)) {
    if (!paths[cfg.arg]) { console.log(`- ${cfg.arg}: no PDF given, skipping`); continue }
    const sheets = await extractSubject(cfg, paths[cfg.arg])
    extracted[cfg.subjectKey] = sheets
    for (const [name, sheet] of Object.entries(sheets)) {
      console.log(`${cfg.arg} ${name}: ${sheet.rows.length} rows  cols=${JSON.stringify(sheet.columns)}`)
      if (dry) sheet.rows.slice(0, 3).forEach(r => console.log('   ', JSON.stringify(r.cells)))
    }
  }
  if (dry) { console.log('\n(dry run — nothing written)'); return }
  for (const rel of TARGET_FILES) {
    const file = path.join(ROOT, rel)
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const [subjectKey, sheets] of Object.entries(extracted)) {
      if (!data[subjectKey]) { console.warn(`! ${rel}: "${subjectKey}" not found`); continue }
      for (const [name, sheet] of Object.entries(sheets)) data[subjectKey][name] = sheet
    }
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
    console.log(`✓ ${rel}: updated`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1) })
}
