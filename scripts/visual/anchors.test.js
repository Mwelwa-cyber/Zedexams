/**
 * Tests for anchors.js — the module that turns a rendered page back into the
 * paper's structure (§4.6).
 *
 * Every case here is one a real render produced. The extractor was written from a
 * model of the document and then corrected four times by what the exporters
 * actually print, so these are regression tests in the strict sense: each one
 * failed before the rule it names existed.
 *
 * Run: node scripts/visual/anchors.test.js
 */

import {
  groupIntoLines, labelDocumentLines, extractTextAnchors, extractHeaderAnchor,
  detectFigures, pageInk, buildLayoutMap, resolveStrictRegions, expectedAnchorsFor,
  declaredPageMismatches, FIGURE_CELL, MIN_FIGURE_EXTENT_CELLS, INK_LEVEL,
} from './anchors.js'

let failures = 0
let passed = 0
function assert(cond, msg) {
  if (cond) { passed += 1; return }
  failures += 1
  console.error(`  ✗ ${msg}`)
}
function group(name) { console.log(`\n${name}`) }

/** A text run at a position, in the shape the rasteriser reports. */
const run = (text, x, y, width = text.length * 7, height = 12) => ({ text, x, y, width, height })

/** A white page of decoded RGBA, with a helper to ink rectangles onto it. */
function blankPage(pageNumber = 1, width = 400, height = 560) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  const page = { pageNumber, width, height, data, textItems: [], images: [] }
  page.inkRect = (x, y, w, h) => {
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) {
        const p = (yy * width + xx) * 4
        data[p] = 0; data[p + 1] = 0; data[p + 2] = 0; data[p + 3] = 255
      }
    }
    return page
  }
  return page
}

/* ── 1. lines ───────────────────────────────────────────────────────────── */

group('1. Text runs become lines')
{
  const lines = groupIntoLines([
    run('(4 marks)', 300, 100),
    run('1.', 60, 100),
    run('Simplify', 90, 100),
    run('the fraction.', 60, 118),
  ])
  assert(lines.length === 2, 'runs on the same baseline are one line')
  assert(lines[0].text === '1. Simplify (4 marks)', `runs are joined in x order — got "${lines[0].text}"`)
  assert(lines[0].x === 60, 'the line starts at the leftmost run')
  assert(lines[1].y === 118, 'the second line keeps its own y')

  // Both renderers emit a question number as its own run, so a leading token is
  // only visible once the runs are reassembled — this is why grouping exists.
  const single = groupIntoLines([run('1.', 60, 100)])
  assert(single[0].text === '1.', 'a lone number survives grouping')
}

/* ── 2. question numbering ──────────────────────────────────────────────── */

group('2. Question numbers are the ascending run, sealed on the first break')
{
  // The real failure: an identify-the-parts diagram prints four numbered answer
  // spaces that restart at 1. Taking every "N." as a question read a one-question
  // paper as four.
  const anchors = extractTextAnchors([{
    pageNumber: 1,
    textItems: [
      run('1.', 60, 100),
      run('Name the parts of the heart.', 60, 120),
      run('1.', 80, 300),   // answer space, restarts
      run('2.', 80, 330),
      run('3.', 80, 360),
      run('4.', 80, 390),
    ],
  }])
  assert(anchors.question_1 === 1, 'the first question is found')
  assert(!('question_2' in anchors), 'a numbered answer space is not question 2')
  assert(!('question_4' in anchors), 'nor question 4')

  const many = extractTextAnchors([{
    pageNumber: 1,
    textItems: [run('1.', 60, 100), run('2.', 60, 200), run('3.', 60, 300)],
  }])
  assert(
    many.question_1 === 1 && many.question_2 === 1 && many.question_3 === 1,
    'a genuine ascending run is all questions',
  )

  // First sighting wins: a number repeated in a running header must not move the
  // anchor to the last page it appears on.
  const repeated = extractTextAnchors([
    { pageNumber: 1, textItems: [run('1.', 60, 100)] },
    { pageNumber: 2, textItems: [run('1.', 60, 100)] },
  ])
  assert(repeated.question_1 === 1, 'a repeated number does not move the anchor to a later page')
}

/* ── 3. the marking key ─────────────────────────────────────────────────── */

