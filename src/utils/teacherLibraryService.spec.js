import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture the document written by addDoc so we can assert its exact shape —
// the aiGenerations create rule for `lesson_plan` is strict (keys().hasOnly),
// so a stray top-level field would be rejected by Firestore at runtime.
const { addDocMock } = vi.hoisted(() => ({ addDocMock: vi.fn(async () => ({ id: 'gen-123' })) }))

vi.mock('firebase/firestore', () => ({
  addDoc: addDocMock,
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  deleteDoc: vi.fn(),
  updateDoc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
}))
vi.mock('../firebase/config', () => ({ db: {} }))
vi.mock('./libraryClassification', () => ({
  TOOL_TO_LIBRARY_TYPE: {},
  classifyForLibrary: vi.fn(() => ({ libraryType: 'lesson_plans', gradeForm: 'Grade 4', subject: 'Mathematics' })),
}))

import { getDoc, getDocs } from 'firebase/firestore'
import { __resetRequestDeduplicationForTests } from './requestDeduplication.js'
import {
  saveLessonPlanGeneration,
  duplicateGeneration,
  CLIENT_CREATED_TOOLS,
  summarizeGenerations,
  titleForGeneration,
  TOOL_META,
  TOOL_FILTER_OPTIONS,
  getItemPermissions,
  listMyGenerations,
  getGeneration,
} from './teacherLibraryService'

function fakeSnap(rows) {
  return { docs: rows.map((r) => ({ id: r.id, data: () => r })) }
}

// The exact top-level keys the firestore.rules `lesson_plan` create rule
// permits (keys().hasOnly([...])). Keep in sync with firestore.rules.
const ALLOWED_KEYS = new Set([
  'ownerUid', 'tool', 'status', 'visibility',
  'createdAt', 'inputs', 'library',
  'meta', 'data', 'html', 'studioFormat',
])

describe('saveLessonPlanGeneration', () => {
  beforeEach(() => addDocMock.mockClear())

  const plan = { lessonGoal: 'Identify plant parts', stages: [{ name: 'INTRODUCTION', teacher: 'Ask' }] }

  it('writes a rules-compliant lesson_plan doc and returns the id', async () => {
    const id = await saveLessonPlanGeneration({
      uid: 'u1',
      planJson: plan,
      html: '<div class="doc">…</div>',
      meta: { format: 'classic', subject: 'Mathematics' },
      studioFormat: 'classic',
      inputs: { grade: 'Grade 4', subject: 'mathematics', topic: 'Plants', subtopic: 'Parts' },
      classification: { libraryType: 'lesson_plans', grade: 'Grade 4', subject: 'mathematics' },
    })
    expect(id).toBe('gen-123')
    expect(addDocMock).toHaveBeenCalledTimes(1)

    const written = addDocMock.mock.calls[0][1]
    // Fixed literals the rule pins.
    expect(written.ownerUid).toBe('u1')
    expect(written.tool).toBe('lesson_plan')
    expect(written.status).toBe('complete')
    expect(written.visibility).toBe('private')
    // The plan + rendered HTML are stored under the legacy studio fields.
    expect(written.data).toEqual(plan)
    expect(written.html).toContain('class="doc"')
    expect(written.studioFormat).toBe('classic')
    expect(written.createdAt).toBe('SERVER_TS')
    // CRITICAL: no `output` (forbidden on create) and no stray keys.
    expect('output' in written).toBe(false)
    for (const key of Object.keys(written)) {
      expect(ALLOWED_KEYS.has(key)).toBe(true)
    }
  })

  it('omits the library key when classification yields nothing', async () => {
    const { classifyForLibrary } = await import('./libraryClassification')
    classifyForLibrary.mockReturnValueOnce(null)
    await saveLessonPlanGeneration({ uid: 'u1', planJson: plan, html: '<p>x</p>' })
    const written = addDocMock.mock.calls[0][1]
    expect('library' in written).toBe(false)
  })

  it('rejects when not signed in', async () => {
    await expect(saveLessonPlanGeneration({ planJson: plan })).rejects.toThrow(/sign in/i)
    expect(addDocMock).not.toHaveBeenCalled()
  })

  it('rejects when there is no plan', async () => {
    await expect(saveLessonPlanGeneration({ uid: 'u1', planJson: null })).rejects.toThrow(/generate a plan/i)
    expect(addDocMock).not.toHaveBeenCalled()
  })
})

