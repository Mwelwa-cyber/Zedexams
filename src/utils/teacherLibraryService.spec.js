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

import { saveLessonPlanGeneration, summarizeGenerations } from './teacherLibraryService'

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
      'rubric', 'sba-task', 'mark-schedule', 'homework', 'full-lesson',
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
