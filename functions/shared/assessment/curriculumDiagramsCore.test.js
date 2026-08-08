/**
 * The curriculum Diagram Library's contract.
 *
 * Three properties matter more than anything about how the art looks, because
 * all three are silent when they break:
 *
 *   1. The label-it variant must not contain the answers. A learner exercise
 *      whose part names sit in the SVG text is an exercise the answer page is
 *      not needed for.
 *   2. The study variant and the label-it variant must number the SAME parts in
 *      the SAME order, because the answer page reads that numbering back.
 *   3. The art must stay printable: no solid colour fills, and label boxes big
 *      enough for a child's handwriting.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import {
  CURRICULUM_DIAGRAMS,
  DIAGRAM_SHADE,
  LABEL_BOX,
  diagramAnswerKey,
  diagramLabelAnchors,
  diagramWordBank,
  matchCurriculumDiagram,
  renderCurriculumDiagram,
} from './curriculumDiagramsCore.js'
import { DIAGRAM_CATALOG, getDiagram, renderDiagramSvg } from './diagramCatalogCore.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

const entries = Object.entries(CURRICULUM_DIAGRAMS)

test('the library has the figures the syllabus topics name', () => {
  for (const key of ['digestivesystem', 'floweringplant', 'leafstructure', 'humanheart',
    'watercycle', 'simplecircuit']) {
    assert.ok(CURRICULUM_DIAGRAMS[key], `${key} is missing from the library`)
  }
})

test('every curriculum figure is reachable through the ONE catalogue', () => {
  // Not a second catalogue for the server: `getDiagram` is the only lookup and
  // it has to know about these.
  for (const [key] of entries) {
    assert.ok(getDiagram(key), `${key} is not in DIAGRAM_CATALOG`)
    assert.ok(DIAGRAM_CATALOG[key].curriculum, `${key} should be marked as a curriculum figure`)
  }
})

for (const [key, entry] of entries) {
  test(`${key}: the label-it variant contains NO part names`, () => {
    const svg = renderCurriculumDiagram(entry, { mode: 'label-it' })
    for (const part of entry.parts) {
      assert.ok(
        !svg.toLowerCase().includes(part.name.toLowerCase()),
        `"${part.name}" leaked into the unlabelled variant — the learner can read the answer`,
      )
    }
    // It must still be usable as an exercise: one numbered box per part.
    const boxes = svg.match(/data-label-box=/g) || []
    assert.equal(boxes.length, entry.parts.length, 'one empty box per part')
  })

  test(`${key}: the study variant names every part`, () => {
    const svg = renderCurriculumDiagram(entry, { mode: 'study' })
    for (const part of entry.parts) {
      assert.ok(svg.includes(part.name), `"${part.name}" is not drawn on the study diagram`)
    }
    assert.equal((svg.match(/data-label-box=/g) || []).length, 0, 'the study copy has no write-in boxes')
  })

  test(`${key}: the answer key numbers the parts the exercise numbered`, () => {
    const exercise = renderCurriculumDiagram(entry, { mode: 'label-it' })
    for (const { number, name } of diagramAnswerKey(entry)) {
      assert.ok(exercise.includes(`>${number}.<`), `the exercise has no box ${number}`)
      assert.ok(name, `answer ${number} has no name`)
    }
  })

  test(`${key}: prints in black and white`, () => {
    const svg = renderCurriculumDiagram(entry, { mode: 'study' })
    const fills = [...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1])
    for (const fill of fills) {
      const allowed = fill === 'none' || fill === DIAGRAM_SHADE || fill === '#1c1612'
      assert.ok(allowed, `${key} fills with ${fill} — a photocopier turns that into a grey smear`)
    }
    // White is permitted only as a wire-gap mask, never as a fill.
    assert.ok(!/fill="#fff/i.test(svg), 'white fills hide the art on a coloured print')
  })

  test(`${key}: label boxes fit a child's handwriting`, () => {
    assert.ok(LABEL_BOX.width >= 60 && LABEL_BOX.height >= 16)
    // Every box has to sit inside the viewBox, or the label prints off the page.
    const { x, y, width, height } = entry.viewBox
    for (const part of entry.parts) {
      assert.ok(part.box[0] >= x, `${part.id}'s box starts left of the viewBox`)
      assert.ok(part.box[0] + LABEL_BOX.width <= x + width, `${part.id}'s box runs off the right`)
      assert.ok(part.box[1] >= y, `${part.id}'s box sits above the viewBox`)
      assert.ok(part.box[1] + LABEL_BOX.height <= y + height, `${part.id}'s box runs off the bottom`)
    }
  })

  test(`${key}: the anchors the learner app reads are normalised 0–1`, () => {
    const anchors = diagramLabelAnchors(entry)
    assert.equal(anchors.length, entry.parts.length)
    for (const a of anchors) {
      for (const field of ['x', 'y', 'boxX', 'boxY']) {
        assert.ok(a[field] >= 0 && a[field] <= 1, `${a.id}.${field} = ${a[field]} is outside 0–1`)
      }
      assert.ok(a.boxWidth > 0 && a.boxHeight > 0)
      assert.ok(a.name && a.id, 'an anchor with no name cannot be dragged onto')
    }
  })

  test(`${key}: the word bank does not print the parts in the order they are drawn`, () => {
    const bank = diagramWordBank(entry)
    assert.equal(bank.length, entry.parts.length)
    assert.deepEqual(bank, [...bank].sort((a, b) => a.localeCompare(b)), 'the bank should be A–Z')
  })
}

test('the board version keeps only the labels a teacher can copy, renumbered', () => {
  const entry = CURRICULUM_DIAGRAMS.digestivesystem
  const key = diagramAnswerKey(entry, { board: true })
  assert.equal(key.length, entry.boardParts.length)
  // A learner copying four labels off a board writes 1-4, not 1, 4, 5, 6.
  assert.deepEqual(key.map((k) => k.number), [1, 2, 3, 4])
  const svg = renderCurriculumDiagram(entry, { mode: 'study', board: true })
  assert.ok(!svg.includes('oesophagus'), 'the board copy drops the parts it left out')
  assert.ok(svg.includes('stomach'))
})

test('a Digestive System topic proposes the digestive figure', () => {
  const match = matchCurriculumDiagram({ topic: 'The Digestive System', subject: 'integrated_science' })
  assert.equal(match.key, 'digestivesystem')
})

test('the longest topic match wins', () => {
  // "plants" and "parts of a flower" both appear; the specific one is right.
  const match = matchCurriculumDiagram({ topic: 'Parts of a flower', subject: 'integrated_science' })
  assert.equal(match.key, 'floweringplant')
})

test('a subject the figure does not belong to does not match', () => {
  assert.equal(matchCurriculumDiagram({ topic: 'Electricity', subject: 'mathematics' }), null)
})

test('a topic with no library figure proposes nothing rather than something close', () => {
  // A wrong figure on a printed handout is worse than no figure.
  assert.equal(matchCurriculumDiagram({ topic: 'Fractions', subject: 'mathematics' }), null)
  assert.equal(matchCurriculumDiagram({}), null)
})

test('the catalogue render path draws the same variants', () => {
  const study = renderDiagramSvg('digestivesystem', {})
  const blank = renderDiagramSvg('digestivesystem', { labels: 'off' })
  const answer = renderDiagramSvg('digestivesystem', { labels: 'answer' })
  assert.ok(study.includes('stomach'))
  assert.ok(!blank.includes('stomach'))
  assert.ok(answer.includes('4. stomach'), 'the marking copy carries the number AND the name')
})

if (process.exitCode) {
  console.error('\n✗ curriculum diagram library FAILED')
} else {
  console.log(`\n✓ curriculum diagram library — ${passed} checks passed`)
}
