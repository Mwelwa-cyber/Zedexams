import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import StatusBadge from '../ui/StatusBadge'
import Button from '../ui/Button'

const TYPE_LABELS = { quiz: '✏️ Quiz', lesson: '📖 Lesson' }

function ContentRow({ item, onSubmit, onWithdraw, onDelete, busy }) {
  const itemId = item.id || item._id || ''
  const status = item.status || (item.isPublished ? 'published' : 'draft')
  const canSubmit   = status === 'draft' || status === 'rejected'
  const canWithdraw = status === 'pending'
  const canDelete   = status === 'draft' || status === 'rejected'
  const canEdit     = itemId && (item.contentType === 'quiz' || item.contentType === 'lesson') && (status === 'draft' || status === 'rejected' || status === 'pending')

  function fmt(ts) {
    if (!ts) return '—'
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  return (
    <div className="bg-white rounded-2xl border theme-border p-4 space-y-3">
      <div className="flex items-start gap-3">
        {/* Type icon */}
        <div className="w-10 h-10 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-center text-lg flex-shrink-0">
          {TYPE_LABELS[item.contentType]?.split(' ')[0] ?? '📄'}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-black text-gray-800 text-sm leading-snug">{item.title}</p>
          <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
            <span className="text-xs text-gray-500 font-bold">{TYPE_LABELS[item.contentType] ?? item.contentType}</span>
            {item.grade   && <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">Grade {item.grade}</span>}
            {item.subject && <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{item.subject}</span>}
            {item.term    && <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full">T{item.term}</span>}
            {item.mode === 'imported_document' && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${item.importStatus === 'needs_review' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                Imported
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <StatusBadge status={status} />
            {item.submittedAt && <span className="text-xs text-gray-400">Submitted {fmt(item.submittedAt)}</span>}
            {!item.submittedAt && item.createdAt && <span className="text-xs text-gray-400">Created {fmt(item.createdAt)}</span>}
          </div>
        </div>
      </div>

      {/* Rejection reason */}
      {status === 'rejected' && item.rejectionReason && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          <p className="text-xs font-black text-red-600 mb-0.5">Rejection reason:</p>
          <p className="text-xs text-red-700 leading-relaxed">{item.rejectionReason}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        {canEdit && (
          <Button
            as={Link}
            to={item.contentType === 'lesson' ? `/teacher/lessons/${itemId}/edit` : `/teacher/quizzes/${itemId}/edit`}
            variant="secondary"
            size="sm"
          >
            ✏️ Edit {item.contentType === 'lesson' ? 'Lesson' : 'Quiz'}
          </Button>
        )}
        {canSubmit && (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => onSubmit(item)}>
            📤 Submit for Approval
          </Button>
        )}
        {canWithdraw && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => onWithdraw(item)}
            className="!text-warning hover:!border-[color:var(--warning-fg)]"
          >
            ↩ Withdraw
          </Button>
        )}
        {canDelete && (
          <button
            onClick={() => onDelete(item)}
            disabled={busy}
            className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 font-black text-xs px-4 py-2 rounded-xl min-h-0 transition-colors">
            🗑 Delete
          </button>
        )}
        {status === 'published' && (
          <span className="text-xs text-green-600 font-bold px-2 py-2">✅ Live for learners</span>
        )}
      </div>
    </div>
  )
}

export default function TeacherContent() {
  const { currentUser } = useAuth()
  const { getMyQuizzes, getMyLessons, submitForApproval, withdrawFromApproval, deleteQuiz, deleteLesson } = useFirestore()

  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [toast, setToast]     = useState(null)
  const [filter, setFilter]   = useState('all')

  function show(msg) { setToast(msg); setTimeout(() => setToast(null), 3500) }

  async function load() {
    if (!currentUser) return
    const [quizzes, lessons] = await Promise.all([
      getMyQuizzes(currentUser.uid),
      getMyLessons(currentUser.uid),
    ])
    const merged = [
      ...quizzes.map(q => ({ ...q, contentType: 'quiz' })),
      ...lessons.map(l => ({ ...l, contentType: 'lesson' })),
    ].sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
    setItems(merged)
    setLoading(false)
  }

  useEffect(() => { load() }, [currentUser])

  async function handleSubmit(item) {
    setBusy(true)
    try {
      await submitForApproval(item.contentType, item.id)
      show('📤 Submitted for approval!')
      await load()
    } catch (e) { show('❌ ' + e.message) }
    setBusy(false)
  }

  async function handleWithdraw(item) {
    setBusy(true)
    try {
      await withdrawFromApproval(item.contentType, item.id)
      show('↩ Withdrawn back to draft.')
      await load()
    } catch (e) { show('❌ ' + e.message) }
    setBusy(false)
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return
    setBusy(true)
    try {
      if (item.contentType === 'quiz')   await deleteQuiz(item.id)
      if (item.contentType === 'lesson') await deleteLesson(item.id)
      show('🗑 Deleted.')
      await load()
    } catch (e) { show('❌ ' + e.message) }
    setBusy(false)
  }

  const FILTERS = ['all', 'draft', 'pending', 'published', 'rejected']
  const filtered = filter === 'all'
    ? items
    : items.filter(i => (i.status || (i.isPublished ? 'published' : 'draft')) === filter)

  return (
    <div className="space-y-5">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-800 text-white font-bold px-5 py-3 rounded-2xl shadow-lg text-sm max-w-xs">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-gray-800">📁 My Content</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage and submit your quizzes and lessons</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button as={Link} to="/teacher/quizzes/new" variant="primary" size="sm">+ Quiz</Button>
          <Button as={Link} to="/teacher/quizzes/new?mode=import" variant="secondary" size="sm">Import Quiz</Button>
          <Button as={Link} to="/teacher/lessons/new" variant="secondary" size="sm">+ Lesson</Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-sm font-bold transition-all min-h-0 whitespace-nowrap ${
              filter === f ? 'bg-blue-600 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300'
            }`}>
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            {f !== 'all' && (
              <span className="ml-1.5 text-xs opacity-70">
                ({items.filter(i => (i.status || (i.isPublished ? 'published' : 'draft')) === f).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border theme-border p-4 animate-pulse h-24" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border theme-border py-16 text-center">
          <div className="text-5xl mb-3">📭</div>
          <p className="font-black text-gray-700">
            {filter === 'all' ? 'No content yet' : `No ${filter} content`}
          </p>
          <p className="text-gray-400 text-sm mt-1">
            {filter === 'all' ? 'Create a quiz or lesson to get started.' : 'Try a different filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(item => (
            <ContentRow
              key={`${item.contentType}-${item.id}`}
              item={item}
              onSubmit={handleSubmit}
              onWithdraw={handleWithdraw}
              onDelete={handleDelete}
              busy={busy}
            />
          ))}
        </div>
      )}
    </div>
  )
}
