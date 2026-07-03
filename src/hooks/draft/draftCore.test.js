/**
 * Tests for the firebase-free Universal Draft Manager core: descriptor-driven
 * build/hydrate, runtime-field stripping, staleness/empty/schema validation, the
 * last-write-wins merge, the dirty fingerprint, and the version ring buffer.
 *
 * Run: node src/hooks/draft/draftCore.test.js
 */

import {
  DRAFT_TTL,
  MAX_VERSIONS,
  draftKey,
  sanitizeRuntime,
  buildDraftPayload,
  isLiveDraft,
  pickFreshestDraft,
  computeDirtyFingerprint,
  pushVersion,
} from './draftCore.js'

import { resolveTabStatus } from './draftTabLock.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

const descriptor = {
  studioId: 'worksheet',
  schemaVersion: 2,
  serialize: (s) => ({ form: s.form, curr: s.curr }),
  hydrate: (p) => ({ form: p.form, curr: p.curr }),
  isNonEmpty: (p) => Boolean(p?.form?.topic || p?.curr),
}

console.log('draftKey — namespaced + collision-free')
{
  assert(
    draftKey({ studioId: 'a', uid: 'u1', draftId: 'd1' }) === 'examprep:draft:a:u1:d1',
    'key includes studioId, uid and draftId',
  )
  assert(
    draftKey({ studioId: 'a', uid: 'u1', draftId: 'd1' }) !== draftKey({ studioId: 'b', uid: 'u1', draftId: 'd1' }),
    'different studios never collide',
  )
}

console.log('\nsanitizeRuntime — drops blob URLs + upload flags deeply')
{
  const cleaned = sanitizeRuntime({
    imageUrl: 'blob:abc',
    imageUploading: true,
    imageAssetId: 'x',
    nested: [{ imageUrl: 'blob:opt', alt: 'A', imageUploadStep: 'y' }],
    keep: 'https://cdn/img.png',
  })
  assert(cleaned.imageUrl === '', 'blob: URL cleared')
  assert(!('imageUploading' in cleaned), 'imageUploading dropped')
  assert(!('imageAssetId' in cleaned), 'imageAssetId dropped')
  assert(cleaned.nested[0].imageUrl === '', 'nested blob: URL cleared')
  assert(cleaned.nested[0].alt === 'A', 'nested alt preserved')
  assert(cleaned.keep === 'https://cdn/img.png', 'real URL preserved')
}

console.log('\nbuildDraftPayload — descriptor serialize + stamps')
{
  const p = buildDraftPayload({ form: { topic: 'Fractions' }, curr: 'x', junk: 1 }, descriptor)
  assert(p.form.topic === 'Fractions', 'serialize picks the fields the studio chose')
  assert(!('junk' in p), 'fields the descriptor did not serialize are dropped')
  assert(typeof p.savedAt === 'number', 'savedAt stamped')
  assert(p.studioId === 'worksheet', 'studioId stamped')
  assert(p.schemaVersion === 2, 'schemaVersion stamped')
}

console.log('\nisLiveDraft — TTL + schema + non-empty')
{
  const fresh = buildDraftPayload({ form: { topic: 'T' }, curr: '' }, descriptor)
  assert(isLiveDraft(fresh, descriptor) === true, 'fresh non-empty draft is live')
  assert(isLiveDraft({ ...fresh, savedAt: Date.now() - DRAFT_TTL - 1000 }, descriptor) === false, 'expired rejected')
  assert(isLiveDraft({ ...fresh, schemaVersion: 1 }, descriptor) === false, 'schema mismatch rejected')
  const empty = buildDraftPayload({ form: {}, curr: '' }, descriptor)
  assert(isLiveDraft(empty, descriptor) === false, 'empty draft rejected')
  assert(isLiveDraft(null, descriptor) === false, 'null rejected')
}

console.log('\npickFreshestDraft — last-write-wins')
{
  const local = { savedAt: 100 }
  const remote = { savedAt: 200 }
  assert(pickFreshestDraft(local, remote).source === 'remote', 'newer remote wins (another device)')
  assert(pickFreshestDraft(remote, local).source === 'local', 'newer local wins')
  assert(pickFreshestDraft(local, null).source === 'local', 'local-only returns local')
  assert(pickFreshestDraft(null, remote).source === 'remote', 'remote-only returns remote')
  assert(pickFreshestDraft(null, null).draft === null, 'nothing returns null draft')
  assert(pickFreshestDraft({ savedAt: 100 }, { savedAt: 100 }).source === 'local', 'tie keeps local')
}

console.log('\ncomputeDirtyFingerprint — stable, savedAt-independent')
{
  const a = buildDraftPayload({ form: { topic: 'T' }, curr: 'x' }, descriptor)
  const b = { ...a, savedAt: a.savedAt + 5000 }
  assert(computeDirtyFingerprint(a) === computeDirtyFingerprint(b), 'savedAt change does not move the fingerprint')
  const c = buildDraftPayload({ form: { topic: 'T2' }, curr: 'x' }, descriptor)
  assert(computeDirtyFingerprint(a) !== computeDirtyFingerprint(c), 'content change moves the fingerprint')
}

console.log('\npushVersion — bounded ring, dedupes head')
{
  let ring = []
  ring = pushVersion(ring, { form: { topic: 'A' }, savedAt: 1 })
  ring = pushVersion(ring, { form: { topic: 'A' }, savedAt: 2 }) // same content, newer time
  assert(ring.length === 1, 'identical-content snapshot is not appended')
  ring = pushVersion(ring, { form: { topic: 'B' }, savedAt: 3 })
  assert(ring.length === 2, 'changed content appends')
  for (let i = 0; i < MAX_VERSIONS + 5; i += 1) {
    ring = pushVersion(ring, { form: { topic: `v${i}` }, savedAt: 100 + i })
  }
  assert(ring.length === MAX_VERSIONS, `ring capped at ${MAX_VERSIONS}`)
  assert(ring[ring.length - 1].form.topic === `v${MAX_VERSIONS + 4}`, 'newest kept at the tail')
}

console.log('\nresolveTabStatus — earliest claim owns the draft')
{
  const now = 10_000
  assert(
    resolveTabStatus({ myTabId: 'b', myClaimedAt: 200, peers: [{ tabId: 'a', claimedAt: 100, lastSeen: now }], now }) === 'shadow',
    'a later tab becomes shadow when an earlier owner is live',
  )
  assert(
    resolveTabStatus({ myTabId: 'a', myClaimedAt: 100, peers: [{ tabId: 'b', claimedAt: 200, lastSeen: now }], now }) === 'owner',
    'the earliest tab stays owner',
  )
  assert(
    resolveTabStatus({ myTabId: 'b', myClaimedAt: 200, peers: [{ tabId: 'a', claimedAt: 100, lastSeen: now - 20_000 }], now }) === 'owner',
    'a stale (gone) owner is ignored — shadow promotes itself',
  )
  assert(
    resolveTabStatus({ myTabId: 'b', myClaimedAt: 100, peers: [{ tabId: 'a', claimedAt: 100, lastSeen: now }], now }) === 'shadow',
    'exact claim tie breaks on tabId',
  )
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll draftCore tests passed.')
