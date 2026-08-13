/**
 * The Forms-level paper — the phase's proof.
 *
 * One realistic Grade 12 / Forms Paper 2 section carrying a circle theorem, a
 * bearings journey, a quadratic graph with read-offs, a cumulative frequency
 * question, a linear-programming region and a transformation — rendered all the
 * way to the artefacts a teacher receives: the print window's HTML, a real
 * .docx, and the marking scheme.
 *
 * Why a golden test rather than only unit tests on the catalogue. Every figure
 * is proved mathematically true in secondaryDiagrams.test.js, against the SVG
 * it generates. That is the drawing. This is the DELIVERY: whether the drawing
 * survives being embedded in Word, whether it reaches the marking scheme (a
 * linear-programming answer is the shaded region; a transformation answer is
 * the image), and whether the learner's copy stays free of the answers. A
 * figure that is perfect in the catalogue and absent from the download has not
 * shipped.
 *
 * A DOM is required — the exporters walk paper HTML with DOMParser, as they do
 * in the browser — so this installs jsdom globals before importing them.
 *
 * Run: node src/utils/formsPaperGolden.test.js
 */

import { JSDOM } from 'jsdom'

// Must be installed BEFORE the exporters load: they branch on
// `typeof DOMParser === 'undefined'` at call time, and the branch worth
// exercising is the one a browser takes.
const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.DOMParser = dom.window.DOMParser
globalThis.Node = dom.window.Node

const { Packer } = await import('docx')
const { unzipSync, strFromU8 } = await import('fflate')
const { buildDocxDocument } = await import('./assessmentToDocx.js')
const { buildPrintableHtml } = await import('./assessmentToPdf.js')
const { setSvgRasterizer, resetSvgRasterizer } = await import('./svgRasterizer.js')
const { buildSavedAssessmentExportReadiness } = await import('./assessmentExportReadiness.js')
const { resolveFigureForExport } = await import('../components/diagrams/diagramCatalog.js')
const { findForbiddenTerms } = await import('../config/paperTerminology.js')

/** Minimal valid PNG (1×1 transparent) — the raster fallback inside each SVG run. */
const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

/**
 * The text a reader actually sees on the printed page.
 *
 * §4.1's forbidden-term check must run over PRINTED TEXT, not markup. Every
 * one of those words appears legitimately in the machinery: "SVG" is in every
 * inline `<svg>` tag in the print window and in the `svgBlip` element Word uses
 * to reference a vector part (§4.2). Running the check over raw markup reports
 * a leak on every paper that contains any figure at all, which is a check that
 * cannot distinguish a real leak from the feature working.
 */
function printedText(html) {
  const el = dom.window.document.createElement('div')
  el.innerHTML = String(html)
  // The stylesheet is not printed text either, and it names `svg` selectors —
  // textContent would hand the whole of it to the term check.
  for (const el2 of el.querySelectorAll('svg, style, script')) el2.remove()
  return el.textContent || ''
}

