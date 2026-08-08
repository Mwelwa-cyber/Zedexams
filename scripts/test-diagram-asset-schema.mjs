/**
 * Tests for the diagramAssets schemas (Visual Studio v2, spec 1A):
 * strict write validation, letter-stripping (letters are NEVER stored),
 * and the permissive read coercer including legacy-label upgrade.
 */
import assert from 'node:assert'
import {
  diagramAssetWriteSchema, diagramAssetUpdateSchema, coerceDiagramAsset,
  DIAGRAM_ART_TYPES, DIAGRAM_PROVENANCES, MAX_DIAGRAM_LABELS,
} from '../src/schemas/diagramAsset.js'

const base = {
  createdBy: 'uid-1',
  title: 'Digestive system',
  art: { type: 'raster', storagePath: 'visual-studio/uid-1/a.png', url: 'https://x/a.png' },
  labels: [
    { id: 'l1', word: 'Stomach', anchor: { x: 0.4, y: 0.5 }, box: { x: 0.9, y: 0.5 }, confidence: 0.92 },
    { id: 'l2', word: 'Liver', anchor: { x: 0.35, y: 0.3 }, box: { x: 0.1, y: 0.3 } },
  ],
  subject: 'Integrated Science',
  grade: '7',
  topic: 'The digestive system',
}

// A valid asset parses, and defaults fill in.
{
  const parsed = diagramAssetWriteSchema.parse(base)
  assert.equal(parsed.status, 'draft')
  assert.equal(parsed.scope, 'private')
  assert.equal(parsed.style, 'bw-line')
  assert.equal(parsed.provenance, 'ai-generated')
  assert.equal(parsed.version, 1)
  assert.deepEqual(parsed.followUpQuestions, [])
  assert.equal(parsed.labels.length, 2)
  assert.equal(parsed.labels[0].confidence, 0.92)
  assert.equal(parsed.labels[1].confidence, undefined)
}

// Letters must NEVER be stored — a stray `letter` field on a label is
// stripped on write (letters are a render-time projection of reading order).
{
  const parsed = diagramAssetWriteSchema.parse({
    ...base,
    labels: [{ id: 'l1', word: 'Stomach', letter: 'P', anchor: { x: 0.4, y: 0.5 }, box: { x: 0.9, y: 0.5 } }],
  })
  assert.equal('letter' in parsed.labels[0], false, 'letter stripped from stored label')
}

// Out-of-range coordinates are refused (normalized 0–1 is the contract).
{
  const bad = diagramAssetWriteSchema.safeParse({
    ...base,
    labels: [{ id: 'l1', word: 'Stomach', anchor: { x: 1.4, y: 0.5 }, box: { x: 0.9, y: 0.5 } }],
  })
  assert.equal(bad.success, false, 'anchor.x > 1 refused')
}

// Missing required fields fail.
assert.equal(diagramAssetWriteSchema.safeParse({ ...base, title: '' }).success, false)
assert.equal(diagramAssetWriteSchema.safeParse({ ...base, createdBy: '' }).success, false)
assert.equal(diagramAssetWriteSchema.safeParse({ ...base, art: { type: 'video' } }).success, false)

// Label cap enforced.
{
  const many = Array.from({ length: MAX_DIAGRAM_LABELS + 1 }, (_, i) => ({
    id: `l${i}`, word: 'part', anchor: { x: 0.5, y: 0.5 }, box: { x: 0.5, y: 0.5 },
  }))
  assert.equal(diagramAssetWriteSchema.safeParse({ ...base, labels: many }).success, false)
}

// Template art round-trips its params (art.type:'template' stays editable).
{
  const parsed = diagramAssetWriteSchema.parse({
    ...base,
    art: { type: 'template', templateId: 'clock-face', params: { hour: 3, minute: 30 } },
  })
  assert.equal(parsed.art.templateId, 'clock-face')
  assert.deepEqual(parsed.art.params, { hour: 3, minute: 30 })
}

// Variant bookkeeping (spec 3E) validates; unknown kind refused.
{
  const ok = diagramAssetWriteSchema.parse({ ...base, familyId: 'fam1', variantOf: 'a1', variantKind: 'simpler' })
  assert.equal(ok.variantKind, 'simpler')
  assert.equal(diagramAssetWriteSchema.safeParse({ ...base, variantKind: 'shinier' }).success, false)
}

// Update schema is a partial — a label-only patch validates.
{
  const patch = diagramAssetUpdateSchema.parse({ labels: base.labels, version: 2 })
  assert.equal(patch.version, 2)
  assert.equal(patch.title, undefined)
}

// History stages carry label+param snapshots (spec 3D).
{
  const parsed = diagramAssetWriteSchema.parse({
    ...base,
    history: [{
      stage: 'ai-labelled', label: 'AI labelled',
      snapshot: { labels: base.labels, params: {} }, at: 1, by: 'uid-1',
    }],
  })
  assert.equal(parsed.history[0].stage, 'ai-labelled')
  assert.equal(parsed.history[0].snapshot.labels.length, 2)
}

// ── Read coercer ────────────────────────────────────────────────────────────

// Never throws; fills sane defaults on junk.
assert.equal(coerceDiagramAsset(null), null)
assert.equal(coerceDiagramAsset('nope'), null)
{
  const c = coerceDiagramAsset({})
  assert.equal(c.title, 'Untitled diagram')
  assert.equal(c.art.type, 'raster')
  assert.deepEqual(c.labels, [])
  assert.equal(c.status, 'draft')
  assert.equal(c.scope, 'private')
  assert.equal(c.version, 1)
}

// Legacy Visual-Studio-v1 labels ({ text, x, y }) upgrade to the v2 shape:
// text → word, x/y → anchor, box defaults onto the anchor.
{
  const c = coerceDiagramAsset({
    labels: [{ id: 'a', text: 'Trachea', x: 0.3, y: 0.2, letter: 'P' }],
  })
  assert.equal(c.labels[0].word, 'Trachea')
  assert.deepEqual(c.labels[0].anchor, { x: 0.3, y: 0.2 })
  assert.deepEqual(c.labels[0].box, { x: 0.3, y: 0.2 })
  assert.equal('letter' in c.labels[0], false, 'legacy letter dropped on read')
}

// Coordinates clamp (not throw) on read; confidence clamps to 0..1.
{
  const c = coerceDiagramAsset({
    labels: [{ word: 'Leaf', anchor: { x: 7, y: -2 }, box: { x: 0.5, y: 0.5 }, confidence: 3 }],
  })
  assert.deepEqual(c.labels[0].anchor, { x: 1, y: 0 })
  assert.equal(c.labels[0].confidence, 1)
}

// Follow-up questions coerce; blank ones drop.
{
  const c = coerceDiagramAsset({
    followUpQuestions: [{ text: 'Name part P.', marks: 2 }, { text: '' }, 'junk'],
  })
  assert.equal(c.followUpQuestions.length, 1)
  assert.deepEqual(c.followUpQuestions[0], { text: 'Name part P.', marks: 2 })
}

// Enum exports stay in the shapes consumers rely on.
assert.deepEqual(DIAGRAM_ART_TYPES, ['raster', 'svg', 'template'])
assert.ok(DIAGRAM_PROVENANCES.includes('bank'))

console.log('test-diagram-asset-schema: all assertions passed')
