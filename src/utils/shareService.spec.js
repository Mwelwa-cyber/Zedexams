import { describe, it, expect, beforeEach, vi } from 'vitest'

// shareService talks to Firestore; mock the SDK so the filter/sort/shape logic
// in listSharesForGeneration is exercised without a network. Mirrors the
// mocking pattern in useTeacherUsage.spec.js.

const getDocs = vi.fn()
vi.mock('../firebase/config', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn(),
  collection: (_db, path) => ({ path }),
  doc: (_db, col, id) => ({ col, id }),
  getDocs: (...args) => getDocs(...args),
  query: (...args) => ({ args }),
  serverTimestamp: () => 'ts',
  updateDoc: vi.fn(),
  where: (field, op, value) => ({ field, op, value }),
}))

import { listSharesForGeneration } from './shareService.js'

const snap = (rows) => ({ docs: rows.map((r) => ({ id: r.id, data: () => r.data })) })

beforeEach(() => { getDocs.mockReset() })

describe('listSharesForGeneration', () => {
  it('returns only non-revoked shares for the given generation, newest first', async () => {
    getDocs.mockResolvedValue(snap([
      { id: 'a', data: { generationId: 'gen1', createdAt: { seconds: 100 } } },
      { id: 'b', data: { generationId: 'gen2', createdAt: { seconds: 200 } } }, // other item
      { id: 'c', data: { generationId: 'gen1', createdAt: { seconds: 300 } } },
      { id: 'd', data: { generationId: 'gen1', createdAt: { seconds: 400 }, revokedAt: 'ts' } }, // revoked
    ]))

    const out = await listSharesForGeneration('uid1', 'gen1')

    expect(out.map((s) => s.token)).toEqual(['c', 'a']) // gen1, not revoked, newest first
    expect(out[0].url.endsWith('/share/c')).toBe(true)
  })

  it('returns [] without querying when uid or generationId is missing', async () => {
    expect(await listSharesForGeneration('', 'gen1')).toEqual([])
    expect(await listSharesForGeneration('uid1', '')).toEqual([])
    expect(getDocs).not.toHaveBeenCalled()
  })

  it('degrades to [] when the read throws', async () => {
    getDocs.mockRejectedValue(new Error('permission denied'))
    expect(await listSharesForGeneration('uid1', 'gen1')).toEqual([])
  })
})