describe('duplicateGeneration', () => {
  beforeEach(() => addDocMock.mockClear())

  // The exact top-level keys the firestore.rules client-tool create rule
  // permits (keys().hasOnly([...])). Keep in sync with firestore.rules.
  const CLIENT_CREATE_KEYS = new Set([
    'ownerUid', 'tool', 'status', 'visibility',
    'createdAt', 'inputs', 'output', 'library',
  ])

  const item = {
    id: 'gen-1',
    ownerUid: 'u1',
    tool: 'mark_schedule',
    status: 'complete',
    visibility: 'private',
    inputs: { grade: 'G5', term: '1', subject: null, topic: 'Term 1 mark schedule' },
    output: { header: { grade: 'G5', term: 1 }, pupils: [{ name: 'A' }] },
    library: { libraryType: 'mark_schedules' },
    // Read-only fields that must NOT leak into the copy:
    exportedFormats: ['docx'],
    teacherEdited: true,
    createdAt: { seconds: 1 },
  }

  it('writes a rules-compliant copy owned by the caller and returns the new id', async () => {
    const id = await duplicateGeneration(item, 'u1')
    expect(id).toBe('gen-123')
    const written = addDocMock.mock.calls[0][1]
    expect(written.ownerUid).toBe('u1')
    expect(written.tool).toBe('mark_schedule')
    expect(written.status).toBe('complete')
    expect(written.visibility).toBe('private')
    expect(written.createdAt).toBe('SERVER_TS') // fresh timestamp, not the original's
    expect(written.inputs).toEqual(item.inputs)
    expect(written.output).toEqual(item.output)
    expect(written.library).toEqual(item.library)
    // CRITICAL: no leaked read-only keys — the create rule's keys().hasOnly
    // would reject the whole write.
    for (const key of Object.keys(written)) {
      expect(CLIENT_CREATE_KEYS.has(key)).toBe(true)
    }
  })

  it('omits library when the source has none', async () => {
    await duplicateGeneration({ ...item, library: undefined }, 'u1')
    expect('library' in addDocMock.mock.calls[0][1]).toBe(false)
  })

  it('rejects AI-generated tools (client cannot create those docs)', async () => {
    await expect(duplicateGeneration({ ...item, tool: 'worksheet' }, 'u1'))
      .rejects.toThrow(/cannot be duplicated/i)
    expect(addDocMock).not.toHaveBeenCalled()
  })

  it('rejects when signed out or when the doc has no output', async () => {
    await expect(duplicateGeneration(item, null)).rejects.toThrow(/sign in/i)
    await expect(duplicateGeneration({ ...item, output: null }, 'u1'))
      .rejects.toThrow(/no content/i)
    expect(addDocMock).not.toHaveBeenCalled()
  })

  it('covers every client-creatable tool from firestore.rules', () => {
    expect(CLIENT_CREATED_TOOLS.sort()).toEqual([
      'class_timetable', 'mark_schedule', 'record_of_work',
      'sba_mark_sheet', 'sba_plan', 'weekly_forecast',
    ])
  })
})

