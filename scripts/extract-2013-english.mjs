#!/usr/bin/env node
/**
 * Re-extract the 2013 English Language (Grades 2-7) syllabus tables directly
 * from the source CDC PDF and write Grades 3-7 into curriculum-data-2013.json.
 *
 * The XLSX→JSON conversion that seeded curriculum-data-2013.json mangled this
 * subject's Grades 3-7: data-value strings ended up as column *headers*,
 * Component/Topic were swapped, and the Skills/Values columns were truncated.
 * Those grades can't be repaired in place — they need re-extraction from the
 * original PDF, which is what this script does. Grade 2 was already clean and
 * is left untouched.
 *
 * The PDF is not committed (it lives with the project owner). Pass its path:
 *
 *   node scripts/extract-2013-english.mjs /path/to/ENGLISH_LANGUAGE_2-7_SYLLABI.pdf
 *
 * Reconstruction is position-based: each grade's six columns (Component, Topic,
 * Specific outcomes, Knowledge, Skills, Values) are located from the repeated
 * table header, every text run is bucketed into a column by its x coordinate,
 * runs are grouped into visual lines by y, and lines are folded into one
 * logical row per topic (a new row starts at a coded Topic cell, or — in the
 * word-labelled Writing/Language sections — at a non-empty Topic cell whose
 * Specific-outcomes cell starts with an outcome code).
 *
 * Output is written to both the public and functions copies.
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

export const SUBJECT = 'English Language Syllabus (Grades 2-7, 2013)'
export const GRADES_TO_REPLACE = [3, 4, 5, 6, 7] // Grade 2 is already clean
export const COLS = ['COMPONENT', 'TOPIC', 'SPECIFIC OUTCOMES', 'KNOWLEDGE', 'SKILLS', 'VALUES']
const HEADER_LABELS = ['component', 'topic', 'specific', 'knowledge', 'skills', 'values']
const TARGET_FILES = [
  'public/syllabi/curriculum-data-2013.json',
  'functions/data/curriculum-data-2013.json',
]
const NOISE = new Set(['component', 'topic', 'specific', 'outcomes', 'specific outcomes', 'knowledge', 'skills', 'values'])

async function loadPages(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath))
  const doc = await getDocument({ data, useSystemFonts: true }).promise
  const pages = []
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent()
    pages.push(tc.items
      .filter(i => i.str.trim())
      .map(i => ({ x: Math.round(i.transform[4]), y: Math.round(i.transform[5]), s: i.str.replace(/\s+/g, ' ').trim() })))
  }
  return pages
}

// Match a header-cell label exactly. Crucially NOT a prefix match: the Values
// column's data ("Knowledge and awareness of…") and the Skills data
// ("Application of…") must not be mistaken for the "Knowledge"/"Skills" header
// cells, or the column x-anchors — and every boundary derived from them — skew.
function matchesLabel(low, lbl) {
  if (lbl === 'specific') return low === 'specific' || low === 'specific outcomes'
  return low === lbl
}
function findAnchors(items) {
  // Anchor on the "Component" header cell — it only ever appears in the header
  // (the Component data column holds words like "Listening and speaking", never
  // the bare word "Component"). Then read the other labels only from the same
  // header band (±18px in y), so a stray "knowledge"/"skills" cell from the
  // previous grade's table spilling onto this page can't hijack an anchor.
  const comp = items.find(it => it.s.toLowerCase() === 'component')
  if (!comp) return null
  const x = {}
  const ys = []
  for (const it of items) {
    if (Math.abs(it.y - comp.y) > 18) continue
    const low = it.s.toLowerCase()
    for (const lbl of HEADER_LABELS) {
      if (matchesLabel(low, lbl) && x[lbl] === undefined) { x[lbl] = it.x; ys.push(it.y) }
    }
  }
  if (HEADER_LABELS.some(l => x[l] === undefined)) return null
  return { x, bottomY: Math.min(...ys) }
}

function gradeHeadings(pages) {
  const h = {}
  pages.forEach((items, idx) => {
    for (const it of items) {
      const m = /^GRADE\s*(\d+)\s+ENGLISH/i.exec(it.s)
      if (m && it.x < 200) h[Number(m[1])] = { page: idx + 1, y: it.y }
    }
  })
  return h
}

function buildBoundaries(anchors) {
  const xs = HEADER_LABELS.map(l => anchors.x[l])
  const bounds = []
  for (let i = 0; i < xs.length - 1; i++) bounds.push((xs[i] + xs[i + 1]) / 2)
  return bounds
}

function colOf(x, bounds) {
  for (let i = 0; i < bounds.length; i++) if (x < bounds[i]) return i
  return bounds.length
}

const startsWithCode = t => /^\d+\.\d+/.test(t.trim())

// The topic key (first three dotted segments) a coded cell belongs to:
// "5.1.2" for a topic "5.1.2 Language…" or an outcome "5.1.2.1 Seek…". One
// logical row = one topic key, so outcomes 5.1.2.1 / 5.1.2.2 group together
// while 5.1.3.x starts a new row. Using the key (rather than "is the topic
// cell coded?") tolerates the layout where an outcome code prints one line
// above its own topic cell — both still resolve to the same key.
export function topicKeyOf(text) {
  const m = /^(\d+\.\d+(?:\.\d+)?)/.exec(text.trim())
  return m ? m[1].split('.').slice(0, 3).join('.') : null
}
export function lineKey(topicCell, outcomeCell) {
  if (startsWithCode(topicCell)) return topicKeyOf(topicCell)
  if (startsWithCode(outcomeCell)) return topicKeyOf(outcomeCell)
  return null // continuation / unkeyed wrap line
}
function isNoiseRow(cells) {
  const vals = COLS.map(c => cells[c]).filter(Boolean)
  return vals.length > 0 && vals.every(v => NOISE.has(v.toLowerCase().trim()))
}

function extractGrade(pages, grade, startPage, endPage, nextHeading) {
  let anchors = null
  for (let p = startPage; p <= endPage && !anchors; p++) anchors = findAnchors(pages[p - 1])
  if (!anchors) throw new Error(`no header anchors for grade ${grade}`)
  const bounds = buildBoundaries(anchors)
  const headerY = anchors.bottomY

  const rows = []
  let cur = null
  let curKey = null
  const blank = () => ({ COMPONENT: '', TOPIC: '', 'SPECIFIC OUTCOMES': '', KNOWLEDGE: '', SKILLS: '', VALUES: '' })
  const pushCur = () => {
    if (!cur) return
    for (const c of COLS) cur[c] = cur[c].replace(/\s+/g, ' ').trim()
    if (COLS.some(c => cur[c]) && !isNoiseRow(cur)) rows.push({ type: 'data', cells: { ...cur } })
    cur = null
  }

  for (let p = startPage; p <= endPage; p++) {
    const items = pages[p - 1].filter(it => {
      if (it.y < 90) return false
      if (p === startPage && it.y >= headerY - 6) return false
      if (nextHeading && p === nextHeading.page && it.y <= nextHeading.y + 6) return false
      return true
    })
    items.sort((a, b) => b.y - a.y || a.x - b.x)
    const lines = []
    let line = null
    for (const it of items) {
      if (!line || Math.abs(it.y - line.y) > 4) { line = { y: it.y, cells: ['', '', '', '', '', ''] }; lines.push(line) }
      const ci = colOf(it.x, bounds)
      line.cells[ci] = (line.cells[ci] ? line.cells[ci] + ' ' : '') + it.s
    }
    for (const ln of lines) {
      const key = lineKey(ln.cells[1], ln.cells[2])
      if (key && key !== curKey) { pushCur(); cur = blank(); curKey = key }
      if (!cur) cur = blank()
      COLS.forEach((c, i) => { if (ln.cells[i]) cur[c] += (cur[c] ? ' ' : '') + ln.cells[i] })
    }
  }
  pushCur()
  return { title: `ENGLISH LANGUAGE SYLLABUS  —  GRADE ${grade}`, columns: [...COLS], rows }
}

export async function extractEnglishGrades(pdfPath) {
  const pages = await loadPages(pdfPath)
  const headings = gradeHeadings(pages)
  const starts = {}
  for (const [g, head] of Object.entries(headings)) {
    for (let p = head.page; p <= pages.length; p++) if (findAnchors(pages[p - 1])) { starts[g] = p; break }
  }
  const order = Object.keys(starts).map(Number).sort((a, b) => a - b)
  const out = {}
  for (let i = 0; i < order.length; i++) {
    const g = order[i]
    const nextHeading = i + 1 < order.length ? headings[order[i + 1]] : null
    const endP = nextHeading ? nextHeading.page : pages.length
    out[g] = extractGrade(pages, g, starts[g], endP, nextHeading)
  }
  return out
}

async function main() {
  const pdfPath = process.argv[2]
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    console.error('Usage: node scripts/extract-2013-english.mjs <path-to-english-2-7-syllabus.pdf>')
    process.exit(1)
  }
  const extracted = await extractEnglishGrades(pdfPath)
  for (const g of GRADES_TO_REPLACE) {
    if (!extracted[g]) throw new Error(`grade ${g} not found in PDF`)
    console.log(`Grade ${g}: ${extracted[g].rows.length} rows`)
  }
  for (const rel of TARGET_FILES) {
    const file = path.join(ROOT, rel)
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const subject = data[SUBJECT]
    if (!subject) { console.warn(`! ${rel}: "${SUBJECT}" not found, skipping`); continue }
    for (const g of GRADES_TO_REPLACE) subject[`Grade ${g}`] = extracted[g]
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
    console.log(`✓ ${rel}: replaced Grades ${GRADES_TO_REPLACE.join(', ')}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1) })
}
