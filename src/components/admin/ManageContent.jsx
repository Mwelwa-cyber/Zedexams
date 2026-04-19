import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, Plus, Download, X, ChevronRight } from 'lucide-react'
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

const STATUSES = ['', 'published', 'pending', 'draft', 'rejected']

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

// ── Quiz row ───────────────────────────────────────────────────────────────
function QuizRow({ quiz, onTogglePublish, onDelete, deleting }) {
  const quizId = quiz.id || quiz._id || ''
  const status = quiz.status ?? (quiz.isPublished ? 'published' : 'draft')
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-start gap-3 hover:shadow-sm transition-shadow">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${
        SUBJECT_COLORS[quiz.subject] ?? 'bg-gray-100 text-gray-500'
      }`}>
        📝
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-black text-gray-800 text-sm leading-snug line-clamp-2">{quiz.title}</p>
        <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
          <Pill color={SUBJECT_COLORS[quiz.subject] ?? 'bg-gray-100 text-gray-700'}>{quiz.subject}</Pill>
          <Pill color="bg-indigo-100 text-indigo-700">G{quiz.grade}</Pill>
          <Pill color="bg-gray-100 text-gray-600">T{quiz.term}</Pill>
          <Pill color="bg-gray-50 text-gray-500">{quiz.questionCount ?? '?'}Q · {quiz.duration}m</Pill>
          {quiz.mode === 'imported_document' && (
            <Pill color={quiz.importStatus === 'needs_review' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}>
              Imported
            </Pill>
          )}
          <StatusPill status={status} />
        </div>
        {quiz.rejectionReason && (
          <p className="text-xs text-red-500 mt-1 italic">Rejected: {quiz.rejectionReason}</p>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-1.5 flex-shrink-0 mt-0.5">
        <Link to={quizId ? `/admin/quizzes/${quizId}/edit` : '/admin/content'}
          aria-disabled={!quizId}
          className="text-xs font-black px-3 py-1.5 rounded-full border-2 border-blue-300 text-blue-700 hover:bg-blue-50 transition-colors">
          ✏️ Edit
        </Link>
        <button onClick={() => onTogglePublish(quiz)}
          className={`text-xs font-bold px-3 py-1.5 rounded-full border min-h-0 transition-colors ${
            status === 'published'
              ? 'border-yellow-300 text-yellow-700 hover:bg-yellow-50'
              : 'border-green-300 text-green-700 hover:bg-green-50'
          }`}>
          {status === 'published' ? 'Unpublish' : 'Publish'}
        </button>
        <button onClick={() => onDelete(quiz)} disabled={deleting === quiz.id}
          className="text-xs font-bold px-3 py-1.5 rounded-full border border-red-200 text-red-500 hover:bg-red-50 min-h-0 disabled:opacity-40 transition-colors">
          {deleting === quiz.id ? '…' : 'Delete'}
        </button>
      </div>
    </div>
  )
}

// ── Lesson row ─────────────────────────────────────────────────────────────
function LessonRow({ lesson, onTogglePublish, onDelete, deleting }) {
  const lessonId = lesson.id || lesson._id || ''
  const status = lesson.status ?? (lesson.isPublished ? 'published' : 'draft')
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-start gap-3 hover:shadow-sm transition-shadow">
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
  const navigate = useNavigate()

  const [tab,     setTab]     = useState('quizzes')
  const [lessons, setLessons] = useState([])
  const [quizzes, setQuizzes] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast,   setToast]   = useState(null)

  // Filters
  const [search,    setSearch]    = useState('')
  const [gradeF,    setGradeF]    = useState('')
  const [subjectF,  setSubjectF]  = useState('')
  const [statusF,   setStatusF]   = useState('')

  const [deleting, setDeleting] = useState(null)
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

  // ── Quiz actions ───────────────────────────────────────────────────────
  async function toggleQuizPublish(quiz) {
    const next = quiz.status !== 'published'
    await updateQuiz(quiz.id, {
      isPublished: next,
      status: next ? 'published' : 'draft',
    })
    setQuizzes(qs => qs.map(q => q.id === quiz.id
      ? { ...q, isPublished: next, status: next ? 'published' : 'draft' } : q))
    show(next ? '✅ Quiz published!' : '📦 Quiz unpublished.')
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
    const qs = q.status ?? (q.isPublished ? 'published' : 'draft')
    return (
      (!gradeF   || q.grade   === gradeF) &&
      (!subjectF || q.subject === subjectF) &&
      (!statusF  || qs        === statusF) &&
      (!term     || q.title?.toLowerCase().includes(term) || q.subject?.toLowerCase().includes(term))
    )
  })

  const filteredLessons = lessons.filter(l => {
    const ls = l.status ?? (l.isPublished ? 'published' : 'draft')
    return (
      (!gradeF   || l.grade   === gradeF) &&
      (!subjectF || l.subject === subjectF) &&
      (!statusF  || ls        === statusF) &&
      (!term     || l.title?.toLowerCase().includes(term) || l.subject?.toLowerCase().includes(term) || l.topic?.toLowerCase().includes(term))
    )
  })

  const totalQuizzes   = quizzes.length
  const publishedCount = quizzes.filter(q => q.isPublished).length
  const pendingCount   = quizzes.filter(q => q.status === 'pending').length
  const draftCount     = quizzes.filter(q => (q.status ?? 'draft') === 'draft').length

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

      {/* Quiz stats row */}
      {tab === 'quizzes' && !loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger">
          {[
            { label: 'Total',     value: totalQuizzes,   color: 'bg-gray-50  border-gray-200', text: 'text-gray-700' },
            { label: 'Published', value: publishedCount, color: 'bg-green-50 border-green-200',text: 'text-green-700' },
            { label: 'Pending',   value: pendingCount,   color: 'bg-yellow-50 border-yellow-200',text: 'text-yellow-700' },
            { label: 'Drafts',    value: draftCount,     color: 'bg-blue-50 border-blue-200',  text: 'text-blue-700' },
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
        <select value={statusF} onChange={e => setStatusF(e.target.value)}
          className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none">
          {STATUSES.map(s => <option key={s} value={s}>{s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All Status'}</option>)}
        </select>
        {(search || gradeF || subjectF || statusF) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSearch(''); setGradeF(''); setSubjectF(''); setStatusF('') }}
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
            <div className="text-center py-14 bg-white rounded-2xl border border-gray-100 shadow-elev-sm">
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
                onTogglePublish={toggleQuizPublish}
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
            <div className="text-center py-14 bg-white rounded-2xl border border-gray-100 shadow-elev-sm">
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
