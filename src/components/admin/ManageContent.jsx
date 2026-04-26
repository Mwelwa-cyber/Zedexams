import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Search, Plus, Download, X, ChevronRight } from '../ui/icons'
import { useFirestore } from '../../hooks/useFirestore'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import Skeleton from '../ui/Skeleton'
import ConfirmDialog from '../ui/ConfirmDialog'

const TABS = [
  { id: 'quizzes', label: '📝 Quizzes' },
  { id: 'lessons', label: '📖 Lessons' },
]

const SUBJECT_COLORS = {
  Mathematics:         'bg-blue-100   text-blue-700',
  English:             'bg-purple-100 text-purple-700',
  'Integrated Science':'bg-orange-100 text-orange-700',
  Science:             'bg-orange-100 text-orange-700',
  'Social Studies':    'bg-teal-100   text-teal-700',
  'Technology Studies':'bg-cyan-100   text-cyan-700',
  'Home Economics':    'bg-pink-100   text-pink-700',
  'Expressive Arts':   'bg-rose-100   text-rose-700',
}

const STATUS_CFG = {
  published: { label: 'Published', dot: 'bg-green-500',  pill: 'bg-green-100 text-green-700'   },
  pending:   { label: 'Pending',   dot: 'bg-yellow-400', pill: 'bg-yellow-100 text-yellow-700' },
  draft:     { label: 'Draft',     dot: 'bg-gray-400',   pill: 'bg-gray-100 text-gray-600'     },
  rejected:  { label: 'Rejected',  dot: 'bg-red-500',    pill: 'bg-red-100 text-red-600'       },
}

