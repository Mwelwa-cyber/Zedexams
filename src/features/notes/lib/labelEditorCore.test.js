// Run: npm run test:label-editor-core  (also via npm run test:all)
//
// The geometry behind the label-the-diagram editor, plus the two list rules
// every list editor relies on. Plain node, like the other notes/lib tests.

import assert from 'node:assert/strict'
import {
  clamp01, pointToFraction, nextItemKey, nudge, labelDiagramIssues, moveInList,
} from './labelEditorCore.js'
import {
  collectKeywordMarks, missingGlossaryWords, newStudyBlock, STUDY_BLOCK_TYPES,
} from './studyBlocks.js'
import { isValidStudyBlock, coerceStudyBlocks } from './studySchema.js'

let pass = 0
function test(name, fn) {
  try { fn(); pass += 1; console.log(`  ok  ${name}`) }
  catch (err) { console.error(`  XX  ${name} — ${err.message}`); process.exitCode = 1 }
}

console.log('\nlabel editor core')

test('clamp01 keeps values inside the image and rounds to 3 places', () => {
  assert.equal(clamp01(-0.4), 0)
  assert.equal(clamp01(1.7), 1)
  assert.equal(clamp01(0.12345), 0.123)
  assert.equal(clamp01('nope'), 0)
})

test('pointToFraction maps a click to a fraction of the image box', () => {
  const rect = { left: 100, top: 50, width: 200, height: 400 }
  assert.deepEqual(pointToFraction(rect, 200, 250), { x: 0.5, y: 0.5 })
  assert.deepEqual(pointToFraction(rect, 100, 50), { x: 0, y: 0 })
})

test('pointToFraction clamps a drag that leaves the picture', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 }
  assert.deepEqual(pointToFraction(rect, -50, 900), { x: 0, y: 1 })
})

test('pointToFraction refuses an unlaid-out image instead of returning NaN', () => {
  assert.equal(pointToFraction({ left: 0, top: 0, width: 0, height: 0 }, 5, 5), null)
  assert.equal(pointToFraction(null, 5, 5), null)
})

test('nextItemKey never reuses a key already on the diagram', () => {
  assert.equal(nextItemKey([]), 'p1')
  assert.equal(nextItemKey([{ key: 'p2' }, { key: 'p3' }]), 'p4')
  const items = [{ key: 'p3' }, { key: 'a' }]
  assert.ok(!items.some((i) => i.key === nextItemKey(items)))
})

test('nudge stays inside the picture', () => {
  assert.equal(nudge(0.999, 0.02), 1)
  assert.equal(nudge(0.005, -0.02), 0)
})

test('labelDiagramIssues explains what is missing', () => {
  const ok = { url: 'x.png', items: [{ label: 'Mouth' }, { label: 'Liver' }] }
  assert.deepEqual(labelDiagramIssues(ok), [])
  assert.ok(labelDiagramIssues({ ...ok, url: '' }).length === 1)
  assert.ok(labelDiagramIssues({ ...ok, items: [{ label: 'Mouth' }] }).some((m) => /two labels/.test(m)))
  assert.ok(labelDiagramIssues({ ...ok, items: [{ label: 'Mouth' }, { label: ' mouth ' }] }).some((m) => /twice/.test(m)))
  assert.ok(labelDiagramIssues({ ...ok, items: [{ label: 'Mouth' }, { label: '' }] }).some((m) => /needs a word/.test(m)))
})

test('moveInList swaps neighbours and ignores moves off either end', () => {
  assert.deepEqual(moveInList(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c'])
  assert.deepEqual(moveInList(['a', 'b', 'c'], 2, 1), ['a', 'b', 'c'])
  assert.deepEqual(moveInList(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c'])
})

console.log('\nkeyword marks')

test('collectKeywordMarks finds [[words]] in every text field, once each', () => {
  const blocks = [
    { type: 'paragraph', text: '[[Digestion]] turns food into **nutrients**; [[gut]] too.' },
    { type: 'tip', lines: ['Say [[digestion]] slowly.'] },
    { type: 'flow', steps: [{ text: 'Chew', note: 'the [[saliva]] helps' }] },
  ]
  assert.deepEqual(collectKeywordMarks(blocks), ['Digestion', 'gut', 'saliva'])
})

test('collectKeywordMarks ignores the glossary block itself', () => {
  const blocks = [{ type: 'glossary', entries: [{ word: 'gut', meaning: 'see [[alimentary canal]]' }] }]
  assert.deepEqual(collectKeywordMarks(blocks), [])
})

test('missingGlossaryWords lists marked words with no entry, matching like the reader does', () => {
  const blocks = [
    { type: 'paragraph', text: '[[Digestion]] and [[gut]] and [[Either … or]]' },
    { type: 'glossary', entries: [{ word: 'digestion', meaning: 'm' }, { word: 'either … or', meaning: 'm' }] },
  ]
  assert.deepEqual(missingGlossaryWords(blocks), ['gut'])
})

console.log('\nblock validity')

test('every type in the add-a-block menu is valid when freshly added', () => {
  for (const type of STUDY_BLOCK_TYPES) {
    assert.ok(isValidStudyBlock(newStudyBlock(type)), `${type} starts invalid`)
  }
})

test('isValidStudyBlock agrees with what coerceStudyBlocks would keep', () => {
  const good = newStudyBlock('labeldiagram')
  const bad = { ...newStudyBlock('labeldiagram'), items: [{ key: 'a', label: 'Only one', x: 0.1, y: 0.1 }] }
  assert.equal(isValidStudyBlock(good), true)
  assert.equal(isValidStudyBlock(bad), false)
  assert.equal(coerceStudyBlocks([good, bad]).length, 1)
  assert.equal(isValidStudyBlock(null), false)
  assert.equal(isValidStudyBlock({ type: 'nope' }), false)
})

console.log(`\n${pass} passed`)
