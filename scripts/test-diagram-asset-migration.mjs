/**
 * Tests for the legacy → Diagram Library migration mapping (Visual Studio v2
 * 1A): pictureBank/visualAssets → diagramAssets, deterministic idempotent
 * target ids, letter-dropping label upgrade, and write-schema compatibility
 * of everything the plan would file.
 */
import assert from 'node:assert'
import {
  migrationDocId, gradeFromBand, pictureBankToDiagramAsset,
  visualAssetToDiagramAsset, planDiagramAssetMigration,
} from '../src/features/visualStudio/lib/diagramAssetMigration.js'
import { diagramAssetWriteSchema } from '../src/schemas/diagramAsset.js'

// Deterministic target ids — the idempotency key.
assert.equal(migrationDocId('pictureBank', 'abc'), 'mig-pb-abc')
assert.equal(migrationDocId('visualAssets', 'abc'), 'mig-va-abc')

// Grade band parsing.
assert.equal(gradeFromBand('G4'), '4')
assert.equal(gradeFromBand('g12'), '12')
assert.equal(gradeFromBand('7'), '7')
assert.equal(gradeFromBand('Form 2'), '')
assert.equal(gradeFromBand(null), '')

// pictureBank → active pictures stay public (already admin-curated).
{
  const d = pictureBankToDiagramAsset({
    id: 'p1', name: ' Maize plant ', url: 'https://x/p1.png', storagePath: 'picture-bank/p1.png',
    subject: 'science', gradeBand: 'G4', status: 'active', createdBy: 'admin',
    keywords: ['maize', 'plant'],
  })
  assert.equal(d.title, 'Maize plant')
  assert.equal(d.art.type, 'raster')
  assert.equal(d.provenance, 'bank')
  assert.equal(d.scope, 'public')
  assert.equal(d.status, 'approved')
  assert.equal(d.grade, '4')
  assert.deepEqual(d.labels, [])
  assert.equal(d.migratedFrom, 'pictureBank/p1')
  assert.ok(diagramAssetWriteSchema.safeParse(d).success, 'mapped doc passes the write schema')
}

// Staged pictures arrive as private drafts; no art → null.
{
  const d = pictureBankToDiagramAsset({ id: 'p2', name: 'Staged', url: 'https://x/p2.png', status: 'staged', createdBy: 'uid-9' })
  assert.equal(d.scope, 'private')
  assert.equal(d.status, 'draft')
  assert.equal(pictureBankToDiagramAsset({ id: 'p3', name: 'No art', status: 'active' }), null)
}

// visualAssets → labels upgrade, letters dropped, box defaults onto anchor.
{
  const d = visualAssetToDiagramAsset({
    id: 'v1', createdBy: 'uid-1', title: 'Respiratory system',
    imageUrl: 'https://x/v1.png', storagePath: 'visual-studio/uid-1/v1.png',
    sourceType: 'upload', style: 'bw_test_diagram',
    labels: [
      { id: 'l1', letter: 'P', text: 'Trachea', x: 0.4, y: 0.3 },
      { letter: 'Q', text: '  Lungs ', x: 2, y: -1 },
    ],
  })
  assert.equal(d.provenance, 'uploaded')
  assert.equal(d.style, 'bw-line', 'legacy style name normalised')
  assert.equal(d.labels.length, 2)
  assert.equal(d.labels[0].word, 'Trachea')
  assert.deepEqual(d.labels[0].anchor, { x: 0.4, y: 0.3 })
  assert.deepEqual(d.labels[0].box, { x: 0.4, y: 0.3 })
  assert.equal('letter' in d.labels[0], false, 'letters are never stored')
  assert.equal(d.labels[1].word, 'Lungs')
  assert.deepEqual(d.labels[1].anchor, { x: 1, y: 0 }, 'out-of-range legacy coords clamp')
  assert.ok(d.labels[1].id, 'label with no id gets one')
  assert.equal(d.scope, 'private')
  assert.ok(diagramAssetWriteSchema.safeParse(d).success, 'mapped doc passes the write schema')
}

// Publicly shared visuals keep their approved public state.
{
  const d = visualAssetToDiagramAsset({
    id: 'v2', createdBy: 'uid-1', title: 'Shared', imageUrl: 'https://x/v2.png',
    visibility: 'public', status: 'approved', sourceType: 'ai',
  })
  assert.equal(d.scope, 'public')
  assert.equal(d.status, 'approved')
}

// planDiagramAssetMigration: idempotent by deterministic id; skip reasons.
{
  const sources = {
    pictureBank: [
      { id: 'p1', name: 'A', url: 'https://x/a.png', status: 'active', createdBy: 'admin' },
      { id: 'p2', status: 'active', createdBy: 'admin' }, // no art
      { name: 'no id', url: 'https://x/n.png' },
    ],
    visualAssets: [
      { id: 'v1', createdBy: 'uid-1', title: 'B', imageUrl: 'https://x/b.png' },
      { id: 'v2', title: 'no owner', imageUrl: 'https://x/c.png' },
    ],
  }
  const plan = planDiagramAssetMigration(sources)
  assert.deepEqual(plan.writes.map((w) => w.docId), ['mig-pb-p1', 'mig-va-v1'])
  assert.deepEqual(plan.skipped.map((s) => s.reason).sort(), ['no-art', 'no-id', 'no-owner'])

  // A re-run with the first run's output present writes nothing new…
  const rerun = planDiagramAssetMigration(sources, { existingIds: new Set(['mig-pb-p1', 'mig-va-v1']) })
  assert.equal(rerun.writes.length, 0)
  assert.ok(rerun.skipped.some((s) => s.reason === 'exists'))

  // …unless --overwrite, which targets the SAME ids (never siblings).
  const over = planDiagramAssetMigration(sources, { existingIds: new Set(['mig-pb-p1', 'mig-va-v1']), overwrite: true })
  assert.deepEqual(over.writes.map((w) => w.docId), ['mig-pb-p1', 'mig-va-v1'])
}

console.log('test-diagram-asset-migration: all assertions passed')
