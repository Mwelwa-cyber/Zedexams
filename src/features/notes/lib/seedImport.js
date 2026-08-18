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
 * `getQuizById(id)` (optional, admin-readable) is used to VERIFY a note's linked
 * quiz is a real, published quiz; if it's missing or unpublished the quiz is
 * re-created from the bank so learners can actually open it.
 *
 * Per note (convergent + idempotent — safe to re-run):
 *   - new (no seedKey match)        → create note + quiz, publish        → 'created'
 *   - exists, content differs (e.g. new diagrams) or its quiz link was
 *     broken/unpublished and got re-created → updateNote refreshed blocks → 'updated'
 *   - exists, content already right but the NOTE was unpublished, so no
 *     learner could open it                 → publishNote               → 'published'
 *   - exists, identical content + a healthy published quiz               → 'skipped'
 *
 * A healthy existing quiz link is reused (never duplicated); a broken one
 * (missing doc or isPublished:false) is repaired by creating a fresh published
 * quiz and relinking — this is what fixes the Social Studies notes whose linked
 * quizzes never became learner-readable.
 */
export async function importGrade7Seed({
  createQuiz, saveQuestions, createNote, updateNote, publishNote, findBySeedKey, getQuizById, currentUid, onProgress,
}) {
  const deps = { createQuiz, saveQuestions, currentUid }
  const summary = { total: (seed.notes || []).length, created: 0, updated: 0, published: 0, skipped: 0, failed: 0, quizzes: 0, repaired: 0 }

  for (const note of seed.notes || []) {
    try {
      const existing = await findBySeedKey(note.seedKey)

      // Desired blocks from the bundle (deep-cloned so a retry stays pristine).
      const blocks = JSON.parse(JSON.stringify(note.blocks || []))
      const quizBlock = blocks.find((b) => b.type === 'quiz')

      // Resolve the quiz link: reuse a HEALTHY existing quiz, else (re)create it.
      let createdQuiz = false
      if (quizBlock) {
        const existingQuiz = Array.isArray(existing?.blocks) ? existing.blocks.find((b) => b.type === 'quiz') : null
        const existingQuizId = existingQuiz?.quizId ? String(existingQuiz.quizId).trim() : ''

        // A link is only healthy if the quiz doc exists AND is published — an
        // orphaned or unpublished id renders as "Quiz not found" for learners.
        let healthy = false
        if (existingQuizId) {
          if (!getQuizById) { healthy = true } // no checker → trust it (back-compat)
          else { let live = null; try { live = await getQuizById(existingQuizId) } catch { live = null } healthy = !!(live && live.isPublished) }
        }

        if (existingQuizId && healthy) {
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
            if (existingQuizId) summary.repaired++ // had a (broken) link before
          } else {
            quizBlock.quizId = existingQuizId || ''
          }
        } else {
          quizBlock.quizId = existingQuizId || ''
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
      if (changed) await updateNote(existing.id, { blocks })

      // …and make sure it is actually LEARNER-VISIBLE. createNote always
      // writes `isPublished: false` and only the create path above published
      // it, so a note that exists but was never published — an import that
      // died between the create and the publish, or one an admin unpublished
      // — stayed invisible to every learner while each re-run reported
      // "updated"/"skipped" and looked like it had worked. Nothing on the
      // learner side reads an unpublished note: the notes list, the subject
      // page's `where('isPublished','==',true)` query and the term plan's
      // topic rows all skip it, so the note is missing from the app rather
      // than merely stale. This is the same repair the quiz link above
      // already gets, applied to the note itself.
      const republished = existing.isPublished !== true
      if (republished) await publishNote(existing.id)

      if (changed) {
        summary.updated++
        if (republished) summary.published++
        onProgress?.({ seedKey: note.seedKey, title: note.title, status: 'updated', republished, quizId: quizBlock?.quizId })
      } else if (republished) {
        // Content was already right; what was wrong is that nobody could see
        // it. Reported as its own status so the admin reads what happened.
        summary.published++
        onProgress?.({ seedKey: note.seedKey, title: note.title, status: 'published', republished: true, quizId: quizBlock?.quizId })
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
