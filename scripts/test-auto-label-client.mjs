/**
 * Tests for the auto-label client decisions (Visual Studio v2 1C): proposal →
 * canvas-label mapping in reading order, confidence flags, and the honest
 * result messaging.
 */
import assert from 'node:assert'
import {
  proposalsToCanvasObjects, isLowConfidence, lowConfidenceCount,
  autoLabelResultMessage, LOW_CONFIDENCE_FALLBACK,
} from '../src/features/visualStudio/lib/autoLabelClient.js'

// Proposals map to plain canvas label objects in READING order, so the
// canvas's array-order lettering gives P to the topmost part.
{
  let n = 0
  const objs = proposalsToCanvasObjects([
    { word: 'Roots', anchor: { x: 0.5, y: 0.9 }, confidence: 0.9 },
    { word: 'Leaf', anchor: { x: 0.5, y: 0.1 }, confidence: 0.65 },
    { word: '  ', anchor: { x: 0.2, y: 0.2 } },     // blank word dropped
    { word: 'NoAnchor' },                            // no anchor dropped
  ], { makeId: () => `id-${n += 1}` })
  assert.equal(objs.length, 2)
  assert.deepEqual(objs.map((o) => o.text), ['Leaf', 'Roots'], 'reading order (top first)')
  assert.equal(objs[0].type, 'label')
  assert.equal(objs[0].x, 0.5)
  assert.equal(objs[0].y, 0.1)
  assert.equal(objs[0].confidence, 0.65)
  assert.equal(objs[0].id, 'id-1')
}

// Confidence flag: only labels with a numeric confidence under the threshold.
assert.equal(isLowConfidence({ type: 'label', confidence: 0.5 }), true)
assert.equal(isLowConfidence({ type: 'label', confidence: 0.9 }), false)
assert.equal(isLowConfidence({ type: 'label' }), false, 'manual label (no confidence) never flagged')
assert.equal(isLowConfidence({ type: 'text', confidence: 0.1 }), false)
assert.equal(isLowConfidence({ type: 'label', confidence: 0.75 }, 0.8), true, 'server threshold wins')
assert.equal(LOW_CONFIDENCE_FALLBACK, 0.7)

assert.equal(lowConfidenceCount([
  { type: 'label', confidence: 0.4 },
  { type: 'label', confidence: 0.95 },
  { type: 'label' },
]), 1)

// Result messaging is honest: failure, empty, low-confidence and ungrounded
// states are all said out loud.
assert.match(autoLabelResultMessage({ failed: true }), /add labels manually/i)
assert.match(autoLabelResultMessage({ added: 0 }), /No parts found/i)
{
  const msg = autoLabelResultMessage({ added: 5, grounded: true, lowCount: 0 })
  assert.match(msg, /5 labels proposed/)
  assert.doesNotMatch(msg, /amber|textbook/)
}
{
  const msg = autoLabelResultMessage({ added: 3, grounded: false, lowCount: 2 })
  assert.match(msg, /2 marked amber/)
  assert.match(msg, /check the words against the textbook/)
}
assert.match(autoLabelResultMessage({ added: 1 }), /1 label proposed/, 'singular form')

console.log('test-auto-label-client: all assertions passed')
