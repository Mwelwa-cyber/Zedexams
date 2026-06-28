// Shared position-based extractor for the 2013 CDC syllabus PDFs.
//
// All of these PDFs are the same kind of table: a repeated column header, then
// rows whose cells wrap across several visual lines. The XLSX→JSON conversion
// that seeded curriculum-data-2013.json mangled many of them (data-value
// column headers, swapped/truncated columns), so the only faithful repair is
// to re-extract from the source PDF. Each subject differs only in its column
// set, so this core is parameterised by a small config and the per-subject
// scripts supply that config.
//
// Approach: locate the columns from the header band (anchored on an
// unambiguous label, read within a tight y-window so a "CONTENT" super-header
// or a stray cell can't hijack an anchor), bucket every text run into a column
// by its x coordinate, group runs into visual lines by y, and fold lines into
// one logical row per "row key" — the code of the row-defining column
// (topic/sub-topic), with an outcome code mapped to its parent by dropping its
// last segment. This tolerates the layout where an outcome code prints one
// line above its own topic cell.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'node:fs'

export async function loadPages(pdfPath) {
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

const startsWithCode = t => /^\d+\.\d+/.test(String(t).trim())
export function fullCode(text) {
  const m = /^(\d+(?:\.\d+)+)/.exec(String(text).trim())
  return m ? m[1] : null
}
function dropLastSegment(code) {
  const parts = code.split('.')
  return parts.length > 2 ? parts.slice(0, -1).join('.') : code
}

// Default label matcher: exact (case-insensitive), with a couple of common
// multi-word / hyphen variants folded together.
function defaultMatch(low, lbl) {
  // Strip all hyphens/spaces so "SUBTOPIC" / "SUB-TOPIC" / "SUB TOPIC" and
  // "SPECIFIC OUTCOMES" all match their label regardless of separator style
  // (the PDFs are inconsistent grade to grade).
  const canon = s => s.replace(/[-\s]/g, '')
  return canon(low) === canon(lbl)
}

// Find column x-anchors from the header band. cfg.labels are the lowercase
// header labels in column order; cfg.anchorLabel is the unambiguous one to key
// the band on (it never appears as a data value).
export function findAnchors(items, cfg) {
  const match = cfg.labelMatch || defaultMatch
  const anchor = items.find(it => match(it.s.toLowerCase(), cfg.anchorLabel))
  if (!anchor) return null
  const x = {}
  const ys = []
  for (const it of items) {
    if (Math.abs(it.y - anchor.y) > 20) continue
    const low = it.s.toLowerCase()
    for (const lbl of cfg.labels) {
      if (match(low, lbl) && x[lbl] === undefined) { x[lbl] = it.x; ys.push(it.y) }
    }
  }
  if (cfg.labels.some(l => x[l] === undefined)) return null
  return { x, bottomY: Math.min(...ys) }
}

function buildBoundaries(anchors, labels) {
  const xs = labels.map(l => anchors.x[l])
  const bounds = []
  for (let i = 0; i < xs.length - 1; i++) bounds.push((xs[i] + xs[i + 1]) / 2)
  return bounds
}
function colOf(x, bounds) {
  for (let i = 0; i < bounds.length; i++) if (x < bounds[i]) return i
  return bounds.length
}

// Header band + column boundaries for one page. When cfg.boundaries is given
// (subjects whose right-hand labels sit under a "CONTENT" super-header and
// can't all be matched), use those fixed boundaries and take the header band
// bottom from the anchor label; otherwise derive both from the found labels.
function headerInfo(items, cfg) {
  if (cfg.boundaries) {
    const match = cfg.labelMatch || defaultMatch
    const anchor = items.find(it => match(it.s.toLowerCase(), cfg.anchorLabel))
    if (!anchor) return null
    return { bottomY: anchor.y, bounds: cfg.boundaries }
  }
  const anchors = findAnchors(items, cfg)
  if (!anchors) return null
  return { bottomY: anchors.bottomY, bounds: buildBoundaries(anchors, cfg.labels) }
}

// Group pages by the leading number of the topic/sub-topic codes in their left
// region — that number is the grade. A page is a table page if it carries at
// least two such codes (preamble/appendix pages don't); the header itself is
// NOT required, so continuation pages whose header doesn't repeat are still
// included. Returns { gradeNumber: [pageNumbers] }.
export function detectGradePages(pages, cfg) {
  const out = {}
  pages.forEach((items, idx) => {
    const counts = {}
    for (const it of items) {
      if (it.x > 220) continue
      const m = /^(\d+)\.\d+/.exec(it.s) // require a real X.Y code, not "5……" TOC leaders
      if (m) counts[m[1]] = (counts[m[1]] || 0) + 1
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    if (total < 2) return // not a data table page
    const grade = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]
    ;(out[grade] = out[grade] || []).push(idx + 1)
  })
  // A grade's table is a contiguous block of pages; keep only the first run
  // (gap ≤ 2) starting at the earliest page, so a later appendix that reuses
  // "1.x"-style numbering doesn't get pulled in.
  for (const g of Object.keys(out)) {
    const ps = out[g].sort((a, b) => a - b)
    const run = [ps[0]]
    for (let i = 1; i < ps.length; i++) {
      if (ps[i] - run[run.length - 1] <= 2) run.push(ps[i]); else break
    }
    out[g] = run
  }
  return out
}

// Extract one grade's sheet from the given page numbers.
export function extractSheet(pages, pageNums, cfg) {
  const { columns, rowCol, outcomeCol } = cfg
  let info = null
  for (const p of pageNums) { info = info || headerInfo(pages[p - 1], cfg) }
  if (!info) throw new Error('no header anchors')
  const bounds = info.bounds

  const lineKey = (cells) => {
    if (startsWithCode(cells[rowCol])) return fullCode(cells[rowCol])
    if (startsWithCode(cells[outcomeCol])) return dropLastSegment(fullCode(cells[outcomeCol]))
    return null
  }
  const noise = new Set((cfg.noiseWords || []).map(s => s.toLowerCase()))
  // A cell is "header noise" if every word in it is a header label word
  // (covers split leaks like "OUTCOMES KNOWLEDGE").
  const allNoise = (v) => {
    const t = v.toLowerCase().trim()
    if (noise.has(t)) return true
    const words = t.split(/\s+/)
    return words.length > 0 && words.every(w => noise.has(w))
  }
  const isNoiseRow = (cells) => {
    const vals = columns.map(c => cells[c]).filter(Boolean)
    return vals.length > 0 && vals.every(allNoise)
  }

  const rows = []
  let cur = null
  let curKey = null
  const blank = () => Object.fromEntries(columns.map(c => [c, '']))
  const pushCur = () => {
    if (!cur) return
    for (const c of columns) cur[c] = cur[c].replace(/\s+/g, ' ').trim()
    if (columns.some(c => cur[c]) && !isNoiseRow(cur)) rows.push({ type: 'data', cells: { ...cur } })
    cur = null
  }

  for (const p of pageNums) {
    const headerY = headerInfo(pages[p - 1], cfg)?.bottomY ?? 9999
    const items = pages[p - 1].filter(it => it.y < headerY - 6 && it.y > 45)
    items.sort((a, b) => b.y - a.y || a.x - b.x)
    const lines = []
    let line = null
    for (const it of items) {
      if (!line || Math.abs(it.y - line.y) > 4) { line = { y: it.y, cells: columns.map(() => '') }; lines.push(line) }
      const ci = colOf(it.x, bounds)
      const token = (cfg.bulletGlyph && it.s === cfg.bulletGlyph) ? '•' : it.s
      line.cells[ci] = (line.cells[ci] ? line.cells[ci] + ' ' : '') + token
    }
    for (const ln of lines) {
      const nonEmpty = ln.cells.filter(Boolean)
      // Skip repeated sub-header lines ("KNOWLEDGE SKILLS VALUES") and bare
      // page-number footer lines that would otherwise glue onto a data cell.
      if (nonEmpty.length && nonEmpty.every(allNoise)) continue
      if (nonEmpty.length === 1 && /^\d{1,3}$/.test(nonEmpty[0].trim())) continue
      const key = lineKey(ln.cells)
      if (key && key !== curKey) { pushCur(); cur = blank(); curKey = key }
      if (!cur) cur = blank()
      columns.forEach((c, i) => { if (ln.cells[i]) cur[c] += (cur[c] ? ' ' : '') + ln.cells[i] })
    }
  }
  pushCur()
  return { columns: [...columns], rows }
}