/** The text Word will show: the contents of every <w:t> run, and nothing else. */
function wordText(xml) {
  // Strip tags to a fixpoint so removals can't reassemble a tag ("<w<x>:t>").
  const stripTags = (run) => {
    let out = run
    let prev
    do {
      prev = out
      out = out.replace(/<[^>]+>/g, '')
    } while (out !== prev)
    return out
  }
  return (String(xml).match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
    .map(stripTags)
    .join(' ')
}

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

/* ── the paper ───────────────────────────────────────────────────────────── */

const META = {
  title: 'End of Year Examination',
  paperName: 'Paper 2',
  subject: 'Mathematics',
  grade: '12',
  framework: '2023',
  schoolName: 'Kabulonga Secondary School',
  totalMarks: 36,
  duration: 150,
  date: '2026-01-15',
  showNameField: true,
  showMarksField: true,
}

/**
 * Six questions, one per family. Every set of parameters here is one the
 * catalogue can draw truly — which the export-gate assertion below then proves
 * rather than assumes.
 */
const QUESTIONS = [
  {
    id: 'q1', order: 1, type: 'short_answer', marks: 6,
    text: '<p>In the diagram, O is the centre of the circle. Find the value of <em>x</em>, giving a reason for your answer.</p>',
    imageDiagram: {
      libraryKey: 'circletheorem',
      params: {
        centre: 'O', points: 'A@200,B@90,C@340', joins: 'O-A,O-C,A-B,B-C',
        angles: 'AOC=110,ABC=x', tangent: '', notToScale: 'yes', cap: 'Circle, centre O',
      },
    },
    correctAnswer: 'x = 55°',
    explanation: 'Angle at the centre is twice the angle at the circumference, so x = 55°.',
  },
  {
    id: 'q2', order: 2, type: 'short_answer', marks: 6,
    text: '<p>A boat sails from A to B, then from B to C. Calculate the distance AC and the bearing of C from A.</p>',
    imageDiagram: {
      libraryKey: 'bearings',
      params: { legs: 'A>B,060,8;B>C,135,6', unit: 'km', notToScale: 'no', cap: 'Bearings journey' },
    },
    correctAnswer: 'AC = 8.7 km on a bearing of 093°',
    explanation: 'Cosine rule on triangle ABC, then the sine rule for the bearing.',
  },
  {
    id: 'q3', order: 3, type: 'short_answer', marks: 6,
    text: '<p>Use the graph to solve the equation <em>x</em>² − 2<em>x</em> − 3 = 0, and write down the coordinates of the turning point.</p>',
    imageDiagram: {
      libraryKey: 'functiongraph',
      params: {
        fn: 'y = x^2 - 2x - 3', xMin: '-3', xMax: '5', yMin: '-6', yMax: '8',
        show: 'roots,turning', notToScale: 'no', cap: 'Graph of y = x² − 2x − 3',
      },
    },
    correctAnswer: 'x = −1 or x = 3',
    explanation: 'Read the roots where the curve crosses the x-axis; the turning point is (1, −4).',
  },
  {
    id: 'q4', order: 4, type: 'short_answer', marks: 6,
    text: '<p>Use the cumulative frequency curve to estimate the median and the interquartile range.</p>',
    imageDiagram: {
      libraryKey: 'ogive',
      params: {
        boundaries: '0,10,20,30,40,50', frequencies: '4,9,14,8,3', readOff: 'median,quartiles',
        xLabel: 'Mass (kg)', yLabel: 'Cumulative frequency', notToScale: 'no', cap: 'Cumulative frequency curve',
      },
    },
    correctAnswer: 'Median ≈ 24.3 kg',
    explanation: 'Read across at half the total frequency, then down to the mass axis.',
  },
  {
    id: 'q5', order: 5, type: 'short_answer', marks: 6,
    text: '<p>The unshaded region R satisfies four inequalities. Write down the inequalities and find the maximum value of 3<em>x</em> + 2<em>y</em> in R.</p>',
    imageDiagram: {
      libraryKey: 'linearprogramming',
      params: {
        constraints: 'x+y<=6,2x+y<=8,x>=0,y>=0', shade: 'unwanted', regionLabel: 'R',
        xMin: '0', xMax: '8', yMin: '0', yMax: '8', notToScale: 'no', cap: 'Feasible region R',
      },
    },
    correctAnswer: 'Maximum value 14, at (2, 4)',
    explanation: 'The maximum is at the vertex (2, 4), giving 3(2) + 2(4) = 14.',
  },
  {
    id: 'q6', order: 6, type: 'short_answer', marks: 6,
    text: '<p>Triangle P is mapped onto triangle Q. Describe the single transformation fully.</p>',
    imageDiagram: {
      libraryKey: 'transformation',
      params: {
        object: '(1,1),(4,1),(1,3)', type: 'rotation', by: '90,0,0',
        objectLabel: 'P', imageLabel: 'Q',
        xMin: '-6', xMax: '6', yMin: '-6', yMax: '6', notToScale: 'no', cap: 'Object and image',
      },
    },
    correctAnswer: 'A rotation of 90° anticlockwise about the origin',
    explanation: 'The centre is the invariant point; check one vertex maps correctly.',
  },
]

/** Every figure this paper asks for, by key. */
const FIGURE_KEYS = QUESTIONS.map((q) => q.imageDiagram.libraryKey)

/* ══════════════════════════════════════════════════════════════════════════
 * 1. The paper is exportable at all
 * ════════════════════════════════════════════════════════════════════════ */

console.log('\nFORMS PAPER — the export gate accepts it')
{
  // The gate resolver refuses a figure whose parameters cannot produce a true
  // drawing, so this is not a formality: it proves every set of parameters in
  // the fixture above is one the catalogue can honour, rather than one that
  // merely renders.
  const readiness = buildSavedAssessmentExportReadiness(META, QUESTIONS, resolveFigureForExport)
  assert(readiness.unresolvedFigures.length === 0,
    `every figure resolves (unresolved: ${JSON.stringify(readiness.unresolvedFigures)})`)
  assert(!readiness.gate.blocked, `the paper is exportable — ${readiness.gate.message || 'no reason given'}`)

  // And the gate has teeth on this paper: break one figure and it refuses.
  const broken = QUESTIONS.map((q, i) => (i !== 4 ? q : {
    ...q,
    imageDiagram: { ...q.imageDiagram, params: { ...q.imageDiagram.params, constraints: 'x+y<=2,x+y>=6' } },
  }))
  const brokenReadiness = buildSavedAssessmentExportReadiness(META, broken, resolveFigureForExport)
  assert(brokenReadiness.unresolvedFigures.length === 1,
    'a figure with no possible region blocks this very paper')
  assert(/No region satisfies/.test(brokenReadiness.unresolvedFigures[0].reason || ''),
    'and the reason is the sentence a teacher can act on')
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2. The print / PDF route
 * ════════════════════════════════════════════════════════════════════════ */

console.log('\nFORMS PAPER — the print window draws every figure inline')
{
  const html = buildPrintableHtml(META, QUESTIONS, 'paper')
  assert((html.match(/<svg /g) || []).length >= FIGURE_KEYS.length,
    `all ${FIGURE_KEYS.length} figures are inline SVG in the print window`)
  assert(!html.includes('Figure could not be loaded'), 'no figure fell back to the placeholder')

  // Spot-checks that the figure on the page is the one the question is about,
  // not a figure-shaped hole or a different shape entirely.
  assert(html.includes('Diagram not drawn to scale'),
    'the circle-theorem figure carries the examination caption')
  assert(html.includes('data-bearing="60"'), 'the bearings figure carries its 060° arc')
  assert(html.includes('>(1, -4)</text>'), 'the quadratic prints its turning point')
  assert(html.includes('data-readoff="median"'), 'the ogive draws the median read-off')
  assert(html.includes('data-shading="unwanted"'), 'the feasible region shades the unwanted side')
  assert(html.includes('data-shape="image"'), 'the transformation draws the image as well as the object')

  // §4.1: our own machinery never reaches the page — checked against the text
  // a reader sees, for the reason printedText() explains.
  const leaked = findForbiddenTerms(printedText(html))
  assert(leaked.length === 0, `no internal term is printed (found ${leaked.join(', ')})`)
}

console.log('\nFORMS PAPER — the learner copy carries no answers')
{
  const learner = printedText(buildPrintableHtml(META, QUESTIONS, 'paper'))
  for (const q of QUESTIONS) {
    assert(!learner.includes(q.correctAnswer), `question ${q.order}'s answer is not on the learner's paper`)
    assert(!learner.includes(q.explanation), `question ${q.order}'s explanation is not on the learner's paper`)
  }
  assert(!learner.includes('rotation of 90° anticlockwise'), 'no answer text leaks into the paper')
}

console.log('\nFORMS PAPER — the marking scheme carries the answers AND the figures')
{
  const scheme = buildPrintableHtml(META, QUESTIONS, 'scheme')
  const schemeText = printedText(scheme)
  for (const q of QUESTIONS) {
    assert(schemeText.includes(q.correctAnswer), `question ${q.order}'s answer is in the scheme`)
    assert(schemeText.includes(q.explanation), `question ${q.order}'s explanation is in the scheme`)
  }
  // The figures matter in the key, not just the paper: a linear-programming
  // answer IS the shaded region and a transformation answer IS the image, so a
  // marking scheme printed without them cannot be marked from.
  assert((scheme.match(/<svg /g) || []).length >= FIGURE_KEYS.length,
    'every figure is drawn in the marking scheme too')
  assert(scheme.includes('data-shading="unwanted"'), 'the feasible region is in the key')
  assert(scheme.includes('data-shape="image"'), 'the transformation image is in the key')
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. The Word route
 * ════════════════════════════════════════════════════════════════════════ */

/** Build the paper and return its zip entries. */
async function renderDocxZip(mode) {
  const stats = { failedImages: [], unresolvedFigures: [] }
  const doc = await buildDocxDocument(META, QUESTIONS, { mode, stats })
  const zip = unzipSync(new Uint8Array(await Packer.toBuffer(doc)))
  return { zip, xml: strFromU8(zip['word/document.xml']), stats }
}

console.log('\nFORMS PAPER — every figure reaches Word as a vector drawing')
{
  // jsdom has no canvas, so the rasteriser is stubbed. The PNG is only the
  // FALLBACK inside each run — modern Word draws the SVG part, which is what
  // the media assertions below are about.
  setSvgRasterizer(async () => PNG_1x1)
  try {
    const { zip, xml, stats } = await renderDocxZip('paper')
    assert(stats.unresolvedFigures.length === 0,
      `no figure was dropped (${JSON.stringify(stats.unresolvedFigures)})`)
    assert(!xml.includes('Figure could not be embedded'), 'no placeholder was printed')

    const drawings = (xml.match(/<w:drawing>/g) || []).length
    assert(drawings >= FIGURE_KEYS.length,
      `all ${FIGURE_KEYS.length} figures are embedded drawings (found ${drawings})`)

    // Vector all the way down: an SVG part per figure, each with a raster
    // fallback beside it for builds too old to draw one.
    const media = Object.keys(zip).filter((n) => n.startsWith('word/media/'))
    const svgs = media.filter((n) => n.endsWith('.svg'))
    assert(svgs.length >= FIGURE_KEYS.length,
      `each figure embeds an SVG part (found ${svgs.length} of ${FIGURE_KEYS.length})`)
    assert(media.some((n) => /\.(png|jpe?g)$/.test(n)), 'the raster fallback is present too')

    // The SVG Word receives is the figure, not an empty box.
    const svgText = svgs.map((n) => strFromU8(zip[n])).join('\n')
    assert(svgText.includes('data-bearing="60"'), 'the bearings figure reached Word intact')
    assert(svgText.includes('data-readoff="median"'), 'the ogive read-off reached Word intact')
    assert(svgText.includes('data-shape="image"'), 'the transformation image reached Word intact')

    const leaked = findForbiddenTerms(wordText(xml))
    assert(leaked.length === 0, `no internal term is printed in Word (found ${leaked.join(', ')})`)
  } finally {
    resetSvgRasterizer()
  }
}

console.log('\nFORMS PAPER — Word: the paper and the key differ in exactly the right way')
{
  setSvgRasterizer(async () => PNG_1x1)
  try {
    const paper = await renderDocxZip('paper')
    const scheme = await renderDocxZip('scheme')
    const paperText = wordText(paper.xml)
    const schemeText = wordText(scheme.xml)
    for (const q of QUESTIONS) {
      // A distinctive fragment: Word splits a sentence across runs, so the
      // whole string is not guaranteed to survive as one substring.
      const fragment = q.explanation.split(' ').slice(0, 4).join(' ')
      assert(!paperText.includes(fragment), `question ${q.order}'s answer is absent from the Word paper`)
      assert(schemeText.includes(fragment), `question ${q.order}'s answer is present in the Word key`)
    }
    const schemeDrawings = (scheme.xml.match(/<w:drawing>/g) || []).length
    assert(schemeDrawings >= FIGURE_KEYS.length,
      `the Word marking scheme draws every figure too (found ${schemeDrawings})`)
  } finally {
    resetSvgRasterizer()
  }
}

console.log(`\nForms paper golden: ${passed} passed, ${failures} failed\n`)
if (failures) process.exit(1)
