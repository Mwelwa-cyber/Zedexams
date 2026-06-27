/**
 * importReviewStore — unit tests.
 *
 * jsdom does not ship IndexedDB, so we pull in fake-indexeddb to provide a
 * real in-process implementation. The globalThis shim must be applied before
 * the store module is imported so openDb() sees a working indexedDB object.
 */
import 'fake-indexeddb/auto'
import { saveReviewSession, loadReviewSession, clearReviewSession } from './importReviewStore.js'

test('saveReviewSession and loadReviewSession round-trip', async () => {
  const session = {
    fileName: 'test.jpg',
    savedAt: Date.now(),
    pageApprovalState: { 1: 'approved', 2: 'pending' },
    diagramChoices: {
      'd1': { diagramId: 'd1', choice: 'keep_original', status: 'ready', previewUrl: 'blob:x', errorMessage: null }
    },
  }
  await saveReviewSession(session)
  const loaded = await loadReviewSession()
  expect(loaded).not.toBeNull()
  expect(loaded.fileName).toBe('test.jpg')
  expect(loaded.pageApprovalState['1']).toBe('approved')
  expect(loaded.diagramChoices['d1'].choice).toBe('keep_original')
})

test('loadReviewSession returns null after clearReviewSession', async () => {
  await saveReviewSession({ fileName: 'x.jpg', savedAt: Date.now(), pageApprovalState: {}, diagramChoices: {} })
  await clearReviewSession()
  const loaded = await loadReviewSession()
  expect(loaded).toBeNull()
})

test('loadReviewSession returns null if session is expired (savedAt > 2h ago)', async () => {
  const oldTime = Date.now() - (3 * 60 * 60 * 1000) // 3 hours ago
  await saveReviewSession({ fileName: 'old.jpg', savedAt: oldTime, pageApprovalState: {}, diagramChoices: {} })
  const loaded = await loadReviewSession()
  expect(loaded).toBeNull()
})
