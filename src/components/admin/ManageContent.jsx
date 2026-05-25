import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Search, Plus, Download, X, ChevronRight, Sparkles } from '../ui/icons'
import { useFirestore } from '../../hooks/useFirestore'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import Skeleton from '../ui/Skeleton'
import ConfirmDialog from '../ui/ConfirmDialog'
import { todayString } from '../../utils/examService'
import { EXAM_ONLY_QUESTION_THRESHOLD, isExamOnly } from '../../utils/quizClassification.js'
import { summarizeImportReview } from '../../utils/importReviewSummary.js'
import ImportReviewBadge from '../quiz/ImportReviewBadge'
import SeoHelmet from '../seo/SeoHelmet'

const TABS = [
  { id: 'quizzes', label: '📝 Quizzes' },
  { id: 'lessons', label: '📖 Lessons' },
]

const SUBJECT_COLORS = {
  English:             'bg-purple-100 text-purple-700',
  'Integrated Science':'bg-orange-100 text-orange-700',
  Mathematics:         'bg-blue-100   text-blue-700',
  'Social Studies':    'bg-teal-100   text-teal-700',
  'Expressive Art':    'bg-rose-100   text-rose-700',
  'Technology Studies':'bg-cyan-100   text-cyan-700',
  Cinyanja:            'bg-pink-100   text-pink-700',
  // legacy
  Science:             'bg-orange-100 text-orange-700',
  'Expressive Arts':   'bg-rose-100   text-rose-700',
  'Home Economics':    'bg-pink-100   text-pink-700',
}

const STATUS_CFG = {
  published: { label: 'Published', dot: 'bg-green-500',  pill: 'bg-green-100 text-green-700'   },
  pending:   { label: 'Pending',   dot: 'bg-yellow-400', pill: 'bg-yellow-100 text-yellow-700' },
  draft:     { label: 'Draft',     dot: 'bg-gray-400',   pill: 'bg-gray-100 text-gray-600'     },
  rejected:  { label: 'Rejected',  dot: 'bg-red-500',    pill: 'bg-red-100 text-red-600'       },
}

const SUBJECTS = [
  '', 'English', 'Integrated Science', 'Mathematics', 'Social Studies',
  'Expressive Art', 'Technology Studies', 'Cinyanja', 'Home Economics',
  'Special Paper 1',
]


function Pill({ children, color }) {
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>{children}</span>
}

