/**
 * Phase 3 §8 — every subject's content type, through every renderer.
 *
 * Phase 1 proved this for mathematics. This is the same walk for the content
 * types the other subjects live on: a chemical formula, a charge, a word
 * equation, units, a results table, a poem, numbered blanks, Cinyanja
 * diacritics and dialogue punctuation — each taken through the sanitiser, the
 * paper HTML, the print window and a real `.docx`.
 *
 * Running it as an audit first was worth doing: nine of the ten content types
 * already survived, because Phase 1's contract generalised. The tenth did not,
 * and it was invisible from three of the four renderers — see the table
 * section below.
 *
 * A DOM is installed before the exporters load, as in paperGolden.test.js.
 *
 * Run: node src/utils/subjectPrintParity.test.js
 */

import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.DOMParser = dom.window.DOMParser
globalThis.Node = dom.window.Node

const { Packer } = await import('docx')
const { unzipSync, strFromU8 } = await import('fflate')
const { buildPrintableHtml } = await import('./assessmentToPdf.js')
const { buildDocxDocument } = await import('./assessmentToDocx.js')
const { richTextToPaperHtml } = await import('../editor/utils/safeRender.js')
const { sanitizeHTML } = await import('../editor/utils/sanitize.js')

let passed = 0
const pending = []
function check(name, fn) {
  pending.push(async () => { await fn(); passed += 1; console.log(`  ✓ ${name}`) })
}
function section(title) {
  pending.push(async () => console.log(`\n${title}`))
}

const SCIENCE = { title: 'Integrated Science Test', subject: 'integrated_science', grade: '7' }
const ENGLISH = { title: 'English Test', subject: 'english', grade: '7' }

/** One question carrying `html`, taken through all four renderers. */
async function renderAll(html, meta = SCIENCE) {
  const questions = [{
    id: 'q1', order: 0, type: 'short_answer', marks: 2,
    text: html, correctAnswer: 'x', options: [],
  }]
  const document_ = await buildDocxDocument(meta, questions, { mode: 'paper' })
  const zip = unzipSync(new Uint8Array(await Packer.toBuffer(document_)))
  return {
    sanitised: sanitizeHTML(html),
    paper: richTextToPaperHtml(html),
    print: buildPrintableHtml(meta, questions, 'paper'),
    docx: strFromU8(zip['word/document.xml']),
  }
}

/** The words a reader sees in the Word document. */
const docxText = (xml) => {
  // Strip tags to a fixpoint so removals can't reassemble a tag ("<w<x>:t>").
  let out = (xml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || []).join(' ')
  let prev
  do {
    prev = out
    out = out.replace(/<[^>]+>/g, '')
  } while (out !== prev)
  return out
}

/**
 * Assert a predicate holds at EVERY stage. A content type that survives three
 * renderers and dies in the fourth is the failure mode this suite exists for —
 * it looks correct everywhere a developer is likely to check.
 */
async function survivesEverywhere(html, probe, what, meta = SCIENCE) {
  const out = await renderAll(html, meta)
  for (const stage of ['sanitised', 'paper', 'print', 'docx']) {
    assert.ok(probe(out[stage], stage), `${what} did not survive the ${stage} stage`)
  }
  return out
}

section('science notation')

check('a chemical formula keeps real subscripts in every output', async () => {
  await survivesEverywhere(
    '<p>Water is H<sub>2</sub>O and the gas is CO<sub>2</sub>.</p>',
    (s) => /<sub>2<\/sub>/.test(s) || /w:val="subscript"/.test(s),
    'a subscript',
  )
})

check('an ionic charge keeps its superscript', async () => {
  await survivesEverywhere(
    '<p>The ions are Na<sup>+</sup> and SO<sub>4</sub><sup>2−</sup>.</p>',
    (s) => /<sup>/.test(s) || /w:val="superscript"/.test(s),
    'a superscript charge',
  )
})

check('a word equation keeps a real reaction arrow, not "->"', async () => {
  const out = await survivesEverywhere(
    '<p>carbon dioxide + water → glucose + oxygen</p>',
    (s) => s.includes('→'),
    'the reaction arrow',
  )
  assert.ok(!docxText(out.docx).includes('->'), 'an ASCII arrow reached Word')
})

check('units carry their exponent and degree sign', async () => {
  await survivesEverywhere(
    '<p>Speed 9.8 m/s<sup>2</sup>, volume 25 cm<sup>3</sup>, temperature 30 °C.</p>',
    (s) => (/<sup>/.test(s) || /w:val="superscript"/.test(s)) && s.includes('°'),
    'a unit exponent or the degree sign',
  )
})

section('tables — the one the audit caught')

