#!/usr/bin/env node
/**
 * Source-of-truth generator: rebuilds the in-app Notes Studio seed bundle from
 * the authoritative Grade-7 DOCX pack (notes) + CSV question banks (quizzes).
 *
 *   node scripts/build-grade7-seed-from-docx.mjs ["<pack root>"]
 *
 * Pack layout (see the zip's README.txt):
 *   Integrated Science/Notes/*.docx   + Quizzes/Grade7_Science_Quizzes.csv
 *   Social Studies/Notes/*.docx       + Quizzes/Grade7_SocialStudies_Quizzes.csv
 *
 * Output:
 *   - src/features/notes/seed/grade7Seed.json   (notes[] + quizzes{})
 *   - public/notes/g7-<sci|ss>-<code>-<n>.png   (every diagram, extracted)
 *
 * Why DOCX → blocks (vs. the old standalone seed.js): the DOCX pack is the
 * single enriched source the content team maintains, and (unlike the previous
 * bundle) the Social Studies notes carry their diagrams. seedKeys are kept
 * identical to the live bundle (g7sci_n_<code> / g7sci_ss_<code>) so the
 * importer matches and UPDATES the already-published notes instead of cloning.
 *
 * The "How to Study & Exam Tips" note has no DOCX; its blocks are carried over
 * verbatim from the existing committed bundle.
 *
 * DOCX authoring differs by subject and this parser handles both:
 *   - Science: Word heading styles + real tables (key-terms table, data tables)
 *     + callout boxes rendered as single-cell tables ("Note", "Summary …").
 *   - Social Studies: emoji section markers (🎯 💭 🔑 ⚡ 🌟 ❓ ⚠️ 📝 ✅ 🧪) +
 *     ListBullet items + key-words tables.
 * Pedagogical blocks are recovered from the markers; mid-body section labels
 * become headings; everything else is a paragraph. Images become `image`
 * blocks captioned by the line that follows them.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { studyBlocksWriteSchema } from '../src/features/notes/lib/studySchema.js'
import { parseCsv } from '../src/utils/csvQuizImport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = join(__dirname, '..')
const PACK = process.argv[2] || 'M:/Claude/zedexams.com/.claude/worktrees/amazing-torvalds-5c5430/.tmp/notes-pack'
const PUBLIC_NOTES = join(REPO, 'public', 'notes')

// ---------------------------------------------------------------------------
// DOCX low-level: read an entry / list media via the system `unzip`.
// ---------------------------------------------------------------------------
function unzipText(docx, entry) {
  return execFileSync('unzip', ['-p', docx, entry], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}
function unzipBytes(docx, entry) {
  return execFileSync('unzip', ['-p', docx, entry], { maxBuffer: 64 * 1024 * 1024 })
}

const decode = (s) => String(s ?? '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")

// Text of a paragraph/cell fragment: concatenate <w:t>, honour <w:br>/<w:tab>.
function fragText(xml) {
  let s = xml
    .replace(/<w:tab\b[^>]*\/>/g, ' ')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
  const parts = [...s.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => decode(m[1]))
  return parts.join('')
}

// Split a table cell into its paragraph lines (so callout boxes keep structure).
function cellLines(cellXml) {
  return [...cellXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    .map((m) => fragText(m[0]).trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Parse a DOCX into an ordered list of "items": paragraph | table | image.
// ---------------------------------------------------------------------------
function parseDocx(docx) {
  const xml = unzipText(docx, 'word/document.xml')
  const rels = unzipText(docx, 'word/_rels/document.xml.rels')
  const relMap = {}
  for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="(media\/[^"]+)"/g)) relMap[m[1]] = m[2].split('/').pop()

  const body = (xml.match(/<w:body>([\s\S]*)<\/w:body>/) || [, xml])[1]
  // Top-level tokens: tables and paragraphs, in document order.
  const tokens = [...body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g)].map((m) => m[0])

  const items = []
  for (const tok of tokens) {
    if (tok.startsWith('<w:tbl')) {
      const rows = [...tok.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((r) =>
        [...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((c) => fragText(c[0]).trim()))
      items.push({ kind: 'table', rows, raw: tok })
      continue
    }
    // paragraph
    const style = (tok.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || ''
    const text = fragText(tok).trim()
    const embed = (tok.match(/r:embed="([^"]+)"/) || [])[1]
    if (embed && relMap[embed]) {
      items.push({ kind: 'image', media: relMap[embed], style })
      if (text) items.push({ kind: 'p', text, style })
    } else if (text) {
      items.push({ kind: 'p', text, style })
    }
  }
  return { items, docx, media: relMap }
}

// ---------------------------------------------------------------------------
// Marker detection. Strip leading emoji/symbols, lowercase, compare.
// ---------------------------------------------------------------------------
const stripLead = (s) => s.replace(/^[^A-Za-z0-9]+/, '').trim()
const norm = (s) => stripLead(s).toLowerCase()

function markerOf(text) {
  const t = norm(text)
  if (t.startsWith('learning objectives')) return 'objectives'
  if (t.startsWith('think first') || t === 'think' || t.startsWith('think about')) return 'think'
  if (t.startsWith('key words') || t.startsWith('key terms') || t.startsWith('key vocabulary')) return 'keyterms'
  if (t.startsWith('key idea')) return 'keyidea'
  if (t.startsWith('did you know')) return 'note'
  if (t.startsWith('quick check')) return 'quickcheck'
  if (t.startsWith('common mistake')) return 'mistake'
  if (t.startsWith('exam tip')) return 'exam'
  if (t.startsWith('summary')) return 'summary'
  if (t.includes('practice quiz')) return 'quiz'
  return null
}

// Running headers / boilerplate to drop entirely.
function isBoilerplate(text) {
  const t = norm(text)
  return (
    /^grade 7 .*(revision notes|zedexams notes|social studies|integrated science)/.test(t) ||
    t === 'zedexams notes' ||
    /revision notes$/.test(t)
  )
}

// A short, title-like line with no terminal sentence punctuation → section heading.
function looksLikeHeading(text) {
  const t = text.trim()
  if (t.length === 0 || t.length > 60) return false
  if (/[.!?:;,]$/.test(t)) return false
  if (/^(q:|a:|answer:|good answer:|✗|✓|x |• )/i.test(t)) return false
  if (markerOf(t)) return false
  return true
}

const S = (v) => (v == null ? '' : String(v))

// Decide whether a 2-col table is a key-terms table or a data table.
function isKeytermsTable(rows, sawKeytermsMarker) {
  if (!rows.length || rows[0].length !== 2) return false
  if (sawKeytermsMarker) return true
  const left = rows.map((r) => (r[0] || '').length)
  const right = rows.map((r) => (r[1] || '').length)
  const avgL = left.reduce((a, b) => a + b, 0) / rows.length
  const avgR = right.reduce((a, b) => a + b, 0) / rows.length
  // term/definition: short left, long right, and row0 is already data (long right).
  return avgL < 22 && avgR > 35 && (rows[0][1] || '').length > 30
}

// ---------------------------------------------------------------------------
// Build study blocks from parsed items.
// ---------------------------------------------------------------------------
function buildBlocks(parsed, seedKey, imgPrefix) {
  const { items } = parsed
  const blocks = []
  let imgCount = 0
  const images = [] // {media, file}

  // Drop the first Heading1 / first non-boilerplate line == the note title.
  let titleConsumed = false

  for (let i = 0; i < items.length; i++) {
    const it = items[i]

    if (it.kind === 'image') {
      imgCount++
      const file = `${imgPrefix}-${imgCount}.png`
      images.push({ media: it.media, file })
      // caption = following paragraph if it's a short non-marker, non-heading-styled line
      let caption = ''
      const nxt = items[i + 1]
      if (nxt && nxt.kind === 'p' && !markerOf(nxt.text) && !/^heading/i.test(nxt.style) &&
          nxt.text.length <= 120 && !isBoilerplate(nxt.text)) {
        caption = nxt.text
        i++
      }
      blocks.push({ type: 'image', url: `/notes/${file}`, caption: S(caption) })
      continue
    }

    if (it.kind === 'table') {
      const rows = it.rows
      // Single-cell callout box → recover its marker.
      if (rows.length === 1 && rows[0].length === 1) {
        const lines = cellLines(it.raw)
        const head = lines[0] || ''
        const mk = markerOf(head)
        const rest = lines.slice(1).filter(Boolean)
        // The marker label and its first content may be glued in one paragraph;
        // re-split on the label.
        const body = rest.length ? rest : [stripLead(head).replace(/^(note|summary[^A-Za-z]*key points|summary)\s*/i, '').trim()].filter(Boolean)
        if (mk === 'summary') blocks.push({ type: 'summary', items: body.map(S) })
        else if (mk === 'objectives') blocks.push({ type: 'objectives', items: body.map(S) })
        else blocks.push({ type: 'note', lines: (mk ? body : lines).map(S) })
        continue
      }
      // Multi-col table.
      if (isKeytermsTable(rows, prevWasKeytermsMarker)) {
        blocks.push({ type: 'keyterms', rows: rows.map((r) => ({ term: S(r[0]), def: S(r[1]) })) })
      } else {
        blocks.push({ type: 'table', headers: rows[0].map(S), rows: rows.slice(1).map((r) => ({ cells: r.map(S) })) })
      }
      prevWasKeytermsMarker = false
      continue
    }

    // paragraph
    const text = it.text
    if (isBoilerplate(text)) continue
    if (/^heading1$/i.test(it.style) && !titleConsumed) { titleConsumed = true; continue }
    if (!titleConsumed && blocks.length === 0 && /^\s*(\d+\.\d+)\b/.test(text)) { titleConsumed = true; continue }

    const mk = markerOf(text)
    if (mk) { i = consumeMarker(mk, text, items, i, blocks); continue }

    // Word heading styles or title-like section labels.
    if (/^heading([23])$/i.test(it.style)) {
      const lvl = it.style.toLowerCase() === 'heading2' ? 2 : 3
      blocks.push({ type: 'heading', level: lvl, text: S(text) }); continue
    }
    if (looksLikeHeading(text) && items[i + 1] && items[i + 1].kind !== 'image') {
      blocks.push({ type: 'heading', level: 3, text: S(text) }); continue
    }

    // ListParagraph / ListBullet → accumulate into a bullets block.
    if (/^list(paragraph|bullet)/i.test(it.style)) {
      const last = blocks[blocks.length - 1]
      if (last && last.type === 'bullets') last.items.push(S(text))
      else blocks.push({ type: 'bullets', items: [S(text)] })
      continue
    }

    blocks.push({ type: 'paragraph', text: S(text) })
  }

  return { blocks, images }
}

