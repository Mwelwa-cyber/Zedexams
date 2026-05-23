import assert from 'node:assert/strict'
import { assertNoBlobImageUrls, stripBlobImageUrls } from './importedQuizAssets.js'
import { createPassageSection, serializeQuizSections } from './quizSections.js'

// ─── assertNoBlobImageUrls ─────────────────────────────────────────────────

// Happy path: a real Storage URL on every record never trips the guard.
assert.doesNotThrow(() => {
  assertNoBlobImageUrls(
    [
      { imageUrl: 'https://storage.googleapis.com/bucket/q.jpg', optionMedia: [] },
      { imageUrl: '', optionMedia: [{ imageUrl: 'https://example.com/opt.jpg', alt: 'A' }] },
    ],
    [
      { imageUrl: 'https://storage.googleapis.com/bucket/p.jpg' },
    ],
  )
}, 'real Storage URLs should not trigger the blob guard')

// A blob: URL on a question's imageUrl must throw.
assert.throws(
  () => assertNoBlobImageUrls([{ imageUrl: 'blob:http://localhost:5173/abc123' }], []),
  /did not finish uploading/i,
  'a blob: URL on a question.imageUrl must throw',
)

// A blob: URL on an option image must throw.
assert.throws(
  () => assertNoBlobImageUrls(
    [{ imageUrl: '', optionMedia: [{ imageUrl: 'blob:http://localhost/x' }] }],
    [],
  ),
  /option image did not finish uploading/i,
  'a blob: URL on an option image must throw',
)

// A blob: URL on a passage's imageUrl must throw.
assert.throws(
  () => assertNoBlobImageUrls([], [{ imageUrl: 'blob:http://localhost/y' }]),
  /passage image did not finish uploading/i,
  'a blob: URL on a passage.imageUrl must throw',
)

// Empty inputs are a no-op.
assert.doesNotThrow(() => assertNoBlobImageUrls(), 'no args is a no-op')
assert.doesNotThrow(() => assertNoBlobImageUrls([], []), 'empty arrays are a no-op')

// ─── stripBlobImageUrls ─────────────────────────────────────────────────────

const stripped = stripBlobImageUrls({
  imageUrl: 'blob:http://localhost/dead',
  optionMedia: [
    { imageUrl: 'blob:http://localhost/dead-opt', alt: 'A' },
    { imageUrl: 'https://example.com/keep.jpg', alt: 'B' },
    null,
  ],
  other: 'preserved',
})
assert.equal(stripped.imageUrl, '', 'blob: question imageUrl is cleared')
assert.deepEqual(stripped.optionMedia[0], { alt: 'A' }, 'blob: option imageUrl is removed but alt survives')
assert.equal(stripped.optionMedia[1].imageUrl, 'https://example.com/keep.jpg', 'real option URLs survive')
assert.equal(stripped.optionMedia[2], null, 'null slots pass through')
assert.equal(stripped.other, 'preserved', 'unrelated fields pass through unchanged')

// ─── Passage schema round-trip ─────────────────────────────────────────────

const section = createPassageSection({
  title: 'Reading test',
  imageUrl: 'blob:http://localhost/passage-1',
  imageAssetId: 'asset-passage-1',
})
assert.equal(section.passage.imageAssetId, 'asset-passage-1',
  'createPassageSection accepts imageAssetId override (Phase 1 schema)')
assert.equal(section.passage.imageUrl, 'blob:http://localhost/passage-1',
  'createPassageSection preserves the override imageUrl')

const sectionDefault = createPassageSection({})
assert.equal(sectionDefault.passage.imageAssetId, '',
  'createPassageSection defaults imageAssetId to empty string')

// serializeQuizSections must propagate imageAssetId so uploadImportedPassageImages
// can find the matching blob and swap in a Storage URL.
const serialized = serializeQuizSections([section], [])
assert.equal(serialized.passages.length, 1, 'one passage serialized')
assert.equal(serialized.passages[0].imageAssetId, 'asset-passage-1',
  'serializeQuizSections carries imageAssetId on the passage payload')

console.log('importedQuizAssets.test.js — OK')
