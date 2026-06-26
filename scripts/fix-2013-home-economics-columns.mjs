// Repairs the mangled Home Economics (Grades 5-7, 2013) syllabus in
// curriculum-data-2013.json.
//
// The 2013 workbook extraction scattered each row's text across phantom
// "COLUMN N" columns, leaving the canonical "SPECIFIC OUTCOMES" column empty
// while the real outcome text landed in "CONTENT" and the real content landed
// in "COLUMN 7" (the layout drifts row-by-row and sheet-by-sheet). In the
// Syllabi Studio table this showed up as a blank SPECIFIC OUTCOMES column.
//
// Home Economics uses a clean numeric code hierarchy, so we can faithfully
// rebuild the four canonical columns by classifying every non-empty cell in a
// row by its leading code depth:
//   X.Y      (2 segments) -> TOPIC
//   X.Y.Z    (3 segments) -> SUB-TOPIC
//   X.Y.Z.W  (4 segments) -> SPECIFIC OUTCOMES
//   bullets / plain text  -> CONTENT
//
// Idempotent: re-running on already-clean data reproduces the same result.
//
// Usage: node scripts/fix-2013-home-economics-columns.mjs
//
// (Other 2013 subjects with phantom columns — Creative & Technology Studies,
// Design & Technology, Food & Nutrition, Home Management — are corrupted far
// more severely, with text shattered mid-word, and cannot be reconstructed
// without re-extracting from the source PDFs. They are intentionally left
// untouched.)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

export const HOME_ECONOMICS_2013 = 'Home Economics Syllabus (Grades 5-7, 2013)'
export const CANONICAL_COLUMNS = ['TOPIC', 'SUB-TOPIC', 'SPECIFIC OUTCOMES', 'CONTENT']

const TARGET_FILES = [
  'public/syllabi/curriculum-data-2013.json',
  'functions/data/curriculum-data-2013.json',
]

// Number of dotted numeric segments at the start of a value ("5.2.2." -> 3).
// Returns 0 when the value doesn't begin with a multi-segment code.
function leadingCodeDepth(value) {
  const m = /^\s*(\d+(?:\.\d+)+)\.?/.exec(value)
  return m ? m[1].split('.').filter(Boolean).length : 0
}

// Stray column-header rows ("KNOWLEDGE SKILLS VALUES") leaked into the data
// from the source workbook; they carry no curriculum content.
function isHeaderNoise(content) {
  return /^(?:KNOWLEDGE|SKILLS|VALUES|CONTENT|TOPIC|SUB-?TOPIC|SPECIFIC OUTCOMES?)(?:\s+(?:KNOWLEDGE|SKILLS|VALUES|CONTENT|TOPIC|SUB-?TOPIC|SPECIFIC OUTCOMES?))*$/i.test(content.trim())
}

function appendCell(existing, value) {
  return existing ? `${existing} ${value}` : value
}

// Rebuild one sheet's rows into the canonical 4-column shape.
export function reconstructHomeEconomicsSheet(sheet) {
  const columns = Array.isArray(sheet.columns) ? sheet.columns : []
  const out = []

  for (const row of sheet.rows || []) {
    if (row.type !== 'data') {
      out.push(row) // preserve any section banners verbatim
      continue
    }
    const bucket = { TOPIC: '', 'SUB-TOPIC': '', 'SPECIFIC OUTCOMES': '', CONTENT: '' }
    for (const col of columns) {
      const value = String(row.cells?.[col] ?? '').trim()
      if (!value) continue
      const depth = leadingCodeDepth(value)
      if (depth === 2) bucket.TOPIC = appendCell(bucket.TOPIC, value)
      else if (depth === 3) bucket['SUB-TOPIC'] = appendCell(bucket['SUB-TOPIC'], value)
      else if (depth >= 4) bucket['SPECIFIC OUTCOMES'] = appendCell(bucket['SPECIFIC OUTCOMES'], value)
      else bucket.CONTENT = appendCell(bucket.CONTENT, value)
    }

    const hasCode = bucket.TOPIC || bucket['SUB-TOPIC'] || bucket['SPECIFIC OUTCOMES']
    if (!hasCode && !bucket.CONTENT) continue            // fully empty row
    if (!hasCode && isHeaderNoise(bucket.CONTENT)) continue // leaked header row

    // A content-only row is a continuation of the previous entry's content
    // that the extractor split onto its own line — fold it back in.
    const prev = out[out.length - 1]
    if (!hasCode && prev && prev.type === 'data') {
      prev.cells.CONTENT = appendCell(prev.cells.CONTENT, bucket.CONTENT)
      continue
    }

    out.push({ type: 'data', cells: { ...bucket } })
  }

  // Preserve sheet-level metadata (e.g. `title`); only columns + rows change.
  return { ...sheet, columns: [...CANONICAL_COLUMNS], rows: out }
}

export function reconstructHomeEconomicsSubject(sheets) {
  const rebuilt = {}
  for (const [sheetName, sheet] of Object.entries(sheets || {})) {
    rebuilt[sheetName] = reconstructHomeEconomicsSheet(sheet)
  }
  return rebuilt
}

function main() {
  let changedAny = false
  for (const rel of TARGET_FILES) {
    const file = path.join(ROOT, rel)
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!data[HOME_ECONOMICS_2013]) {
      console.warn(`! ${rel}: "${HOME_ECONOMICS_2013}" not found, skipping`)
      continue
    }
    const before = JSON.stringify(data[HOME_ECONOMICS_2013])
    data[HOME_ECONOMICS_2013] = reconstructHomeEconomicsSubject(data[HOME_ECONOMICS_2013])
    const after = JSON.stringify(data[HOME_ECONOMICS_2013])
    if (before === after) {
      console.log(`= ${rel}: already clean`)
      continue
    }
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
    changedAny = true
    const sheets = data[HOME_ECONOMICS_2013]
    const rows = Object.values(sheets).reduce((n, s) => n + s.rows.length, 0)
    console.log(`✓ ${rel}: rebuilt Home Economics (${Object.keys(sheets).length} sheets, ${rows} rows)`)
  }
  if (!changedAny) console.log('Nothing to do.')
}

// Run only when invoked directly (not when imported by the test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