// module-scoped flag set when a "key words" marker is seen so the NEXT table
// is treated as key-terms even when its shape is ambiguous.
let prevWasKeytermsMarker = false

// Consume the lines that belong to a marker block; returns the new index i.
function consumeMarker(mk, headText, items, i, blocks) {
  const level = (headText.match(/\[([^\]]+)\]/) || [])[1] || ''
  // gather following paragraph lines until the next marker / heading / table / image
  const lines = []
  let j = i + 1
  for (; j < items.length; j++) {
    const n = items[j]
    if (n.kind !== 'p') break
    if (markerOf(n.text)) break
    if (/^heading[123]$/i.test(n.style)) break
    lines.push(n.text)
  }
  const consumedTo = j - 1

  if (mk === 'objectives') { blocks.push({ type: 'objectives', items: lines.map(S) }); return consumedTo }
  if (mk === 'summary')    { blocks.push({ type: 'summary',    items: lines.map(S) }); return consumedTo }
  if (mk === 'think') {
    // "Think first" holds short question prompts; the topic's intro paragraph
    // follows with no marker. Keep only the leading question lines and let the
    // intro be reprocessed as a normal paragraph.
    let cut = lines.findIndex((l) => !/\?\s*$/.test(l))
    if (cut === -1) cut = lines.length
    if (cut === 0) cut = 1 // tolerate a non-question first prompt
    blocks.push({ type: 'think', lines: lines.slice(0, cut).map(S) })
    return i + cut
  }
  if (mk === 'note')       { blocks.push({ type: 'note',       lines: lines.map(S) }); return consumedTo }
  if (mk === 'keyidea')    { blocks.push({ type: 'keyidea',    text: S(lines.join(' ')) }); return consumedTo }
  if (mk === 'keyterms') {
    // either a following table (handled by main loop) or alternating term/def lines
    prevWasKeytermsMarker = true
    if (!lines.length) return i // let the next table become keyterms
    const rows = []
    for (let k = 0; k + 1 < lines.length; k += 2) rows.push({ term: S(lines[k]), def: S(lines[k + 1]) })
    if (rows.length) { blocks.push({ type: 'keyterms', rows }); prevWasKeytermsMarker = false }
    return consumedTo
  }
  if (mk === 'quickcheck') {
    const q = (lines.find((l) => /^q:/i.test(l)) || '').replace(/^q:\s*/i, '')
    const a = (lines.find((l) => /^(answer|a):/i.test(l)) || '').replace(/^(answer|a):\s*/i, '')
    blocks.push({ type: 'quickcheck', q: S(q), a: S(a), level: S(level) }); return consumedTo
  }
  if (mk === 'exam') {
    const q = (lines.find((l) => /^q:/i.test(l)) || '').replace(/^q:\s*/i, '')
    const a = (lines.find((l) => /^(good answer|answer|a):/i.test(l)) || '').replace(/^(good answer|answer|a):\s*/i, '')
    blocks.push({ type: 'exam', q: S(q), a: S(a) }); return consumedTo
  }
  if (mk === 'mistake') {
    const wrong = (lines.find((l) => /^[✗x]/i.test(stripLead(l)) || /^✗/.test(l)) || lines[0] || '').replace(/^[✗x]\s*/i, '').replace(/^[^A-Za-z0-9]+/, '')
    const correct = (lines.find((l) => /^✓/.test(l) || /^v\b/i.test(stripLead(l))) || lines[1] || '').replace(/^✓\s*/, '').replace(/^[^A-Za-z0-9]+/, '')
    blocks.push({ type: 'mistake', wrong: S(wrong), correct: S(correct) }); return consumedTo
  }
  if (mk === 'quiz') { blocks.push({ type: 'quiz', quizKey: '', quizTitle: '', questionCount: null }); return consumedTo }
  return i
}

