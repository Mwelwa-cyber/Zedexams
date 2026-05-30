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

/**
 * Run the import. `deps` supplies the write functions (from useFirestore + the
 * notes lib) and an existence check so the caller owns all Firestore access.
 * Returns a summary; calls onProgress({ seedKey, title, status, quizId?, error? })
 * per note ('created' | 'skipped' | 'failed').
 */
export async function importGrade7Seed({
  createQuiz, saveQuestions, createNote, publishNote, findBySeedKey, currentUid, onProgress,
}) {
  const summary = { total: (seed.notes || []).length, created: 0, skipped: 0, failed: 0, quizzes: 0 }

  for (const note of seed.notes || []) {
    try {
      if (await findBySeedKey(note.seedKey)) {
        summary.skipped++
        onProgress?.({ seedKey: note.seedKey, title: note.title, status: 'skipped' })
        continue
      }

      // Deep-clone so a retry starts from the pristine bundle.
      const blocks = JSON.parse(JSON.stringify(note.blocks || []))
      const quizBlock = blocks.find((b) => b.type === 'quiz' && b.quizKey)
      let quizId = null

      if (quizBlock) {
        const questions = buildSeedQuestions(seed.quizzes[quizBlock.quizKey], note.title)
        if (questions.length) {
          quizId = await createQuiz({
            title: `${note.title} — Practice Quiz`,
            subject: note.subject, grade: note.grade, term: '', description: '',
            passages: [], parts: [], passageCount: 0,
            totalMarks: questions.reduce((s, q) => s + (q.marks || 1), 0),
            questionCount: questions.length,
            isPublished: true, status: 'published',
            createdBy: currentUid, quizType: 'practice', mode: 'seed_import',
          })
          await saveQuestions(quizId, questions)
          quizBlock.quizId = quizId
          quizBlock.quizTitle = `${note.title} — Practice Quiz`
          quizBlock.questionCount = questions.length
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
