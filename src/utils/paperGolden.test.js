/**
 * Golden-file tests — a reference paper per subject family, rendered all the way
 * to the artefacts a teacher actually receives (§4.6).
 *
 * The brief's reasoning, which is exactly right: *"Without these, 'works for all
 * subjects' silently regresses on every layout change."* And the failure mode it
 * names — *"A paper that looks correct in Preview and breaks in Word is a failed
 * paper"* — is invisible to every test that stops at the block model.
 *
 * So these go the whole way: rich text → paper HTML (the KaTeX-free form the
 * non-JS renderers consume) → a real .docx built by the `docx` library → unzip →
 * assert against `word/document.xml`. If a formula loses its subscript, an answer
 * leaks onto the learner's copy, or a table degrades to a paragraph, that is a
 * failing assertion here rather than a teacher's discovery.
 *
 * These are STRUCTURAL golden files, not pixel diffs. They catch the class of
 * regression that actually happens (content lost or mangled in translation)
 * without a browser screenshot pipeline in CI. Visual diffing of the four
 * renderings is the remaining half of §4.6.
 *
 * A DOM is required — the exporters walk paper HTML with DOMParser, as they do in
 * the browser — so this installs jsdom globals before importing them.
 *
 * Run: node src/utils/paperGolden.test.js
 */

import { JSDOM } from 'jsdom'

// Must be installed BEFORE the exporters load: assessmentToDocx and safeRender
// both branch on `typeof DOMParser === 'undefined'` at call time, and the whole
// point of this suite is to exercise the branch a browser takes.
const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.DOMParser = dom.window.DOMParser
globalThis.Node = dom.window.Node
// `navigator` is a getter-only global on modern Node, and nothing in the export
// path reads it — so it is deliberately not stubbed.

const { Packer, Document, Paragraph } = await import('docx')
const { unzipSync, strFromU8 } = await import('fflate')
const { buildDocxDocument, svgImageRun, unresolvedFigureMessage } = await import('./assessmentToDocx.js')
const { richTextToPaperHtml } = await import('../editor/utils/safeRender.js')
const { clearImageBytesCache } = await import('./fetchImageBytes.js')
const { findForbiddenTerms } = await import('../config/paperTerminology.js')
const realFetchForTerms = globalThis.fetch

/** Minimal valid PNG (1x1 transparent), for the raster fallback assertions. */
const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

let failures = 0
let passed = 0
function assert(cond, msg) {
  if (cond) {
    passed += 1
    console.log(`  ok  ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗   ${msg}`)
  }
}

/** Build a paper and return its word/document.xml. */
async function renderDocx(meta, questions, opts = { mode: 'paper' }) {
  const doc = await buildDocxDocument(meta, questions, opts)
  const zip = unzipSync(new Uint8Array(await Packer.toBuffer(doc)))
  return strFromU8(zip['word/document.xml'])
}

/** A KaTeX math node, as the editor stores one. */
function math(latex) {
  return `<span class="mnode" data-latex="${latex.replace(/"/g, '&quot;')}"></span>`
}

/**
 * The text a reader actually SEES in a fragment of paper HTML.
 *
 * Attribute values do not count. `data-tex` deliberately carries the source
 * LaTeX so the Word export can build a real equation from it (§4.2), so a naive
 * substring check over the raw HTML would find "\\ce" and conclude the paper had
 * leaked LaTeX onto the page when it had not.
 */
function visibleText(html) {
  const el = dom.window.document.createElement('div')
  el.innerHTML = html
  return el.textContent || ''
}

