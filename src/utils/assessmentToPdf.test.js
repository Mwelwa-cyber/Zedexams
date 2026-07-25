/**
 * Regression tests for the Assessment → Print-window PDF renderer.
 *
 * These tests cover the three bug classes that caused content to be silently
 * dropped from the printed paper while still appearing in the on-screen
 * preview (PaperBlocks.jsx) and the Word export (assessmentToDocx.js):
 *
 *   B1 — Catalog shape diagrams (imageDiagram: {libraryKey, params}) were never
 *         rendered — neither on question stems, passage blocks, nor MCQ options.
 *   B2 — Fill-in-the-Blanks questions printed a bare word-bank line (shared with
 *         MCQ) but never rendered the statements with blank spans, nor replaced
 *         blanks with green-highlighted answers in scheme mode.
 *   B3 — answerFormat 'none'/'labelled_blanks', explicit answerLines=0, essay
 *         line-count (was hard-coded 10, should be DEFAULT_ANSWER_LINES.essay=8),
 *         and sub-part "(a)(b)(c)" blocks were all ignored.
 *
 * All tests use `buildPrintableHtml` (exported for test purposes) directly —
 * no DOM, no open browser window.
 *
 * Run:  node src/utils/assessmentToPdf.test.js
 */

import assert from 'node:assert/strict'
import { buildPrintableHtml } from './assessmentToPdf.js'
import { DEFAULT_ANSWER_LINES } from './assessmentPaperLayout.js'

// ─── helpers ────────────────────────────────────────────────────────────────

const BASE_ASSESSMENT = {
  schoolName: 'Test School', subject: 'Science', grade: '7',
  assessmentType: 'end_of_term', term: '1',
  showNameField: false, showDateField: false, showClassField: false, showMarksField: false,
}

function html(extraAssessment = {}, questions = [], mode = 'paper') {
  return buildPrintableHtml(
    { ...BASE_ASSESSMENT, ...extraAssessment },
    questions,
    mode,
  )
}

function makeQ(overrides) {
  return { id: 'q1', order: 0, marks: 1, text: 'Q text', options: [], ...overrides }
}