group('3. An answer block belongs to the question it prints under')
{
  const anchors = extractTextAnchors([{
    pageNumber: 2,
    textItems: [
      run('1.', 60, 100),
      run('2.', 60, 200),
      run('Answers: 1. Aorta 2. Left ventricle', 74, 260),
    ],
  }])
  assert(anchors.answer_2 === 2, 'the answer block is filed under question 2, which it sits below')
  assert(!('answer_1' in anchors), 'and not under question 1')

  // The learner copy has no answer labels at all, which is why the togetherness
  // pair is skipped there rather than failing.
  const learner = extractTextAnchors([{ pageNumber: 1, textItems: [run('1.', 60, 100)] }])
  assert(!Object.keys(learner).some((k) => k.startsWith('answer_')), 'a learner copy carries no answer anchors')

  const titled = extractTextAnchors([{
    pageNumber: 1,
    textItems: [run('Fractions Test — Marking Key', 60, 60)],
  }])
  assert(titled.marking_key === 1, 'the marking-key title is an anchor')

  const sections = extractTextAnchors([{ pageNumber: 3, textItems: [run('SECTION B', 60, 60)] }])
  assert(sections.section_b === 3, 'a section heading is an anchor, lower-cased')
}

/* ── 4. the header ──────────────────────────────────────────────────────── */

group('4. The header block')
{
  const pages = [{ pageNumber: 1, textItems: [run('KABULONGA PRIMARY SCHOOL', 60, 40)] }]
  assert(
    extractHeaderAnchor(pages, { schoolName: 'Kabulonga Primary School' }).header === 1,
    'the header is matched case-insensitively',
  )
  assert(
    Object.keys(extractHeaderAnchor(pages, { schoolName: 'Other School' })).length === 0,
    'a header that is not there produces no anchor, so its absence is a finding',
  )
}

/* ── 5. figures ─────────────────────────────────────────────────────────── */

group('5. Figures: a placement first, ink second')
{
  // The false positive that produced the extent rule: a fractions paper with no
  // diagrams reported seven figures — rules, fraction bars and borders.
  const rules = blankPage()
  rules.inkRect(40, 100, 320, 2)   // a rule
  rules.inkRect(40, 140, 320, 1)   // an answer line
  rules.inkRect(100, 200, 40, 2)   // a fraction bar
  assert(detectFigures(rules).length === 0, 'thin ink is not a figure')

  const withFigure = blankPage()
  const side = (MIN_FIGURE_EXTENT_CELLS + 4) * FIGURE_CELL
  withFigure.inkRect(80, 200, side, side)
  const found = detectFigures(withFigure)
  assert(found.length === 1, `a square block of ink is one figure — got ${found.length}`)
  assert(found[0].source === 'ink', 'and it is reported as coming from ink')

  // A placed image wins, and it is the ONLY signal that survives a labelled
  // figure: on a marking key the answer labels sit on the diagram and fragment
  // its ink into pieces too small to be a figure.
  const labelled = blankPage()
  labelled.images = [{ x: 100, y: 300, width: 150, height: 150 }]
  labelled.textItems = [run('Aorta', 120, 340), run('Left ventricle', 150, 380)]
  const placed = detectFigures(labelled)
  assert(placed.length === 1 && placed[0].source === 'placement', 'a placed image is the figure')

  const tiny = blankPage()
  tiny.images = [{ x: 10, y: 10, width: 16, height: 16 }]
  assert(detectFigures(tiny).length === 0, 'a 16px logo is not a figure')

  assert(pageInk(blankPage()) === 0, 'a blank page has no ink')
  const inked = blankPage().inkRect(0, 0, 400, 56)
  assert(Math.abs(pageInk(inked) - 0.1) < 0.01, 'ink is measured as a fraction of the page')

  // Transparent pixels are paper. Treating alpha 0 as dark reported every page as
  // solid ink, which would have made the blank-page check useless.
  const transparent = blankPage()
  for (let i = 0; i < 400 * 560; i += 1) transparent.data[i * 4 + 3] = 0
  assert(pageInk(transparent) === 0, 'transparent pixels are not ink')

  const grey = blankPage()
  grey.inkRect(0, 0, 400, 56)
  for (let i = 0; i < 400 * 56; i += 1) {
    grey.data[i * 4] = INK_LEVEL + 5; grey.data[i * 4 + 1] = INK_LEVEL + 5; grey.data[i * 4 + 2] = INK_LEVEL + 5
  }
  assert(pageInk(grey) === 0, 'paper-pale grey is not ink')
}

/* ── 6. figures are named after their question ──────────────────────────── */

group('6. A figure is named after the question it belongs to')
{
  // `diagram_2` means "question 2's diagram" — which is what makes
  // together: [['diagram_2','question_2']] mean anything. Numbering figures in
  // document order looked equivalent and was not: a fixture whose only figure
  // belongs to question 2 got `diagram_1`, and its togetherness check had nothing
  // to check.
  const page = blankPage()
  page.textItems = [run('1.', 60, 100), run('2.', 60, 300)]
  page.images = [{ x: 100, y: 340, width: 150, height: 150 }]
  const layout = buildLayoutMap([page])
  assert(layout.anchors.diagram_2 === 1, `the figure under question 2 is diagram_2 — got ${JSON.stringify(layout.anchors)}`)
  assert(!('diagram_1' in layout.anchors), 'it is not named by document order')

  const two = blankPage()
  two.textItems = [run('1.', 60, 100)]
  two.images = [{ x: 40, y: 200, width: 120, height: 120 }, { x: 220, y: 200, width: 120, height: 120 }]
  const twoLayout = buildLayoutMap([two])
  assert(
    twoLayout.anchors.diagram_1 === 1 && twoLayout.anchors['diagram_1.2'] === 1,
    'a second figure under one question gets its own ID rather than being folded in',
  )
}

