import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getNoteProgress, recordNoteOpened, recordNotePercent } from './progress.js'
import { getDoc, setDoc } from 'firebase/firestore'

// Reading progress is best-effort telemetry. The callers in
// useRecordNoteProgress fire writes without awaiting and await the read without
// a try/catch, so a denied/failed Firestore op used to escape as an unhandled
// "Missing or insufficient permissions" rejection on /notes/:id. These tests
// pin the resilience that prevents that: reads resolve to null, writes resolve.
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => () => {}),
  serverTimestamp: vi.fn(() => 'ts'),
}))
vi.mock('../../../firebase/config', () => ({ db: {} }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('noteProgress — resilient reads/writes (no unhandled permission rejections)', () => {
  it('getNoteProgress resolves null (not reject) when the read is denied', async () => {
    vi.mocked(getDoc).mockRejectedValueOnce(
      Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }),
    )
    await expect(getNoteProgress('uid1', 'note1')).resolves.toBeNull()
  })

  it('getNoteProgress returns the record when the read succeeds', async () => {
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => true,
      id: 'uid1_note1',
      data: () => ({ noteId: 'note1', percent: 40 }),
    })
    await expect(getNoteProgress('uid1', 'note1')).resolves.toMatchObject({ noteId: 'note1', percent: 40 })
  })

  it('recordNoteOpened resolves (does not throw) when the write is denied', async () => {
    vi.mocked(setDoc).mockRejectedValueOnce(
      Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }),
    )
    await expect(recordNoteOpened('uid1', { id: 'note1', grade: '5', subject: 'Maths' })).resolves.toBeUndefined()
  })

  it('recordNotePercent persists via setDoc on the happy path', async () => {
    vi.mocked(setDoc).mockResolvedValueOnce(undefined)
    await recordNotePercent('uid1', { id: 'note1' }, 55)
    expect(setDoc).toHaveBeenCalledOnce()
  })

  it('write helpers no-op without a uid or note id (never touch Firestore)', async () => {
    await recordNoteOpened(null, { id: 'note1' })
    await recordNoteOpened('uid1', {})
    expect(setDoc).not.toHaveBeenCalled()
  })
})
