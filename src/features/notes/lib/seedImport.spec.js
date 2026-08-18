/**
 * seedImport — the Grade-7 seeder's convergence rules.
 *
 * The bug pinned here: `createNote` always writes `isPublished: false`, and
 * only the CREATE path published the note. A note that existed but had never
 * been published — an import that died between the create and the publish, or
 * one an admin unpublished — was invisible to every learner, while each
 * re-run reported "updated" or "skipped" and looked like it had worked.
 * Nothing on the learner side reads an unpublished note, so the note was
 * missing from the app rather than merely stale: absent from the notes list,
 * absent from the subject page (`where('isPublished','==',true)`), and absent
 * from the term plan's topic rows that name it.
 *
 * These are behaviour tests against fake deps — the importer's whole job is
 * deciding WHICH writes to make, so what matters is the calls it makes, not
 * the values it returns.
 */
import { describe, it, expect, vi } from 'vitest'
import { importGrade7Seed } from './seedImport'

const DIGESTION = 'g7sci_n_1_1'

/** Fake deps. `existing` maps seedKey → the note doc findBySeedKey returns. */
function deps(existing = {}) {
  const d = {
    createQuiz: vi.fn(async () => 'quiz-new'),
    saveQuestions: vi.fn(async () => {}),
    createNote: vi.fn(async () => 'note-new'),
    updateNote: vi.fn(async () => {}),
    publishNote: vi.fn(async () => {}),
    // Every seeded quiz link is healthy unless a test says otherwise, so
    // quiz churn cannot be mistaken for the note behaviour under test.
    getQuizById: vi.fn(async () => ({ isPublished: true })),
    findBySeedKey: vi.fn(async (key) => existing[key] || null),
    currentUid: 'admin-1',
    onProgress: vi.fn(),
  }
  return d
}

/** The seeded note as it stands in the bundle, so content compares equal. */
async function seededNote(seedKey, overrides = {}) {
  const { default: seed } = await import('../seed/grade7Seed.json')
  const note = seed.notes.find((n) => n.seedKey === seedKey)
  const blocks = JSON.parse(JSON.stringify(note.blocks))
  // Mirror what a successful earlier import left behind: the quiz block
  // carries a real quizId and no quizKey.
  for (const b of blocks) {
    if (b.type === 'quiz') { b.quizId = 'quiz-existing'; delete b.quizKey }
  }
  return { id: 'note-1', seedKey, blocks, isPublished: true, ...overrides }
}

const eventFor = (d, seedKey) =>
  d.onProgress.mock.calls.map((c) => c[0]).find((e) => e.seedKey === seedKey)

describe('importGrade7Seed — learner visibility', () => {
  it('publishes an existing note that was never published, even when its content is already right', async () => {
    const note = await seededNote(DIGESTION, { isPublished: false })
    const d = deps({ [DIGESTION]: note })

    const summary = await importGrade7Seed(d)

    expect(d.publishNote).toHaveBeenCalledWith('note-1')
    expect(summary.published).toBeGreaterThanOrEqual(1)
    // Content was already correct, so it must NOT be rewritten…
    expect(d.updateNote).not.toHaveBeenCalledWith('note-1', expect.anything())
    // …and the admin must be told what actually happened.
    expect(eventFor(d, DIGESTION)).toMatchObject({ status: 'published', republished: true })
  })

  it('publishes AND updates a note that is both stale and unpublished', async () => {
    const note = await seededNote(DIGESTION, { isPublished: false, blocks: [{ type: 'paragraph', text: 'an older version' }] })
    const d = deps({ [DIGESTION]: note })

    const summary = await importGrade7Seed(d)

    expect(d.updateNote).toHaveBeenCalledWith('note-1', { blocks: expect.any(Array) })
    expect(d.publishNote).toHaveBeenCalledWith('note-1')
    expect(summary.updated).toBeGreaterThanOrEqual(1)
    expect(eventFor(d, DIGESTION)).toMatchObject({ status: 'updated', republished: true })
  })

  it('leaves an already-published, already-current note completely alone', async () => {
    const note = await seededNote(DIGESTION)
    const d = deps({ [DIGESTION]: note })

    await importGrade7Seed(d)

    expect(d.publishNote).not.toHaveBeenCalledWith('note-1')
    expect(d.updateNote).not.toHaveBeenCalledWith('note-1', expect.anything())
    expect(eventFor(d, DIGESTION)).toMatchObject({ status: 'skipped' })
  })

  it('treats a missing isPublished field as unpublished', async () => {
    // Fail-closed: a doc predating the field is not evidence of visibility.
    const note = await seededNote(DIGESTION)
    delete note.isPublished
    const d = deps({ [DIGESTION]: note })

    await importGrade7Seed(d)

    expect(d.publishNote).toHaveBeenCalledWith('note-1')
  })

  it('still creates and publishes a note that does not exist yet', async () => {
    const d = deps({})
    const summary = await importGrade7Seed(d)

    expect(summary.created).toBe(summary.total)
    expect(d.publishNote).toHaveBeenCalledWith('note-new')
    expect(eventFor(d, DIGESTION)).toMatchObject({ status: 'created' })
  })
})
