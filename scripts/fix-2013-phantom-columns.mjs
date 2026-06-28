// Repairs the phantom "COLUMN N" corruption in several 2013 syllabi in
// curriculum-data-2013.json — the same class of bug already fixed for Home
// Economics and Creative & Technology Studies, but here the damage is milder:
// the cell text is intact, it just landed one column to the left of its
// labelled column (or in a trailing overflow column), leaving the real label
// empty and a phantom "COLUMN N" header showing in the Syllabi Studio table.
//
// For each affected sheet we coalesce the scattered source columns back into
// the canonical labelled columns. The transform is deliberately LOSSLESS:
// every non-empty source cell ends up in exactly one canonical column
// (concatenated if two sources both hold text), so even where the original
// column semantics are muddled the worst case is a bullet landing in an
// adjacent column — never dropped. Leaked header rows ("KNOWLEDGE" / "SKILLS
// VALUES") are removed.
//
// Idempotent: every canonical column lists itself among its sources, so a
// second run is a no-op.
//
// NOT handled here (left untouched — flagged, not silently mangled):
//   • Mathematics (Grades 10-12) Grade 12 — the rows drift by varying offsets
//     so the Knowledge/Skills/Values triple can't be realigned by a fixed map.
//   • English Language (Grades 2-7) Grades 3-7 — data-value column headers plus
//     semantic column swaps and mid-word breaks.
//   Both need the source spreadsheets to reconstruct faithfully.
//
// Usage: node scripts/fix-2013-phantom-columns.mjs

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const TARGET_FILES = [
  'public/syllabi/curriculum-data-2013.json',
  'functions/data/curriculum-data-2013.json',
]

// Per-sheet rebuild plans. Each plan lists the canonical output columns in
// order; each canonical column names the source columns to pull from (first
// non-empty wins; multiple non-empty are concatenated). The canonical name is
// always treated as one of its own sources (appended automatically) so the
// rebuild is idempotent.
const FN_HM_COLUMNS = [
  ['THEME', ['COLUMN 1']],
  ['TOPIC', ['COLUMN 3']],
  ['SPECIFIC OUTCOMES', ['COLUMN 5']],
  ['KNOWLEDGE', ['COLUMN 7']],
  ['SKILLS', ['COLUMN 9']],
  ['VALUES', ['COLUMN 11']],
]

export const PLANS = [
  {
    label: 'Food & Nutrition',
    subject: 'Food & Nutrition Syllabus (Grades 10-12, 2013)',
    sheets: { 'Grade 10': FN_HM_COLUMNS, 'Grade 11': FN_HM_COLUMNS, 'Grade 12': FN_HM_COLUMNS },
  },
  {
    label: 'Home Management',
    subject: 'Home Management Syllabus (Grades 10-12, 2013)',
    sheets: { 'Grade 10': FN_HM_COLUMNS, 'Grade 11': FN_HM_COLUMNS, 'Grade 12': FN_HM_COLUMNS },
  },
  {
    label: 'Mathematics (Grades 10-12)',
    subject: 'Mathematics Syllabus (Grades 10-12, 2013)',
    sheets: {
      // Grade 10: only the first column is mis-headed with a data value and
      // holds the (empty-labelled) TOPIC text.
      'Grade 10': [
        ['TOPIC', ['10.2 SETS']],
        ['SUBTOPICS', []],
        ['SPECIFIC OUTCOMES', []],
        ['KNOWLEDGE', []],
        ['SKILLS', []],
        ['VALUES', []],
      ],
      // Grade 11: leading phantom holds TOPIC; trailing phantoms hold the
      // Knowledge / Skills / Values columns whose labels were lost.
      'Grade 11': [
        ['TOPIC', ['COLUMN 1']],
        ['SUB TOPIC', []],
        ['SPECIFIC OUTCOME', []],
        ['KNOWLEDGE', ['COLUMN 5']],
        ['SKILLS', ['COLUMN 6']],
        ['VALUES', ['COLUMN 7']],
      ],
    },
  },
  {
    label: 'Agricultural Science',
    subject: 'Agricultural Science Syllabus (Grades 10-12, 2013)',
    sheets: {
      // Trailing overflow column — a few rows' Values bullets landed in COLUMN 7.
      'Grade 12': [
        ['TOPIC', []],
        ['SUB-TOPIC', []],
        ['SPECIFIC OUTCOMES', []],
        ['CONTENT', []],
        ['Skills', []],
        ['Values', ['COLUMN 7']],
      ],
    },
  },
  {
    label: 'Physical Education (Grades 8-9)',
    subject: 'Physical Education Syllabus (Grades 8-9, 2013)',
    sheets: {
      'Grade 8': [
        ['TOPIC', []],
        ['SUB-TOPIC', []],
        ['SPECIFIC OUTCOMES', []],
        ['Knowledge', []],
        ['CONTENT', []],
        ['Values', ['COLUMN 7']],
      ],
    },
  },
  {
    label: 'Physical Education (Grades 10-12)',
    subject: 'Physical Education Syllabus (Grades 10-12, 2013)',
    sheets: {
      'Grade 12': [
        ['TOPIC', []],
        ['SUB-TOPIC', []],
        ['SPECIFIC OUTCOMES', []],
        ['Knowledge', []],
        ['Skills', ['COLUMN 7']],
        ['CONTENT', ['COLUMN 8']],
      ],
    },
  },
]

