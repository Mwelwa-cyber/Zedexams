/**
 * BulkPublishQuizzesButton — generate + save a learner-facing quiz for
 * each topic in the current CBC KB filter. Unlike BulkGenerateButton
 * (which queues agent briefs producing teacher artifacts), this one
 * writes directly to the public quizzes collection so learners see the
 * quizzes immediately.
 *
 * Why this exists: the project owner asked for "agents that produce
 * quizzes I review and approve". The agent pipeline doesn't drive the
 * quiz path (quizzes go through the synchronous generateQuizQuestions
 * callable + Vex verifier), so a separate bulk action is needed to
 * close that gap.
 *
 * Workflow:
 *   1. For each topic (capped at MAX_BATCH to limit cost):
 *      a. generateAIQuizQuestions → returns MCQs grounded on the KB
 *      b. createQuiz → writes a quiz doc with isPublished:false (draft)
 *      c. saveQuestions → batched write of normalized questions
 *   2. Reports per-topic progress, surfaces partial failures, and
 *      navigates to /admin/content on completion so the admin can
 *      review and publish.
 *
 * Quizzes are saved as drafts by default. The admin reviews, then
 * publishes via the standard Manage Content flow. No content reaches
 * learners until the human flips isPublished.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { generateAIQuizQuestions } from '../../utils/aiAssistant'
import { normalizeSubject, SUBJECT_LABELS } from '../../config/curriculum.js'

const MAX_BATCH = 10
const QUESTIONS_PER_QUIZ = 5

// Learner-facing quizzes collection only accepts grades 4-7 per the
// Firestore rules' _validGrade helper (PSLE focus). Filtering here
// keeps the bulk action consistent with the rule — a topic for G8+
// would fail at addDoc with 'permission-denied' otherwise.
const LEARNER_GRADES = new Set(['4', '5', '6', '7'])

function gradeForLearnerCollection(grade) {
  // The CBC KB uses 'G6' / 'G7' / 'ECE'. The learner-facing /quizzes
  // page filters by plain '4'/'5'/'6'/'7'. Strip the leading 'G' so
  // saved quizzes appear in the right grade chip.
  const v = String(grade || '').toUpperCase()
  if (v.startsWith('G')) return v.slice(1)
  return v
}

function subjectForLearnerCollection(subject) {
  // The KB stores subject as a lowercase key ('mathematics', 'expressive_arts',
  // 'integrated_science'); the learner-facing list filters on the canonical
  // display label ('Mathematics', 'Expressive Art', 'Integrated Science').
  // Route the KB key through normalizeSubject — its SUBJECT_SLUG_TO_LABEL map
  // covers the underscore variants and the integrated_science alias, so e.g.
  // 'expressive_arts' resolves to 'Expressive Art' (singular) rather than the
  // naive title-cased 'Expressive Arts' that would never match the filter.
  const key = String(subject || '')
  const normalized = normalizeSubject(key)
  if (SUBJECT_LABELS.includes(normalized)) return normalized
  // Unrecognised key: fall back to the old title-case heuristic so we never
  // write an empty subject.
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function BulkPublishQuizzesButton({ topics }) {
  const { currentUser } = useAuth()
  const { createQuiz, saveQuestions } = useFirestore()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' })
  const [results, setResults] = useState({ saved: 0, failed: [] })

  const eligible = Array.isArray(topics) ?
    topics.filter((t) => {
      if (!t || !t.grade || !t.subject || !t.topic) return false
      // Match the Firestore rule — refuse to even attempt a write that
      // would land in permission-denied.
      return LEARNER_GRADES.has(gradeForLearnerCollection(t.grade))
    }) : []
  const skippedNonPsle = Array.isArray(topics) ?
    topics.filter((t) => t && t.grade && t.subject && t.topic
      && !LEARNER_GRADES.has(gradeForLearnerCollection(t.grade))).length : 0
  const count = Math.min(eligible.length, MAX_BATCH)

  if (eligible.length === 0) return null

  async function handleRun() {
    if (!currentUser?.uid || count === 0) return
    setBusy(true)
    setResults({ saved: 0, failed: [], warnings: [] })
    setProgress({ done: 0, total: count, label: 'Starting…' })
    const slice = eligible.slice(0, count)
    const failed = []
    const warnings = []
    let saved = 0

    for (let i = 0; i < slice.length; i++) {
      const t = slice[i]
      setProgress({ done: i, total: count, label: `Generating "${t.topic}"…` })
      try {
        const { questions, warning: kbWarning } = await generateAIQuizQuestions({
          subject: subjectForLearnerCollection(t.subject),
          grade: gradeForLearnerCollection(t.grade),
          topic: t.topic,
          count: QUESTIONS_PER_QUIZ,
          type: 'mcq',
        })
        // KB-grounding warnings are non-fatal — the AI fell back to general
        // CBC knowledge instead of the verified topic. Surface them so the
        // admin knows which drafts likely deserve more careful review.
        if (kbWarning) {
          warnings.push({ topic: t.topic, warning: kbWarning })
        }
        const usable = Array.isArray(questions) ? questions.filter((q) => {
          if (!q || typeof q !== 'object') return false
          if (!String(q.text || '').trim()) return false
          const opts = Array.isArray(q.options) ?
            q.options.filter((o) => String(o ?? '').trim()) : []
          return opts.length >= 2
        }) : []
        if (usable.length === 0) {
          failed.push({ topic: t.topic, error: 'No usable questions returned.' })
          continue
        }

        setProgress({ done: i, total: count, label: `Saving "${t.topic}"…` })
        const quizId = await createQuiz({
          title: `Grade ${gradeForLearnerCollection(t.grade)} ${subjectForLearnerCollection(t.subject)} — ${t.topic}`,
          subject: subjectForLearnerCollection(t.subject),
          grade: gradeForLearnerCollection(t.grade),
          term: t.term ? String(t.term) : '',
          description: `Auto-drafted quiz on ${t.topic} (review before publishing).`,
          passages: [],
          parts: [],
          passageCount: 0,
          totalMarks: usable.length,
          questionCount: usable.length,
          isPublished: false,
          status: 'draft',
          createdBy: currentUser.uid,
          durationMinutes: 15,
          quizType: 'practice',
        })
        await saveQuestions(quizId, usable)
        saved += 1
      } catch (err) {
        failed.push({
          topic: t.topic,
          error: err?.message || 'Unknown error',
        })
      }
    }

    setResults({ saved, failed, warnings })
    setProgress({ done: count, total: count, label: 'Done.' })
    setBusy(false)
    // Only auto-navigate when everything was clean — leave the admin on
    // the modal so they can read the failures / warnings before moving on.
    if (saved > 0 && failed.length === 0 && warnings.length === 0) {
      setTimeout(() => navigate('/admin/content'), 1500)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-xl text-sm font-black text-white bg-gradient-to-r from-sky-600 to-cyan-500 disabled:opacity-50"
        title={`Generate + save ${count} learner-facing quiz draft${count === 1 ? '' : 's'} from the current filter`}
      >
        ✏️ Bulk publish quizzes ({count})
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="font-black text-lg text-slate-900">Bulk publish quizzes</h3>
            <p className="text-xs text-slate-600 mt-1">
              Generates a {QUESTIONS_PER_QUIZ}-question MCQ quiz for each filtered topic and saves it as a draft to <code>quizzes/</code>. Capped at {MAX_BATCH} per click.
            </p>

            <div className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-900">
              <p className="font-black">{count} quiz draft{count === 1 ? '' : 's'} will be created</p>
              <p className="mt-0.5 text-sky-700">
                Saved as <code>isPublished: false</code> — review in /admin/content and click Publish when you're ready.
              </p>
              {skippedNonPsle > 0 && (
                <p className="mt-1 text-amber-700">
                  ⚠ {skippedNonPsle} topic{skippedNonPsle === 1 ? '' : 's'} skipped — quizzes only support Grades 4–7 (PSLE focus).
                </p>
              )}
            </div>

            {busy && (
              <div className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">
                <p className="font-black">{progress.done} / {progress.total}</p>
                <p className="mt-0.5 truncate text-slate-600">{progress.label}</p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-sky-500 transition-all"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}

            {!busy && results.saved > 0 && (
              <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800 font-black">
                ✓ Saved {results.saved} quiz{results.saved === 1 ? '' : 'zes'} as draft{results.saved === 1 ? '' : 's'}.
                {results.failed?.length === 0 && results.warnings?.length === 0 && ' Redirecting to /admin/content…'}
              </p>
            )}
            {!busy && results.warnings?.length > 0 && (
              <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <p className="font-black">{results.warnings.length} draft{results.warnings.length === 1 ? '' : 's'} need closer review</p>
                <p className="mt-0.5 text-amber-700/90">
                  The AI couldn't ground these on a verified KB topic — it fell back to general CBC knowledge. Read them carefully before publishing.
                </p>
                <ul className="mt-1 list-disc list-inside text-amber-700">
                  {results.warnings.slice(0, 5).map((w, i) => (
                    <li key={i}><strong>{w.topic}</strong>: {w.warning}</li>
                  ))}
                  {results.warnings.length > 5 && (
                    <li className="italic">…and {results.warnings.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
            {!busy && results.failed?.length > 0 && (
              <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800">
                <p className="font-black">{results.failed.length} failed</p>
                <ul className="mt-1 list-disc list-inside text-rose-700">
                  {results.failed.slice(0, 5).map((f, i) => (
                    <li key={i}><strong>{f.topic}</strong>: {f.error}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { if (!busy) setOpen(false) }}
                disabled={busy}
                className="px-3 py-2 rounded-xl text-xs font-black text-slate-600 hover:text-slate-800 disabled:opacity-50"
              >
                {results.saved > 0 ? 'Close' : 'Cancel'}
              </button>
              {results.saved === 0 && (
                <button
                  type="button"
                  onClick={handleRun}
                  disabled={busy || count === 0}
                  className="px-4 py-2 rounded-xl text-xs font-black text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50"
                >
                  {busy ? 'Running…' : `Generate + save ${count}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
