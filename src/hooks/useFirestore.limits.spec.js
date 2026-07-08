/**
 * Regression guard: the teacher/admin list queries in useFirestore must carry
 * a Firestore `limit()`. These `where(...) + orderBy(...)` reads feed UI lists
 * (teacher library, header search, admin queues) and previously had NO bound —
 * a prolific author or a payment backlog read the whole collection on every
 * mount. This locks a limit onto each so a future edit can't silently drop it.
 *
 * We mock firebase/firestore so `limit(n)` is observable and every query
 * short-circuits to an empty snapshot; the assertions are about the query the
 * hook builds, not Firestore itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('../firebase/config', () => ({ db: {} }))

const limitMock = vi.fn((n) => ({ __limit: n }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, ...path) => ({ __collection: path.join('/') })),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [] })),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((...a) => ({ __where: a })),
  orderBy: vi.fn((...a) => ({ __orderBy: a })),
  limit: (...a) => limitMock(...a),
  serverTimestamp: vi.fn(() => 'TS'),
  increment: vi.fn(),
  writeBatch: vi.fn(),
  Timestamp: { fromMillis: vi.fn() },
  getCountFromServer: vi.fn(),
}))

import { useFirestore, TEACHER_QUERY_LIMIT, ADMIN_QUERY_LIMIT } from './useFirestore'

function hook() {
  return renderHook(() => useFirestore()).result.current
}

beforeEach(() => limitMock.mockClear())

describe('useFirestore — list queries are bounded', () => {
  it('constants are sane positive caps', () => {
    expect(TEACHER_QUERY_LIMIT).toBeGreaterThan(0)
    expect(ADMIN_QUERY_LIMIT).toBeGreaterThan(0)
  })

  it('getQuizzesByTeacher applies the teacher cap', async () => {
    await hook().getQuizzesByTeacher('t1')
    expect(limitMock).toHaveBeenCalledWith(TEACHER_QUERY_LIMIT)
  })

  it('getMyAssessments applies the teacher cap', async () => {
    await hook().getMyAssessments('t1')
    expect(limitMock).toHaveBeenCalledWith(TEACHER_QUERY_LIMIT)
  })

  it('getMyQuizzes applies the teacher cap', async () => {
    await hook().getMyQuizzes('t1')
    expect(limitMock).toHaveBeenCalledWith(TEACHER_QUERY_LIMIT)
  })

  it('getMyLessons applies the teacher cap', async () => {
    await hook().getMyLessons('t1')
    expect(limitMock).toHaveBeenCalledWith(TEACHER_QUERY_LIMIT)
  })

  it('getPendingPayments applies the admin cap', async () => {
    await hook().getPendingPayments()
    expect(limitMock).toHaveBeenCalledWith(ADMIN_QUERY_LIMIT)
  })

  it('getPendingApprovals caps both the quiz and lesson sub-queries', async () => {
    await hook().getPendingApprovals()
    expect(limitMock).toHaveBeenCalledTimes(2)
    expect(limitMock).toHaveBeenNthCalledWith(1, ADMIN_QUERY_LIMIT)
    expect(limitMock).toHaveBeenNthCalledWith(2, ADMIN_QUERY_LIMIT)
  })

  it('honours an explicit caller-supplied limit override', async () => {
    await hook().getMyQuizzes('t1', 25)
    expect(limitMock).toHaveBeenCalledWith(25)
  })
})