/** Does the Word XML carry a real subscript run containing this text? */
function hasScriptRun(xml, text, kind) {
  const val = kind === 'sub' ? 'subscript' : 'superscript'
  // docx emits <w:rPr>…<w:vertAlign w:val="subscript"/></w:rPr><w:t>2</w:t>
  const re = new RegExp(
    `<w:vertAlign w:val="${val}"\\s*/>[\\s\\S]{0,200}?<w:t[^>]*>${text}</w:t>`,
  )
  return re.test(xml)
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Integrated Science — a chemical equation
 * ════════════════════════════════════════════════════════════════════════ */

console.log('\nGOLDEN — Integrated Science: a chemical equation reaches Word intact')
{
  const equation = String.raw`\ce{2H2 + O2 -> 2H2O}`
  const paperHtml = richTextToPaperHtml(`<p>Balance: ${math(equation)}</p>`)

  // The KaTeX-free form the print window and Word both consume.
  assert(!visibleText(paperHtml).includes('\\ce'),
    'the raw LaTeX command is never VISIBLE on the paper')
  assert(paperHtml.includes('→'), 'the reaction arrow is a real arrow, not "->"')
  assert(/<sub>2<\/sub>/.test(paperHtml), 'the subscript is real markup, not a Unicode guess')
  assert(!/>2H2 \+ O2/.test(paperHtml), 'no un-subscripted formula survives')

  const xml = await renderDocx(
    { title: 'Chemistry Test', subject: 'Integrated Science', grade: '11' },
    [{ id: 'q1', order: 1, type: 'short_answer', text: paperHtml, marks: 2 }],
  )
  assert(hasScriptRun(xml, '2', 'sub'), 'Word receives a genuine subscript run')
  assert(xml.includes('→'), 'the arrow survives into the Word file')
  assert(!xml.includes('\\ce'), 'no LaTeX leaks into the Word file')
  assert(!xml.includes('-&gt;'), 'no ASCII arrow leaks into the Word file')
}

console.log('\nGOLDEN — Integrated Science: an ion charge and a precipitate')
{
  const paperHtml = richTextToPaperHtml(
    `<p>${math(String.raw`\ce{CO3^2-}`)} and ${math(String.raw`\ce{AgCl v}`)}</p>`,
  )
  assert(/<sup>2−<\/sup>/.test(paperHtml), 'the charge is a superscript')
  assert(paperHtml.includes('↓'), 'the precipitate marker is an arrow…')
  assert(!/AgCl\s*v/.test(visibleText(paperHtml)),
    '…and never the letter "v" beside a formula')

  const xml = await renderDocx(
    { title: 'Ions', subject: 'Integrated Science', grade: '11' },
    [{ id: 'q1', order: 1, type: 'short_answer', text: paperHtml, marks: 2 }],
  )
  assert(hasScriptRun(xml, '2−', 'super'), 'Word receives a genuine superscript charge')
  assert(xml.includes('↓'), 'the precipitate marker survives into Word')
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2. Mathematics — an equation with a nested fraction
 * ════════════════════════════════════════════════════════════════════════ */

console.log('\nGOLDEN — Mathematics: the quadratic formula keeps its fraction bar')
{
  const paperHtml = richTextToPaperHtml(
    `<p>Solve using ${math(String.raw`x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}`)}</p>`,
  )
  // The regression this whole slice exists for: the bar used to vanish, leaving
  // "-b ± √(b²-4ac)2a" — a product, not a quotient, and a wrong formula.
  assert(paperHtml.includes('/'), 'the fraction bar is present')
  assert(paperHtml.includes('(2a)'), 'the denominator is bracketed so it binds correctly')
  assert(paperHtml.includes('±'), 'plus-or-minus survives')
  // Inside a root or a fraction the formula is laid out linearly, so a nested
  // power becomes the Unicode character rather than a <sup> element. That is the
  // right trade for DIGITS — ⁰-⁹ are near-universal in fonts — and it keeps the
  // bracketing readable. Letters, where glyph coverage is patchy, are never
  // nested this way at the top level (see the chemistry cases above, which do get
  // real markup).
  assert(paperHtml.includes('b²'), 'b squared is rendered, inside the root')
  assert(!/√\(b²-4ac\)2a/.test(paperHtml), 'the formula is NOT a product')

  const xml = await renderDocx(
    { title: 'Quadratics', subject: 'Mathematics', grade: '11' },
    [{ id: 'q1', order: 1, type: 'short_answer', text: paperHtml, marks: 3 }],
  )
  // Word now receives a REAL equation rather than this linear text, so the flat
  // "(2a)" and "b²" forms are deliberately absent from the .docx — the parts are
  // there as equation structure instead. The next golden asserts that directly.
  assert(xml.includes('<m:oMath>'), 'Word receives the formula as an equation')
  assert(xml.includes('2a'), 'the denominator is in the equation')
  assert(!xml.includes('\\frac'), 'no LaTeX leaks into the Word file')
  assert(!xml.includes('\\sqrt'), 'and neither does the root command')
}

console.log('\nGOLDEN — Mathematics: a fraction inside an ANSWER CHOICE survives to Word')
{
  // §11 lists "fractions inside answer choices" as its own fixture, and it is a
  // different code path from a fraction in a stem: the options go through the
  // option-string memo and are parsed by `cachedOptionNodes`, not by the
  // question-body walker. A fraction that survives in a stem and collapses to
  // "12" in an option is exactly the failure that shape of duplication produces.
  const frac = (n, d) => richTextToPaperHtml(`<p>${math(String.raw`\frac{${n}}{${d}}`)}</p>`)
  const xml = await renderDocx(
    { title: 'Fractions', subject: 'Mathematics', grade: '5', answerChoiceCount: 4 },
    [{
      id: 'q1', order: 1, type: 'mcq', marks: 1,
      text: 'Which fraction is the largest?',
      options: [frac(1, 2), frac(1, 3), frac(3, 4), frac(1, 4)],
      correctAnswer: 2,
    }],
  )
  assert(xml.includes('<m:f>'), 'an option fraction reaches Word as a real stacked fraction')
  // The bare-characters failure: "1/2" flattening to "12" because the bar was
  // dropped. Four options that all collapsed that way would print as 12, 13, 34
  // and 14 — plausible-looking numbers, every one of them wrong.
  assert(!/>12</.test(xml) && !/>34</.test(xml), 'no option collapsed to its bare digits')
  assert(!xml.includes('\\frac'), 'no LaTeX leaks into an option')
  assert(xml.includes('A.') || xml.includes('A)'), 'the options are still lettered')
}

console.log('\nGOLDEN — Mathematics: Word receives a REAL equation, not a picture of one')
{
  // §4.2: "For DOCX, emit real OMML equations — Word mangles anything else."
  const xml = await renderDocx(
    { title: 'Quadratics', subject: 'Mathematics', grade: '11' },
    [{
      id: 'q1', order: 1, type: 'short_answer', marks: 3,
      text: richTextToPaperHtml(
        `<p>Solve using ${math(String.raw`x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}`)}</p>`,
      ),
    }],
  )
  assert(xml.includes('<m:oMath>'), 'the paper carries a Word equation object')
  assert(xml.includes('<m:f>'), 'the fraction is a real stacked fraction')
  assert(xml.includes('<m:rad>'), 'the square root is a real radical')
  assert(xml.includes('<m:sSup>'), 'b squared is a real superscript inside it')
  // Not a raster: the brief allows a vector fallback but never a low-resolution
  // image, and an equation should not have become one at all.
  assert(!/media\/[^"']*\.(png|jpg)/.test(xml), 'the equation is not an embedded picture')
}

console.log('\nGOLDEN — a formula that does NOT need an equation stays editable text')
{
  // Chemistry and inline powers render perfectly as runs with real
  // superscript/subscript, and a teacher can still edit them as text. Wrapping
  // them in an equation object would be a worse artefact, not a better one.
  const xml = await renderDocx(
    { title: 'Formulae', subject: 'Integrated Science', grade: '11' },
    [{
      id: 'q1', order: 1, type: 'short_answer', marks: 2,
      text: richTextToPaperHtml(`<p>${math(String.raw`\ce{H2SO4}`)}</p>`),
    }],
  )
  assert(!xml.includes('<m:oMath>'), 'chemistry is not wrapped in an equation object')
  assert(hasScriptRun(xml, '2', 'sub'), '…and keeps its genuine subscript run')
}

console.log('\nGOLDEN — an unmodelled construct still prints, as text')
{
  // The brief's fallback rule, read strictly: never silently drop a formula.
  const xml = await renderDocx(
    { title: 'Fallback', subject: 'Mathematics', grade: '11' },
    [{
      id: 'q1', order: 1, type: 'short_answer', marks: 1,
      text: richTextToPaperHtml(`<p>${math(String.raw`5 \times 3 = 15`)}</p>`),
    }],
  )
  assert(xml.includes('×'), 'the formula is on the page')
  assert(!xml.includes('<m:oMath>'), 'and did not need an equation object to get there')
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. Learner copy vs teacher copy (§4.3)
 * ════════════════════════════════════════════════════════════════════════ */

console.log('\nGOLDEN — a learner never receives the answer')
{
  const meta = { title: 'Marking', subject: 'Integrated Science', grade: '11' }
  const questions = [{
    id: 'q1', order: 1, type: 'mcq',
    text: 'Which gas do plants take in?',
    options: ['Carbon dioxide', 'Oxygen', 'Nitrogen', 'Hydrogen'],
    correctAnswer: 0,
    explanation: 'THE-MARKING-EXPLANATION',
    marks: 1,
  }]
  const paperXml = await renderDocx(meta, questions, { mode: 'paper' })
  const schemeXml = await renderDocx(meta, questions, { mode: 'scheme' })

  assert(
    !paperXml.includes('THE-MARKING-EXPLANATION'),
    'the marking explanation is absent from the learner paper',
  )
  assert(
    schemeXml.includes('THE-MARKING-EXPLANATION'),
    '…and present on the teacher marking scheme',
  )
  assert(paperXml.includes('Carbon dioxide'), 'the options still print for the learner')
}

console.log('\nGOLDEN — a labelled diagram\'s answers reach the key and not the learner')
{
  // §4.3's figure half. The composited overlay needs a canvas, so in this
  // DOM-less harness the exporter falls back to the plain image plus a text
  // list — which is exactly the path where a leak would be easiest to miss.
  const meta = { title: 'Heart', subject: 'Integrated Science', grade: '11' }
  const questions = [{
    id: 'q1', order: 1, type: 'diagram', marks: 2,
    text: 'Name the parts of the heart.',
    imageUrl: 'https://example/heart.png',
    diagramMode: 'identify',
    diagramLabels: [
      { x: 0.25, y: 0.3, text: 'AORTA-ANSWER' },
      { x: 0.6, y: 0.55, text: 'VENTRICLE-ANSWER' },
    ],
  }]
  const paperXml = await renderDocx(meta, questions, { mode: 'paper' })
  const schemeXml = await renderDocx(meta, questions, { mode: 'scheme' })

  assert(
    !paperXml.includes('AORTA-ANSWER') && !paperXml.includes('VENTRICLE-ANSWER'),
    'no part name reaches the learner copy',
  )
  assert(
    schemeXml.includes('AORTA-ANSWER') && schemeXml.includes('VENTRICLE-ANSWER'),
    '…and both reach the marking key',
  )
  assert(
    paperXml.includes('Name the parts of the heart'),
    'the learner still gets the question',
  )
}

console.log('\nGOLDEN — a vertical sum reaches Word with the space it asked for')
{
  // The editor offers ruled working space per sum and the preview draws it.
  // Word dropped it, because the `working` flag stopped at the content model —
  // so a question that gave a learner room to show their method printed without
  // it. Asserted on the real .docx rather than on the block.
  const sum = (working) => ({
    id: 'q1', order: 1, type: 'short_answer', marks: 2,
    text: richTextToPaperHtml(
      `<div class="vert-arith" data-operator="+" data-lines="248|176" data-answer=""`
      + `${working ? ' data-working="true"' : ''}></div>`,
    ),
  })
  const meta = { title: 'Sums', subject: 'Mathematics', grade: '5' }
  const withSpace = await renderDocx(meta, [sum(true)])
  const without = await renderDocx(meta, [sum(false)])

  assert(withSpace.includes('248') && withSpace.includes('176'), 'the addends reach Word')
  // The ruled lines are paragraph bottom borders, so count those.
  const rules = (xml) => (xml.match(/w:bottom w:val="single"/g) || []).length
  assert(
    rules(withSpace) > rules(without),
    `the working space adds ruled lines (${rules(withSpace)} vs ${rules(without)})`,
  )
  assert(
    !without.includes('w:bottom w:val="single"') || rules(without) < rules(withSpace),
    'a sum that did not ask for working space does not get it',
  )
}

console.log('\nGOLDEN — a library diagram reaches Word as vector, with a raster fallback')
{
  // §4.2's "SVG as the source of truth". The catalog diagrams are drawn as SVG
  // and both the preview and the print window use them as SVG; Word was the one
  // renderer getting a flattened bitmap, so the only figure on the paper that is
  // vector all the way down was the one that printed with resampled edges.
  //
  // Asserted on the packed .docx because the whole claim is about what is inside
  // the file: two media parts and the svgBlip extension that tells Word to
  // prefer the vector.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"'
    + ' viewBox="0 0 120 60"><rect x="1" y="1" width="118" height="58" fill="none"'
    + ' stroke="#1c1612"/></svg>'
  const run = svgImageRun(svg, PNG_1x1, { width: 120, height: 60 }, 'A rectangle')
  const doc = new Document({ sections: [{ children: [new Paragraph({ children: [run] })] }] })
  const zip = unzipSync(new Uint8Array(await Packer.toBuffer(doc)))
  const media = Object.keys(zip).filter((k) => k.startsWith('word/media/') && k.length > 'word/media/'.length)
  const xml = strFromU8(zip['word/document.xml'])

  assert(media.some((k) => k.endsWith('.svg')), 'the vector is embedded')
  assert(media.some((k) => k.endsWith('.png')), 'and the raster fallback alongside it')
  assert(xml.includes('svgBlip'), 'the svgBlip extension tells Word to prefer the vector')
  assert(
    strFromU8(zip['[Content_Types].xml']).includes('svg'),
    'and the SVG content type is declared, or Word refuses the part',
  )
  assert(xml.includes('A rectangle'), 'alt text survives the vector path')
}

console.log('\nGOLDEN — a figure is never lost to make it sharper')
{
  // The vector path has a catch that falls back to the raster. That is right —
  // a sharper outline is not worth a blank figure — but a silent fallback is
  // also how a feature comes to look like it works while doing nothing: the
  // first version of this passed the SVG as a string, `docx` read it as base64
  // and threw, and every diagram quietly stayed a bitmap.
  //
  // So: rubbish markup must still produce an embedded figure, and valid markup
  // must produce a vector. Both halves, or the catch proves nothing.
  const t = { width: 60, height: 30 }
  const broken = svgImageRun(null, PNG_1x1, t, 'Fallback')
  const zip = unzipSync(new Uint8Array(await Packer.toBuffer(
    new Document({ sections: [{ children: [new Paragraph({ children: [broken] })] }] }),
  )))
  const media = Object.keys(zip).filter((k) => k.startsWith('word/media/') && k.length > 'word/media/'.length)
  assert(media.length > 0, 'a figure is still embedded when the vector cannot be')

  const good = svgImageRun(
    '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"></svg>', PNG_1x1, t,
  )
  const goodXml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(
    new Document({ sections: [{ children: [new Paragraph({ children: [good] })] }] }),
  )))['word/document.xml'])
  assert(goodXml.includes('svgBlip'), 'and valid markup really does take the vector path')
}

