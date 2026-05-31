// src/features/notes/lib/seedImport.js
//
// One-click admin seeder: creates the Grade-7 study notes (Integrated Science +
// Social Studies) from the committed bundle (seed/grade7Seed.json), creates +
// publishes each note's practice quiz where one exists, and links them.
// Idempotent per note via seedKey. Each note carries its own subject/grade.
//
// Reuses the app's gated write paths:
//   - questions: standalone item → CSV row → rowToQuestion (same as /admin/import/csv)
//   - quiz doc:  createQuiz (quizWriteSchema-validated), published directly (admin)
//   - notes:     createNote (noteFormat 'study') + publishNote
// Quiz/diagram images resolve to /notes/<file> (committed in public/notes/).

import seed from '../seed/grade7Seed.json'
import { rowToQuestion } from '../../../utils/csvQuizImport'

/** Counts for the pre-import confirmation. */
export function seedSummary() {
  const quizzes = Object.keys(seed.quizzes || {}).length
  const questions = Object.values(seed.quizzes || {}).reduce((s, items) => s + (items?.length || 0), 0)
  return { notes: (seed.notes || []).length, quizzes, questions }
}

/** Standalone quiz items → gated question objects (reuses the CSV import path). */
export function buildSeedQuestions(items, topic) {
  return (items || []).map((it) => {
    const opts = Array.isArray(it.options) ? it.options : []
    const letter = 'ABCD'[it.answer] || String((Number(it.answer) || 0) + 1)
    const row = [
      'mcq', String(it.q || ''),
      String(opts[0] || ''), String(opts[1] || ''), String(opts[2] || ''), String(opts[3] || ''),
      letter, '', topic || '', '1', '', String(it.explanation || ''),
      it.image ? `/notes/${it.image}` : '',
    ]
    return rowToQuestion(row)
  }).filter((r) => r.status !== 'error').map((r) => r.question)
}

/** Create a published practice quiz for `note` from bundle bank `quizKey`.
 *  Returns { quizId, count } or null when the bank yields no valid questions. */
async function createNoteQuiz(note, quizKey, { createQuiz, saveQuestions, currentUid }) {
  const questions = buildSeedQuestions(seed.quizzes[quizKey], note.title)
  if (!questions.length) return null
  const quizId = await createQuiz({
    title: `${note.title} — Practice Quiz`,
    subject: note.subject, grade: note.grade, term: '', description: '',
    passages: [], parts: [], passageCount: 0,
    totalMarks: questions.reduce((s, q) => s + (q.marks || 1), 0),
    questionCount: questions.length,
    isPublished: true, status: 'published',
    createdBy: currentUid, quizType: 'practice', mode: 'seed_import',
  })
  await saveQuestions(quizId, questions)
  return { quizId, count: questions.length }
}

/**
 * Run the import. `deps` supplies the write functions (useFirestore + notes lib)
 * and `findBySeedKey(key)` → the existing note doc `{ id, ...data }` or null.
 *
 * Per note:
 *   - new (no seedKey match)                       → create note + quiz, publish → 'created'
 *   - exists, its quiz block isn't linked yet, and the bundle has a quiz for it
 *     → create + link the quiz (updateNote)                                      → 'relinked'
 *   - exists + already linked, or has no quiz                                    → 'skipped'
 *
 * Convergent + idempotent: re-running backfills quizzes for notes that were
 * imported before their quiz banks existed, without duplicating anything.
 */
export async function importGrade7Seed({
  createQuiz, saveQuestions, createNote, updateNote, publishNote, findBySeedKey, currentUid, onProgress,
}) {
  const deps = { createQuiz, saveQuestions, currentUid }
  const summary = { total: (seed.notes || []).length, created: 0, relinked: 0, skipped: 0, failed: 0, quizzes: 0 }

  for (const note of seed.notes || []) {
    try {
      const existing = await findBySeedKey(note.seedKey)

      if (existing) {
        // Backfill a quiz onto an already-imported note that isn't linked yet.
        const bundleQuiz = (note.blocks || []).find((b) => b.type === 'quiz' && b.quizKey)
        const existingBlocks = Array.isArray(existing.blocks) ? existing.blocks : []
        const existingQuiz = existingBlocks.find((b) => b.type === 'quiz')
        const alreadyLinked = existingQuiz && existingQuiz.quizId && String(existingQuiz.quizId).trim()
        if (bundleQuiz && existingQuiz && !alreadyLinked) {
          const made = await createNoteQuiz(note, bundleQuiz.quizKey, deps)
          if (made) {
            const newBlocks = existingBlocks.map((b) => (b.type === 'quiz'
              ? { ...b, quizId: made.quizId, quizTitle: `${note.title} — Practice Quiz`, questionCount: made.count }
              : b))
            await updateNote(existing.id, { blocks: newBlocks })
            summary.relinked++; summary.quizzes++
            onProgress?.({ seedKey: note.seedKey, title: note.title, status: 'relinked', quizId: made.quizId })
            continue
          }
        }
        summary.skipped++
        onProgress?.({ seedKey: note.seedKey, title: note.title, status: 'skipped' })
        continue
      }

      // New note → create note + quiz, publish. Deep-clone so a retry is pristine.
      const blocks = JSON.parse(JSON.stringify(note.blocks || []))
      const quizBlock = blocks.find((b) => b.type === 'quiz' && b.quizKey)
      let quizId = null
      if (quizBlock) {
        const made = await createNoteQuiz(note, quizBlock.quizKey, deps)
        if (made) {
          quizId = made.quizId
          quizBlock.quizId = made.quizId
          quizBlock.quizTitle = `${note.title} — Practice Quiz`
          quizBlock.questionCount = made.count
          summary.quizzes++
        }
        delete quizBlock.quizKey
      }
      const noteId = await createNote({
        title: note.title, subject: note.subject, grade: note.grade,
        noteFormat: 'study', blocks, seedKey: note.seedKey, createdBy: currentUid,
      })
      await publishNote(noteId)
      summary.created++
      onProgress?.({ seedKey: note.seedKey, title: note.title, status: 'created', quizId })
    } catch (err) {
      summary.failed++
      onProgress?.({ seedKey: note.seedKey, title: note.title, status: 'failed', error: err?.message || String(err) })
    }
  }

  return summary
}
