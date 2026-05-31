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

// Recursively sort object keys so two semantically-equal blocks serialise the
// same regardless of field order.
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o }, {})
  }
  return v
}

// Content fingerprint that ignores quiz-linkage churn (quizId/quizKey/title/
// count) so a note only counts as "changed" when its actual teaching content
// (text, diagrams, tables…) differs. Quiz linking is handled separately.
function contentFingerprint(blocks) {
  return JSON.stringify((blocks || []).map((b) => (b.type === 'quiz' ? { type: 'quiz' } : sortKeys(b))))
}

/**
 * Run the import. `deps` supplies the write functions (useFirestore + notes lib)
 * and `findBySeedKey(key)` → the existing note doc `{ id, ...data }` or null.
 *
 * Per note (convergent + idempotent — safe to re-run):
 *   - new (no seedKey match)        → create note + quiz, publish        → 'created'
 *   - exists, content differs from the bundle (e.g. new diagrams), or its
 *     quiz still needs linking        → updateNote with refreshed blocks  → 'updated'
 *   - exists, identical content + already linked                          → 'skipped'
 *
 * Existing quiz links are reused (never duplicated): a note that already has a
 * linked quiz keeps it; only a missing link triggers quiz creation.
 */
export async function importGrade7Seed({
  createQuiz, saveQuestions, createNote, updateNote, publishNote, findBySeedKey, currentUid, onProgress,
}) {
  const deps = { createQuiz, saveQuestions, currentUid }
  const summary = { total: (seed.notes || []).length, created: 0, updated: 0, skipped: 0, failed: 0, quizzes: 0 }

  for (const note of seed.notes || []) {
    try {
      const existing = await findBySeedKey(note.seedKey)

      // Desired blocks from the bundle (deep-cloned so a retry stays pristine).
      const blocks = JSON.parse(JSON.stringify(note.blocks || []))
      const quizBlock = blocks.find((b) => b.type === 'quiz')

      // Resolve the quiz link: reuse an existing one, else create from the bank.
      let createdQuiz = false
      if (quizBlock) {
        const existingQuiz = Array.isArray(existing?.blocks) ? existing.blocks.find((b) => b.type === 'quiz') : null
        const existingQuizId = existingQuiz?.quizId ? String(existingQuiz.quizId).trim() : ''
        if (existingQuizId) {
          quizBlock.quizId = existingQuizId
          quizBlock.quizTitle = existingQuiz.quizTitle || quizBlock.quizTitle || `${note.title} — Practice Quiz`
          if (existingQuiz.questionCount != null) quizBlock.questionCount = existingQuiz.questionCount
        } else if (quizBlock.quizKey && seed.quizzes[quizBlock.quizKey]) {
          const made = await createNoteQuiz(note, quizBlock.quizKey, deps)
          if (made) {
            quizBlock.quizId = made.quizId
            quizBlock.quizTitle = `${note.title} — Practice Quiz`
            quizBlock.questionCount = made.count
            summary.quizzes++; createdQuiz = true
          }
        }
        if (quizBlock.quizId == null) quizBlock.quizId = ''
        delete quizBlock.quizKey
      }

      if (!existing) {
        const noteId = await createNote({
          title: note.title, subject: note.subject, grade: note.grade,
          noteFormat: 'study', blocks, seedKey: note.seedKey, createdBy: currentUid,
        })
        await publishNote(noteId)
        summary.created++
        onProgress?.({ seedKey: note.seedKey, title: note.title, status: 'created', quizId: quizBlock?.quizId })
        continue
      }

      // Existing note: update only when teaching content changed or a quiz was
      // just linked — otherwise leave it (and its updatedAt) untouched.
      const changed = createdQuiz || contentFingerprint(existing.blocks) !== contentFingerprint(blocks)
      if (changed) {
        await updateNote(existing.id, { blocks })
        summary.updated++
        onProgress?.({ seedKey: note.seedKey, title: note.title, status: 'updated', quizId: quizBlock?.quizId })
      } else {
        summary.skipped++
        onProgress?.({ seedKey: note.seedKey, title: note.title, status: 'skipped' })
      }
    } catch (err) {
      summary.failed++
      onProgress?.({ seedKey: note.seedKey, title: note.title, status: 'failed', error: err?.message || String(err) })
    }
  }

  return summary
}