check('a results table reaches WORD as a real table, not run-together text', async () => {
  // This is the break. The preview and the print window render `textHtml`
  // directly, so a table looks perfect in both; Word walks the shared CONTENT
  // MODEL, which had no table node — so every cell was concatenated into one
  // paragraph and a teacher's results table printed as "TimeTemp020 °C535 °C".
  // Invisible from three of the four renderers.
  const out = await renderAll(
    '<table><thead><tr><th>Time (min)</th><th>Temperature</th></tr></thead>' +
    '<tbody><tr><td>0</td><td>20 °C</td></tr><tr><td>5</td><td>35 °C</td></tr></tbody></table>',
  )
  assert.ok(/<w:tbl[ >]/.test(out.docx), 'the table did not reach Word as a table')
  const text = docxText(out.docx)
  assert.ok(!/Time \(min\)Temperature/.test(text), 'header cells were concatenated')
  assert.ok(!/20 °C535/.test(text), 'body cells were concatenated')
  for (const cell of ['Time (min)', 'Temperature', '20 °C', '35 °C']) {
    assert.ok(text.includes(cell), `the cell "${cell}" was lost`)
  }
})

check('a table keeps its cells in the preview and print window too', async () => {
  await survivesEverywhere(
    '<table><thead><tr><th>Crop</th><th>Yield</th></tr></thead>' +
    '<tbody><tr><td>Maize</td><td>4 t</td></tr></tbody></table>',
    (s, stage) => (stage === 'docx' ? /<w:tbl[ >]/.test(s) : /<table[ >]/.test(s)),
    'the table structure',
  )
})

check('maths inside a table cell survives to Word', async () => {
  // §4 — cells honour the Phase 1 contract.
  const out = await renderAll(
    '<table><tbody><tr><td>Half</td>' +
    '<td><span class="math-frac" data-math-fraction="1" data-num="1" data-den="2"></span></td>' +
    '</tr></tbody></table>',
  )
  assert.ok(/<w:tbl[ >]/.test(out.docx))
  const text = docxText(out.docx)
  assert.ok(text.includes('1') && text.includes('2'), 'the fraction lost its digits in a cell')
})

section('language typography')

check('a poem keeps every stanza and line break', async () => {
  const out = await survivesEverywhere(
    '<p>The sun goes down<br>Behind the hill</p><p>The birds fly home<br>The world is still</p>',
    (s, stage) => (stage === 'docx' ? /<w:br\b/.test(s) : /<br/.test(s)),
    'a line break',
    ENGLISH,
  )
  // Two stanzas must remain two paragraphs, not one re-flowed block.
  const paras = (out.print.match(/<p[ >]/g) || []).length
  assert.ok(paras >= 2, 'the stanzas were re-flowed into one paragraph')
})

check('numbered blanks keep their underscores at full length', async () => {
  await survivesEverywhere(
    '<p>1. The capital of Zambia is ____.</p><p>2. The longest river is ____.</p>',
    (s) => s.includes('____'),
    'a fill-in blank',
    ENGLISH,
  )
})

check('Cinyanja special characters survive byte-for-byte', async () => {
  // A character that renders in the editor and prints as a box fails the
  // phase. Ŵ/ŵ and the modifier apostrophe are the ones the syllabus uses.
  const out = await survivesEverywhere(
    '<p>Ŵanthu ndi ŵana. Chingʼono chaŵiri. Nyaŵo ndi mwaŵi.</p>',
    (s) => s.includes('Ŵ') && s.includes('ŵ') && s.includes('ʼ'),
    'a Cinyanja diacritic',
    ENGLISH,
  )
  const text = docxText(out.docx)
  assert.ok(!text.includes('?'), 'a character was substituted in Word')
  assert.ok(!/&#x?[0-9A-Fa-f]+;/.test(text), 'a character reached Word as an entity')
})

check('curly quotes, apostrophes and dashes are not normalised away', async () => {
  await survivesEverywhere(
    '<p>“Where are you going?” she asked. ‘Home,’ he said — quickly.</p>',
    (s) => s.includes('“') && s.includes('‘') && s.includes('—'),
    'dialogue punctuation',
    ENGLISH,
  )
})

section('the Phase 1 regression — mathematics is unchanged')

check('a stacked fraction still reaches every renderer', async () => {
  await survivesEverywhere(
    '<p>Calculate <span class="math-frac" data-math-fraction="1" data-num="3" data-den="5"></span>.</p>',
    (s, stage) => (stage === 'docx'
      ? /w:val="superscript"/.test(s)
      : /math-frac|data-num/.test(s)),
    'a stacked fraction',
    { title: 'Maths', subject: 'mathematics', grade: '7' },
  )
})

;(async () => {
  for (const t of pending) await t()
  console.log(`\n${passed} subject print-parity checks passed\n`)
})().catch((err) => { console.error(err); process.exit(1) })
