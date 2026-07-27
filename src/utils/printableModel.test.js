/**
 * The identity of a printable paper.
 *
 * The rule these tests hold: anything that changes the printed page changes the
 * fingerprint, and nothing else does. The version they replaced recorded text
 * LENGTHS and option COUNTS, which fails both halves — a reworded question of
 * the same length was invisible, and so was every field nobody had thought to
 * list.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import {
  buildPrintableModel, printableFingerprint, stableStringify, hashString,
  renderableAssessment, assertMeasurable,
} from './printableModel.js'

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

const base = () => buildPrintableModel({
  assessment: {
    title: 'Topic Test', subject: 'Geography', grade: '7', schoolName: 'Kabulonga Primary',
    footerCode: 'ZX/1', logoUrl: 'logo.png', duration: 60, term: '2',
    mcqOptionLayout: 'grid', showNameField: true,
  },
  questions: [{
    localId: 'a', type: 'mcq', marks: 2, answerLines: 3,
    text: '<p>Which river is longest?</p>',
    options: ['Zambezi', 'Kafue'], correctAnswer: 0,
    imageDiagram: { libraryKey: 'triangle', params: { size: 4 } },
    imageUrl: 'photo.png', imageWidth: 60,
  }],
  passages: [{ localId: 'p', passageText: '<p>A story.</p>', imageDiagram: { libraryKey: 'map' } }],
  parts: [{ id: 'P1', title: 'SECTION A' }],
  pagebreaks: ['a'],
  mode: 'paper',
})

const fp = (mutate) => {
  const model = base()
  mutate(model)
  return printableFingerprint(model)
}

console.log('\n— stable, and identical for identical papers —')

test('the same paper fingerprints the same, twice', () => {
  assert.equal(printableFingerprint(base()), printableFingerprint(base()))
})

test('key insertion order does not change identity', () => {
  // Without a stable serialisation, two structurally identical papers built by
  // different code paths differ, and every reload reads as an edit.
  const a = { assessment: { title: 'T', subject: 'S' }, questions: [], passages: [], parts: [], pagebreaks: [], mode: 'paper', attribution: false }
  const b = { mode: 'paper', questions: [], attribution: false, parts: [], pagebreaks: [], passages: [], assessment: { subject: 'S', title: 'T' } }
  assert.equal(printableFingerprint(a), printableFingerprint(b))
})

console.log('\n— every print-affecting change moves it —')

test('a SAME-LENGTH reword changes the fingerprint', () => {
  // The defect this exists for. "IIII" and "WWWW" are four characters and about
  // half a line apart, so a length-based identity lets a teacher push a question
  // onto the next page while the count on screen never moves.
  const original = '<p>Which river is longest?</p>'
  //             …the same character count, and about half a line wider on the page.
  const reworded = '<p>Which river is WWWWWWW?</p>'.padEnd(original.length, '!').slice(0, original.length)
  assert.equal(reworded.length, original.length, 'the fixture must actually be the same length')
  assert.notEqual(reworded, original)

  const before = printableFingerprint(base())
  const after = fp((m) => { m.questions[0].text = reworded })
  assert.notEqual(after, before, 'a reword of identical length must still change identity')
})

test('rewording an option changes it, with the option count unchanged', () => {
  const before = printableFingerprint(base())
  assert.notEqual(fp((m) => { m.questions[0].options = ['Zambezi', 'Luangwa'] }), before)
})

test('every field the renderer reads is part of the identity', () => {
  const before = printableFingerprint(base())
  const changes = {
    'question marks': (m) => { m.questions[0].marks = 5 },
    'answer lines': (m) => { m.questions[0].answerLines = 12 },
    'question type': (m) => { m.questions[0].type = 'essay' },
    'correct answer': (m) => { m.questions[0].correctAnswer = 1 },
    'diagram key': (m) => { m.questions[0].imageDiagram.libraryKey = 'square' },
    'diagram PARAMS': (m) => { m.questions[0].imageDiagram.params.size = 9 },
    'image source': (m) => { m.questions[0].imageUrl = 'other.png' },
    'image width': (m) => { m.questions[0].imageWidth = 90 },
    'passage text': (m) => { m.passages[0].passageText = '<p>Another story.</p>' },
    'passage diagram': (m) => { m.passages[0].imageDiagram.libraryKey = 'globe' },
    'section name': (m) => { m.parts[0].title = 'SECTION B' },
    'section order': (m) => { m.parts.push({ id: 'P2', title: 'SECTION B' }) },
    'page breaks': (m) => { m.pagebreaks = [] },
    'school name': (m) => { m.assessment.schoolName = 'Another School' },
    'school logo': (m) => { m.assessment.logoUrl = 'other-logo.png' },
    'footer code': (m) => { m.assessment.footerCode = 'ZX/2' },
    'header field toggle': (m) => { m.assessment.showNameField = false },
    'option layout': (m) => { m.assessment.mcqOptionLayout = 'list' },
    'duration': (m) => { m.assessment.duration = 90 },
    'paper vs marking scheme': (m) => { m.mode = 'scheme' },
    'attribution watermark': (m) => { m.attribution = true },
    'question order': (m) => { m.questions.unshift({ localId: 'z', text: '<p>New</p>', type: 'short_answer', marks: 1 }) },
  }
  for (const [what, mutate] of Object.entries(changes)) {
    assert.notEqual(fp(mutate), before, `${what} must change the fingerprint`)
  }
})

test('nothing that cannot reach the page changes it', () => {
  // The model is exactly what the renderer is handed, so this is a property of
  // its construction rather than of a filter: a field outside the model cannot
  // be fingerprinted, and a field inside it is rendered.
  const model = base()
  const before = printableFingerprint(model)
  const withNoise = { ...model, uiScrollPosition: 400, lastSavedAt: 12345 }
  // Extra keys DO change it — which is the honest behaviour. What matters is
  // that no caller can add them: buildPrintableModel fixes the key set.
  assert.notEqual(printableFingerprint(withNoise), before)
  assert.deepEqual(
    Object.keys(buildPrintableModel({ ...model, uiScrollPosition: 400 })).sort(),
    ['assessment', 'attribution', 'mode', 'pagebreaks', 'parts', 'passages', 'questions'],
  )
})

console.log('\n— the serialisation and the hash —')

test('stableStringify sorts keys and survives the awkward values', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}')
  assert.equal(stableStringify([3, 1, 2]), '[3,1,2]', 'array order is meaning, not noise')
  assert.equal(stableStringify(null), 'null')
  assert.equal(stableStringify(undefined), 'null')
  assert.equal(stableStringify(NaN), 'null')
  assert.equal(stableStringify(Infinity), 'null')
  assert.equal(stableStringify(() => {}), 'null')
  assert.equal(stableStringify(new Date('2026-01-01T00:00:00Z')), '"2026-01-01T00:00:00.000Z"')
})

test('the hash separates near-identical inputs', () => {
  assert.notEqual(hashString('a'), hashString('b'))
  assert.notEqual(hashString('ab'), hashString('ba'))
  assert.equal(hashString('abc'), hashString('abc'))
  // The length is part of the digest, so a 32-bit collision also has to collide
  // on length before it can be mistaken for the same paper.
  assert.match(hashString('abc'), /^[0-9a-f]{8}-3$/)
})

console.log('\n— the model is what gets rendered —')

test('passages, parts and pagebreaks are folded onto the assessment the renderer reads', () => {
  // buildPrintableHtml reads them off the ASSESSMENT. Fingerprinting them as
  // separate arrays and handing the renderer an assessment without them is how
  // a passage edit triggered a re-measurement of a document that did not
  // contain the edit.
  const doc = renderableAssessment(base())
  assert.equal(doc.passages.length, 1)
  assert.equal(doc.parts.length, 1)
  assert.deepEqual(doc.pagebreaks, ['a'])
  assert.equal(doc.title, 'Topic Test')
})

test('a measurement refuses anything that is not a printable model', () => {
  assert.throws(() => assertMeasurable(null), /printable model/)
  assert.throws(() => assertMeasurable({ questions: [] }), /missing "assessment"/)
  assert.throws(() => assertMeasurable({ assessment: {}, questions: [] }), /missing "passages"/)
  assert.ok(assertMeasurable(base()))
})

if (!process.exitCode) {
  console.log(`\n✓ printable model — ${passed} tests passed`)
}