const NOISE_WORDS = [
  'KNOWLEDGE', 'SKILLS', 'VALUES', 'CONTENT', 'THEME', 'TOPIC',
  'SUB-TOPIC', 'SUBTOPIC', 'SUBTOPICS', 'SUB TOPIC',
  'SPECIFIC OUTCOME', 'SPECIFIC OUTCOMES', 'COMPONENT',
]
function isNoiseWord(value) {
  return NOISE_WORDS.includes(value.trim().toUpperCase())
}

function coalesce(existing, value) {
  if (!value) return existing
  if (!existing) return value
  if (existing.includes(value)) return existing // idempotent: already merged
  const sep = /^[•\-*]/.test(value.trim()) || existing.includes('\n') ? '\n' : ' '
  return `${existing}${sep}${value}`
}

// Rebuild one sheet from its column plan.
export function rebuildSheet(sheet, columnPlan) {
  // Ensure every canonical column is one of its own sources (idempotency).
  const plan = columnPlan.map(([name, sources]) => [
    name,
    sources.includes(name) ? sources : [...sources, name],
  ])
  const canonical = plan.map(([name]) => name)
  const out = []

  for (const row of sheet.rows || []) {
    if (row.type !== 'data') { out.push(row); continue }
    const cells = {}
    for (const [name, sources] of plan) {
      let value = ''
      for (const src of sources) {
        const v = String(row.cells?.[src] ?? '').trim()
        if (v) value = coalesce(value, v)
      }
      cells[name] = value
    }
    const values = Object.values(cells).filter(Boolean)
    if (!values.length) continue                       // fully empty row
    if (values.every(isNoiseWord)) continue            // leaked header row
    out.push({ type: 'data', cells })
  }

  return { ...sheet, columns: canonical, rows: out }
}

export function rebuildSubject(sheets, sheetPlans) {
  const rebuilt = {}
  for (const [name, sheet] of Object.entries(sheets || {})) {
    rebuilt[name] = sheetPlans[name] ? rebuildSheet(sheet, sheetPlans[name]) : sheet
  }
  return rebuilt
}

// Assert no non-empty, non-noise source cell was dropped by the rebuild.
export function assertLossless(originalSheet, rebuiltSheet, sheetPlan) {
  const planned = new Set(sheetPlan.flatMap(([name, srcs]) => [name, ...srcs]))
  const rebuiltText = rebuiltSheet.rows
    .filter(r => r.type === 'data')
    .map(r => Object.values(r.cells).join(''))
    .join('')
  for (const row of originalSheet.rows || []) {
    if (row.type !== 'data') continue
    for (const [col, raw] of Object.entries(row.cells || {})) {
      const v = String(raw ?? '').trim()
      if (!v || isNoiseWord(v)) continue
      if (!planned.has(col)) throw new Error(`source column not in plan: ${col}`)
      if (!rebuiltText.includes(v)) {
        throw new Error(`dropped value from ${col}: ${JSON.stringify(v.slice(0, 60))}`)
      }
    }
  }
}

function main() {
  let changedAny = false
  for (const rel of TARGET_FILES) {
    const file = path.join(ROOT, rel)
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    let fileChanged = false
    for (const plan of PLANS) {
      const subject = data[plan.subject]
      if (!subject) { console.warn(`! ${rel}: "${plan.subject}" not found`); continue }
      const before = JSON.stringify(subject)
      const rebuilt = rebuildSubject(subject, plan.sheets)
      // Safety: verify losslessness before committing the rebuild.
      for (const [name, sheetPlan] of Object.entries(plan.sheets)) {
        if (subject[name]) assertLossless(subject[name], rebuilt[name], sheetPlan)
      }
      data[plan.subject] = rebuilt
      if (JSON.stringify(rebuilt) !== before) fileChanged = true
    }
    if (!fileChanged) { console.log(`= ${rel}: already clean`); continue }
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
    changedAny = true
    console.log(`✓ ${rel}: rebuilt ${PLANS.length} subjects`)
  }
  if (!changedAny) console.log('Nothing to do.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
