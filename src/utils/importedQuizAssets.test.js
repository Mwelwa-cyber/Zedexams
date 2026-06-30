import assert from 'node:assert/strict'
import {
  assertNoBlobImageUrls,
  stripBlobImageUrls,
  applyUploadedImageUrls,
} from './importedQuizAssets.js'
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

// A blob: URL on a stacked extra figure (images[]) must throw.
assert.throws(
  () => assertNoBlobImageUrls(
    [{ imageUrl: 'https://example.com/main.jpg', images: [{ url: 'blob:http://localhost/extra' }] }],
    [],
  ),
  /did not finish uploading/i,
  'a blob: URL on an extra images[] figure must throw',
)

// Real URLs on images[] never trip the guard.
assert.doesNotThrow(
  () => assertNoBlobImageUrls(
    [{ imageUrl: 'https://example.com/main.jpg', images: [{ url: 'https://example.com/extra.jpg' }] }],
    [],
  ),
  'real images[] URLs should not trigger the blob guard',
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

// stripBlobImageUrls drops dead-blob extras but keeps already-uploaded ones.
const strippedExtras = stripBlobImageUrls({
  imageUrl: 'https://example.com/main.jpg',
  images: [
    { url: 'blob:http://localhost/dead-extra', alt: 'X' },
    { url: 'https://example.com/kept-extra.jpg', alt: 'Y' },
  ],
})
assert.equal(strippedExtras.images.length, 1, 'blob: extra figure is dropped')
assert.equal(strippedExtras.images[0].url, 'https://example.com/kept-extra.jpg', 'uploaded extra survives')

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

// ─── applyUploadedImageUrls ────────────────────────────────────────────────
// Regression: after an import autosave uploads each figure to Storage and
// revokes its blob: URL, the live sections must already point at the uploaded
// Storage URLs — otherwise every on-screen figure (e.g. the review screen's
// crop modal) renders broken once the blob is gone.

const uploads = new Map([
  ['asset-stem', 'https://store/stem.png'],
  ['asset-opt', 'https://store/opt.png'],
  ['asset-extra', 'https://store/extra.png'],
  ['asset-passage', 'https://store/passage.png'],
  ['asset-sub', 'https://store/sub.png'],
])

const sections = [
  {
    kind: 'standalone',
    question: {
      imageUrl: 'blob:stem',
      imageAssetId: 'asset-stem',
      optionMedia: [{ imageUrl: 'blob:opt', imageAssetId: 'asset-opt', alt: 'A' }, null],
      images: [{ url: 'blob:extra', imageAssetId: 'asset-extra', alt: 'X' }],
    },
  },
  {
    kind: 'passage',
    passage: {
      imageUrl: 'blob:passage',
      imageAssetId: 'asset-passage',
      questions: [
        { imageUrl: 'blob:sub', imageAssetId: 'asset-sub' },
        { imageUrl: 'https://store/already.png', imageAssetId: '' },
      ],
    },
  },
]

const reconciled = applyUploadedImageUrls(sections, uploads)

assert.notEqual(reconciled, sections, 'a matching upload produces a new sections array')
const q = reconciled[0].question
assert.equal(q.imageUrl, 'https://store/stem.png', 'standalone stem swapped to Storage URL')
assert.equal(q.imageAssetId, '', 'standalone stem imageAssetId cleared')
assert.equal(q.optionMedia[0].imageUrl, 'https://store/opt.png', 'option media swapped to Storage URL')
assert.equal(q.optionMedia[0].imageAssetId, undefined, 'option media imageAssetId dropped')
assert.equal(q.optionMedia[0].alt, 'A', 'option media alt preserved')
assert.equal(q.optionMedia[1], null, 'null option slot passes through')
assert.equal(q.images[0].url, 'https://store/extra.png', 'stacked extra figure swapped (url field)')
assert.equal(q.images[0].imageAssetId, undefined, 'stacked extra imageAssetId dropped')

const p = reconciled[1].passage
assert.equal(p.imageUrl, 'https://store/passage.png', 'passage image swapped to Storage URL')
assert.equal(p.imageAssetId, '', 'passage imageAssetId cleared')
assert.equal(p.questions[0].imageUrl, 'https://store/sub.png', 'passage sub-question swapped')
assert.equal(p.questions[1].imageUrl, 'https://store/already.png', 'already-uploaded sub-question untouched')

// No blob: URL should survive the reconcile when every figure was uploaded.
assert.doesNotThrow(
  () => assertNoBlobImageUrls(
    [reconciled[0].question, ...reconciled[1].passage.questions],
    [reconciled[1].passage],
  ),
  'reconciled records carry no blob: URLs',
)

// No matching assetIds → same reference back (so React can bail out of a re-render).
assert.equal(
  applyUploadedImageUrls(sections, new Map([['nope', 'https://store/x.png']])),
  sections,
  'no matching assetId returns the same sections reference',
)

// An empty / missing map is a no-op that returns the input untouched.
assert.equal(applyUploadedImageUrls(sections, new Map()), sections, 'empty map is a no-op')
assert.equal(applyUploadedImageUrls(sections), sections, 'missing map is a no-op')

console.log('importedQuizAssets.test.js — OK')
