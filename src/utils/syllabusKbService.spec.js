/**
 * Regression tests for loadRawCurriculum cache behaviour in syllabusKbService.
 *
 * Root cause guarded: a failed fetch was previously cached as `_rawCache = {}`
 * (truthy), permanently poisoning the session. Every subsequent call served the
 * empty object without retrying, silently emptying SyllabiLibrary and every
 * studio curriculum picker for the rest of the session.
 *
 * After the fix: _rawCache stays null on failure so the next call retries, and
 * the error is rethrown so getMergedSyllabi rejects and callers can surface it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Dependency mocks (all Firebase / service deps the module imports) ────────

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  getDocs: vi.fn(async () => ({ docs: [] })),
}))
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => vi.fn(async () => ({ data: {} }))),
}))
vi.mock('../firebase/config', () => ({ default: {}, db: {} }))
vi.mock('./adminCbcKbService', () => ({
  getActiveKbVersion: vi.fn(async () => 'v1'),
  listCbcTopics: vi.fn(async () => []),
}))
vi.mock('./syllabusMapping', () => ({
  syllabiToKbTopics: vi.fn(() => []),
}))

// Import after mocks are hoisted so the service module resolves against them.
import { getMergedSyllabi, invalidateSyllabiCache } from './syllabusKbService'

describe('syllabusKbService – loadRawCurriculum cache behaviour', () => {
  beforeEach(() => {
    // Reset in-memory caches before every test so each case starts cold.
    invalidateSyllabiCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects when fetch rejects — cache not poisoned — second call retries', async () => {
    // fetch fails on both attempts.
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'))
    vi.stubGlobal('fetch', fetchMock)

    // First call must reject, not resolve-empty.
    await expect(getMergedSyllabi()).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // The cache was not poisoned: a second call must attempt a fresh fetch.
    await expect(getMergedSyllabi()).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects when fetch returns a non-ok HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })))
    await expect(getMergedSyllabi()).rejects.toThrow('HTTP 503')
  })

  it('resolves with the fetched data on success and caches it (fetch not called again)', async () => {
    const payload = {
      'Physics Syllabus (Forms 1-4)': { 'Form 1': { columns: [], rows: [] } },
    }
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload }))
    vi.stubGlobal('fetch', fetchMock)

    // First call fetches and resolves with the data (overrides are empty so
    // applyOverrides returns the raw payload unchanged).
    const result = await getMergedSyllabi()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject(payload)

    // Second call must use the in-memory cache — fetch is NOT called again.
    const cached = await getMergedSyllabi()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cached).toMatchObject(payload)
  })
})
