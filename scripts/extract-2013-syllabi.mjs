#!/usr/bin/env node
/**
 * Extract the 2013 syllabi .xlsx files into the JSON shape consumed by
 * `src/components/teacher/SyllabiLibrary.jsx`.
 *
 * Source dir is hard-coded to the local machine path the project owner
 * keeps the originals at. Re-run any time the .xlsx files are updated:
 *
 *   node scripts/extract-2013-syllabi.mjs
 *
 * Output overwrites `public/syllabi/curriculum-data-2013.json`.
 *
 * Header inference: row 2 in each sheet is the column-name row, but the
 * MoE template often leaves the last two columns as "COLUMN 5" / "COLUMN 6".
 * Row 3 in that template carries the real names (Knowledge / Skills /
 * Values) — we fall back to it when the row-2 header is a placeholder.
 */

import { createRequire } from 'node:module'
import { readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// exceljs is a devDep of functions/, not the root package. Reach into it
// via createRequire so this script doesn't need its own install.
const require = createRequire(import.meta.url)
const ExcelJS = require(resolve(dirname(fileURLToPath(import.meta.url)), '../functions/node_modules/exceljs'))

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

const SOURCE_DIR = 'M:/Primary/Grade 4/Syllabi/Old Syllabi 2013'
const OUT_PATH = resolve(REPO_ROOT, 'public/syllabi/curriculum-data-2013.json')

// Files whose source xlsx is malformed in a way the heuristic extractor
// can't recover from. Re-add once cleaner sources are available.
const SKIP_FILES = new Set([])

// Per-file column-name overrides. Used when the row-2 + row-3 inference
// produces a clearly wrong header (e.g. text fragmented across cells in
// a bad PDF→XLSX conversion). Indexed by 0-based column number.
const COLUMN_OVERRIDES = {
  // Art & Design's source xlsx has every cell's text broken across
  // adjacent columns. The headers come out as "S UB-TOPIC" / "Knowledg"
  // / "e" — fix the labels so the table renders cleanly even though
  // the underlying row data stays fragmented (a source-cleanup
  // problem, not a code one).
  'Art & Design Syllabus (Grades 10-12, 2013).xlsx': {
    0: 'TOPIC',
    1: 'SUB-TOPIC',
    2: 'SPECIFIC OUTCOMES',
    3: 'CONTENT',
    4: 'Knowledge / Skills',
    5: 'Values',
  },
}

if (!existsSync(SOURCE_DIR)) {
  console.error(`Source dir not found: ${SOURCE_DIR}`)
  process.exit(1)
}

function cleanCell(value) {
  if (value === null || value === undefined) return ''
  // Rich-text cells come back as { richText: [...] } from exceljs.
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map(r => r.text || '').join('').trim()
    }
    if (value.text) return String(value.text).trim()
    if (value.result !== undefined) return String(value.result).trim()
    return String(value).trim()
  }
  return String(value).trim()
}

function isPlaceholderHeader(text) {
  if (!text) return true
  return /^COLUMN\s*\d+$/i.test(text.trim())
}

async function extractWorkbook(filePath, fileName) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const sheets = {}
  const overrides = COLUMN_OVERRIDES[fileName] || null

  for (const ws of wb.worksheets) {
    // Skip obviously empty or hidden index sheets.
    if (!ws || ws.rowCount < 2) continue

    const title = cleanCell(ws.getRow(1).getCell(1).value)
    const headerRow = ws.getRow(2)
    const subHeaderRow = ws.getRow(3)

    // Pull header cells until we hit a long run of empties — the MoE
    // templates always pack columns left-to-right.
    const rawHeaders = []
    let consecutiveEmpty = 0
    for (let c = 1; c <= 12; c++) {
      const raw = cleanCell(headerRow.getCell(c).value)
      if (raw) {
        consecutiveEmpty = 0
        rawHeaders.push(raw)
      } else {
        consecutiveEmpty++
        if (consecutiveEmpty >= 3 && rawHeaders.length > 0) break
        rawHeaders.push('')
      }
    }
    // Trim trailing empties.
    while (rawHeaders.length && !rawHeaders[rawHeaders.length - 1]) rawHeaders.pop()

    // Replace "COLUMN N" placeholders with the row-3 sub-header where
    // possible. Long sub-header text is data, not a label — bail out then.
    // Per-file overrides win in all cases (the malformed Art & Design source
    // ends up with sliced-up header text the inference can't fix).
    const columns = rawHeaders.map((h, i) => {
      if (overrides && overrides[i] !== undefined) return overrides[i]
      if (!isPlaceholderHeader(h)) return h
      const fallback = cleanCell(subHeaderRow.getCell(i + 1).value)
      if (fallback && fallback.length < 25) return fallback
      return h || `COLUMN ${i + 1}`
    })

    // Walk data rows. Start at row 3 unless row 3 was itself the sub-header
    // (i.e. our header inference used it) — in that case row 3 still
    // carries the sub-header text and downstream rendering treats it as a
    // data row labelled "Knowledge / Skills / Values", which matches the
    // existing JSON.
    const rows = []
    for (let r = 3; r <= ws.rowCount; r++) {
      const cells = {}
      let hasContent = false
      for (let c = 0; c < columns.length; c++) {
        const v = cleanCell(ws.getRow(r).getCell(c + 1).value)
        cells[columns[c]] = v
        if (v) hasContent = true
      }
      if (hasContent) rows.push({ type: 'data', cells })
    }

    sheets[ws.name] = { title, columns, rows }
  }

  return sheets
}

async function main() {
  const files = readdirSync(SOURCE_DIR).filter(f => f.toLowerCase().endsWith('.xlsx'))
  files.sort()
  console.log(`Found ${files.length} .xlsx files in ${SOURCE_DIR}`)

  const out = {}
  for (const file of files) {
    if (SKIP_FILES.has(file)) {
      console.log(`  ${file} ... SKIPPED (malformed source)`)
      continue
    }
    const subjectKey = file.replace(/\.xlsx$/i, '')
    process.stdout.write(`  ${subjectKey} ... `)
    try {
      const sheets = await extractWorkbook(join(SOURCE_DIR, file), file)
      out[subjectKey] = sheets
      const sheetCount = Object.keys(sheets).length
      const totalRows = Object.values(sheets).reduce((n, s) => n + s.rows.length, 0)
      console.log(`${sheetCount} sheet(s), ${totalRows} data rows`)
    } catch (err) {
      console.log(`FAILED — ${err.message}`)
    }
  }

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), 'utf8')
  const bytes = JSON.stringify(out).length
  console.log(`\nWrote ${OUT_PATH}`)
  console.log(`${Object.keys(out).length} subjects · ${(bytes / 1024).toFixed(1)} KB minified`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
