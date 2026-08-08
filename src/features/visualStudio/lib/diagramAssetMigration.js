/**
 * Legacy → Diagram Library migration mapping (Visual Studio v2 spec 1A — pure).
 *
 * Maps the two legacy stores onto `diagramAssets` docs:
 *   • `pictureBank/{id}` (admin-curated shared bank) → art + EMPTY labels +
 *     inferred metadata, provenance 'bank'.
 *   • `visualAssets/{id}` (a teacher's baked "My Visuals") → art + upgraded
 *     labels (v1 `{ letter, text, x, y }` → v2 `{ word, anchor, box }`;
 *     letters are DROPPED — they are a render-time projection).
 *
 * Idempotency is by construction: the target doc id is a pure function of the
 * source (`migrationDocId`), so re-running the migration overwrites the same
 * docs rather than minting siblings, and `migratedFrom` records provenance.
 * The admin-SDK script (scripts/migrate-diagram-assets.mjs) owns all I/O;
 * this module tests under plain `node`.
 */

/** Deterministic target doc id for a source doc — the idempotency key. */
export function migrationDocId(sourceCollection, sourceId) {
  const prefix = sourceCollection === 'pictureBank' ? 'pb' : 'va'
  return `mig-${prefix}-${String(sourceId)}`
}

function clamp01(v, fallback = 0.5) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(1, n))
}

/** 'G4' / 'g4' / '4' / 4 → '4'; anything unparseable → ''. */
export function gradeFromBand(gradeBand) {
  const m = String(gradeBand == null ? '' : gradeBand).trim().match(/^g?\s*(\d{1,2})$/i)
  return m ? m[1] : ''
}

const VISUAL_SOURCE_TO_PROVENANCE = {
  ai: 'ai-generated',
  upload: 'uploaded',
  template: 'template',
  clipart: 'bank',
}

/**
 * Map a pictureBank doc to a diagramAssets write payload.
 * Active bank pictures stay publicly readable (scope 'public' + status
 * 'approved' — they already passed admin curation); staged ones arrive as
 * private drafts. Returns null for a doc with no readable art.
 */
export function pictureBankToDiagramAsset(pic) {
  if (!pic || typeof pic !== 'object') return null
  const url = String(pic.url || '')
  const storagePath = String(pic.storagePath || '')
  if (!url && !storagePath) return null
  const active = String(pic.status || '') === 'active'
  return {
    createdBy: String(pic.createdBy || 'admin'),
    title: String(pic.name || '').trim().slice(0, 200) || 'Untitled diagram',
    description: Array.isArray(pic.keywords) ? pic.keywords.join(', ').slice(0, 1000) : '',
    art: { type: 'raster', url: url.slice(0, 2000), storagePath: storagePath.slice(0, 500) },
    labels: [],
    subject: String(pic.subject || ''),
    grade: gradeFromBand(pic.gradeBand),
    provenance: 'bank',
    status: active ? 'approved' : 'draft',
    scope: active ? 'public' : 'private',
    style: 'bw-line',
    migratedFrom: `pictureBank/${String(pic.id || '')}`,
  }
}

/**
 * Map a visualAssets doc to a diagramAssets write payload. The v1 label set
 * upgrades to the v2 shape (box starts on the anchor — auto placement is a
 * later editor action); letters are dropped, never stored. Returns null for
 * a doc with no readable art.
 */
export function visualAssetToDiagramAsset(va) {
  if (!va || typeof va !== 'object') return null
  const url = String(va.imageUrl || '')
  const storagePath = String(va.storagePath || '')
  if (!url && !storagePath) return null
  const labels = (Array.isArray(va.labels) ? va.labels : [])
    .filter((l) => l && typeof l === 'object')
    .map((l, i) => {
      const anchor = { x: clamp01(l.x), y: clamp01(l.y) }
      return {
        id: String(l.id || `mig-l${i + 1}`),
        word: String(l.text || '').trim().slice(0, 80),
        anchor,
        box: { ...anchor },
      }
    })
    .slice(0, 40)
  const publiclyShared = String(va.visibility || 'private') === 'public'
    && ['approved', 'published'].includes(String(va.status || ''))
  return {
    createdBy: String(va.createdBy || ''),
    createdByName: String(va.createdByName || ''),
    title: String(va.title || '').trim().slice(0, 200) || 'Untitled diagram',
    description: String(va.description || '').slice(0, 1000),
    art: { type: 'raster', url: url.slice(0, 2000), storagePath: storagePath.slice(0, 500) },
    labels,
    subject: String(va.subject || ''),
    grade: va.grade == null ? '' : String(va.grade),
    topic: String(va.topic || ''),
    subtopic: String(va.subtopic || ''),
    provenance: VISUAL_SOURCE_TO_PROVENANCE[String(va.sourceType || '')] || 'ai-generated',
    status: publiclyShared ? String(va.status) : 'draft',
    scope: publiclyShared ? 'public' : 'private',
    style: String(va.style || '') === 'bw_test_diagram' ? 'bw-line' : String(va.style || 'bw-line'),
    migratedFrom: `visualAssets/${String(va.id || '')}`,
  }
}

/**
 * Plan the migration for a batch of source docs: what would be written where.
 * The script runs this in dry-run mode and prints it; live mode writes it.
 * Sources whose target doc already exists (by deterministic id) are reported
 * as `skipped: 'exists'` unless `overwrite` — idempotent by default.
 *
 * @param {{ pictureBank?: Array, visualAssets?: Array }} sources docs with `id`
 * @param {{ existingIds?: Set<string>, overwrite?: boolean }} [opts]
 * @returns {{ writes: Array<{ docId, source, data }>, skipped: Array<{ source, reason }> }}
 */
export function planDiagramAssetMigration(sources = {}, { existingIds = new Set(), overwrite = false } = {}) {
  const writes = []
  const skipped = []
  const push = (collectionName, raw, data) => {
    const source = `${collectionName}/${String(raw?.id || '')}`
    if (!raw?.id) { skipped.push({ source, reason: 'no-id' }); return }
    if (!data) { skipped.push({ source, reason: 'no-art' }); return }
    if (!data.createdBy) { skipped.push({ source, reason: 'no-owner' }); return }
    const docId = migrationDocId(collectionName, raw.id)
    if (existingIds.has(docId) && !overwrite) { skipped.push({ source, reason: 'exists' }); return }
    writes.push({ docId, source, data })
  }
  for (const pic of sources.pictureBank || []) push('pictureBank', pic, pictureBankToDiagramAsset(pic))
  for (const va of sources.visualAssets || []) push('visualAssets', va, visualAssetToDiagramAsset(va))
  return { writes, skipped }
}
