import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// Mock the I/O layers so the hook can be exercised without IndexedDB / Firestore.
vi.mock('./draftIdbStore.js', () => ({
  idbGetDraft: vi.fn(async () => null),
  idbPutDraft: vi.fn(async () => {}),
  idbDeleteDraft: vi.fn(async () => {}),
  idbSweepExpired: vi.fn(async () => {}),
}))
vi.mock('./draftCloudSync.js', () => ({
  saveDraftRemote: vi.fn(async () => 'synced'),
  deleteDraftRemote: vi.fn(async () => {}),
  loadDraftMerged: vi.fn(async () => ({ draft: null, source: null, remoteVersions: [] })),
}))
vi.mock('./draftTabLock.js', () => ({
  createTabLock: () => ({ stop: () => {}, getStatus: () => 'owner' }),
}))
vi.mock('../../utils/criticalWork.js', () => ({
  beginCriticalWork: vi.fn(() => vi.fn()),
}))

import { useDraftManager } from './useDraftManager.js'
import { idbPutDraft, idbGetDraft, idbDeleteDraft } from './draftIdbStore.js'
import { saveDraftRemote, loadDraftMerged, deleteDraftRemote } from './draftCloudSync.js'
import { beginCriticalWork } from '../../utils/criticalWork.js'

const descriptor = {
  studioId: 'worksheet',
  schemaVersion: 1,
  serialize: (s) => ({ form: s.form }),
  hydrate: (p) => ({ form: p.form }),
  isNonEmpty: (p) => Boolean(p?.form?.topic),
}

const baseProps = {
  studioId: 'worksheet',
  uid: 'u1',
  draftId: 'worksheet-current',
  descriptor,
  enabled: true,
  debounceMs: 20,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useDraftManager', () => {
  it('auto-saves locally and to the cloud after the debounce', async () => {
    const { rerender } = renderHook(
      ({ state }) => useDraftManager({ ...baseProps, state }),
      { initialProps: { state: { form: { topic: '' } } } },
    )
    // Empty form → nothing persisted.
    await new Promise((r) => setTimeout(r, 40))
    expect(idbPutDraft).not.toHaveBeenCalled()

    // A real edit → auto-save fires.
    rerender({ state: { form: { topic: 'Fractions' } } })
    await waitFor(() => expect(idbPutDraft).toHaveBeenCalled())
    await waitFor(() => expect(saveDraftRemote).toHaveBeenCalled())
    // Announced critical work while dirty (unload/PWA protection).
    expect(beginCriticalWork).toHaveBeenCalled()
  })

  it('offers a recoverable draft found on mount', async () => {
    loadDraftMerged.mockResolvedValueOnce({
      draft: { form: { topic: 'Recovered' }, savedAt: Date.now(), schemaVersion: 1 },
      source: 'remote',
      remoteVersions: [],
    })
    const onRestore = vi.fn()
    const { result } = renderHook(() =>
      useDraftManager({ ...baseProps, state: { form: { topic: '' } }, onRestore }),
    )
    await waitFor(() => expect(result.current.recovery.available).toBe(true))
    expect(result.current.source).toBe('remote')

    act(() => { result.current.acceptRecovery() })
    expect(onRestore).toHaveBeenCalledWith({ form: { topic: 'Recovered' } })
    expect(result.current.recovery.available).toBe(false)
  })

  it('clear() wipes local + cloud drafts', async () => {
    const { result } = renderHook(() =>
      useDraftManager({ ...baseProps, state: { form: { topic: 'x' } } }),
    )
    await act(async () => { await result.current.clear() })
    expect(idbDeleteDraft).toHaveBeenCalled()
    expect(deleteDraftRemote).toHaveBeenCalled()
  })

  it('does not read a draft when disabled', async () => {
    renderHook(() =>
      useDraftManager({ ...baseProps, enabled: false, state: { form: { topic: 'x' } } }),
    )
    await new Promise((r) => setTimeout(r, 30))
    expect(idbGetDraft).not.toHaveBeenCalled()
  })
})