const SUBJECTS = [
  '', 'Mathematics', 'English', 'Integrated Science', 'Social Studies',
  'Technology Studies', 'Home Economics', 'Expressive Arts',
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
  const today = new Date().toISOString().slice(0, 10)
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

// ── Quiz row ───────────────────────────────────────────────────────────────
function QuizRow({ quiz, onSetPractice, onSetDailyExam, onUnassign, onDelete, deleting }) {
  const quizId   = quiz.id || quiz._id || ''
  const quizType = quiz.quizType  // 'practice' | 'daily_exam' | undefined
  const [showDailyModal, setShowDailyModal] = useState(false)

  const typeIcon  = quizType === 'daily_exam' ? '🏆' : quizType === 'practice' ? '📝' : '📦'
  const qCount    = quiz.questionCount ?? '?'
  const duration  = quiz.durationMinutes || quiz.duration || '?'

  return (
    <>
      {showDailyModal && (
        <DailyExamModal quiz={quiz} onSave={onSetDailyExam} onClose={() => setShowDailyModal(false)} />
      )}
      <div className={`bg-white rounded-2xl border p-4 flex items-start gap-3 hover:shadow-sm transition-shadow ${
        quizType === 'daily_exam' ? 'border-amber-200' : quizType === 'practice' ? 'border-green-100' : 'theme-border opacity-75'
      }`}>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${
          SUBJECT_COLORS[quiz.subject] ?? 'bg-gray-100 text-gray-500'
        }`}>
          {typeIcon}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-black text-gray-800 text-sm leading-snug line-clamp-2">{quiz.title}</p>
          <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
            <Pill color={SUBJECT_COLORS[quiz.subject] ?? 'bg-gray-100 text-gray-700'}>{quiz.subject}</Pill>
            <Pill color="bg-indigo-100 text-indigo-700">G{quiz.grade}</Pill>
            <Pill color="bg-gray-100 text-gray-600">T{quiz.term}</Pill>
            <Pill color="bg-gray-50 text-gray-500">{qCount}Q · {duration}m</Pill>
            {quiz.mode === 'imported_document' && (
              <Pill color={quiz.importStatus === 'needs_review' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}>
                Imported
              </Pill>
            )}
            {quizType === 'daily_exam' && (
              <Pill color="bg-amber-100 text-amber-700">🏆 Daily Exam · {quiz.dailyExamDate}</Pill>
            )}
            {quizType === 'practice' && (
              <Pill color="bg-green-100 text-green-700">📝 Practice Quiz</Pill>
            )}
            {!quizType && (
              <Pill color="bg-gray-100 text-gray-500">⚠ Unassigned</Pill>
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
            className="text-xs font-black px-3 py-1.5 rounded-full border-2 border-blue-300 text-blue-700 hover:bg-blue-50 transition-colors text-center">
            ✏️ Edit
          </Link>

          {/* Assignment controls */}
          {quizType !== 'practice' && (
            <button onClick={() => onSetPractice(quiz)}
              className="text-xs font-bold px-3 py-1.5 rounded-full border border-green-300 text-green-700 hover:bg-green-50 min-h-0 transition-colors">
              📝 Practice
            </button>
          )}
          {quizType !== 'daily_exam' && (
            <button onClick={() => setShowDailyModal(true)}
              className="text-xs font-bold px-3 py-1.5 rounded-full border border-amber-300 text-amber-700 hover:bg-amber-50 min-h-0 transition-colors">
              🏆 Daily Exam
            </button>
          )}
          {quizType && (
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
    <div className="bg-white rounded-2xl border theme-border p-4 flex items-start gap-3 hover:shadow-sm transition-shadow">
      <div className="bg-green-100 text-green-700 w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0">📖</div>
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
          className="text-xs font-black px-3 py-1.5 rounded-full border-2 border-blue-300 text-blue-700 hover:bg-blue-50 transition-colors">
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
  }, [])

  // ── Legacy migration ───────────────────────────────────────────────────
  const legacyQuizzes = quizzes.filter(q => !q.quizType && q.isPublished)

  async function migrateLegacyQuizzes() {
    if (!legacyQuizzes.length) return
    setMigrating(true)
    try {
      await Promise.all(
        legacyQuizzes.map(q => updateQuiz(q.id, { quizType: 'practice' }))
      )
      setQuizzes(qs => qs.map(q =>
        (!q.quizType && q.isPublished) ? { ...q, quizType: 'practice' } : q
      ))
      show(`✅ Migrated ${legacyQuizzes.length} published quizzes → Practice`)
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
  async function setAsPractice(quiz) {
    await updateQuiz(quiz.id, {
      quizType: 'practice',
      isPublished: true,
      status: 'published',
      isDailyExam: false,
      dailyExamDate: null,
    })
    setQuizzes(qs => qs.map(q => q.id === quiz.id
      ? { ...q, quizType: 'practice', isPublished: true, status: 'published', isDailyExam: false, dailyExamDate: null }
      : q))
    show('📝 Set as Practice Quiz — students can access it now.')
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
    return (
      (!gradeF      || q.grade   === gradeF) &&
      (!subjectF    || q.subject === subjectF) &&
      (!quizTypeF   || (quizTypeF === 'unassigned' ? !q.quizType : qt === quizTypeF)) &&
      (!term        || q.title?.toLowerCase().includes(term) || q.subject?.toLowerCase().includes(term))
    )
  })

  const filteredLessons = lessons.filter(l => (
      (!gradeF   || l.grade   === gradeF) &&
      (!subjectF || l.subject === subjectF) &&

      (!term     || l.title?.toLowerCase().includes(term) || l.subject?.toLowerCase().includes(term) || l.topic?.toLowerCase().includes(term))
    ))

  const totalQuizzes    = quizzes.length
  const practiceCount   = quizzes.filter(q => q.quizType === 'practice').length
  const dailyExamCount  = quizzes.filter(q => q.quizType === 'daily_exam').length
  const unassignedCount = quizzes.filter(q => !q.quizType).length

  return (
    <div className="space-y-5">
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
            to="/admin/quizzes/new"
            variant="primary"
            size="md"
            leadingIcon={<Icon as={Plus} size="sm" />}
          >
            Quiz
          </Button>
          <Button
            as={Link}
            to="/admin/quizzes/new?mode=import"
            variant="secondary"
            size="md"
            leadingIcon={<Icon as={Download} size="sm" />}
          >
            Import Quiz
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

      {/* Legacy migration banner */}
      {tab === 'quizzes' && !loading && legacyQuizzes.length > 0 && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border-2 border-orange-300 bg-orange-50 px-4 py-3">
          <div>
            <p className="font-black text-orange-800 text-sm">
              ⚠ {legacyQuizzes.length} published quiz{legacyQuizzes.length !== 1 ? 'zes' : ''} not yet assigned
            </p>
            <p className="text-orange-700 text-xs mt-0.5">
              These were published before the new system. Migrate them to Practice so students can still access them.
            </p>
          </div>
          <button
            onClick={migrateLegacyQuizzes}
            disabled={migrating}
            className="flex-shrink-0 bg-orange-500 hover:bg-orange-600 text-white font-black text-xs rounded-xl px-4 py-2 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {migrating ? 'Migrating…' : '📝 Migrate all → Practice'}
          </button>
        </div>
      )}

      {/* Quiz stats row */}
      {tab === 'quizzes' && !loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger">
          {[
            { label: 'Total',      value: totalQuizzes,   color: 'bg-gray-50   border-gray-200',   text: 'text-gray-700'  },
            { label: '📝 Practice', value: practiceCount,  color: 'bg-green-50  border-green-200',  text: 'text-green-700' },
            { label: '🏆 Daily',    value: dailyExamCount, color: 'bg-amber-50  border-amber-200',  text: 'text-amber-700' },
            { label: '⚠ Unassigned',value: unassignedCount,color: 'bg-red-50    border-red-200',    text: 'text-red-600'   },
          ].map(s => (
            <div key={s.label} className={`${s.color} border rounded-2xl p-3 text-center shadow-elev-sm animate-slide-in-soft`}>
              <p className={`text-display-md ${s.text}`} style={{ fontSize: 22 }}>{s.value}</p>
              <p className="text-eyebrow mt-0.5" style={{ color: 'inherit', opacity: 0.75 }}>{s.label}</p>
            </div>
          ))}
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
          {['4','5','6'].map(g => <option key={g} value={g}>Grade {g}</option>)}
        </select>
        <select value={subjectF} onChange={e => setSubjectF(e.target.value)}
          className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none">
          {SUBJECTS.map(s => <option key={s} value={s}>{s || 'All Subjects'}</option>)}
        </select>
        <select value={quizTypeF} onChange={e => setQuizTypeF(e.target.value)}
          className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none">
          <option value="">All Types</option>
          <option value="practice">📝 Practice</option>
          <option value="daily_exam">🏆 Daily Exam</option>
          <option value="unassigned">⚠ Unassigned</option>
        </select>
        {(search || gradeF || subjectF || quizTypeF) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSearch(''); setGradeF(''); setSubjectF(''); setQuizTypeF('') }}
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
              <p className="text-display-md text-gray-700" style={{ fontSize: 16 }}>No quizzes match your filters</p>
              <div className="inline-flex mt-3">
                <Button
                  as={Link}
                  to="/admin/quizzes/new"
                  variant="primary"
                  size="sm"
                  trailingIcon={<Icon as={ChevronRight} size="sm" />}
                >
                  Create a new quiz
                </Button>
              </div>
            </div>
          ) : (
            filteredQuizzes.map(quiz => (
              <QuizRow
                key={quiz.id}
                quiz={quiz}
                onSetPractice={setAsPractice}
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
