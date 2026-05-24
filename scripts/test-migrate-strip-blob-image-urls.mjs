import assert from 'node:assert/strict'
import {
  cleanQuestionBlobUrls,
  cleanParentDocBlobUrls,
} from './migrate-strip-blob-image-urls.mjs'

// ─── cleanQuestionBlobUrls ─────────────────────────────────────────────────

// Blob: stem URL gets cleared, summary increments.
{
  const summary = { stem: 0, options: 0, droppedAssetIds: 0 }
  const cleaned = cleanQuestionBlobUrls({
    imageUrl: 'blob:http://localhost/abc',
    imageAssetId: 'leftover',
  }, summary)
  assert.ok(cleaned, 'returns a cleaned copy when stem is blob:')
  assert.equal(cleaned.imageUrl, '')
  assert.equal(cleaned.imageAssetId, '')
  assert.equal(summary.stem, 1)
  assert.equal(summary.droppedAssetIds, 1)
}

// Blob: option image gets removed from the slot, summary increments.
{
  const summary = { stem: 0, options: 0, droppedAssetIds: 0 }
  const cleaned = cleanQuestionBlobUrls({
    imageUrl: 'https://storage.googleapis.com/b/q.jpg',
    optionMedia: [
      { imageUrl: 'blob:http://localhost/a', alt: 'A' },
      { imageUrl: 'https://example.com/keep.jpg', alt: 'B' },
      null,
    ],
  }, summary)
  assert.ok(cleaned, 'returns cleaned copy when only an option is blob:')
  assert.equal(cleaned.imageUrl, 'https://storage.googleapis.com/b/q.jpg',
    'real stem URL is untouched')
  assert.deepEqual(cleaned.optionMedia[0], { alt: 'A' }, 'blob: option slot drops imageUrl')
  assert.equal(cleaned.optionMedia[1].imageUrl, 'https://example.com/keep.jpg',
    'real option URLs survive')
  assert.equal(cleaned.optionMedia[2], null, 'null slots pass through')
  assert.equal(summary.options, 1)
  assert.equal(summary.stem, 0)
}

// Orphan imageAssetId alone (no blob: URL) also gets dropped.
{
  const summary = { stem: 0, options: 0, droppedAssetIds: 0 }
  const cleaned = cleanQuestionBlobUrls({
    imageUrl: '',
    imageAssetId: 'orphan-7',
  }, summary)
  assert.ok(cleaned, 'orphan imageAssetId triggers a clean')
  assert.equal(cleaned.imageAssetId, '')
  assert.equal(summary.stem, 0)
  assert.equal(summary.droppedAssetIds, 1)
}

// Clean record returns null (no work to do — caller skips the write).
{
  const cleaned = cleanQuestionBlobUrls({
    imageUrl: 'https://storage.googleapis.com/b/q.jpg',
    optionMedia: [{ imageUrl: 'https://example.com/x.jpg', alt: 'A' }],
  })
  assert.equal(cleaned, null, 'fully-clean record returns null')
}

// Invalid input returns null without throwing.
{
  assert.equal(cleanQuestionBlobUrls(null), null)
  assert.equal(cleanQuestionBlobUrls('not an object'), null)
  assert.equal(cleanQuestionBlobUrls(undefined), null)
}

// ─── cleanParentDocBlobUrls ────────────────────────────────────────────────

// Blob: passage URL gets nulled, real ones survive.
{
  const summary = { passages: 0, droppedAssetIds: 0 }
  const cleaned = cleanParentDocBlobUrls({
    title: 'Quiz',
    passages: [
      { id: 'p1', imageUrl: 'blob:http://localhost/p1' },
      { id: 'p2', imageUrl: 'https://example.com/keep.jpg' },
      { id: 'p3', imageUrl: null },
    ],
  }, summary)
  assert.ok(cleaned)
  assert.equal(cleaned.passages[0].imageUrl, null)
  assert.equal(cleaned.passages[1].imageUrl, 'https://example.com/keep.jpg')
  assert.equal(cleaned.passages[2].imageUrl, null)
  assert.equal(summary.passages, 1)
  assert.equal(cleaned.title, 'Quiz', 'unrelated parent fields pass through')
}

// Passage with orphan imageAssetId triggers a clean even without blob: URL.
{
  const summary = { passages: 0, droppedAssetIds: 0 }
  const cleaned = cleanParentDocBlobUrls({
    passages: [{ id: 'p', imageUrl: null, imageAssetId: 'orphan-9' }],
  }, summary)
  assert.ok(cleaned)
  assert.equal(cleaned.passages[0].imageAssetId, '')
  assert.equal(summary.droppedAssetIds, 1)
}

// Clean parent doc returns null.
{
  const cleaned = cleanParentDocBlobUrls({
    title: 'Q',
    passages: [{ id: 'p1', imageUrl: 'https://example.com/x.jpg' }],
  })
  assert.equal(cleaned, null)
}

// Doc with no `passages` array returns null without throwing.
{
  assert.equal(cleanParentDocBlobUrls({ title: 'No passages' }), null)
  assert.equal(cleanParentDocBlobUrls(null), null)
  assert.equal(cleanParentDocBlobUrls({ passages: 'not-an-array' }), null)
}

console.log('test-migrate-strip-blob-image-urls.mjs — OK')