/* ── 7. strict regions ──────────────────────────────────────────────────── */

group('7. Strict regions are resolved from this render, and never dropped')
{
  const page = blankPage()
  page.textItems = [run('1.', 60, 100), run('2.', 60, 300)]
  const layout = buildLayoutMap([page])
  const { regions, unresolved } = resolveStrictRegions(
    [{ type: 'maths', anchor: 'question_1' }], page, layout,
  )
  assert(regions.length === 1, 'the region is resolved')
  assert(unresolved.length === 0, 'and nothing is unresolved')
  assert(regions[0].y < 100 && regions[0].y + regions[0].height <= 300, 'it spans question 1 down to question 2')
  assert(regions[0].type === 'maths', 'the declared type is carried through')

  // A region that cannot be placed is REPORTED. Dropping it would mean the
  // fixture's maths is no longer held to the strict limit while the fixture still
  // says it is — the suite would report green having stopped checking.
  const missing = resolveStrictRegions([{ type: 'maths', anchor: 'question_9' }], page, {
    ...layout, anchors: { ...layout.anchors, question_9: 1 },
  })
  assert(missing.unresolved.includes('question_9'), 'an unplaceable region is reported, not dropped')

  // An anchor on another page is not unresolved — it is simply elsewhere.
  const elsewhere = resolveStrictRegions([{ type: 'maths', anchor: 'question_1' }], page, {
    ...layout, anchors: { question_1: 7 },
  })
  assert(
    elsewhere.regions.length === 0 && elsewhere.unresolved.length === 0,
    'an anchor on another page is neither resolved nor an error',
  )

  const header = blankPage()
  header.textItems = [run('KABULONGA PRIMARY SCHOOL', 60, 40), run('1.', 60, 200)]
  const headerLayout = buildLayoutMap([header], { schoolName: 'Kabulonga Primary School' })
  const headerRegions = resolveStrictRegions([{ type: 'header', anchor: 'header' }], header, headerLayout)
  assert(headerRegions.regions.length === 1, 'the header region resolves')
  assert(headerRegions.regions[0].y === 0, 'and starts at the top of the page')
}

/* ── 8. what a fixture declares ─────────────────────────────────────────── */

group('8. A fixture declares what its render must contain')
{
  const fixture = {
    regions: [{ type: 'diagram', anchor: 'diagram_1' }],
    together: [['diagram_1', 'question_1'], ['answer_1', 'question_1']],
    expectedAnchorPages: { question_7: 2 },
  }
  const learner = expectedAnchorsFor(fixture, 'paper')
  assert(!('answer_1' in learner), 'the learner copy is not expected to carry an answer anchor')
  assert(learner.diagram_1 === true, 'but it is expected to carry the diagram')
  assert(learner.question_7 === 2, 'a declared page is kept as the page, not flattened to true')

  const scheme = expectedAnchorsFor(fixture, 'scheme')
  assert(scheme.answer_1 === true, 'the marking key IS expected to carry the answer anchor')

  const mismatches = declaredPageMismatches({ question_7: 2, question_1: true }, { question_7: 3, question_1: 1 })
  assert(mismatches.length === 1 && mismatches[0].id === 'question_7', 'a declared page that moved is reported')
  assert(
    declaredPageMismatches({ question_9: 2 }, {}).length === 0,
    'an absent anchor is not a page mismatch — that is the render guard\'s finding',
  )
}

/* ── 9. one labelling, two readers ──────────────────────────────────────── */

group('9. The anchor map and the region resolver read the same labelling')
{
  // They each carried their own copy of the patterns and disagreed about which
  // line `answer_N` was. One walk, one answer.
  const pages = [{
    pageNumber: 1,
    textItems: [run('1.', 60, 100), run('2.', 60, 200), run('Answers: x', 74, 240)],
  }]
  const labelled = labelDocumentLines(pages)
  const fromLines = labelled[0].lines.filter((l) => l.anchor).map((l) => l.anchor)
  const fromMap = Object.keys(extractTextAnchors(pages))
  assert(
    fromLines.every((id) => fromMap.includes(id)) && fromMap.every((id) => fromLines.includes(id)),
    `the two agree — lines ${fromLines.join(',')} vs map ${fromMap.join(',')}`,
  )
}

console.log(`\n${passed} passed, ${failures} failed`)
if (failures) process.exit(1)
