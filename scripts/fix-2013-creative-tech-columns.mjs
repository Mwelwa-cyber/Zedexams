// Repairs the mangled Creative & Technology Studies (2013) syllabus in
// curriculum-data-2013.json.
//
// The 2013 workbook extraction was far rougher on this subject than on most:
// every sheet carried a thicket of phantom "COLUMN N" headers (31 of 48
// columns across the four grades), the real labelled columns (THEME / SUB
// TOPIC / SPECIFIC OUTCOMES / KNOWLEDGE) were left empty, and a lot of cell
// text was shattered across those phantom columns — sometimes mid-word
// ("Mo" | "ve" | "ment" -> "Movement", "Perf" | "orm" -> "Perform"). In the
// Syllabi Studio table this surfaced exactly as the user reported: literal
// "COLUMN 6 / COLUMN 7" headers and words split apart across cells.
//
// We rebuild the canonical four-column shape the rest of the 2013 primary
// syllabi use ([TOPIC, SUB-TOPIC, SPECIFIC OUTCOMES, CONTENT]) by classifying
// every non-empty cell in a row by its leading numeric code depth — the one
// signal the bad conversion left intact:
//   X.Y      (2 segments) -> TOPIC
//   X.Y.Z    (3 segments) -> SUB-TOPIC
//   X.Y.Z.W  (4 segments) -> SPECIFIC OUTCOMES
//   • bullet / plain text -> CONTENT
// Cells with no leading code are continuation fragments and are stitched back
// onto whichever field they were broken out of (see joinFragment / the
// cross-row fold in reconstructCreativeTechSheet).
//
// This is a best-effort reconstruction, not a perfect recovery: a minority of
// rows were scattered so badly (text broken letter-by-letter across columns)
// that no algorithm can faithfully reassemble them without the source PDF.
// Those rows still come out readable and in the correct canonical columns —
// just with some residual intra-word spacing — which is a large improvement
// over the phantom-column salad they replace.
//
// Idempotent: re-running on already-clean data reproduces the same result.
//
// Usage: node scripts/fix-2013-creative-tech-columns.mjs

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

export const CREATIVE_TECH_2013 = 'Creative & Technology Studies Syllabus (2013)'
export const CANONICAL_COLUMNS = ['TOPIC', 'SUB-TOPIC', 'SPECIFIC OUTCOMES', 'CONTENT']

const TARGET_FILES = [
  'public/syllabi/curriculum-data-2013.json',
  'functions/data/curriculum-data-2013.json',
]

// Number of dotted numeric segments at the start of a value ("1.1.2." -> 3).
// Returns 0 when the value doesn't begin with a multi-segment code.
export function leadingCodeDepth(value) {
  const m = /^\s*(\d+(?:\.\d+)+)\.?/.exec(value)
  return m ? m[1].split('.').filter(Boolean).length : 0
}

function isBullet(value) {
  return /^[•\-*]/.test(value.trim())
}

// Stray column-header rows ("KNOWLEDGE", "SKILLS VALUES") leaked into the data
// from the source workbook; they carry no curriculum content.
function isHeaderNoise(content) {
  const W = '(?:KNOWLEDGE|SKILLS|VALUES|CONTENT|THEME|TOPIC|SUB-?\\s?TOPIC|SPECIFIC OUTCOMES?)'
  return new RegExp(`^${W}(?:\\s+${W})*$`, 'i').test(content.trim())
}

// Append a continuation fragment to existing text. A fragment that is a single
// token (no internal whitespace) starting with a lowercase letter is a piece
// of a word that the bad PDF->XLSX conversion split mid-word ("Mo" | "ve" |
// "ment"); join it tight. Anything with internal spaces, or starting with an
// uppercase letter / digit / bullet, is a fresh word or phrase; space-join it.
export function joinFragment(existing, frag) {
  frag = frag.trim()
  if (!frag) return existing
  if (!existing) return frag
  const midWordPiece = !/\s/.test(frag) && /^[a-z]/.test(frag)
  return midWordPiece ? existing + frag : `${existing} ${frag}`
}

// A new coded segment starts its own logical line within a field.
function appendLine(existing, value) {
  return existing ? `${existing}\n${value}` : value
}