console.log('\nGOLDEN — our own machinery is never printed on a paper (§4.1)')
{
  // The owner's decision names the internal terms that must never reach a
  // learner: MathML, LaTeX, SVG, raster fallback, render node, model output,
  // validation schema, question payload.
  //
  // Checked against the RENDERED .docx, not the source — every one of those
  // words appears legitimately in the exporters' identifiers and comments, so a
  // source scan would be all false positives and would be switched off. What
  // matters is the page.
  //
  // The paper deliberately exercises the paths where a leak would come from: a
  // formula (which carries its LaTeX as data), a library diagram (embedded as
  // SVG with a raster fallback), and a figure that cannot be fetched (whose
  // placeholder is written by us).
  clearImageBytesCache()
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch (CORS)') }
  try {
    const meta = { title: 'Mixed', subject: 'Mathematics', grade: '7' }
    const questions = [
      {
        id: 'q1', order: 1, type: 'short_answer', marks: 2,
        text: richTextToPaperHtml(`<p>Simplify ${math(String.raw`\frac{6}{8}`)}.</p>`),
      },
      {
        id: 'q2', order: 2, type: 'short_answer', marks: 1,
        text: '<p>Name this shape.</p>',
        imageDiagram: { libraryKey: 'rectangle', params: {} },
      },
      {
        id: 'q3', order: 3, type: 'short_answer', marks: 1,
        text: '<p>Study the picture.</p>', imageUrl: 'https://example/missing.png',
      },
    ]
    for (const mode of ['paper', 'scheme']) {
      const xml = await renderDocx(meta, questions, { mode })
      const leaked = findForbiddenTerms(xml)
      assert(leaked.length === 0, `${mode}: no internal term is printed (found ${leaked.join(', ')})`)
    }

    // And the check has teeth. A guard that cannot fail is decoration, and this
    // one is not hypothetical: decision 3 asks us to RECORD when a raster
    // fallback was used, which is precisely the kind of note that ends up on the
    // page instead of on the teacher's screen.
    const leaky = await renderDocx(meta, [{
      id: 'q1', order: 1, type: 'short_answer', marks: 1,
      text: '<p>The raster fallback for this LaTeX diagram failed.</p>',
    }])
    const caught = findForbiddenTerms(leaky)
    assert(caught.includes('LaTeX'), 'a leaked internal term IS detected in a real .docx')
    assert(caught.includes('raster fallback'), 'including the multi-word ones')
  } finally {
    globalThis.fetch = realFetchForTerms
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. English — a comprehension passage stays with its questions
 * ════════════════════════════════════════════════════════════════════════ */

console.log('\nGOLDEN — English: a passage and its questions both reach Word')
{
  const xml = await renderDocx(
    {
      title: 'Comprehension', subject: 'English', grade: '8',
      // Passages are stored on the assessment document alongside its questions,
      // which is how the studio saves them and how buildPaperLayout reads them.
      passages: [{
        id: 'p1', title: 'The Journey',
        passageText: '<p>Chanda walked to the river before dawn.</p>',
        order: 1,
      }],
    },
    [{
      id: 'q1', order: 1, type: 'short_answer',
      text: 'What did Chanda decide?',
      passageId: 'p1', marks: 2,
    }],
  )
  assert(xml.includes('Chanda walked to the river'), 'the passage text is in the Word file')
  assert(xml.includes('What did Chanda decide'), 'its question is too')
  // Both indices must be real — a missing passage would give -1, which is "less
  // than" any real index and would pass a naive ordering check.
  const passageAt = xml.indexOf('Chanda walked to the river')
  const questionAt = xml.indexOf('What did Chanda decide')
  assert(
    passageAt >= 0 && questionAt >= 0 && passageAt < questionAt,
    'and the passage comes before the question that depends on it',
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5. Layout guarantees (§4.5)
 * ════════════════════════════════════════════════════════════════════════ */

console.log('\nGOLDEN — a heading, a stem and a figure hold together across a page break')
{
  const xml = await renderDocx(
    { title: 'Layout', subject: 'Mathematics', grade: '11' },
    [{
      id: 'q1', order: 1, type: 'short_answer',
      text: 'Work out the area of the shape.',
      marks: 3,
    }],
    { mode: 'paper' },
  )
  // Word's own mechanism: <w:keepNext/> binds a paragraph to the next one,
  // <w:keepLines/> stops one splitting mid-way. Without these, a question stem
  // can be orphaned at the foot of a page from its own answer space, and a
  // section heading can sit alone at the bottom — both named in §4.5.
  assert(xml.includes('<w:keepNext/>'), 'the paper carries keep-with-next paragraphs')
  assert(xml.includes('<w:keepLines/>'), 'and keep-lines-together paragraphs')
}

console.log('\nGOLDEN — the keep flags are applied narrowly, not to everything')
{
  // keepNext on every paragraph would chain the whole paper into one
  // unbreakable block, and Word would push it to a fresh page — producing
  // exactly the big gaps §4.5 is trying to prevent. So the answer lines a
  // learner writes on must remain breakable.
  const xml = await renderDocx(
    { title: 'Spread', subject: 'English', grade: '8' },
    Array.from({ length: 12 }, (_, i) => ({
      id: `q${i + 1}`, order: i + 1, type: 'essay',
      text: `Question ${i + 1}`, marks: 10,
    })),
    { mode: 'paper' },
  )
  const paragraphs = (xml.match(/<w:p>|<w:p [^>]*>/g) || []).length
  const keeps = (xml.match(/<w:keepNext\/>/g) || []).length
  assert(paragraphs > 0, 'the paper has paragraphs to reason about')
  assert(
    keeps < paragraphs / 2,
    `fewer than half the paragraphs are kept with the next (${keeps} of ${paragraphs})`,
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6. Figures are big enough for the level (§4.2)
 * ════════════════════════════════════════════════════════════════════════ */

console.log('\nGOLDEN — a figure is never smaller than the level allows')
{
  // Phase 2 gave every band a minFigureSizeMm and nothing applied it. A Nursery
  // picture-matching question could print at whatever size a width preset gave,
  // and a five-year-old cannot answer a question about a picture they cannot
  // make out.
  //
  // An UPLOADED image is used rather than a library diagram: the diagram path
  // rasterises through a canvas, which jsdom does not have, so it would fall
  // back to alt text and prove nothing about the size.
  const PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ])
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'image/png' : null) },
    arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
  })

  // docx writes the embed size in EMUs on <wp:extent cx=".." cy="..">.
  const extentOf = (xml) => {
    const m = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml)
    return m ? { cx: Number(m[1]), cy: Number(m[2]) } : null
  }
  const paper = (grade) => ([
    { title: 'Figures', subject: 'Integrated Science', grade },
    [{
      id: 'q1', order: 1, type: 'short_answer', marks: 1,
      text: 'Look at the picture.',
      // The same deliberately SMALL preset at both levels.
      imageUrl: 'https://example.test/pic.png', imageWidth: 'small',
    }],
  ])

  try {
    clearImageBytesCache()
    const nursery = extentOf(await renderDocx(...paper('ECE_N')))
    clearImageBytesCache()
    const formFour = extentOf(await renderDocx(...paper('11')))

    assert(Boolean(nursery), 'the Nursery figure was embedded with a size')
    assert(Boolean(formFour), 'so was the Form 4 one')
    if (nursery && formFour) {
      assert(
        Math.min(nursery.cx, nursery.cy) > Math.min(formFour.cx, formFour.cy),
        `the same "small" preset prints BIGGER at Nursery than at Form 4 ` +
        `(${Math.min(nursery.cx, nursery.cy)} vs ${Math.min(formFour.cx, formFour.cy)} EMU)`,
      )
      // 914400 EMU per inch; the Early Childhood floor is 45mm ≈ 1.77in.
      const nurseryMm = (Math.min(nursery.cx, nursery.cy) / 914400) * 25.4
      assert(
        nurseryMm >= 44,
        `the Nursery figure reaches its level's minimum (${nurseryMm.toFixed(1)}mm)`,
      )
    }
  } finally {
    globalThis.fetch = realFetch
    clearImageBytesCache()
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7. Word export uses real WordprocessingML, not an MHTML blob (§4.4)
 * ════════════════════════════════════════════════════════════════════════ */

console.log('\nGOLDEN — the Word download is a real .docx (§4.4)')
{
  const doc = await buildDocxDocument(
    { title: 'Format check', subject: 'Mathematics', grade: '8' },
    [{ id: 'q1', order: 1, type: 'short_answer', text: 'A question.', marks: 1 }],
    { mode: 'paper' },
  )
  const bytes = new Uint8Array(await Packer.toBuffer(doc))
  // A .docx is a ZIP: "PK\x03\x04". An MHTML blob starts with MIME headers, opens
  // in desktop Word by luck and fails on mobile Word — which is what many
  // Zambian teachers use.
  assert(
    bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04,
    'the file is a ZIP container, not an MHTML blob',
  )
  const zip = unzipSync(bytes)
  assert('word/document.xml' in zip, 'it contains word/document.xml')
  assert('[Content_Types].xml' in zip, 'it contains the OPC content types part')
  const xml = strFromU8(zip['word/document.xml'])
  // Extract the declared xmlns:w namespace and compare it exactly — a bare
  // substring check could be satisfied by an unrelated URL that merely
  // contains the namespace string.
  const wordNamespace = (xml.match(/xmlns:w="([^"]*)"/) || [])[1]
  assert(
    wordNamespace === 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'the document declares the WordprocessingML namespace',
  )
}

console.log('\nGOLDEN — a library diagram: failure is visible, success is real')
{
  // The defect these two halves pin: a library diagram that could not be
  // rasterised was dropped from the Word file with no trace. A teacher
  // downloaded a paper whose question referred to a figure that was not there,
  // and nothing said so — not the file, not the studio, not a log line. The
  // fetched-image path had a dashed-red placeholder for exactly this; the
  // library-diagram path silently omitted.
  const { setSvgRasterizer, resetSvgRasterizer } = await import('./svgRasterizer.js')
  const meta = { title: 'Shape Test', subject: 'Mathematics', grade: '8', date: '2026-01-15' }
  const questions = [{
    id: 'q1', order: 1, type: 'short_answer', marks: 3,
    text: '<p>Find the size of the marked angle.</p>',
    imageDiagram: { libraryKey: 'triangleangle', params: {} },
  }]

  // ── half one: no rasteriser (jsdom has no canvas) ──────────────────────
  resetSvgRasterizer()
  const failStats = { failedImages: [], unresolvedFigures: [] }
  const failedZip = unzipSync(new Uint8Array(await Packer.toBuffer(
    await buildDocxDocument(meta, questions, { mode: 'paper', stats: failStats }),
  )))
  const failedXml = strFromU8(failedZip['word/document.xml'])
  assert(
    failedXml.includes('Figure could not be embedded'),
    'a diagram that cannot be rasterised prints the dashed-red placeholder',
  )
  assert(
    !/<w:drawing>/.test(failedXml),
    'and no drawing is embedded — the placeholder is not a diagram',
  )
  assert(failStats.unresolvedFigures.length === 1, 'the failure is recorded once')
  const entry = failStats.unresolvedFigures[0]
  assert(entry.diagramKey === 'triangleangle', 'the diagnostic names the diagram key')
  assert(entry.stage === 'rasterise', `the diagnostic names the failure stage — got "${entry.stage}"`)
  assert(entry.questionNumber === 1, 'the diagnostic names the question')
  assert(
    unresolvedFigureMessage(entry).startsWith('Question 1 requires a diagram'),
    'the message a teacher reads names the question',
  )
  assert(failStats.failedImages.length === 1, 'the existing failure counter still counts it')

  // A diagram key the catalog does not have fails at a DIFFERENT stage, because
  // "the catalog has no such shape" and "the browser could not draw it" call for
  // different fixes.
  const unknownStats = { failedImages: [], unresolvedFigures: [] }
  await Packer.toBuffer(await buildDocxDocument(
    meta,
    [{ ...questions[0], imageDiagram: { libraryKey: 'no-such-diagram', params: {} } }],
    { mode: 'paper', stats: unknownStats },
  ))
  assert(
    unknownStats.unresolvedFigures[0]?.stage === 'catalog',
    'an unknown diagram key is reported at the catalog stage',
  )

  // ── half two: a working rasteriser ─────────────────────────────────────
  // The placeholder proves failure is visible; this proves the success path
  // actually embeds a figure. Injected rather than mocked away: the exporter's
  // own code runs, and only the pixels a browser would have drawn are supplied.
  setSvgRasterizer(async () => PNG_1x1)
  try {
    const okStats = { failedImages: [], unresolvedFigures: [] }
    const okZip = unzipSync(new Uint8Array(await Packer.toBuffer(
      await buildDocxDocument(meta, questions, { mode: 'paper', stats: okStats }),
    )))
    const okXml = strFromU8(okZip['word/document.xml'])
    const media = Object.keys(okZip).filter((n) => /^word\/media\//.test(n))
    assert(okStats.unresolvedFigures.length === 0, 'nothing is unresolved when rasterisation works')
    assert(!okXml.includes('Figure could not be embedded'), 'and no placeholder is printed')
    assert(/<w:drawing>/.test(okXml), 'the Word file contains a drawing')
    assert(okXml.includes('svgBlip'), 'the SVG representation is declared (§4.2)')
    assert(media.some((n) => /\.svg$/i.test(n)), 'the SVG part is embedded')
    assert(media.some((n) => /\.png$/i.test(n)), 'the PNG fallback is embedded alongside it')
    assert(
      /Target="media\/[^"]+"/.test(strFromU8(okZip['word/_rels/document.xml.rels'] || new Uint8Array())),
      'the image relationship is declared, so the drawing is not a blank box',
    )

    // A rasteriser that answers with something that is not PNG bytes must fail
    // rather than embed a corrupt image — which in Word is an empty frame, the
    // exact silent failure this change exists to end.
    setSvgRasterizer(async () => 'not bytes')
    const badStats = { failedImages: [], unresolvedFigures: [] }
    await Packer.toBuffer(await buildDocxDocument(meta, questions, { mode: 'paper', stats: badStats }))
    assert(
      badStats.unresolvedFigures[0]?.stage === 'rasterise',
      'a rasteriser returning non-PNG data is reported, not embedded',
    )
  } finally {
    resetSvgRasterizer()
  }
}

console.log('\nGOLDEN — a paper missing a required figure is not delivered')
{
  // The half the earlier fix left open. The failure was RECORDED and the file
  // was saved anyway, so the caller learned that question 1's diagram was
  // missing from a document the teacher already had. A report that arrives
  // after the download is a receipt, not a gate.
  const { setSvgRasterizer, resetSvgRasterizer } = await import('./svgRasterizer.js')
  const { downloadAssessmentDocx } = await import('./assessmentToDocx.js')
  const meta = { title: 'Shape Test', subject: 'Mathematics', grade: '8', date: '2026-01-15' }
  const withFigure = [{
    id: 'q1', order: 1, type: 'short_answer', marks: 3,
    text: '<p>Find the size of the marked angle.</p>',
    imageDiagram: { libraryKey: 'triangleangle', params: {} },
  }]

  // Observe the real delivery path rather than stubbing the exporter: the claim
  // is about what reaches the teacher's disk. Every route in `saveBlob` ends at
  // an anchor click or an object URL, so counting those counts saves — and a
  // stubbed `downloadAssessmentDocx` would have proved only that the stub works.
  const saved = []
  const realClick = dom.window.HTMLAnchorElement.prototype.click
  dom.window.HTMLAnchorElement.prototype.click = function spyClick() {
    if (this.hasAttribute('download')) saved.push(this.getAttribute('download'))
  }
  const realCreateObjectURL = dom.window.URL.createObjectURL
  dom.window.URL.createObjectURL = () => 'blob:spy'
  dom.window.URL.revokeObjectURL = () => {}
  globalThis.URL.createObjectURL = dom.window.URL.createObjectURL
  globalThis.URL.revokeObjectURL = dom.window.URL.revokeObjectURL

  resetSvgRasterizer()                       // jsdom has no canvas → 'rasterise'
  let refusal = null
  try {
    await downloadAssessmentDocx(meta, withFigure, 'paper.docx')
  } catch (err) {
    refusal = err
  }
  // THROWN rather than returned: a returned flag put the burden on every caller
  // to look, and the two library export routes did not — they awaited the
  // download and toasted "Paper download started" over a file never written.
  assert(refusal !== null, 'the export throws rather than returning quietly')
  assert(refusal.code === 'unresolved-figure', 'with a code a caller can recognise')
  assert(refusal.entries.length === 1, 'the diagnostic travels with it')
  assert(
    refusal.message.startsWith('Question 1 requires a diagram'),
    `and its message is the repair instruction — got "${refusal.message}"`,
  )
  assert(saved.length === 0, 'NO FILE reached the teacher')

  // The same paper with a working rasteriser downloads normally — the refusal
  // is about the missing figure, not about having figures at all.
  setSvgRasterizer(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3]))
  try {
    const ok = await downloadAssessmentDocx(meta, withFigure, 'paper.docx')
    assert(ok.delivered === true, 'a paper whose figures rendered is delivered')
    assert(ok.unresolvedFigures.length === 0, 'with nothing unresolved')
    assert(saved.length === 1, 'and the file is saved exactly once')
  } finally {
    resetSvgRasterizer()
  }

  // The harness renders deliberately broken fixtures and needs the document to
  // inspect; the studio never sets this.
  resetSvgRasterizer()
  const forced = await downloadAssessmentDocx(meta, withFigure, 'paper.docx', { allowUnresolvedFigures: true })
  assert(forced.delivered === true, 'an explicit opt-out still delivers')
  assert(forced.unresolvedFigures.length === 1, 'and still reports the figure')
  assert(saved.length === 2, 'the opt-out saved a file')

  dom.window.HTMLAnchorElement.prototype.click = realClick
  dom.window.URL.createObjectURL = realCreateObjectURL
}

