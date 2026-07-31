import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LIBRARY_TYPES } from '../../config/library.js'

/**
 * The Firestore half of the save path. The decisions are tested under plain
 * node in saveLibraryDocumentCore.test.js; what this file pins is the part only
 * a mock can see — that an update is a NAMED-FIELD MERGE and never a
 * whole-document rewrite, and that the counts are invalidated on the way out.
 */

const setDoc = vi.fn(async () => {})
const updateDoc = vi.fn(async () => {})
let storedDoc = null

vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ __collection: name }),
  doc: (...args) => {
    // doc(db, collection, id) → a pinned ref; doc(collectionRef) → an auto id.
    if (args.length === 1) return { id: 'auto_generated_id', __path: args[0].__collection }
    return { id: args[2], __path: `${args[1]}/${args[2]}` }
  },
  getDoc: async () => ({ exists: () => storedDoc !== null, data: () => storedDoc }),
  serverTimestamp: () => '__server_timestamp__',
  setDoc: (...args) => setDoc(...args),
  updateDoc: (...args) => updateDoc(...args),
}))
vi.mock('../../firebase/config', () => ({ default: {}, db: {} }))

const { saveLibraryDocument, MissingDimensionsError } = await import('./saveLibraryDocument.js')
const { libraryCountCache, readCount } = await import('./libraryCountCache.js')
const { LIBRARY_META_FIELD, folderCountKey, metaPath } = await import('./queries.js')

/** The written metadata, whichever shape the write used. */
const written = (call) => call[1][LIBRARY_META_FIELD] || Object.fromEntries(
  Object.entries(call[1])
    .filter(([k]) => k.startsWith(`${LIBRARY_META_FIELD}.`))
    .map(([k, v]) => [k.slice(LIBRARY_META_FIELD.length + 1), v]),
)

const UID = 'teacher_1'
const FULL_META = {
  curriculum: 'CBC', grade: 'Grade 4', term: 'Term 2', subject: 'Mathematics',
  title: 'Fractions',
}

describe('saveLibraryDocument', () => {
  beforeEach(() => {
    setDoc.mockClear()
    updateDoc.mockClear()
    storedDoc = null
    libraryCountCache.clear()
  })

  it('creates with setDoc and stamps the derived metadata', async () => {
    const result = await saveLibraryDocument({
      studioId: LIBRARY_TYPES.LESSON_PLANS,
      meta: FULL_META,
      payload: { html: '<p>plan</p>' },
      targetState: 'classified',
      uid: UID,
    })

    expect(setDoc).toHaveBeenCalledTimes(1)
    expect(updateDoc).not.toHaveBeenCalled()
    const [, fields] = setDoc.mock.calls[0]
    expect(written(setDoc.mock.calls[0])).toMatchObject({
      createdBy: UID,
      studio: LIBRARY_TYPES.LESSON_PLANS,
      curriculum: 'cbc',
      grade: 'grade-4',
      term: 2,
      subject: 'mathematics',
      libraryState: 'classified',
      classificationState: 'complete',
      libraryMetaVersion: 1,
      scope: 'personal',
      schoolId: null,
    })
    // The studio's body stays at the top level, beside the block…
    expect(fields.html).toBe('<p>plan</p>')
    // …as does the collection's own owner field, which every library query
    // filters on because that is what the read rules gate on.
    expect(fields.ownerUid).toBe(UID)
    expect(result.id).toBe('auto_generated_id')
    expect(result.classificationState).toBe('complete')
  })

  it('updates with a named-field merge — never a whole-document set', async () => {
    storedDoc = {
      ownerUid: UID,
      [LIBRARY_META_FIELD]: {
        createdBy: UID, studio: LIBRARY_TYPES.LESSON_PLANS, libraryState: 'working',
        classificationState: 'needs_sorting', academicYear: 2026, createdAt: 'old_ts',
      },
    }

    await saveLibraryDocument({
      studioId: LIBRARY_TYPES.LESSON_PLANS,
      docId: 'doc_1',
      meta: FULL_META,
      targetState: 'classified',
      uid: UID,
    })

    expect(updateDoc).toHaveBeenCalledTimes(1)
    // The whole point: an update must never go through setDoc, or a concurrent
    // writer's change is silently dropped.
    expect(setDoc).not.toHaveBeenCalled()

    const [ref, fields] = updateDoc.mock.calls[0]
    expect(ref.id).toBe('doc_1')
    // Dot paths, so Firestore merges into the stored map rather than replacing
    // it — a replaced map would drop whatever another writer had just set.
    expect(fields[metaPath('libraryState')]).toBe('classified')
    expect(fields[metaPath('classificationState')]).toBe('complete')
    expect(fields).not.toHaveProperty(metaPath('createdBy'))
    expect(fields).not.toHaveProperty(metaPath('createdAt'))
    expect(fields).not.toHaveProperty(LIBRARY_META_FIELD)
  })

  it('refuses to classify a document that is missing a required dimension', async () => {
    await expect(saveLibraryDocument({
      studioId: LIBRARY_TYPES.LESSON_PLANS,
      meta: { ...FULL_META, grade: null },
      targetState: 'classified',
      uid: UID,
    })).rejects.toThrow(MissingDimensionsError)
    expect(setDoc).not.toHaveBeenCalled()
  })

  it('saves the same document as `working` without validating it', async () => {
    await saveLibraryDocument({
      studioId: LIBRARY_TYPES.LESSON_PLANS,
      meta: { ...FULL_META, grade: null },
      targetState: 'working',
      uid: UID,
    })
    expect(setDoc).toHaveBeenCalledTimes(1)
    expect(written(setDoc.mock.calls[0]).libraryState).toBe('working')
  })

  it('invalidates the folder counts the document landed in', async () => {
    const key = folderCountKey({
      createdBy: UID,
      studio: LIBRARY_TYPES.LESSON_PLANS,
      academicYear: new Date().getFullYear(),
      path: { curriculum: 'cbc', grade: 'grade-4' },
    })
    await readCount(key, async () => 7)
    expect(libraryCountCache.get(key)).toBe(7)

    await saveLibraryDocument({
      studioId: LIBRARY_TYPES.LESSON_PLANS,
      meta: FULL_META,
      targetState: 'classified',
      uid: UID,
    })

    expect(libraryCountCache.get(key)).toBeUndefined()
  })

  it('invalidates BOTH the old and the new path when a document moves', async () => {
    storedDoc = {
      ownerUid: UID,
      [LIBRARY_META_FIELD]: {
        createdBy: UID, studio: LIBRARY_TYPES.LESSON_PLANS, libraryState: 'classified',
        classificationState: 'complete', academicYear: 2026,
        curriculum: 'cbc', grade: 'grade-4', term: 1, subject: 'mathematics',
      },
    }
    const keyFor = (path) => folderCountKey({
      createdBy: UID, studio: LIBRARY_TYPES.LESSON_PLANS, academicYear: 2026, path,
    })
    const oldKey = keyFor({ curriculum: 'cbc', grade: 'grade-4' })
    const newKey = keyFor({ curriculum: 'cbc', grade: 'grade-5' })
    await readCount(oldKey, async () => 2)
    await readCount(newKey, async () => 0)

    await saveLibraryDocument({
      studioId: LIBRARY_TYPES.LESSON_PLANS,
      docId: 'doc_1',
      meta: { ...FULL_META, grade: 'Grade 5' },
      targetState: 'classified',
      uid: UID,
    })

    expect(libraryCountCache.get(oldKey)).toBeUndefined()
    expect(libraryCountCache.get(newKey)).toBeUndefined()
  })
})