// Collapse one source row's scattered cells into the canonical four-field
// bucket, classifying each non-empty cell by leading code depth and folding
// uncoded fragments back into the field they were broken out of.
export function reconstructCreativeTechRow(columns, cells) {
  const bucket = { TOPIC: '', 'SUB-TOPIC': '', 'SPECIFIC OUTCOMES': '', CONTENT: '' }
  let current = null
  for (const col of columns) {
    const value = String(cells?.[col] ?? '').trim()
    if (!value) continue
    if (isBullet(value)) {
      bucket.CONTENT = appendLine(bucket.CONTENT, value)
      current = 'CONTENT'
      continue
    }
    const depth = leadingCodeDepth(value)
    let target = null
    if (depth === 2) target = 'TOPIC'
    else if (depth === 3) target = 'SUB-TOPIC'
    else if (depth >= 4) target = 'SPECIFIC OUTCOMES'
    if (target) {
      bucket[target] = appendLine(bucket[target], value)
      current = target
    } else if (current) {
      bucket[current] = joinFragment(bucket[current], value)
    } else {
      bucket.CONTENT = joinFragment(bucket.CONTENT, value)
      current = 'CONTENT'
    }
  }
  return bucket
}

// Rebuild one grade sheet into the canonical four-column shape.
export function reconstructCreativeTechSheet(sheet) {
  const columns = Array.isArray(sheet.columns) ? sheet.columns : []
  const out = []

  for (const row of sheet.rows || []) {
    if (row.type !== 'data') {
      out.push(row) // preserve any section banners verbatim
      continue
    }
    const bucket = reconstructCreativeTechRow(columns, row.cells)
    const hasCode = bucket.TOPIC || bucket['SUB-TOPIC'] || bucket['SPECIFIC OUTCOMES']
    if (!hasCode && !bucket.CONTENT) continue                 // fully empty row
    if (!hasCode && isHeaderNoise(bucket.CONTENT)) continue   // leaked header row

    // An anchorless short, non-bulleted CONTENT row is a wrapped continuation
    // of the previous row's last field — fold it back in. These cross-row
    // breaks fall on word boundaries (the outcome text wrapped onto the next
    // visual line), so they're space-joined, unlike the mid-word in-row splits.
    //
    // The fold target must be the previous row's rightmost populated *coded*
    // field (SPECIFIC OUTCOMES > SUB-TOPIC > TOPIC) — that's exactly where a
    // re-parse of the rebuilt row would re-absorb a trailing uncoded fragment,
    // so folding anywhere else would break idempotency.
    const prev = out[out.length - 1]
    const isContinuation =
      !hasCode && bucket.CONTENT && !isBullet(bucket.CONTENT) &&
      !bucket.CONTENT.includes('\n') && bucket.CONTENT.length < 60
    const foldTarget = prev && prev.type === 'data'
      ? ['SPECIFIC OUTCOMES', 'SUB-TOPIC', 'TOPIC'].find(k => prev.cells[k]?.trim())
      : null
    if (isContinuation && foldTarget) {
      prev.cells[foldTarget] = `${prev.cells[foldTarget]} ${bucket.CONTENT}`
      continue
    }

    out.push({ type: 'data', cells: { ...bucket } })
  }

  // Preserve sheet-level metadata (e.g. `title`); only columns + rows change.
  return { ...sheet, columns: [...CANONICAL_COLUMNS], rows: out }
}

export function reconstructCreativeTechSubject(sheets) {
  const rebuilt = {}
  for (const [sheetName, sheet] of Object.entries(sheets || {})) {
    rebuilt[sheetName] = reconstructCreativeTechSheet(sheet)
  }
  return rebuilt
}

function main() {
  let changedAny = false
  for (const rel of TARGET_FILES) {
    const file = path.join(ROOT, rel)
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!data[CREATIVE_TECH_2013]) {
      console.warn(`! ${rel}: "${CREATIVE_TECH_2013}" not found, skipping`)
      continue
    }
    const before = JSON.stringify(data[CREATIVE_TECH_2013])
    data[CREATIVE_TECH_2013] = reconstructCreativeTechSubject(data[CREATIVE_TECH_2013])
    const after = JSON.stringify(data[CREATIVE_TECH_2013])
    if (before === after) {
      console.log(`= ${rel}: already clean`)
      continue
    }
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
    changedAny = true
    const sheets = data[CREATIVE_TECH_2013]
    const rows = Object.values(sheets).reduce((n, s) => n + s.rows.length, 0)
    console.log(`✓ ${rel}: rebuilt Creative & Technology Studies (${Object.keys(sheets).length} sheets, ${rows} rows)`)
  }
  if (!changedAny) console.log('Nothing to do.')
}

// Run only when invoked directly (not when imported by the test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