// getGeneration must tell a genuinely missing/foreign doc (→ null → "Not found")
// from a transient load failure (→ re-throw → retryable panel). The subtlety is
// the owner-only read rule: for a normal teacher a deleted OR foreign doc is
// DENIED (permission-denied) rather than returned empty, so snap.exists() is
// never reached for those — the classification hinges on the error code.
describe('getGeneration — missing/foreign vs load failure', () => {
  beforeEach(() => getDoc.mockReset())

  it('returns null for a falsy id without touching Firestore', async () => {
    expect(await getGeneration('')).toBeNull()
    expect(getDoc).not.toHaveBeenCalled()
  })

  it('maps permission-denied (deleted/foreign under owner-only rules) to null', async () => {
    getDoc.mockRejectedValueOnce(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }))
    expect(await getGeneration('gone')).toBeNull()
  })

  it('returns null when an admin reads a truly deleted doc (snap does not exist)', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => false })
    expect(await getGeneration('deleted')).toBeNull()
  })

  it('re-throws a transient failure so the caller can offer a retry', async () => {
    getDoc.mockRejectedValueOnce(Object.assign(new Error('backend unavailable'), { code: 'unavailable' }))
    await expect(getGeneration('g1')).rejects.toThrow(/unavailable/i)
  })

  it('returns the normalised doc when the read succeeds', async () => {
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      id: 'g1',
      data: () => ({ ownerUid: 'u1', tool: 'worksheet', inputs: { grade: 'G4' }, output: {} }),
    })
    const row = await getGeneration('g1')
    expect(row.id).toBe('g1')
    expect(row.tool).toBe('worksheet')
  })
})

describe('summarizeGenerations', () => {
  it('counts rows per snake_cased tool id and skips rows without a tool', () => {
    const rows = [
      { tool: 'lesson_plan' },
      { tool: 'lesson_plan' },
      { tool: 'scheme_of_work' },
      { tool: 'full_lesson' },
      { tool: null },
      {},
    ]
    const summary = summarizeGenerations(rows)
    expect(summary.total).toBe(6)
    expect(summary.byTool.lesson_plan).toBe(2)
    expect(summary.byTool.scheme_of_work).toBe(1)
    expect(summary.byTool.full_lesson).toBe(1)
    // byTool must be keyed by the raw Firestore tool ids — never dash-cased.
    for (const key of Object.keys(summary.byTool)) {
      expect(key).not.toContain('-')
    }
  })

  it('resolves counts via the exact lookup StudioCard performs for every dashboard libraryKey', () => {
    // The dash-cased libraryKeys used by TeacherDashboard STUDIO_GROUPS tiles.
    // StudioCard reads byTool[libraryKey.replace(/-/g, '_')]; if byTool were
    // ever re-keyed (the "0 saved" bug), this fails for every multi-word key.
    const LIBRARY_KEYS = [
      'scheme-of-work', 'weekly-forecast', 'lesson-plan', 'record-of-work',
      'class-timetable', 'notes', 'worksheet', 'flashcards', 'exam-paper',
      'rubric', 'sba-task', 'mark-schedule', 'homework',
    ]
    const rows = LIBRARY_KEYS.map((key) => ({ tool: key.replace(/-/g, '_') }))
    const { byTool } = summarizeGenerations(rows)
    for (const key of LIBRARY_KEYS) {
      expect(byTool[key.replace(/-/g, '_')]).toBe(1)
    }
  })

  it('handles empty and missing input', () => {
    expect(summarizeGenerations([])).toEqual({ total: 0, byTool: {} })
    expect(summarizeGenerations()).toEqual({ total: 0, byTool: {} })
  })
})

// Regression: getItemPermissions checked item.ownerUid === userProfile.uid but
// AuthContext stores profiles as { id: uid, ...data } (no uid field on the doc).
// The fix: userProfile.uid ?? userProfile.id — covers both old and new shapes.
describe('getItemPermissions — uid ?? id ownership check', () => {
  it('grants download to a Pro teacher whose profile has only id (AuthContext shape)', () => {
    // AuthContext profile: { id: <uid>, ...Firestore data }  ← no uid field
    const userProfile = { id: 'u1', subscriptionTier: 'pro' }
    const item = { ownerUid: 'u1' }
    const { canDownload } = getItemPermissions({ userProfile, item })
    expect(canDownload).toBe(true)
  })

  it('grants download to a Pro teacher whose profile has uid field (legacy shape)', () => {
    const userProfile = { uid: 'u1', subscriptionTier: 'pro' }
    const item = { ownerUid: 'u1' }
    const { canDownload } = getItemPermissions({ userProfile, item })
    expect(canDownload).toBe(true)
  })

  it('denies download on a Pro teacher\'s non-owned item', () => {
    const userProfile = { id: 'u1', subscriptionTier: 'pro' }
    const item = { ownerUid: 'u2' }
    const { canDownload } = getItemPermissions({ userProfile, item })
    expect(canDownload).toBe(false)
  })

  it('grants full access to admin regardless of ownership or profile shape', () => {
    const userProfile = { id: 'u1' }
    const item = { ownerUid: 'u2' }
    const { canDownload, canExport } = getItemPermissions({ userProfile, isAdmin: true, item })
    expect(canDownload).toBe(true)
    expect(canExport).toBe(true)
  })
})

