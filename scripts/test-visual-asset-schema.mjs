/**
 * Tests for the visualAssets Zod schema + read coercer.
 */
import assert from 'node:assert'
import {
  visualAssetWriteSchema, coerceVisualAsset,
  VISUAL_STATUSES, VISUAL_VISIBILITIES,
} from '../src/shared/schemas/visualAsset.js'

// Minimal valid write applies sensible defaults.
const ok = visualAssetWriteSchema.safeParse({
  createdBy: 'u1', title: 'Respiratory diagram', imageUrl: 'https://x/y.png',
})
assert.ok(ok.success, ok.success ? '' : JSON.stringify(ok.error.issues))
assert.equal(ok.data.status, 'draft')
assert.equal(ok.data.visibility, 'private')
assert.equal(ok.data.sourceType, 'ai')
assert.equal(ok.data.isBlackAndWhite, true)
assert.deepEqual(ok.data.labels, [])

// createdBy + title are required.
assert.equal(visualAssetWriteSchema.safeParse({ title: 'x', createdBy: '' }).success, false)
assert.equal(visualAssetWriteSchema.safeParse({ createdBy: 'u', title: '' }).success, false)

// Bad enum is rejected.
assert.equal(
  visualAssetWriteSchema.safeParse({ createdBy: 'u', title: 't', status: 'bogus' }).success,
  false,
)

// Labels validate and cap.
const withLabels = visualAssetWriteSchema.safeParse({
  createdBy: 'u', title: 't',
  labels: [{ id: 'l1', letter: 'P', text: 'Nose', x: 0.2, y: 0.4 }],
})
assert.ok(withLabels.success)
assert.equal(withLabels.data.labels[0].letter, 'P')

// Coercer never throws and clamps label ratios + normalises bad enums.
const c = coerceVisualAsset({
  id: '1', title: '', status: 'weird', visibility: 'nope',
  labels: [{ id: 'l', letter: 'P', text: 'Nose', x: 2, y: -1 }],
})
assert.equal(c.title, 'Untitled visual')
assert.equal(c.labels[0].x, 1, 'x clamped to 1')
assert.equal(c.labels[0].y, 0, 'y clamped to 0')
assert.equal(c.status, 'draft')
assert.equal(c.visibility, 'private')
assert.equal(c.isBlackAndWhite, true)
assert.equal(coerceVisualAsset(null), null)
assert.equal(coerceVisualAsset('x'), null)

// Exported enum lists are sane.
assert.ok(VISUAL_STATUSES.includes('published'))
assert.ok(VISUAL_VISIBILITIES.includes('public'))

console.log('✓ visual-asset-schema tests passed')
