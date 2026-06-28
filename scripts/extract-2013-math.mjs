#!/usr/bin/env node
/**
 * Re-extract the 2013 Mathematics (Grades 10-12) Grade 12 syllabus table from
 * the source CDC PDF and write it into curriculum-data-2013.json.
 *
 * Grade 12 was the one sheet the phantom-column repair (#1348) couldn't fix in
 * place: its rows drift by varying offsets, so the Knowledge/Skills/Values
 * triple can't be realigned by a fixed column map. Grades 10 and 11 were
 * already repaired in #1348 and are left untouched.
 *
 * The PDF is not committed (it lives with the project owner). Pass its path:
 *
 *   node scripts/extract-2013-math.mjs /path/to/Mathematics_10-12.pdf
 *
 * Reconstruction is position-based (same approach as scripts/extract-2013-
 * english.mjs): the six columns (Topic, Sub topic, Specific outcome,
 * Knowledge, Skills, Values) are located from the repeated table header,
 * every text run is bucketed into a column by its x coordinate, runs are
 * grouped into visual lines by y, and lines are folded into one logical row
 * per sub-topic key (X.Y.Z — taken from whichever of the sub-topic / outcome
 * cell carries a code). The "?" bullet glyph the PDF uses is normalised to "•".
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

export const SUBJECT = 'Mathematics Syllabus (Grades 10-12, 2013)'
export const GRADE = 'Grade 12'
export const COLS = ['TOPIC', 'SUB TOPIC', 'SPECIFIC OUTCOME', 'KNOWLEDGE', 'SKILLS', 'VALUES']
const HEADER_LABELS = ['topic', 'sub topic', 'specific outcome', 'knowledge', 'skills', 'values']
const TARGET_FILES = [
  'public/syllabi/curriculum-data-2013.json',
  'functions/data/curriculum-data-2013.json',
]
const NOISE = new Set(['topic', 'sub topic', 'sub-topic', 'sub-topics', 'specific outcome',
  'specific outcomes', 'knowledge', 'skills', 'values', 'content'])

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

function matchesLabel(low, lbl) {
  if (lbl === 'sub topic') return low === 'sub topic' || low === 'sub-topic' || low === 'sub-topics'
  if (lbl === 'specific outcome') return low === 'specific outcome' || low === 'specific outcomes'
  return low === lbl
}

// Anchor on the "Topic" header cell (never a data value), then read the other
// labels only from the same header band (±18px in y) so the "CONTENT"
// super-header or stray text can't hijack an anchor.
function findAnchors(items) {
  const topic = items.find(it => it.s.toLowerCase() === 'topic')
  if (!topic) return null
  const x = {}
  const ys = []
  for (const it of items) {
    if (Math.abs(it.y - topic.y) > 18) continue
    const low = it.s.toLowerCase()
    for (const lbl of HEADER_LABELS) {
      if (matchesLabel(low, lbl) && x[lbl] === undefined) { x[lbl] = it.x; ys.push(it.y) }
    }
  }
  if (HEADER_LABELS.some(l => x[l] === undefined)) return null
  return { x, bottomY: Math.min(...ys) }
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
export function topicKeyOf(text) {
  const m = /^(\d+\.\d+(?:\.\d+)?)/.exec(text.trim())
  return m ? m[1].split('.').slice(0, 3).join('.') : null
}
export function lineKey(subTopicCell, outcomeCell) {
  if (startsWithCode(subTopicCell)) return topicKeyOf(subTopicCell)
  if (startsWithCode(outcomeCell)) return topicKeyOf(outcomeCell)
  return null
}
function isNoiseRow(cells) {
  const vals = COLS.map(c => cells[c]).filter(Boolean)
  return vals.length > 0 && vals.every(v => NOISE.has(v.toLowerCase().trim()))
}

// Grade 12's table pages: the "GRADE 12" section heading (not the running
// "GRADE 10 - 12" footer), then consecutive header-bearing pages whose Topic
// column still carries 12.x codes.
function gradeTwelvePages(pages) {
  let headingPage = null
  pages.forEach((items, idx) => {
    if (items.some(it => /^GRADE\s*12$/i.test(it.s) && it.x < 120)) headingPage = idx + 1
  })
  if (!headingPage) return []
  const out = []
  for (let p = headingPage; p <= pages.length; p++) {
    const items = pages[p - 1]
    if (!findAnchors(items)) continue
    const has12 = items.some(it => it.x < 150 && /^12\.\d/.test(it.s))
    if (out.length && !has12) break // reached the post-table appendix
    if (has12) out.push(p)
  }
  return out
}

export function extractGradeTwelve(pages) {
  const tablePages = gradeTwelvePages(pages)
  if (!tablePages.length) throw new Error('Grade 12 table pages not found')
  let anchors = null
  for (const p of tablePages) { anchors = anchors || findAnchors(pages[p - 1]) }
  const bounds = buildBoundaries(anchors)

  const rows = []
  let cur = null
  let curKey = null
  const blank = () => ({ TOPIC: '', 'SUB TOPIC': '', 'SPECIFIC OUTCOME': '', KNOWLEDGE: '', SKILLS: '', VALUES: '' })
  const pushCur = () => {
    if (!cur) return
    for (const c of COLS) cur[c] = cur[c].replace(/\s+/g, ' ').trim()
    if (COLS.some(c => cur[c]) && !isNoiseRow(cur)) rows.push({ type: 'data', cells: { ...cur } })
    cur = null
  }

  for (const p of tablePages) {
    const headerY = findAnchors(pages[p - 1])?.bottomY ?? 9999
    const items = pages[p - 1].filter(it => it.y < headerY - 6 && it.y > 45) // below header, above footer
    items.sort((a, b) => b.y - a.y || a.x - b.x)
    const lines = []
    let line = null
    for (const it of items) {
      if (!line || Math.abs(it.y - line.y) > 4) { line = { y: it.y, cells: ['', '', '', '', '', ''] }; lines.push(line) }
      const ci = colOf(it.x, bounds)
      const token = it.s === '?' ? '•' : it.s // normalise the PDF's bullet glyph
      line.cells[ci] = (line.cells[ci] ? line.cells[ci] + ' ' : '') + token
    }
    for (const ln of lines) {
      const key = lineKey(ln.cells[1], ln.cells[2])
      if (key && key !== curKey) { pushCur(); cur = blank(); curKey = key }
      if (!cur) cur = blank()
      COLS.forEach((c, i) => { if (ln.cells[i]) cur[c] += (cur[c] ? ' ' : '') + ln.cells[i] })
    }
  }
  pushCur()
  return { title: `MATHEMATICS SYLLABUS  —  GRADE 12`, columns: [...COLS], rows }
}

async function main() {
  const pdfPath = process.argv[2]
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    console.error('Usage: node scripts/extract-2013-math.mjs <path-to-mathematics-10-12.pdf>')
    process.exit(1)
  }
  const pages = await loadPages(pdfPath)
  const sheet = extractGradeTwelve(pages)
  console.log(`Grade 12: ${sheet.rows.length} rows`)
  for (const rel of TARGET_FILES) {
    const file = path.join(ROOT, rel)
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const subject = data[SUBJECT]
    if (!subject) { console.warn(`! ${rel}: "${SUBJECT}" not found, skipping`); continue }
    subject[GRADE] = sheet
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
    console.log(`✓ ${rel}: replaced ${GRADE}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1) })
}
