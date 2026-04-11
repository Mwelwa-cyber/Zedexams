import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useFirestore } from '../../hooks/useFirestore'

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
          <StatusPill status={status} />
        </div>
        {quiz.rejectionReason && (
          <p className="text-xs text-red-500 mt-1 italic">Rejected: {quiz.rejectionReason}</p>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-1.5 flex-shrink-0 mt-0.5">
        <Link to={`/admin/quizzes/${quiz.id}/edit`}
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

  async function handleDeleteLesson(lesson) {
    if (deleting) return
    if (!window.confirm(`Delete "${lesson.title}"? This cannot be undone.`)) return
    setDeleting(lesson.id)
    await deleteLesson(lesson.id)
    setLessons(ls => ls.filter(l => l.id !== lesson.id))
    setDeleting(null)
    show('Lesson deleted.')
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

  async function handleDeleteQuiz(quiz) {
    if (deleting) return
    if (!window.confirm(`Delete "${quiz.title}"? All questions will also be deleted. This cannot be undone.`)) return
    setDeleting(quiz.id)
    await deleteQuiz(quiz.id)
    setQuizzes(qs => qs.filter(q => q.id !== quiz.id))
    setDeleting(null)
    show('Quiz deleted.')
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

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-gray-800">📁 Manage Content</h1>
          <p className="text-gray-500 text-sm">Edit, publish, or delete lessons and quizzes</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link to="/admin/quizzes/new"
            className="bg-green-600 hover:bg-green-700 text-white font-black text-sm px-4 py-2 rounded-xl transition-colors">
            + Quiz
          </Link>
          <Link to="/admin/lessons/new"
            className="border-2 border-green-600 text-green-600 font-black text-sm px-4 py-2 rounded-xl hover:bg-green-50 transition-colors">
            + Lesson
          </Link>
        </div>
      </div>

      {/* Quiz stats row */}
      {tab === 'quizzes' && !loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total',     value: totalQuizzes,   color: 'bg-gray-50  border-gray-200', text: 'text-gray-700' },
            { label: 'Published', value: publishedCount, color: 'bg-green-50 border-green-200',text: 'text-green-700' },
            { label: 'Pending',   value: pendingCount,   color: 'bg-yellow-50 border-yellow-200',text: 'text-yellow-700' },
            { label: 'Drafts',    value: draftCount,     color: 'bg-blue-50 border-blue-200',  text: 'text-blue-700' },
          ].map(s => (
            <div key={s.label} className={`${s.color} border rounded-2xl p-3 text-center`}>
              <p className={`text-2xl font-black ${s.text}`}>{s.value}</p>
              <p className={`text-xs font-bold ${s.text} opacity-70`}>{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-full text-sm font-bold transition-all min-h-0 ${
              tab === t.id ? 'bg-green-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Search title, subject…"
          className="flex-1 min-w-[160px] border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none" />
        <select value={gradeF} onChange={e => setGradeF(e.target.value)}
          className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none">
          <option value="">All Grades</option>
          {['4','5','6','7'].map(g => <option key={g} value={g}>Grade {g}</option>)}
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
          <button onClick={() => { setSearch(''); setGradeF(''); setSubjectF(''); setStatusF('') }}
            className="text-xs text-gray-500 hover:text-gray-700 font-bold px-2 min-h-0 bg-transparent shadow-none">
            ✕ Clear
          </button>
        )}
      </div>

      {/* ── Quizzes tab ────────────────────────────────────────────────────── */}
      {tab === 'quizzes' && (
        <div className="space-y-3">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 animate-pulse h-20" />
            ))
          ) : filteredQuizzes.length === 0 ? (
            <div className="text-center py-14 bg-white rounded-2xl border border-gray-100">
              <div className="text-4xl mb-2">📭</div>
              <p className="font-bold text-gray-600">No quizzes match your filters</p>
              <Link to="/admin/quizzes/new"
                className="inline-block mt-3 text-green-600 font-bold text-sm hover:underline">
                Create a new quiz →
              </Link>
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
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 animate-pulse h-20" />
            ))
          ) : filteredLessons.length === 0 ? (
            <div className="text-center py-14 bg-white rounded-2xl border border-gray-100">
              <div className="text-4xl mb-2">📭</div>
              <p className="font-bold text-gray-600">No lessons match your filters</p>
              <Link to="/admin/lessons/new"
                className="inline-block mt-3 text-green-600 font-bold text-sm hover:underline">
                Create a new lesson →
              </Link>
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