/* ── The page setup reaches BOTH renderers (§2) ───────────────────────────
   A page-size or orientation control that only moves the preview is a
   preference the printer ignores, and the teacher discovers it after running
   forty copies. So it is asserted against the rendered `.docx` section
   properties AND against the print stylesheet's `@page` rule — the two places
   a sheet's shape is actually decided. */
{
  const { buildPrintableHtml } = await import('./assessmentToPdf.js')
  const questions = [{ id: 'q1', order: 1, type: 'short_answer', text: 'Explain.', marks: 2 }]

  // Default: A4 portrait, unchanged from before any of this existed.
  const defaultXml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(
    await buildDocxDocument({ subject: 'Science', grade: '5' }, questions, { mode: 'paper' }),
  )))['word/document.xml'])
  // A4 portrait is 210 × 297mm = 11906 × 16838 twips.
  assert(defaultXml.includes('w:w="11906"'), 'a paper with no page setup is A4 wide in Word')
  assert(defaultXml.includes('w:h="16838"'), 'and A4 tall')
  assert(
    buildPrintableHtml({ subject: 'Science', grade: '5' }, questions, 'paper').includes('size: A4;'),
    'and the print stylesheet says A4',
  )

  // A5 landscape with wide margins.
  const a5 = { subject: 'Science', grade: '5', layout: { pageSize: 'a5', orientation: 'landscape', margins: 'wide' } }
  const a5Xml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(
    await buildDocxDocument(a5, questions, { mode: 'paper' }),
  )))['word/document.xml'])
  // A5 landscape is 210mm across and 148mm down = 11906 × 8391 twips, and that
  // is the way round Word stores it. Asserted on the emitted XML rather than on
  // the value passed in, because `docx` swaps the two itself for a landscape
  // section — pass it the laid-out dimensions and the swap lands you back at
  // portrait, on a page that still claims to be landscape.
  assert(a5Xml.includes('w:w="11906"') && a5Xml.includes('w:h="8391"'), 'A5 landscape reaches Word as 210 × 148mm')
  assert(a5Xml.includes('w:orient="landscape"'), 'and Word is told to turn it')
  // 25mm = 1417 twips.
  assert(a5Xml.includes('w:top="1417"'), 'wide margins reach Word')

  const a5Css = buildPrintableHtml(a5, questions, 'paper')
  assert(a5Css.includes('size: A5 landscape;'), 'the print stylesheet says A5 landscape')
  assert(a5Css.includes('margin: 25mm 25mm'), 'and carries the same wide margins')

  // Typography is one decision too: a paper set to 14pt prints at 14pt.
  const large = buildPrintableHtml(
    { subject: 'Science', grade: '5', layout: { bodySize: 'large' } }, questions, 'paper',
  )
  assert(large.includes('font-size: 14pt;'), 'the body size reaches the print stylesheet')
}

console.log(
  failures === 0
    ? `\n✓ paper golden files — ${passed} assertions passed`
    : `\n✗ paper golden files — ${failures} of ${passed + failures} assertions FAILED`,
)
if (failures > 0) process.exit(1)
