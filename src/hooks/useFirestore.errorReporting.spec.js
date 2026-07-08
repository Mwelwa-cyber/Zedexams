/**
 * Regression guard: the swallowed Firestore read failures in useFirestore must
 * be forwarded to the client error reporter, not only console.error'd. Every
 * getter degrades to []/null on error to keep the UI alive, which previously
 * made read failures (permission-denied, missing index, offline) invisible in
 * production. This locks in that a failing read still reports — with a
 * `firestore.<fn>` context tag — while keeping the graceful []/null fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('../firebase/config', () => ({ db: {} }))

// getDocs rejects so every getter takes its catch branch.
const readError = new Error('permission-denied')
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => { throw readError }),
  getDocs: vi.fn(async () => { throw readError }),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  orderBy: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  serverTimestamp: vi.fn(),
  increment: vi.fn(),
  writeBatch: vi.fn(),
  Timestamp: {},
  getCountFromServer: vi.fn(async () => { throw readError }),
}))

const reportClientError = vi.fn()
vi.mock('../utils/clientErrorReporting.js', () => ({
  reportClientError: (...a) => reportClientError(...a),
}))

import { useFirestore } from './useFirestore'

function hook() {
  return renderHook(() => useFirestore()).result.current
}

beforeEach(() => {
  reportClientError.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {}) // silence dev log
})

describe('useFirestore — read failures are reported', () => {
  it('forwards a failed list read and still returns the safe empty array', async () => {
    const out = await hook().getMyQuizzes('t1')
    expect(out).toEqual([]) // graceful fallback preserved
    expect(reportClientError).toHaveBeenCalledWith(readError, 'firestore.getMyQuizzes')
  })

  it('forwards a failed single-doc read and still returns null', async () => {
    const out = await hook().getQuizById('q1')
    expect(out).toBeNull()
    expect(reportClientError).toHaveBeenCalledWith(readError, 'firestore.getQuizById')
  })

  it('tags the report with the specific getter that failed', async () => {
    await hook().getPendingApprovals()
    expect(reportClientError).toHaveBeenCalledWith(readError, 'firestore.getPendingApprovals')
  })

  it('reports each of several distinct getters under its own context', async () => {
    const api = hook()
    await api.getAllResults()
    await api.getLessons?.('G5', 'Mathematics')
    const contexts = reportClientError.mock.calls.map(c => c[1])
    expect(contexts).toContain('firestore.getAllResults')
    // every reported context is namespaced under firestore.*
    expect(contexts.every(c => typeof c === 'string' && c.startsWith('firestore.'))).toBe(true)
  })
})
