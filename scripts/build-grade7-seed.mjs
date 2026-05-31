#!/usr/bin/env node
/**
 * One-off generator: converts the standalone Notes Studio content
 * (M:\Zed Books n Quiz\Notes Studio\seed.js + Quizzes (Web)\quizzes.js) into a
 * committed, app-ready seed bundle for the in-app Notes Studio importer.
 *
 *   node scripts/build-grade7-seed.mjs ["<standalone root>"]
 *
 * Output: src/features/notes/seed/grade7ScienceSeed.json
 *   { version, notes: [{ seedKey, title, subject, grade, blocks[] }],
 *     quizzes: { "<code name>": [{ q, options[4], answer, explanation, image }] } }
 *
 * The 5 diagram PNGs the notes/quizzes reference must be copied to
 * public/notes/ separately (see the PR / README). Image blocks here carry
 * `url: "/notes/<file>"`; quiz question images resolve the same way at import.
 *
 * Conversion notes (standalone → app `study` block model):
 *   - keyterms rows  [term, def]  → { term, def }   (Firestore forbids nested arrays)
 *   - table rows     [c1, c2, …]  → { cells: [...] }
 *   - image dataUrl  "images/x"   → url "/notes/x"
 *   - quiz block     {url,count}  → { quizKey } (importer creates+links the real quiz)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { studyBlocksWriteSchema } from '../src/features/notes/lib/studySchema.js'
import { parseCsv } from '../src/utils/csvQuizImport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = join(__dirname, '..')
const STANDALONE = process.argv[2] || 'M:/Zed Books n Quiz'

// Extract the […] / {…} literal assigned to `marker` and JSON-parse it.
// Searches for the open bracket AFTER the assignment so leading comments
// (which may contain stray brackets) are skipped.
function loadAssigned(path, marker, open, close) {
  const text = readFileSync(path, 'utf8')
  const at = text.indexOf(marker)
  if (at < 0) throw new Error(`Could not find ${marker} in ${path}`)
  const start = text.indexOf(open, at)
  const end = text.lastIndexOf(close)
  if (start < 0 || end < 0 || end < start) throw new Error(`Could not find ${open}…${close} after ${marker} in ${path}`)
  return JSON.parse(text.slice(start, end + 1))
}

const SEED = loadAssigned(join(STANDALONE, 'Notes Studio', 'seed.js'), 'window.SEED', '[', ']')
const QUIZZES = loadAssigned(join(STANDALONE, 'Quizzes (Web)', 'quizzes.js'), 'window.QUIZZES', '{', '}')

// Social Studies quizzes live in a CSV (Subtopic,Question,OptionA-D,CorrectAnswer,Explanation),
// keyed by Subtopic = the note's "<code> <name>". Parse + merge into the quiz map so the
// Social Studies notes' quiz blocks get wired exactly like the Integrated Science ones.
// Question items match the standalone shape ({q, options[4], answer 0-based, explanation, image}).
function loadSocialStudiesCsv(path) {
  let text
  try { text = readFileSync(path, 'utf8') } catch { return {} }
  const rows = parseCsv(text)
  if (rows.length < 2) return {}
  const header = rows[0].map((h) => String(h ?? '').trim())
  const col = (name) => header.indexOf(name)
  const ci = {
    sub: col('Subtopic'), q: col('Question'),
    a: col('OptionA'), b: col('OptionB'), c: col('OptionC'), d: col('OptionD'),
    ans: col('CorrectAnswer'), exp: col('Explanation'),
  }
  const out = {}
  for (const r of rows.slice(1)) {
    const sub = String(r[ci.sub] ?? '').trim()
    if (!sub) continue
    const ans = 'ABCD'.indexOf(String(r[ci.ans] ?? '').trim().toUpperCase())
    ;(out[sub] ||= []).push({
      q: String(r[ci.q] ?? '').trim(),
      options: [r[ci.a], r[ci.b], r[ci.c], r[ci.d]].map((x) => String(x ?? '').trim()),
      answer: ans < 0 ? 0 : ans,
      explanation: String(r[ci.exp] ?? '').trim(),
      image: '',
    })
  }
  return out
}
Object.assign(QUIZZES, loadSocialStudiesCsv(join(STANDALONE, 'Social Studies Quizzes', 'Grade7_SocialStudies_Quizzes.csv')))

const S = (v) => (v == null ? '' : String(v))
const arr = (v) => (Array.isArray(v) ? v : [])

function convertBlock(b) {
  switch (b.type) {
    case 'objectives': case 'summary': case 'bullets': case 'numbers':
      return { type: b.type, items: arr(b.items).map(S) }
    case 'think': case 'note': case 'tip':
      return { type: b.type, lines: arr(b.lines).map(S) }
    case 'heading':
      return { type: 'heading', level: b.level === 2 ? 2 : 3, text: S(b.text) }
    case 'paragraph': case 'keyidea':
      return { type: b.type, text: S(b.text) }
    case 'picture':
      return { type: 'picture', caption: S(b.caption), lines: arr(b.lines).map(S) }
    case 'keyterms':
      return { type: 'keyterms', rows: arr(b.rows).map((r) => ({ term: S(r[0]), def: S(r[1]) })) }
    case 'table':
      return { type: 'table', headers: arr(b.headers).map(S), rows: arr(b.rows).map((r) => ({ cells: arr(r).map(S) })) }
    case 'quickcheck':
      return { type: 'quickcheck', q: S(b.q), a: S(b.a), level: S(b.level) }
    case 'exam':
      return { type: 'exam', q: S(b.q), a: S(b.a) }
    case 'mistake':
      return { type: 'mistake', wrong: S(b.wrong), correct: S(b.correct) }
    case 'image': {
      const m = S(b.dataUrl).match(/images\/([^/?#]+)$/i)
      return { type: 'image', url: m ? `/notes/${m[1]}` : '', caption: S(b.caption) }
    }
    case 'quiz':
      return { type: 'quiz', quizKey: '', quizTitle: '', questionCount: null }
    default:
      return null
  }
}

let dropped = 0
const notes = SEED.map((n) => {
  const key = `${n.code ? n.code + ' ' : ''}${n.name}`.trim()
  const blocks = arr(n.blocks).map((b) => {
    const c = convertBlock(b)
    if (!c) dropped++
    return c
  }).filter(Boolean)
  // Wire the quiz block to its bank key (if a matching quiz bank exists).
  for (const b of blocks) {
    if (b.type === 'quiz' && QUIZZES[key]) {
      b.quizKey = key
      b.quizTitle = `${key} — Practice Quiz`
      b.questionCount = QUIZZES[key].length
    }
  }
  return {
    // seedKey prefix kept stable (g7sci_) so notes already imported from an
    // earlier run stay deduped; standalone ids are subject-distinct (n_* vs ss_*).
    seedKey: `g7sci_${n.id}`,
    title: key || S(n.name),
    subject: S(n.subject) || 'Integrated Science',
    grade: S(n.grade) || '7',
    blocks,
  }
})

// Validate every converted note's blocks against the app write schema.
let failures = 0
for (const note of notes) {
  const res = studyBlocksWriteSchema.safeParse(note.blocks)
  if (!res.success) {
    failures++
    console.error(`✗ ${note.seedKey} (${note.title}):`, res.error.issues?.[0])
  }
}

const bundle = {
  version: 1,
  generatedFrom: 'standalone Notes Studio (Grade 7: Integrated Science + Social Studies)',
  notes,
  quizzes: QUIZZES,
}

const outPath = join(REPO, 'src', 'features', 'notes', 'seed', 'grade7Seed.json')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(bundle, null, 2) + '\n', 'utf8')

const quizCount = Object.keys(QUIZZES).length
const qTotal = Object.values(QUIZZES).reduce((s, items) => s + items.length, 0)
const withQuiz = notes.filter((n) => n.blocks.some((b) => b.type === 'quiz' && b.quizKey)).length
console.log(`\nWrote ${outPath}`)
console.log(`  notes: ${notes.length} (${withQuiz} link a quiz)`)
console.log(`  quizzes: ${quizCount} banks · ${qTotal} questions`)
console.log(`  blocks dropped (unknown type): ${dropped}`)
console.log(`  schema validation failures: ${failures}`)
// Flag any quiz bank whose key doesn't match a note title (likely a Subtopic typo).
const noteTitles = new Set(notes.map((n) => n.title))
const orphanBanks = Object.keys(QUIZZES).filter((k) => !noteTitles.has(k))
if (orphanBanks.length) console.warn(`  ⚠ quiz banks with no matching note: ${orphanBanks.join(' | ')}`)
if (failures > 0) process.exit(1)