let failures = 0
function ok(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

// ─── B1 — imageDiagram on question stem ──────────────────────────────────────

console.log('\nB1 — catalog shape diagrams')

{
  const out = html({}, [makeQ({
    type: 'short_answer',
    imageDiagram: { libraryKey: 'triangle', params: {} },
  })])
  ok(out.includes('<svg'), 'question stem imageDiagram renders an <svg element')
  ok(out.includes('q-diagram'), 'question stem imageDiagram is wrapped in .q-diagram')
}

{
  // MCQ with image-mode options, one using a catalog diagram
  const out = html({}, [makeQ({
    type: 'mcq',
    optionsMode: 'image',
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 0,
    optionMedia: [
      { diagram: { libraryKey: 'circle', params: {} } },
      { imageUrl: 'https://x/b.png' },
      null,
      null,
    ],
  })])
  ok(out.includes('<svg'), 'image-mode MCQ option with catalog diagram renders <svg')
  ok(out.includes('img-box'), 'image-mode option box is present')
}

{
  // MCQ with mixed-mode options, one using a catalog diagram
  const out = html({}, [makeQ({
    type: 'mcq',
    optionsMode: 'mixed',
    options: ['one', 'two', 'three', 'four'],
    correctAnswer: 0,
    optionMedia: [
      { diagram: { libraryKey: 'rectangle', params: {} } },
      null, null, null,
    ],
  })])
  ok(out.includes('<svg'), 'mixed-mode MCQ option with catalog diagram renders <svg')
}

{
  // Passage with imageDiagram
  const out = html({
    passages: [{
      id: 'ps1', order: 0,
      imageDiagram: { libraryKey: 'cylinder', params: { r: '3', h: '6' } },
      title: 'Study the shape',
    }],
  }, [makeQ({ order: 1, passageId: 'ps1', type: 'short_answer' })])
  ok(out.includes('<svg'), 'passage-level imageDiagram renders <svg in the passage box')
  ok(out.includes('q-diagram'), 'passage imageDiagram wrapped in .q-diagram')
}

// ─── B2 — fill_blanks rendering ──────────────────────────────────────────────

console.log('\nB2 — fill-in-the-blanks')

{
  const q = makeQ({
    type: 'fill_blanks',
    wordBank: ['soap', 'clean', 'water'],
    statements: [
      { text: 'We use ____ to wash our hands.', answers: ['soap'] },
      { text: 'Plants need ____ and ____', answers: ['water', 'sunlight'] },
    ],
  })
  const out = html({}, [q])
  ok(out.includes('fill-word-bank'), 'fill_blanks: word-bank box rendered (.fill-word-bank)')
  ok(out.includes('Word Bank:'), 'fill_blanks: "Word Bank:" label present')
  ok(out.includes('soap'), 'fill_blanks: word-bank word "soap" present')
  ok(out.includes('fill-row'), 'fill_blanks: statement rows rendered (.fill-row)')
  ok(out.includes('fill-label'), 'fill_blanks: statement labels rendered (.fill-label)')
  ok(out.includes('A.'), 'fill_blanks: first statement labelled "A."')
  ok(out.includes('B.'), 'fill_blanks: second statement labelled "B."')
  ok(out.includes('fill-gap'), 'fill_blanks: blank spans rendered (.fill-gap)')
  // The generic word-bank line must NOT be duplicated
  const wbOccurrences = (out.match(/Word Bank:/g) || []).length
  ok(wbOccurrences === 1, 'fill_blanks: "Word Bank:" appears exactly once (not duplicated by generic path)')
}

{
  // Scheme mode: blanks replaced by green answer text
  const q = makeQ({
    type: 'fill_blanks',
    showAnswer: true,
    wordBank: ['soap'],
    statements: [
      { text: 'We use ____ to wash our hands.', answers: ['soap'] },
    ],
  })
  const out = html({}, [q], 'scheme')
  ok(out.includes('fill-answer'), 'fill_blanks scheme mode: answer span rendered (.fill-answer)')
  ok(out.includes('soap'), 'fill_blanks scheme mode: the answer text is present')
  ok(!out.includes('class="fill-gap"'), 'fill_blanks scheme mode: no blank gap spans (answers fill them)')
  // renderAnswerBlock must not add a redundant "Expected answer:" block
  ok(!out.includes('Expected answer:'), 'fill_blanks scheme mode: no redundant "Expected answer:" block')
}

// ─── B3 — answer-space, sub-parts, defaults ──────────────────────────────────

console.log('\nB3 — answer space + sub-parts + defaults')

{
  // answerFormat 'none' → no lines at all. Use the HTML attribute form so the
  // CSS rule .answer-line { … } in the <style> block doesn't produce a false positive.
  const out = html({}, [makeQ({
    type: 'short_answer',
    answerFormat: 'none',
  })])
  ok(!out.includes('class="answer-line"'), 'answerFormat "none": no ruled lines printed')
}

{
  // labelled_blanks
  const out = html({}, [makeQ({
    type: 'short_answer',
    answerFormat: 'labelled_blanks',
    blankLabels: ['P', 'Q', 'R'],
  })])
  ok(out.includes('labelled-blank-row'), 'labelled_blanks: blank rows rendered')
  ok(out.includes('blank-label'), 'labelled_blanks: label spans present')
  ok(out.includes('P:'), 'labelled_blanks: label P present')
  ok(out.includes('Q:'), 'labelled_blanks: label Q present')
  ok(out.includes('R:'), 'labelled_blanks: label R present')
}

{
  // answerLines: 0 — explicit zero means no ruled space. Use the HTML attribute form
  // so the CSS rule .answer-line { … } doesn't produce a false positive.
  const out = html({}, [makeQ({
    type: 'short_answer',
    answerLines: 0,
  })])
  ok(!out.includes('class="answer-line"'), 'answerLines 0: no ruled lines (not coerced to 1)')
}

{
  // Essay default: must use DEFAULT_ANSWER_LINES.essay (= 8), not a hard-coded 10
  const out = html({}, [makeQ({ type: 'essay' })])
  const lineCount = (out.match(/class="answer-line"/g) || []).length
  ok(lineCount === DEFAULT_ANSWER_LINES.essay,
    `essay default: ${lineCount} lines === DEFAULT_ANSWER_LINES.essay (${DEFAULT_ANSWER_LINES.essay})`)
}

{
  // Short-answer default: DEFAULT_ANSWER_LINES.short (= 2)
  const out = html({}, [makeQ({ type: 'short_answer' })])
  const lineCount = (out.match(/class="answer-line"/g) || []).length
  ok(lineCount === DEFAULT_ANSWER_LINES.short,
    `short_answer default: ${lineCount} lines === DEFAULT_ANSWER_LINES.short (${DEFAULT_ANSWER_LINES.short})`)
}

{
  // Sub-parts: "(a) part sentence [marks]" rows
  const out = html({}, [makeQ({
    type: 'short_answer',
    subParts: [
      { text: 'Name the organ labelled P.', answer: 'heart', marks: 1, answerFormat: 'inline' },
      { text: 'State its function.', answer: 'pumps blood', marks: 2, answerFormat: 'lines', answerLines: 3 },
      { text: 'On the diagram.', answer: '', marks: 1, answerFormat: 'none' },
    ],
  })])
  ok(out.includes('subparts'), 'sub-parts: .subparts container rendered')
  ok(out.includes('subpart-row'), 'sub-parts: .subpart-row elements present')
  ok(out.includes('(a)'), 'sub-parts: first part labelled "(a)"')
  ok(out.includes('(b)'), 'sub-parts: second part labelled "(b)"')
  ok(out.includes('(c)'), 'sub-parts: third part labelled "(c)"')
  ok(out.includes('subpart-gap'), 'sub-parts inline format: .subpart-gap blank rendered')
  ok(out.includes('subpart-lines'), 'sub-parts lines format: .subpart-lines block rendered')
}

{
  // Sub-parts scheme mode: answer block shows "(a) answer (b) answer" pairs
  const out = html({}, [makeQ({
    type: 'short_answer',
    showAnswer: true,
    subParts: [
      { text: 'What is the organ?', answer: 'heart', marks: 1, answerFormat: 'inline' },
      { text: 'Describe its function.', answer: 'pumps blood', marks: 2, answerFormat: 'lines' },
    ],
  })], 'scheme')
  ok(out.includes('answer-block'), 'sub-parts scheme mode: answer-block div rendered')
  ok(out.includes('Answers:'), 'sub-parts scheme mode: "Answers:" label present')
  ok(out.includes('(a)'), 'sub-parts scheme mode: (a) pair present')
  ok(out.includes('heart'), 'sub-parts scheme mode: first answer text present')
  ok(out.includes('pumps blood'), 'sub-parts scheme mode: second answer text present')
}

// ─── Smoke — MCQ, matching, sequence don't crash ─────────────────────────────

console.log('\nSmoke — other question types')

{
  const out = html({}, [
    makeQ({ id: 'q1', order: 0, type: 'mcq', options: ['A', 'B', 'C', 'D'], correctAnswer: 2 }),
    makeQ({ id: 'q2', order: 1, type: 'matching',
      matchingLeft: ['Dog', 'Bird'], matchingRight: ['Bark', 'Sing'], matchingAnswer: [0, 1] }),
    makeQ({ id: 'q3', order: 2, type: 'sequence',
      sequenceItems: ['First', 'Second', 'Third'], sequenceAnswer: [1, 2, 3] }),
  ])
  ok(out.includes('options-text'), 'MCQ: options-text grid rendered')
  ok(out.includes('match-columns'), 'matching: match-columns rendered')
  ok(out.includes('seq-list'), 'sequence: seq-list rendered')
  ok(!out.includes('undefined'), 'no "undefined" strings leaked into output')
  ok(!out.includes('[object Object]'), 'no "[object Object]" leaked into output')
}

// ─── B4: figure labels — leader lines and collisions (§4.2) ──────────────────
//
// The print window drew the label pills and SILENTLY DROPPED the leader lines
// the preview and the Word export both draw, so a labelled diagram printed with
// labels floating and nothing pointing at the part. Nothing anywhere separated
// two labels dropped on the same spot either — they printed on top of each
// other. Both now come from the shared resolver, so all three renderers agree.

console.log('\nB4 — figure labels')
{
  const out = html({}, [makeQ({
    id: 'q1', order: 0, type: 'diagram', text: 'Name the parts.',
    imageUrl: 'https://example.test/heart.png',
    diagramMode: 'labeled',
    diagramLabels: [{ x: 0.25, y: 0.5, tx: 0.85, ty: 0.5, text: 'Aorta' }],
  })])
  ok(out.includes('<svg class="diagram-leaders"'), 'a leader-line layer is emitted at all')
  const line = /<line x1="([\d.]+)%" y1="[\d.]+%" x2="([\d.]+)%"/.exec(out)
  ok(Boolean(line), 'the leader line is drawn')
  if (line) {
    ok(Number(line[1]) > 25, `it starts outside the pill, toward the part (x1=${line[1]}%)`)
    ok(Math.abs(Number(line[2]) - 85) < 0.1, 'and ends exactly on the part')
  }
  ok(out.includes('<circle'), 'with a tip dot on the part')
}
{
  const out = html({}, [makeQ({
    id: 'q1', order: 0, type: 'diagram', text: 'Name the parts.',
    imageUrl: 'https://example.test/heart.png',
    diagramMode: 'labeled',
    diagramLabels: [{ x: 0.5, y: 0.5, text: 'Atrium' }, { x: 0.5, y: 0.5, text: 'Ventricle' }],
  })])
  const tops = [...out.matchAll(/class="diagram-label" style="left:([\d.]+)%;top:([\d.]+)%"/g)]
    .map(m => `${m[1]},${m[2]}`)
  ok(tops.length === 2, 'both pills are printed')
  ok(tops[0] !== tops[1], `and they no longer print at the same spot (${tops.join(' / ')})`)
}
{
  // A diagram whose labels carry no target keeps printing exactly as before —
  // this change must not start drawing lines on papers that never had them.
  const out = html({}, [makeQ({
    id: 'q1', order: 0, type: 'diagram', text: 'Name the parts.',
    imageUrl: 'https://example.test/heart.png',
    diagramMode: 'labeled',
    diagramLabels: [{ x: 0.2, y: 0.2, text: 'Aorta' }, { x: 0.8, y: 0.8, text: 'Apex' }],
  })])
  // (the stylesheet always carries the .diagram-leaders rule — look for the markup)
  ok(!out.includes('<svg class="diagram-leaders"'), 'no targets and no collisions → no leader layer')
  ok(out.includes('>Aorta<') && out.includes('>Apex<'), 'the labels still print')
}

// ─── Result ───────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll assessmentToPdf tests passed.')