// ---------------------------------------------------------------------------
// Quizzes: parse a CSV bank keyed by Subtopic = "<code> <name>".
// ---------------------------------------------------------------------------
function loadCsvBank(path) {
  let text
  try { text = readFileSync(path, 'utf8') } catch { return {} }
  const rows = parseCsv(text)
  if (rows.length < 2) return {}
  const header = rows[0].map((h) => String(h ?? '').replace(/^﻿/, '').trim())
  const ci = Object.fromEntries(['Subtopic', 'Question', 'OptionA', 'OptionB', 'OptionC', 'OptionD', 'CorrectAnswer', 'Explanation', 'Image']
    .map((n) => [n, header.indexOf(n)]))
  const out = {}
  for (const r of rows.slice(1)) {
    const sub = String(r[ci.Subtopic] ?? '').trim()
    if (!sub) continue
    const ans = 'ABCD'.indexOf(String(r[ci.CorrectAnswer] ?? '').trim().toUpperCase())
    ;(out[sub] ||= []).push({
      q: String(r[ci.Question] ?? '').trim(),
      options: [r[ci.OptionA], r[ci.OptionB], r[ci.OptionC], r[ci.OptionD]].map((x) => String(x ?? '').trim()),
      answer: ans < 0 ? 0 : ans,
      explanation: String(r[ci.Explanation] ?? '').trim(),
      image: ci.Image >= 0 ? String(r[ci.Image] ?? '').trim() : '',
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
// rebuild:false → carry the subject's notes over from the existing bundle.
// The Integrated Science DOCX are plainer than the notes already published
// (they lack the quick-check / mistake / exam / think blocks and 4 of the live
// diagrams), so Science is preserved; only Social Studies is rebuilt from DOCX
// (it gains its 34 diagrams and keeps the rich marker blocks). See PR notes.
const SUBJECTS = [
  { dir: 'Integrated Science', label: 'Integrated Science', abbr: 'sci', keyPrefix: 'g7sci_n_', csv: 'Quizzes/Grade7_Science_Quizzes.csv', notesDir: 'Notes', rebuild: false },
  { dir: 'Social Studies', label: 'Social Studies', abbr: 'ss', keyPrefix: 'g7sci_ss_', csv: 'Quizzes/Grade7_SocialStudies_Quizzes.csv', notesDir: 'Notes', rebuild: true },
]

const existingPath = join(REPO, 'src/features/notes/seed/grade7Seed.json')
const prevBundle = existsSync(existingPath) ? JSON.parse(readFileSync(existingPath, 'utf8')) : { notes: [] }

const quizzes = {}
const notes = []
let totalImages = 0
const imgWrites = [] // {docx, media, dest}

for (const subj of SUBJECTS) {
  // Per-subject bank: Science and Social Studies share codes (both "1.1", "2.1"…),
  // so titles must be resolved within the subject's own bank, not the merged map.
  const subjBank = loadCsvBank(join(PACK, subj.dir, subj.csv))
  Object.assign(quizzes, subjBank)

  // Carry this subject's notes over unchanged (e.g. Integrated Science, whose
  // published notes are richer than the DOCX). Includes the no-DOCX tips note.
  if (!subj.rebuild) {
    for (const n of prevBundle.notes || []) if (n.subject === subj.label) notes.push(n)
    continue
  }

  const notesPath = join(PACK, subj.dir, subj.notesDir)
  const files = readdirSync(notesPath).filter((f) => f.toLowerCase().endsWith('.docx')).sort()
  for (const f of files) {
    // "Notes 2.1 The Continents.docx" → code "2.1"
    const code = (f.match(/Notes\s+(\d+\.\d+)/) || [])[1]
    if (!code) { console.warn(`⚠ no code in ${f}`); continue }
    const docxPath = join(notesPath, f)
    const parsed = parseDocx(docxPath)
    const seedKey = `${subj.keyPrefix}${code.replace('.', '_')}`
    const imgPrefix = `g7-${subj.abbr}-${code.replace('.', '-')}`
    const { blocks, images } = buildBlocks(parsed, seedKey, imgPrefix)
    prevWasKeytermsMarker = false

    // title = "<code> <name>" from this subject's CSV Subtopic if present, else filename.
    const fileName = f.replace(/^Notes\s+/, '').replace(/\.docx$/i, '').replace(/-$/, '?')
    const csvKey = Object.keys(subjBank).find((k) => k.startsWith(code + ' '))
    const title = csvKey || fileName

    // Wire the quiz block to its bank. The Science DOCX omit the "practice quiz"
    // CTA the Social Studies ones carry, so append a quiz block when a bank
    // exists but no quiz block was parsed — every quiz-bearing note links one.
    if (quizzes[title]) {
      let qb = blocks.find((b) => b.type === 'quiz')
      if (!qb) { qb = { type: 'quiz', quizKey: '', quizTitle: '', questionCount: null }; blocks.push(qb) }
      qb.quizKey = title; qb.quizTitle = `${title} — Practice Quiz`; qb.questionCount = quizzes[title].length
    }

    notes.push({ seedKey, title, subject: subj.label, grade: '7', blocks })
    for (const im of images) imgWrites.push({ docx: docxPath, media: im.media, dest: join(PUBLIC_NOTES, im.file) })
    totalImages += images.length
  }
}

// Sort: Science first (tips, then by code), then Social Studies — matches prior order loosely.
const codeNum = (t) => { const m = (t.match(/(\d+)\.(\d+)/) || []); return m.length ? Number(m[1]) * 100 + Number(m[2]) : -1 }
notes.sort((a, b) => {
  if (a.subject !== b.subject) return a.subject === 'Integrated Science' ? -1 : 1
  return codeNum(a.title) - codeNum(b.title)
})

// Extract images.
mkdirSync(PUBLIC_NOTES, { recursive: true })
for (const w of imgWrites) writeFileSync(w.dest, unzipBytes(w.docx, `word/media/${w.media}`))

// Validate.
let failures = 0
for (const n of notes) {
  const res = studyBlocksWriteSchema.safeParse(n.blocks)
  if (!res.success) { failures++; console.error(`✗ ${n.seedKey} (${n.title}):`, JSON.stringify(res.error.issues?.[0])) }
}

const bundle = {
  version: 2,
  generatedFrom: 'Grade-7 DOCX pack (Integrated Science + Social Studies) — notes + CSV quiz banks',
  notes,
  quizzes,
}
writeFileSync(existingPath, JSON.stringify(bundle, null, 2) + '\n', 'utf8')

const withQuiz = notes.filter((n) => n.blocks.some((b) => b.type === 'quiz' && b.quizKey)).length
const qTotal = Object.values(quizzes).reduce((s, items) => s + items.length, 0)
console.log(`\nWrote ${existingPath}`)
console.log(`  notes: ${notes.length} (${withQuiz} link a quiz)`)
console.log(`  quizzes: ${Object.keys(quizzes).length} banks · ${qTotal} questions`)
console.log(`  images extracted: ${totalImages} → public/notes/`)
console.log(`  schema validation failures: ${failures}`)
const noteTitles = new Set(notes.map((n) => n.title))
const orphan = Object.keys(quizzes).filter((k) => !noteTitles.has(k))
if (orphan.length) console.warn(`  ⚠ quiz banks with no matching note: ${orphan.join(' | ')}`)
if (failures > 0) process.exit(1)