function StatusPill({ status }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.draft
  return (
    <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 ${cfg.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

// ── Schedule Daily Exam modal ──────────────────────────────────────────────
// ── Assign-to-Daily-Exam modal ─────────────────────────────────────────────
function DailyExamModal({ quiz, onSave, onClose }) {
  // Use local-time date so it matches the student-side todayString() check.
  // toISOString() returns UTC and can be off-by-one near midnight in any
  // non-UTC timezone, which would cause the saved dailyExamDate to never
  // equal "today" on the /exams page.
  const today = todayString()
  const [date,     setDate]     = useState(quiz.dailyExamDate || today)
  const [duration, setDuration] = useState(quiz.durationMinutes || quiz.duration || 45)
  // `isDemo` preserves whatever is already on the quiz — admins can flip it
  // here when turning a quiz into a Daily Exam so that free-tier learners
  // can sit a sample exam without a paid subscription.
  const [isDemo,   setIsDemo]   = useState(!!quiz.isDemo)
  const [saving,   setSaving]   = useState(false)

  async function handleSave() {
    setSaving(true)
    await onSave(quiz, { date, duration: Number(duration), isDemo })
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-black text-gray-800 text-base">🏆 Set as Daily Exam</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <p className="text-xs text-gray-500 mb-4 font-bold line-clamp-2">{quiz.title}</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-black text-gray-600 mb-1">Exam Date</label>
            <input type="date" value={date} min={today}
              onChange={e => setDate(e.target.value)}
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-amber-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-black text-gray-600 mb-1">Duration (minutes)</label>
            <input type="number" value={duration} min={5} max={180}
              onChange={e => setDuration(e.target.value)}
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-amber-500 focus:outline-none" />
            <p className="text-xs text-gray-400 mt-1">Tip: 45–60 min for 50+ question papers</p>
          </div>
          <div className="rounded-xl border-2 theme-border bg-gray-50 px-3 py-2.5">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black text-gray-700">Mark as Demo Exam</p>
                <p className="mt-0.5 text-[11px] font-bold text-gray-500 leading-snug">Visible to learners on free/Demo Access so they can try a sample exam.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isDemo}
                onClick={() => setIsDemo(v => !v)}
                className={`relative h-5 w-10 flex-shrink-0 rounded-full p-0 shadow-none transition-colors ${isDemo ? 'bg-amber-500' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${isDemo ? 'left-5' : 'left-0.5'}`} />
              </button>
            </label>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={handleSave} disabled={saving || !date}
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-black text-sm rounded-xl py-2.5 disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : '🏆 Confirm Daily Exam'}
          </button>
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 text-sm font-bold hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// Long quizzes (≥ EXAM_ONLY_QUESTION_THRESHOLD questions) are exam-only —
// they never appear in the /quizzes practice library and the daily
// auto-picker skips them. Admins pin them as Daily Exam manually whenever
// they want a formal sit-down. isExamOnly / the threshold live in
// utils/quizClassification.js so the in-editor publish path stays in sync.

// ── Quiz row ───────────────────────────────────────────────────────────────
function QuizRow({ quiz, onPublish, onSetDailyExam, onUnassign, onDelete, deleting }) {
  const quizId   = quiz.id || quiz._id || ''
  const quizType = quiz.quizType  // 'practice' | 'daily_exam' | undefined
  const examOnly = isExamOnly(quiz)
  const [showDailyModal, setShowDailyModal] = useState(false)

  const typeIcon  = quizType === 'daily_exam' ? '🏆' : examOnly ? '🏆' : quizType === 'practice' ? '📝' : '📦'
  const qCount    = quiz.questionCount ?? '?'
  const duration  = quiz.durationMinutes || quiz.duration || '?'

  return (
    <>
      {showDailyModal && (
        <DailyExamModal quiz={quiz} onSave={onSetDailyExam} onClose={() => setShowDailyModal(false)} />
      )}
      <div className={`content-card ${
        quizType === 'daily_exam' ? 'border-amber-200' : quizType === 'practice' ? 'border-green-100' : 'opacity-75'
      }`}>
        <div className={`cc-icon ${
          quizType === 'daily_exam' ? 't-amber' : quizType === 'practice' ? 't-mint' : 't-purple'
        }`}>
          <span className="text-base">{typeIcon}</span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-black text-gray-800 text-sm leading-snug line-clamp-2">{quiz.title}</p>
          <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
            <Pill color={SUBJECT_COLORS[quiz.subject] ?? 'bg-gray-100 text-gray-700'}>{quiz.subject}</Pill>
            <Pill color="bg-indigo-100 text-indigo-700">G{quiz.grade}</Pill>
            <Pill color="bg-gray-100 text-gray-600">T{quiz.term}</Pill>
            <Pill color="bg-gray-50 text-gray-500">{qCount}Q · {duration}m</Pill>
            <ImportReviewBadge record={quiz} />
            {quizType === 'daily_exam' && (
              <Pill color="bg-amber-100 text-amber-700">🏆 Daily Exam · {quiz.dailyExamDate}</Pill>
            )}
            {quizType !== 'daily_exam' && examOnly && quiz.isPublished && (
              <Pill color="bg-amber-100 text-amber-700">🏆 Exam only · {qCount}Q</Pill>
            )}
            {quizType === 'practice' && !examOnly && (
              <Pill color="bg-green-100 text-green-700">📝 Practice</Pill>
            )}
            {!quizType && !examOnly && (
              <Pill color="bg-gray-100 text-gray-500">⚠ Unassigned</Pill>
            )}
            {!quizType && examOnly && !quiz.isPublished && (
              <Pill color="bg-gray-100 text-gray-500">⚠ Unpublished</Pill>
            )}
            {quiz.isDemo && (
              <Pill color="bg-sky-100 text-sky-700">🎁 Demo · free-tier</Pill>
            )}
          </div>
          {quiz.rejectionReason && (
            <p className="text-xs text-red-500 mt-1 italic">Rejected: {quiz.rejectionReason}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5 flex-shrink-0 mt-0.5">
          <Link to={quizId ? `/admin/quizzes/${quizId}/edit` : '/admin/content'}
            aria-disabled={!quizId}
            className="btn-edit justify-center">
            ✏️ Edit
          </Link>

          {/* Assignment controls */}
          {!quiz.isPublished && (
            <button onClick={() => onPublish(quiz)}
              className="text-xs font-bold px-3 py-1.5 rounded-full border border-green-300 text-green-700 hover:bg-green-50 min-h-0 transition-colors">
              ✅ Publish
            </button>
          )}
          {quizType !== 'daily_exam' && (
            <button onClick={() => setShowDailyModal(true)}
              className="text-xs font-bold px-3 py-1.5 rounded-full border border-amber-300 text-amber-700 hover:bg-amber-50 min-h-0 transition-colors">
              🏆 Daily Exam
            </button>
          )}
          {(quizType || quiz.isPublished) && (
            <button onClick={() => onUnassign(quiz)}
              className="text-xs font-bold px-3 py-1.5 rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50 min-h-0 transition-colors">
              Unassign
            </button>
          )}

          <button onClick={() => onDelete(quiz)} disabled={deleting === quiz.id}
            className="text-xs font-bold px-3 py-1.5 rounded-full border border-red-200 text-red-500 hover:bg-red-50 min-h-0 disabled:opacity-40 transition-colors">
            {deleting === quiz.id ? '…' : 'Delete'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Lesson row ─────────────────────────────────────────────────────────────
function LessonRow({ lesson, onTogglePublish, onDelete, deleting }) {
  const lessonId = lesson.id || lesson._id || ''
  const status = lesson.status ?? (lesson.isPublished ? 'published' : 'draft')
  return (
    <div className="content-card">
      <div className="cc-icon t-mint"><span className="text-base">📖</span></div>
      <div className="flex-1 min-w-0">
        <p className="font-black text-gray-800 text-sm leading-snug line-clamp-2">{lesson.title}</p>
        <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
          <Pill color={SUBJECT_COLORS[lesson.subject] ?? 'bg-gray-100 text-gray-700'}>{lesson.subject}</Pill>
          <Pill color="bg-indigo-100 text-indigo-700">G{lesson.grade}</Pill>
          <Pill color="bg-gray-100 text-gray-600">T{lesson.term}</Pill>
          {lesson.topic && <Pill color="bg-gray-50 text-gray-500">{lesson.topic}</Pill>}
          <StatusPill status={status} />
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-1.5 flex-shrink-0 mt-0.5">
        <Link to={lessonId ? `/admin/lessons/${lessonId}/edit` : '/admin/content'}
          aria-disabled={!lessonId}
          className="btn-edit justify-center">
          ✏️ Edit
        </Link>
        <button onClick={() => onTogglePublish(lesson)}
          className={`text-xs font-bold px-3 py-1.5 rounded-full border min-h-0 transition-colors ${
            lesson.isPublished
              ? 'border-yellow-300 text-yellow-700 hover:bg-yellow-50'
              : 'border-green-300 text-green-700 hover:bg-green-50'
          }`}>
          {lesson.isPublished ? 'Unpublish' : 'Publish'}
        </button>
        <button onClick={() => onDelete(lesson)} disabled={deleting === lesson.id}
          className="text-xs font-bold px-3 py-1.5 rounded-full border border-red-200 text-red-500 hover:bg-red-50 min-h-0 disabled:opacity-40 transition-colors">
          {deleting === lesson.id ? '…' : 'Delete'}
        </button>
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function ManageContent() {
  const { getAllLessons, updateLesson, deleteLesson, getAllQuizzes, updateQuiz, deleteQuiz } = useFirestore()

  const [tab,     setTab]     = useState('quizzes')
  const [lessons, setLessons] = useState([])
  const [quizzes, setQuizzes] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast,   setToast]   = useState(null)

  // Filters
  const [search,     setSearch]     = useState('')
  const [gradeF,     setGradeF]     = useState('')
  const [subjectF,   setSubjectF]   = useState('')
  const [quizTypeF,  setQuizTypeF]  = useState('')
  // Phase 8: when true, the quiz list collapses to imports the parser
  // flagged as needs_review (or that carry import warnings). Off by default
  // so the existing tabs keep working as they did before.
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false)

  const [deleting,     setDeleting]     = useState(null)
  const [migrating,    setMigrating]    = useState(false)
  // { kind: 'quiz' | 'lesson', item: Record } | null
  const [pendingDelete, setPendingDelete] = useState(null)

  function show(msg, isErr = false) {
    setToast({ msg, isErr }); setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [l, q] = await Promise.all([getAllLessons(), getAllQuizzes()])
      setLessons(l); setQuizzes(q); setLoading(false)
    }
    load()
  }, [getAllLessons, getAllQuizzes])

  // ── Legacy migration ───────────────────────────────────────────────────
  // Published quizzes that haven't been classified yet. Long quizzes
  // (≥ 50 questions) become exam-only; short quizzes go to Practice.
  const legacyQuizzes = quizzes.filter(q => q.isPublished && (!q.quizType || typeof q.examOnly !== 'boolean'))

  async function migrateLegacyQuizzes() {
    if (!legacyQuizzes.length) return
    setMigrating(true)
    try {
      await Promise.all(
        legacyQuizzes.map(q => {
          const long = isExamOnly(q)
          const patch = { examOnly: long }
          if (!q.quizType) patch.quizType = long ? null : 'practice'
          return updateQuiz(q.id, patch)
        })
      )
      setQuizzes(qs => qs.map(q => {
        if (!q.isPublished || (q.quizType && typeof q.examOnly === 'boolean')) return q
        const long = isExamOnly(q)
        return {
          ...q,
          examOnly: long,
          quizType: q.quizType || (long ? null : 'practice'),
        }
      }))
      show(`✅ Migrated ${legacyQuizzes.length} quiz${legacyQuizzes.length === 1 ? '' : 'zes'}`)
    } catch (e) {
      show('❌ Migration failed: ' + e.message, true)
    } finally {
      setMigrating(false)
    }
  }

  // ── Lesson actions ─────────────────────────────────────────────────────
  async function toggleLessonPublish(lesson) {
    const next = !lesson.isPublished
    await updateLesson(lesson.id, {
      isPublished: next,
      status: next ? 'published' : 'draft',
    })
    setLessons(ls => ls.map(l => l.id === lesson.id
      ? { ...l, isPublished: next, status: next ? 'published' : 'draft' } : l))
    show(next ? '✅ Lesson published!' : '📦 Lesson unpublished.')
  }

  function handleDeleteLesson(lesson) {
    if (deleting) return
    setPendingDelete({ kind: 'lesson', item: lesson })
  }

  async function confirmDeleteLesson(lesson) {
    setDeleting(lesson.id)
    try {
      await deleteLesson(lesson.id)
      setLessons(ls => ls.filter(l => l.id !== lesson.id))
      show('Lesson deleted.')
    } catch (err) {
      show('❌ ' + (err?.message || 'Failed to delete lesson.'), true)
    } finally {
      setDeleting(null)
      setPendingDelete(null)
    }
  }

  // ── Quiz assignment actions ────────────────────────────────────────────
  // Publishing classifies the quiz automatically: short quizzes go straight
  // into the practice library; long quizzes (≥ 50 Q) become exam-only and
  // wait for an admin to pin them as Daily Exam (the auto-picker skips them).
  async function publishQuiz(quiz) {
    const long = isExamOnly(quiz)
    const patch = {
      isPublished: true,
      status: 'published',
      examOnly: long,
      quizType: long ? null : 'practice',
      isDailyExam: false,
      dailyExamDate: null,
    }
    await updateQuiz(quiz.id, patch)
    setQuizzes(qs => qs.map(q => q.id === quiz.id ? { ...q, ...patch } : q))
    show(long
      ? '🏆 Published as Exam-only — pin it as Daily Exam when you want to use it.'
      : '📝 Published — students can practice it now.')
  }

  // Bulk-publish every draft that matches the current filter. Used as a
  // natural follow-up to the CBC KB's "✏️ Bulk publish quizzes" action,
  // which creates N drafts at once — the admin reviews the list in this
  // page, then clicks here to ship them all without a per-row publish click.
  const [bulkPublishing, setBulkPublishing] = useState(false)
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)

  async function publishAllVisibleDrafts() {
    const drafts = filteredQuizzes.filter(q => !q.isPublished)
    if (drafts.length === 0) return
    setBulkPublishing(true)
    let succeeded = 0
    let failed = 0
    for (const q of drafts) {
      try {
        await publishQuiz(q)
        succeeded += 1
      } catch {
        failed += 1
      }
    }
    setBulkPublishing(false)
    setBulkConfirmOpen(false)
    show(
      failed === 0
        ? `✅ Published ${succeeded} quiz${succeeded === 1 ? '' : 'zes'}.`
        : `Published ${succeeded}; ${failed} failed. Check console for details.`,
      failed > 0,
    )
  }

  async function setAsDailyExam(quiz, { date, duration, isDemo }) {
    // `isDemo` may be undefined if called from older code paths — only write
    // the field when the modal explicitly supplied a value, so we don't
    // accidentally clear a flag the admin set elsewhere.
    const demoPatch = typeof isDemo === 'boolean' ? { isDemo } : {}
    await updateQuiz(quiz.id, {
      quizType: 'daily_exam',
      isDailyExam: true,
      dailyExamDate: date,
      durationMinutes: duration,
      isPublished: true,
      status: 'published',
      ...demoPatch,
    })
    setQuizzes(qs => qs.map(q => q.id === quiz.id
      ? { ...q, quizType: 'daily_exam', isDailyExam: true, dailyExamDate: date, durationMinutes: duration, isPublished: true, status: 'published', ...demoPatch }
      : q))
    show(`🏆 Set as Daily Exam on ${date}${isDemo ? ' · Demo' : ''}`)
  }

  async function unassignQuiz(quiz) {
    await updateQuiz(quiz.id, {
      quizType: null,
      isPublished: false,
      status: 'draft',
      isDailyExam: false,
      dailyExamDate: null,
    })
    setQuizzes(qs => qs.map(q => q.id === quiz.id
      ? { ...q, quizType: null, isPublished: false, status: 'draft', isDailyExam: false, dailyExamDate: null }
      : q))
    show('⚠ Quiz unassigned — students can no longer access it.')
  }

  function handleDeleteQuiz(quiz) {
    if (deleting) return
    setPendingDelete({ kind: 'quiz', item: quiz })
  }

  async function confirmDeleteQuiz(quiz) {
    setDeleting(quiz.id)
    try {
      await deleteQuiz(quiz.id)
      setQuizzes(qs => qs.filter(q => q.id !== quiz.id))
      show('Quiz deleted.')
    } catch (err) {
      show('❌ ' + (err?.message || 'Failed to delete quiz.'), true)
    } finally {
      setDeleting(null)
      setPendingDelete(null)
    }
  }

  // ── Filter logic ───────────────────────────────────────────────────────
  const term = search.toLowerCase()

  const filteredQuizzes = quizzes.filter(q => {
    const qt = q.quizType ?? ''
    const matchesType = (() => {
      if (!quizTypeF) return true
      if (quizTypeF === 'unpublished') return !q.isPublished
      if (quizTypeF === 'exam_only')  return isExamOnly(q) && q.isPublished && qt !== 'daily_exam'
      if (quizTypeF === 'practice')   return qt === 'practice' && !isExamOnly(q)
      return qt === quizTypeF
    })()
    // Phase 8: when the "Needs review" chip is on, drop everything that's
    // either not an import or that imported cleanly. Implemented via the
    // same summarizer the badge uses, so the chip count and the badges
    // always agree.
    const matchesNeedsReview = !needsReviewOnly || summarizeImportReview(q).needsReview
    return (
      (!gradeF      || q.grade   === gradeF) &&
      (!subjectF    || q.subject === subjectF) &&
      matchesType &&
      matchesNeedsReview &&
      (!term        || q.title?.toLowerCase().includes(term) || q.subject?.toLowerCase().includes(term))
    )
  })

  // Count of quizzes the Needs-review chip would surface, computed against
  // the ALREADY-grade/subject/type/text-filtered set so the chip's "(N)"
  // matches what the user will see after they enable it.
  const needsReviewCount = quizzes.reduce((count, q) => {
    if (!summarizeImportReview(q).needsReview) return count
    if (gradeF && q.grade !== gradeF) return count
    if (subjectF && q.subject !== subjectF) return count
    if (term && !(q.title?.toLowerCase().includes(term) || q.subject?.toLowerCase().includes(term))) return count
    return count + 1
  }, 0)

  const filteredLessons = lessons.filter(l => (
      (!gradeF   || l.grade   === gradeF) &&
      (!subjectF || l.subject === subjectF) &&

      (!term     || l.title?.toLowerCase().includes(term) || l.subject?.toLowerCase().includes(term) || l.topic?.toLowerCase().includes(term))
    ))

  const totalQuizzes    = quizzes.length
  const practiceCount   = quizzes.filter(q => q.quizType === 'practice' && !isExamOnly(q)).length
  const examOnlyCount   = quizzes.filter(q => isExamOnly(q) && q.isPublished && q.quizType !== 'daily_exam').length
  const dailyExamCount  = quizzes.filter(q => q.quizType === 'daily_exam').length
  const unpublishedCount = quizzes.filter(q => !q.isPublished).length

  return (
    <div className="space-y-5">
      <SeoHelmet title="Manage content" noIndex />
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 font-bold px-5 py-3 rounded-2xl shadow-lg text-sm max-w-xs ${
          toast.isErr ? 'bg-red-600 text-white' : 'bg-green-700 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete?.kind === 'quiz' ? 'Delete this quiz?' : 'Delete this lesson?'}
        message={
          pendingDelete?.kind === 'quiz'
            ? <>You're about to delete <strong className="theme-text">"{pendingDelete?.item?.title}"</strong>. All questions linked to it will be removed too. This cannot be undone.</>
            : <>You're about to delete <strong className="theme-text">"{pendingDelete?.item?.title}"</strong>. This cannot be undone.</>
        }
        confirmLabel={pendingDelete?.kind === 'quiz' ? 'Delete quiz' : 'Delete lesson'}
        variant="danger"
        loading={Boolean(deleting) && pendingDelete?.item?.id === deleting}
        onConfirm={() => {
          if (!pendingDelete) return
          if (pendingDelete.kind === 'quiz') confirmDeleteQuiz(pendingDelete.item)
          else confirmDeleteLesson(pendingDelete.item)
        }}
        onCancel={() => setPendingDelete(null)}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-eyebrow">Library</p>
          <h1 className="text-display-xl text-gray-800 mt-1 flex items-center gap-2">
            <span aria-hidden="true">📁</span> Manage content
          </h1>
          <p className="text-body-sm text-gray-500 mt-1">Edit, publish, or delete lessons and quizzes</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            as={Link}
            to="/admin/quizzes/new?mode=ai"
            variant="primary"
            size="md"
            leadingIcon={<Icon as={Sparkles} size="sm" />}
          >
            AI Quiz
          </Button>
          <Button
            as={Link}
            to="/admin/quizzes/new?mode=import"
            variant="secondary"
            size="md"
            leadingIcon={<Icon as={Download} size="sm" />}
          >
            Import (Word/PDF)
          </Button>
          <Button
            as={Link}
            to="/admin/quizzes/new"
            variant="secondary"
            size="md"
            leadingIcon={<Icon as={Plus} size="sm" />}
          >
            Manual quiz
          </Button>
          <Button
            as={Link}
            to="/admin/lessons/new"
            variant="secondary"
            size="md"
            leadingIcon={<Icon as={Plus} size="sm" />}
          >
            Lesson
          </Button>
        </div>
      </div>

      {/* Auto-picker explainer */}
      {tab === 'quizzes' && !loading && (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 px-4 py-3">
          <p className="font-black text-amber-800 text-sm">
            🤖 Daily Exam auto-picker is on
          </p>
          <p className="text-amber-700 text-xs mt-0.5 leading-snug">
            Every morning (Lusaka time) one short quiz per grade is promoted to today's Daily Exam, then sent back to Practice the next day. Quizzes with {EXAM_ONLY_QUESTION_THRESHOLD}+ questions are exam-only — they never auto-rotate, you pin those manually with 🏆 Daily Exam.
          </p>
        </div>
      )}

      {/* Legacy migration banner */}
      {tab === 'quizzes' && !loading && legacyQuizzes.length > 0 && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border-2 border-orange-300 bg-orange-50 px-4 py-3">
          <div>
            <p className="font-black text-orange-800 text-sm">
              ⚠ {legacyQuizzes.length} quiz{legacyQuizzes.length !== 1 ? 'zes' : ''} need classification
            </p>
            <p className="text-orange-700 text-xs mt-0.5">
              Tag each one as Practice or Exam-only based on its question count so the auto-picker knows what to do.
            </p>
          </div>
          <button
            onClick={migrateLegacyQuizzes}
            disabled={migrating}
            className="flex-shrink-0 bg-orange-500 hover:bg-orange-600 text-white font-black text-xs rounded-xl px-4 py-2 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {migrating ? 'Migrating…' : '📝 Classify all'}
          </button>
        </div>
      )}

      {/* Quiz stats row */}
      {tab === 'quizzes' && !loading && (
        <div className="stats-row stagger">
          {[
            { label: 'Total',         value: totalQuizzes,     t: 't-purple' },
            { label: '📝 Practice',   value: practiceCount,    t: 't-mint'   },
            { label: '🏆 Exam-only',  value: examOnlyCount,    t: 't-amber'  },
            { label: '🏆 Daily',      value: dailyExamCount,   t: 't-amber'  },
            { label: '⚠ Unpublished', value: unpublishedCount, t: 't-pink'   },
          ].map(s => (
            <div key={s.label} className={`stat-tile ${s.t} animate-slide-in-soft`}>
              <span className="stat-num">{s.value}</span>
              <span className="stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Bulk publish drafts — only when there are visible drafts matching the
          current filter. Reads filteredQuizzes (the same array QuizRow uses
          below) so the count and the action stay consistent. */}
      {tab === 'quizzes' && !loading && filteredQuizzes.some(q => !q.isPublished) && (
        <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-black text-emerald-900 text-sm">
              {filteredQuizzes.filter(q => !q.isPublished).length} draft{filteredQuizzes.filter(q => !q.isPublished).length === 1 ? '' : 's'} in the current filter
            </p>
            <p className="text-xs text-emerald-700 mt-0.5">
              Quick-publish them all in one click — practice quizzes go live, long ones become exam-only awaiting Daily pin.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setBulkConfirmOpen(true)}
            disabled={bulkPublishing}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
          >
            {bulkPublishing ? 'Publishing…' : `✅ Publish all ${filteredQuizzes.filter(q => !q.isPublished).length} drafts`}
          </button>
        </div>
      )}

      {bulkConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="font-black text-lg text-gray-800">Publish all visible drafts?</h3>
            <p className="text-xs text-gray-600 mt-1">
              {filteredQuizzes.filter(q => !q.isPublished).length} quiz{filteredQuizzes.filter(q => !q.isPublished).length === 1 ? '' : 'zes'} will become learner-visible immediately. Long ones (≥{EXAM_ONLY_QUESTION_THRESHOLD} Q) save as exam-only, the rest as practice.
            </p>
            <ul className="mt-3 max-h-48 overflow-y-auto text-xs text-gray-700 space-y-1 border-2 border-gray-100 rounded-xl p-2">
              {filteredQuizzes.filter(q => !q.isPublished).slice(0, 12).map(q => (
                <li key={q.id} className="truncate">• {q.title}</li>
              ))}
              {filteredQuizzes.filter(q => !q.isPublished).length > 12 && (
                <li className="italic text-gray-500">…and {filteredQuizzes.filter(q => !q.isPublished).length - 12} more</li>
              )}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBulkConfirmOpen(false)}
                disabled={bulkPublishing}
                className="px-3 py-2 rounded-xl text-xs font-black text-gray-600 hover:text-gray-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={publishAllVisibleDrafts}
                disabled={bulkPublishing}
                className="px-4 py-2 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
              >
                {bulkPublishing ? 'Publishing…' : 'Publish them all'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`px-4 py-2 rounded-full text-sm font-bold transition-all duration-fast ease-out min-h-0 ${
              tab === t.id
                ? 'bg-green-600 text-white shadow-elev-md shadow-elev-inner-hl'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:-translate-y-px'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <Icon as={Search} size="sm" />
          </span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search title, subject…"
            aria-label="Search content"
            className="w-full border-2 border-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:border-green-500"
          />
        </div>
        <select value={gradeF} onChange={e => setGradeF(e.target.value)}
          className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none">
          <option value="">All Grades</option>
          {['4','5','6','7'].map(g => <option key={g} value={g}>Grade {g}</option>)}
        </select>
        <select value={subjectF} onChange={e => setSubjectF(e.target.value)}
          className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none">
          {SUBJECTS.map(s => <option key={s} value={s}>{s || 'All Subjects'}</option>)}
        </select>
        <select value={quizTypeF} onChange={e => setQuizTypeF(e.target.value)}
          className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none">
          <option value="">All Types</option>
          <option value="practice">📝 Practice</option>
          <option value="exam_only">🏆 Exam only</option>
          <option value="daily_exam">🏆 Daily Exam</option>
          <option value="unpublished">⚠ Unpublished</option>
        </select>
        {/* Phase 8: chip-style toggle. Disabled (greyed out) when there's
            nothing to review so it never looks "broken" — clicking has no
            visible effect because the predicate matches zero items. */}
        <button
          type="button"
          onClick={() => setNeedsReviewOnly(v => !v)}
          aria-pressed={needsReviewOnly}
          disabled={!needsReviewOnly && needsReviewCount === 0}
          className={`rounded-xl border-2 px-3 py-2 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            needsReviewOnly
              ? 'border-amber-500 bg-amber-100 text-amber-800'
              : 'border-gray-200 bg-white text-gray-700 hover:border-amber-300'
          }`}
          title={needsReviewOnly
            ? 'Click to show all imports'
            : needsReviewCount > 0
              ? `${needsReviewCount} imported draft${needsReviewCount === 1 ? '' : 's'} flagged for review`
              : 'No imports currently need review'}
        >
          ⚠️ Needs review
          {needsReviewCount > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-black text-white min-w-[20px]">
              {needsReviewCount}
            </span>
          )}
        </button>
        {(search || gradeF || subjectF || quizTypeF || needsReviewOnly) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('')
              setGradeF('')
              setSubjectF('')
              setQuizTypeF('')
              setNeedsReviewOnly(false)
            }}
            leadingIcon={<Icon as={X} size="sm" />}
          >
            Clear
          </Button>
        )}
      </div>

      {/* ── Quizzes tab ────────────────────────────────────────────────────── */}
      {tab === 'quizzes' && (
        <div className="space-y-3">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={80} className="rounded-2xl" />
            ))
          ) : filteredQuizzes.length === 0 ? (
            <div className="text-center py-14 bg-white rounded-2xl border theme-border shadow-elev-sm">
              <div className="text-4xl mb-2" aria-hidden="true">📭</div>
              <p className="text-display-md text-gray-700" style={{ fontSize: 16 }}>
                {totalQuizzes === 0 ? 'No quizzes yet' : 'No quizzes match your filters'}
              </p>
              {totalQuizzes === 0 && (
                <p className="mt-1 text-xs text-gray-500 max-w-md mx-auto">
                  Start with AI Quiz to draft from a topic, Import to convert a Word/PDF document, or build one by hand.
                </p>
              )}
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button
                  as={Link}
                  to="/admin/quizzes/new?mode=ai"
                  variant="primary"
                  size="sm"
                  leadingIcon={<Icon as={Sparkles} size="sm" />}
                >
                  AI Quiz
                </Button>
                <Button
                  as={Link}
                  to="/admin/quizzes/new?mode=import"
                  variant="secondary"
                  size="sm"
                  leadingIcon={<Icon as={Download} size="sm" />}
                >
                  Import (Word/PDF)
                </Button>
                <Button
                  as={Link}
                  to="/admin/quizzes/new"
                  variant="secondary"
                  size="sm"
                  leadingIcon={<Icon as={Plus} size="sm" />}
                >
                  Manual
                </Button>
              </div>
            </div>
          ) : (
            filteredQuizzes.map(quiz => (
              <QuizRow
                key={quiz.id}
                quiz={quiz}
                onPublish={publishQuiz}
                onSetDailyExam={setAsDailyExam}
                onUnassign={unassignQuiz}
                onDelete={handleDeleteQuiz}
                deleting={deleting}
              />
            ))
          )}
        </div>
      )}

      {/* ── Lessons tab ────────────────────────────────────────────────────── */}
      {tab === 'lessons' && (
        <div className="space-y-3">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={80} className="rounded-2xl" />
            ))
          ) : filteredLessons.length === 0 ? (
            <div className="text-center py-14 bg-white rounded-2xl border theme-border shadow-elev-sm">
              <div className="text-4xl mb-2" aria-hidden="true">📭</div>
              <p className="text-display-md text-gray-700" style={{ fontSize: 16 }}>No lessons match your filters</p>
              <div className="inline-flex mt-3">
                <Button
                  as={Link}
                  to="/admin/lessons/new"
                  variant="primary"
                  size="sm"
                  trailingIcon={<Icon as={ChevronRight} size="sm" />}
                >
                  Create a new lesson
                </Button>
              </div>
            </div>
          ) : (
            filteredLessons.map(lesson => (
              <LessonRow
                key={lesson.id}
                lesson={lesson}
                onTogglePublish={toggleLessonPublish}
                onDelete={handleDeleteLesson}
                deleting={deleting}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
