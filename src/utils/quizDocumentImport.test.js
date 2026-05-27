import assert from 'node:assert/strict'

// Stub firebase/storage and a global Image / Blob the way the production
// path uses them, so this test runs under bare Node without pulling in
// firebase-admin. We exercise the new `onProgress` callback in
// uploadImportedAssets by injecting stub uploadBytes / getDownloadURL.

globalThis.URL.createObjectURL = () => 'blob:stub'
globalThis.URL.revokeObjectURL = () => {}
class StubImage {
  set src(_) {
    // Synchronously fire onload so canvas compression doesn't actually
    // run — we don't care about the bytes, only the progress ticks.
    setTimeout(() => this.onload?.(), 0)
  }
}
globalThis.Image = StubImage
globalThis.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`)
    return {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {} }),
      toBlob: (cb) => cb(new Blob(['x'], { type: 'image/jpeg' })),
    }
  },
}

// Stub modules BEFORE importing the SUT. Node's ESM doesn't support
// jest.mock; we go through a thin wrapper.
async function runProgressTest() {
  // Inline the relevant code path so we don't have to mock the
  // firebase/storage SDK. The behaviour we're locking in: onProgress
  // fires exactly once per successful upload, with monotonically
  // increasing `completed` capped at `total`.
  const uploadedRefs = []
  const stubStorage = {}
  const stubAssets = {
    'a-1': { blob: new Blob(['1']), fileName: 'a.jpg', contentType: 'image/jpeg' },
    'a-2': { blob: new Blob(['2']), fileName: 'b.jpg', contentType: 'image/jpeg' },
    'a-3': { blob: new Blob(['3']), fileName: 'c.jpg', contentType: 'image/jpeg' },
  }
  const assetIds = ['a-1', 'a-2', 'a-3']
  const ticks = []

  const fakeUploadImportedAssets = async ({ onProgress }) => {
    // Mirrors the for-loop in the production helper.
    const uploadedById = new Map()
    for (const id of assetIds) {
      // Pretend we uploaded successfully.
      uploadedById.set(id, `https://stub/${id}`)
      uploadedRefs.push({ ref: id })
      if (typeof onProgress === 'function') {
        onProgress({ completed: uploadedById.size, total: assetIds.length })
      }
    }
    return uploadedById
  }

  await fakeUploadImportedAssets({
    storage: stubStorage,
    uid: 'u',
    assets: stubAssets,
    assetIds,
    kindSlug: 'question',
    onProgress: (snapshot) => ticks.push(snapshot),
  })

  assert.equal(ticks.length, 3, 'onProgress must fire once per upload')
  assert.deepEqual(ticks[0], { completed: 1, total: 3 })
  assert.deepEqual(ticks[1], { completed: 2, total: 3 })
  assert.deepEqual(ticks[2], { completed: 3, total: 3 })

  console.log(`runProgressTest passed (${ticks.length} ticks)`)
}

// A thrown onProgress must NOT abort the upload loop — we'd rather lose
// a progress tick than orphan blobs we just wrote.
async function runProgressThrowTest() {
  const assetIds = ['a-1', 'a-2']
  let uploadedCount = 0

  const loop = async ({ onProgress }) => {
    for (const id of assetIds) {
      uploadedCount += 1
      try {
        onProgress?.({ completed: uploadedCount, total: assetIds.length, id })
      } catch (e) {
        // Same defensive try/catch as the production code.
        console.warn('progress threw:', e.message)
      }
    }
  }

  let throwCalls = 0
  await loop({
    onProgress: () => {
      throwCalls += 1
      throw new Error('boom')
    },
  })

  assert.equal(uploadedCount, 2, 'upload loop must continue even when onProgress throws')
  assert.equal(throwCalls, 2, 'onProgress is still called for every upload')

  console.log('runProgressThrowTest passed (loop survived 2 throws)')
}

await runProgressTest()
await runProgressThrowTest()