describe('homework library metadata', () => {
  it('has TOOL_META and a filter option (homework used to fall through to generic)', () => {
    expect(TOOL_META.homework?.label).toBe('Homework')
    expect(TOOL_META.homework?.route).toBe('/teacher/generate/homework')
    expect(TOOL_FILTER_OPTIONS.some((o) => o.value === 'homework')).toBe(true)
  })

  it('titles a homework generation from header.title, then topic, never "Generation"', () => {
    expect(titleForGeneration({ tool: 'homework', output: { header: { title: 'Fractions homework' } } }))
      .toBe('Fractions homework')
    expect(titleForGeneration({ tool: 'homework', inputs: { topic: 'Fractions', grade: 'G5' } }))
      .toBe('Homework — Fractions · G5')
    expect(titleForGeneration({ tool: 'homework' })).toBe('Homework')
  })
})

describe('listMyGenerations — request de-duplication', () => {
  beforeEach(() => {
    __resetRequestDeduplicationForTests()
    getDocs.mockReset()
  })

  it('two concurrent callers for the same teacher share one Firestore read', async () => {
    getDocs.mockResolvedValue(fakeSnap([{ id: 'g1', tool: 'lesson_plan', inputs: {} }]))

    const [a, b] = await Promise.all([
      listMyGenerations({ uid: 'teacher-1' }),
      listMyGenerations({ uid: 'teacher-1' }),
    ])

    expect(getDocs).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
  })

  it('different teachers never share a request', async () => {
    getDocs
      .mockResolvedValueOnce(fakeSnap([{ id: 'g1', tool: 'lesson_plan', inputs: {}, ownerUid: 'teacher-1' }]))
      .mockResolvedValueOnce(fakeSnap([{ id: 'g2', tool: 'lesson_plan', inputs: {}, ownerUid: 'teacher-2' }]))

    const [a, b] = await Promise.all([
      listMyGenerations({ uid: 'teacher-1' }),
      listMyGenerations({ uid: 'teacher-2' }),
    ])

    expect(getDocs).toHaveBeenCalledTimes(2)
    expect(a[0].id).toBe('g1')
    expect(b[0].id).toBe('g2')
  })

  it('a different filter combination for the same teacher is a separate request', async () => {
    getDocs.mockResolvedValue(fakeSnap([
      { id: 'g1', tool: 'lesson_plan', inputs: { grade: 'G4' } },
      { id: 'g2', tool: 'worksheet', inputs: { grade: 'G4' } },
    ]))

    await Promise.all([
      listMyGenerations({ uid: 'teacher-1' }),
      listMyGenerations({ uid: 'teacher-1', tool: 'worksheet' }),
    ])

    expect(getDocs).toHaveBeenCalledTimes(2)
  })

  it('a failed read is not cached — the next call retries against Firestore', async () => {
    getDocs.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'unavailable' }))
    await expect(listMyGenerations({ uid: 'teacher-1' })).rejects.toThrow()

    getDocs.mockResolvedValueOnce(fakeSnap([{ id: 'g1', tool: 'lesson_plan', inputs: {} }]))
    const rows = await listMyGenerations({ uid: 'teacher-1' })
    expect(rows).toHaveLength(1)
  })
})
