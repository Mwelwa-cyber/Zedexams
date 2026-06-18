import { beforeEach, describe, expect, it, vi } from 'vitest'

// quizAssignments.js wires up a Firestore callable + db at module load. Mock
// the Firebase surface (and analytics) so the pure planners and the
// assign fan-out can be exercised in jsdom.
const callable = vi.fn()
const capture = vi.fn()

vi.mock('../firebase/config', () => ({ default: {}, db: {} }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [] })),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
}))
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => (...args) => callable(...args),
}))
vi.mock('./analytics', () => ({ capture: (...args) => capture(...args) }))

const {
  resolveAutomaticTargets,
  buildSmartSuggestion,
  deriveQuizStatus,
  assignQuizToTargets,
} = await import('./quizAssignments')

const classes = [
  { id: 'c1', grade: '7', subject: 'mathematics', school: 'Alpha', active: true },
  { id: 'c2', grade: '7', subject: 'english', school: 'Alpha', active: true },
  { id: 'c3', grade: '5', subject: 'mathematics', school: 'Beta', active: true },
  { id: 'c4', grade: '7', subject: 'mathematics', school: 'Alpha', active: false },
]

beforeEach(() => {
  callable.mockReset()
  capture.mockReset()
})

describe('resolveAutomaticTargets', () => {
  it('returns [] for non-array input', () => {
    expect(resolveAutomaticTargets(null)).toEqual([])
  })

  it('honours an explicit classIds allow-list (ignoring other filters)', () => {
    const out = resolveAutomaticTargets(classes, { classIds: ['c2', 'c3'] })
    expect(out.map((c) => c.id)).toEqual(['c2', 'c3'])
  })

  it('filters by grade + subject and excludes inactive classes', () => {
    const out = resolveAutomaticTargets(classes, { grade: '7', subject: 'mathematics' })
    expect(out.map((c) => c.id)).toEqual(['c1'])
  })

  it('matches school case-insensitively', () => {
    const out = resolveAutomaticTargets(classes, { grade: '7', school: 'alpha' })
    expect(out.map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('returns all active classes for an empty rule', () => {
    expect(resolveAutomaticTargets(classes, {}).map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })
})

describe('buildSmartSuggestion', () => {
  it('returns null with no quiz or no classes', () => {
    expect(buildSmartSuggestion({ quiz: null, classes })).toBeNull()
    expect(buildSmartSuggestion({ quiz: { grade: '7' }, classes: [] })).toBeNull()
  })

  it('prefers a strict grade+subject match', () => {
    const out = buildSmartSuggestion({ quiz: { grade: '7', subject: 'mathematics' }, classes })
    expect(out.scope).toBe('grade+subject')
    expect(out.count).toBe(1)
    expect(out.classes[0].id).toBe('c1')
  })

  it('falls back to grade-only when no subject matches', () => {
    const out = buildSmartSuggestion({ quiz: { grade: '7', subject: 'science' }, classes })
    // No class teaches grade-7 science, so it widens to grade-only.
    expect(out.scope).toBe('grade')
    expect(out.classes.map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('returns null when nothing matches the grade at all', () => {
    expect(buildSmartSuggestion({ quiz: { grade: '12' }, classes })).toBeNull()
  })
})

describe('deriveQuizStatus', () => {
  it('defaults to draft', () => {
    expect(deriveQuizStatus(null)).toBe('draft')
    expect(deriveQuizStatus({})).toBe('draft')
  })

  it('maps archived/completed status verbatim', () => {
    expect(deriveQuizStatus({ status: 'Archived' })).toBe('archived')
    expect(deriveQuizStatus({ status: 'completed' })).toBe('completed')
  })

  it('distinguishes published vs active by active assignments', () => {
    expect(deriveQuizStatus({ isPublished: true })).toBe('published')
    expect(deriveQuizStatus({ isPublished: true }, { activeAssignments: 2 })).toBe('active')
  })

  it('reads scheduled/pending raw status when not published', () => {
    expect(deriveQuizStatus({ status: 'scheduled' })).toBe('scheduled')
    expect(deriveQuizStatus({ status: 'pending' })).toBe('pending')
  })
})

describe('assignQuizToTargets', () => {
  it('requires a resourceId', async () => {
    await expect(assignQuizToTargets({ resourceId: '' })).rejects.toThrow(/resourceId is required/)
  })

  it('returns empty buckets with no targets', async () => {
    const res = await assignQuizToTargets({ resourceId: 'q1', targets: [] })
    expect(res).toEqual({ assigned: [], skipped: [], errors: [] })
    expect(callable).not.toHaveBeenCalled()
  })

  it('skips classes already assigned, assigns the rest, and reports failures', async () => {
    callable
      .mockResolvedValueOnce({ data: { assignmentId: 'a-c2' } })
      .mockRejectedValueOnce(new Error('boom'))
    const res = await assignQuizToTargets({
      resourceId: 'q1',
      targets: [{ classId: 'c1' }, { classId: 'c2' }, { classId: 'c3' }],
      existingClassIds: ['c1'],
    })
    expect(res.skipped).toEqual([{ classId: 'c1', reason: 'already-assigned' }])
    expect(res.assigned).toEqual([{ classId: 'c2', assignmentId: 'a-c2', data: { assignmentId: 'a-c2' } }])
    expect(res.errors).toEqual([{ classId: 'c3', message: 'boom' }])
    expect(callable).toHaveBeenCalledTimes(2)
  })

  it('caps learnerUids at 200 and forwards date options as ms', async () => {
    callable.mockResolvedValue({ data: {} })
    const due = new Date('2026-01-02T00:00:00Z')
    await assignQuizToTargets({
      resourceId: 'q1',
      targets: [{ classId: 'c1', learnerUids: Array.from({ length: 250 }, (_, i) => `u${i}`) }],
      options: { dueAt: due, timed: true },
    })
    const payload = callable.mock.calls[0][0]
    expect(payload.learnerUids).toHaveLength(200)
    expect(payload.dueAtMs).toBe(due.getTime())
    expect(payload.timed).toBe(true)
    expect(payload.assignmentMode).toBe('manual')
  })

  it('still resolves even if analytics capture throws', async () => {
    callable.mockResolvedValue({ data: {} })
    capture.mockImplementation(() => { throw new Error('no analytics') })
    const res = await assignQuizToTargets({ resourceId: 'q1', targets: [{ classId: 'c1' }] })
    expect(res.assigned).toHaveLength(1)
  })
})
