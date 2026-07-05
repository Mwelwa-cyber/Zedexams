import { describe, it, expect, beforeEach, vi } from 'vitest'

// shareService talks to Firestore; mock the SDK so the filter/sort/shape logic
// in listSharesForGeneration and the write shape of publishShare are exercised
// without a network. Mirrors the mocking pattern in useTeacherUsage.spec.js.

const getDocs = vi.fn()
const addDoc = vi.fn()
vi.mock('../firebase/config', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  addDoc: (...args) => addDoc(...args),
  collection: (_db, path) => ({ path }),
  doc: (_db, col, id) => ({ col, id }),
  getDocs: (...args) => getDocs(...args),
  query: (...args) => ({ args }),
  serverTimestamp: () => 'SERVER_TS',
  updateDoc: vi.fn(),
  where: (field, op, value) => ({ field, op, value }),
}))

import { listSharesForGeneration, publishShare } from './shareService.js'

const snap = (rows) => ({ docs: rows.map((r) => ({ id: r.id, data: () => r.data })) })

beforeEach(() => { getDocs.mockReset(); addDoc.mockReset() })

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

describe('publishShare', () => {
  // Each test configures addDoc to return a fake Firestore ref with an id so
  // publishShare can build the return value without a live database.
  const FAKE_ID = 'abc123token'
  function mockAddDoc() {
    addDoc.mockResolvedValue({ id: FAKE_ID })
  }

  it('writes the correct fields to /shares and returns { token, shareId, url }', async () => {
    mockAddDoc()
    const result = await publishShare({
      tool: 'lesson_plan',
      ownerUid: 'uid-teacher',
      title: 'Grade 5 Mathematics Lesson Plan',
      plan: { header: { grade: 'G5', subject: 'mathematics' }, sections: [] },
      subject: 'mathematics',
      grade: 'G5',
      topic: 'Fractions',
      generationId: 'gen-xyz',
    })

    expect(result.token).toBe(FAKE_ID)
    expect(result.shareId).toBe(FAKE_ID)
    expect(result.url).toContain(`/share/${FAKE_ID}`)

    // Verify the Firestore write shape — these are the fields the rules enforce.
    expect(addDoc).toHaveBeenCalledTimes(1)
    const [, written] = addDoc.mock.calls[0]
    expect(written.tool).toBe('lesson_plan')
    expect(written.ownerUid).toBe('uid-teacher')
    expect(written.title).toBe('Grade 5 Mathematics Lesson Plan')
    expect(written.plan).toEqual({ header: { grade: 'G5', subject: 'mathematics' }, sections: [] })
    expect(written.createdAt).toBe('SERVER_TS')
    expect(written.generationId).toBe('gen-xyz')
  })

  it('truncates tool to 40 chars and title to 200 chars to match Firestore limits', async () => {
    mockAddDoc()
    const longTool = 'x'.repeat(100)
    const longTitle = 'y'.repeat(300)
    await publishShare({ tool: longTool, ownerUid: 'uid1', title: longTitle, plan: { a: 1 } })

    const [, written] = addDoc.mock.calls[0]
    expect(written.tool.length).toBeLessThanOrEqual(40)
    expect(written.title.length).toBeLessThanOrEqual(200)
  })

  it('sets optional fields to null when omitted', async () => {
    mockAddDoc()
    await publishShare({ tool: 'worksheet', ownerUid: 'uid1', title: 'WS', plan: { q: 1 } })

    const [, written] = addDoc.mock.calls[0]
    expect(written.subject).toBeNull()
    expect(written.grade).toBeNull()
    expect(written.topic).toBeNull()
    expect(written.generationId).toBeNull()
  })

  it('throws when ownerUid is missing — never writes unauthenticated docs', async () => {
    await expect(publishShare({ tool: 'lesson_plan', ownerUid: '', title: 'T', plan: { a: 1 } }))
      .rejects.toThrow('Must be signed in')
    expect(addDoc).not.toHaveBeenCalled()
  })

  it('throws when plan is falsy — never writes a share with no content', async () => {
    await expect(publishShare({ tool: 'lesson_plan', ownerUid: 'uid1', title: 'T', plan: null }))
      .rejects.toThrow('Nothing to share')
    expect(addDoc).not.toHaveBeenCalled()
  })

  it('throws when plan is not an object (e.g. a raw string)', async () => {
    await expect(publishShare({ tool: 'lesson_plan', ownerUid: 'uid1', title: 'T', plan: 'raw' }))
      .rejects.toThrow('Nothing to share')
    expect(addDoc).not.toHaveBeenCalled()
  })
})
