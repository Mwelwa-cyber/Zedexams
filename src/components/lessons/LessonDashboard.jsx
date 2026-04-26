import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { LESSON_GRADES, LESSON_SUBJECTS } from './lessonConstants'
import Button from '../ui/Button'
import Skeleton from '../ui/Skeleton'

const STATUS = {
  published: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  draft: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-700',
}

function statusOf(lesson) {
  return lesson.status || (lesson.isPublished ? 'published' : 'draft')
}

function dateLabel(value) {
  if (!value) return 'Not saved'
  const date = value.toDate ? value.toDate() : new Date(value)
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Stat({ label, value, tone }) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    sky: 'bg-sky-50 text-sky-700 border-sky-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    gray: 'bg-gray-50 text-gray-700 theme-border',
  }
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <p className="text-2xl font-black">{value}</p>
      <p className="text-xs font-black uppercase tracking-wide opacity-80">{label}</p>
    </div>
  )
}

function LessonRow({ lesson, editPath, canPublish, busyId, onPublishToggle, onSubmit, onWithdraw, onDelete }) {
  const status = statusOf(lesson)
  const isPresentation = lesson.mode === 'pptx_viewer' || lesson.creationMode === 'pptx_viewer'
  const slideCount = isPresentation ? lesson.presentation?.slideCount || 0 : lesson.slides?.length || 0
  const modeLabel = isPresentation
    ? 'Presentation'
    : lesson.mode === 'imported_pptx' || lesson.creationMode === 'imported_pptx'
      ? 'Editable PPTX'
      : lesson.creationMode === 'quick-lesson'
        ? 'Quick'
        : 'Builder'

  return (
    <div className="rounded-3xl border theme-border bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex flex-1 gap-3">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-xl font-black text-emerald-700">
            {isPresentation ? '▣' : '▦'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-black leading-tight text-gray-900">{lesson.title || 'Untitled lesson'}</h3>
              <span className={`rounded-full px-2 py-0.5 text-xs font-black ${STATUS[status] || STATUS.draft}`}>{status}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-black text-sky-700">Grade {lesson.grade}</span>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-black text-emerald-700">{lesson.subject}</span>
              {lesson.topic && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-black text-amber-700">{lesson.topic}</span>}
              <span className="rounded-full bg-gray-50 px-2 py-0.5 text-xs font-black text-gray-600">{slideCount} slides</span>
              <span className="rounded-full bg-gray-50 px-2 py-0.5 text-xs font-black text-gray-600">{modeLabel}</span>
              {lesson.importStatus === 'needs_review' && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-black text-amber-700">Needs review</span>}
            </div>
            <p className="mt-2 text-xs font-bold text-gray-400">Updated {dateLabel(lesson.updatedAt || lesson.createdAt)}</p>
            {lesson.rejectionReason && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{lesson.rejectionReason}</p>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Link to={`/lessons/${lesson.id}`} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-black text-gray-700">
            View
          </Link>
          <Link to={editPath} className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-700">
            Edit
          </Link>
          {canPublish ? (
            <Button variant="secondary" size="sm" disabled={busyId === lesson.id} onClick={() => onPublishToggle(lesson)}>
              {status === 'published' ? 'Unpublish' : 'Publish'}
            </Button>
          ) : (
            <>
              {(status === 'draft' || status === 'rejected') && (
                <Button variant="primary" size="sm" disabled={busyId === lesson.id} onClick={() => onSubmit(lesson)}>
                  Submit
                </Button>
              )}
              {status === 'pending' && (
                <Button variant="secondary" size="sm" disabled={busyId === lesson.id} onClick={() => onWithdraw(lesson)}>
                  Withdraw
                </Button>
              )}
            </>
          )}
          <Button variant="danger" size="sm" disabled={busyId === lesson.id} onClick={() => onDelete(lesson)}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function LessonDashboard() {
  const location = useLocation()
  const { currentUser, isAdmin } = useAuth()
  const {
    getAllLessons,
    getMyLessons,
    updateLesson,
    deleteLesson,
    submitForApproval,
    withdrawFromApproval,
  } = useFirestore()

  const isTeacherArea = location.pathname.startsWith('/teacher')
  const canPublish = isAdmin && !isTeacherArea
  const basePath = isTeacherArea ? '/teacher/lessons' : '/admin/lessons'

  const [lessons, setLessons] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [toast, setToast] = useState(null)
  const [filters, setFilters] = useState({ search: '', grade: '', subject: '', topic: '', status: '' })

  function show(message, error = false) {
    setToast({ message, error })
    setTimeout(() => setToast(null), 3000)
  }

  async function loadLessons() {
    if (!currentUser) return
    setLoading(true)
    const data = isTeacherArea ? await getMyLessons(currentUser.uid) : await getAllLessons()
    setLessons(data)
    setLoading(false)
  }

  useEffect(() => {
    loadLessons()
  }, [currentUser, isTeacherArea])

  const topics = useMemo(() => {
    return [...new Set(lessons.map(lesson => lesson.topic).filter(Boolean))].sort()
  }, [lessons])

  const filtered = useMemo(() => {
    const search = filters.search.toLowerCase()
    return lessons.filter(lesson => {
      const status = statusOf(lesson)
      return (
        (!filters.grade || lesson.grade === filters.grade) &&
        (!filters.subject || lesson.subject === filters.subject) &&
        (!filters.topic || lesson.topic === filters.topic) &&
        (!filters.status || status === filters.status) &&
        (!search || [lesson.title, lesson.subject, lesson.topic].some(value => String(value || '').toLowerCase().includes(search)))
      )
    })
  }, [filters, lessons])

  const stats = useMemo(() => ({
    total: lessons.length,
    published: lessons.filter(lesson => statusOf(lesson) === 'published').length,
    pending: lessons.filter(lesson => statusOf(lesson) === 'pending').length,
    drafts: lessons.filter(lesson => statusOf(lesson) === 'draft').length,
  }), [lessons])

  function patchFilter(field, value) {
    setFilters(current => ({ ...current, [field]: value }))
  }

  async function togglePublish(lesson) {
    setBusyId(lesson.id)
    try {
      const next = statusOf(lesson) !== 'published'
      await updateLesson(lesson.id, { isPublished: next, status: next ? 'published' : 'draft' })
      show(next ? 'Lesson published.' : 'Lesson unpublished.')
      await loadLessons()
    } catch (error) {
      show(error.message || 'Could not update lesson.', true)
    } finally {
      setBusyId(null)
    }
  }

  async function submitLesson(lesson) {
    setBusyId(lesson.id)
    try {
      await submitForApproval('lesson', lesson.id)
      show('Lesson submitted for approval.')
      await loadLessons()
    } catch (error) {
      show(error.message || 'Could not submit lesson.', true)
    } finally {
      setBusyId(null)
    }
  }

  async function withdrawLesson(lesson) {
    setBusyId(lesson.id)
    try {
      await withdrawFromApproval('lesson', lesson.id)
      show('Lesson returned to draft.')
      await loadLessons()
    } catch (error) {
      show(error.message || 'Could not withdraw lesson.', true)
    } finally {
      setBusyId(null)
    }
  }

  async function removeLesson(lesson) {
    if (!window.confirm(`Delete "${lesson.title}"? This cannot be undone.`)) return
    setBusyId(lesson.id)
    try {
      await deleteLesson(lesson.id)
      show('Lesson deleted.')
      await loadLessons()
    } catch (error) {
      show(error.message || 'Could not delete lesson.', true)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-5">
      {toast && (
        <div className={`fixed right-4 top-4 z-50 max-w-sm rounded-2xl px-5 py-3 text-sm font-black text-white shadow-lg ${toast.error ? 'bg-red-600' : 'bg-emerald-700'}`}>
          {toast.message}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black uppercase tracking-wide text-emerald-700">Lessons</p>
          <h1 className="mt-1 text-3xl font-black text-gray-900">{isTeacherArea ? 'My Lesson Slides' : 'Lesson Dashboard'}</h1>
          <p className="mt-1 text-sm font-bold text-gray-500">Create, edit, publish, and organise native slides or preserved PowerPoint presentations.</p>
        </div>
        <Button as={Link} to={`${basePath}/new`} variant="primary" size="md">
          Create New Lesson
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total" value={stats.total} tone="gray" />
        <Stat label="Published" value={stats.published} tone="emerald" />
        <Stat label="Pending" value={stats.pending} tone="amber" />
        <Stat label="Drafts" value={stats.drafts} tone="sky" />
      </div>

      <div className="rounded-3xl border theme-border bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(130px,0.6fr))]">
          <input value={filters.search} onChange={event => patchFilter('search', event.target.value)} placeholder="Search title, subject, or topic" className="rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500" />
          <select value={filters.grade} onChange={event => patchFilter('grade', event.target.value)} className="rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500">
            <option value="">All Grades</option>
            {LESSON_GRADES.map(grade => <option key={grade} value={grade}>Grade {grade}</option>)}
          </select>
          <select value={filters.subject} onChange={event => patchFilter('subject', event.target.value)} className="rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500">
            <option value="">All Subjects</option>
            {LESSON_SUBJECTS.map(subject => <option key={subject} value={subject}>{subject}</option>)}
          </select>
          <select value={filters.topic} onChange={event => patchFilter('topic', event.target.value)} className="rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500">
            <option value="">All Topics</option>
            {topics.map(topic => <option key={topic} value={topic}>{topic}</option>)}
          </select>
          <select value={filters.status} onChange={event => patchFilter('status', event.target.value)} className="rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-bold outline-none focus:border-emerald-500">
            <option value="">All Statuses</option>
            <option value="published">Published</option>
            <option value="pending">Pending</option>
            <option value="draft">Draft</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} height={112} className="!rounded-3xl" />)
        ) : filtered.length === 0 ? (
          <div className="theme-card border theme-border rounded-3xl py-16 text-center shadow-elev-sm">
            <p className="text-4xl" aria-hidden="true">▦</p>
            <h2 className="mt-3 text-display-md theme-text">No lessons found</h2>
            <p className="mt-1 text-body-sm theme-text-muted">Create a slide lesson or adjust the filters.</p>
            <Button as={Link} to={`${basePath}/new`} variant="primary" size="sm" className="mt-4">
              Create Lesson
            </Button>
          </div>
        ) : (
          filtered.map(lesson => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              editPath={`${basePath}/${lesson.id}/edit`}
              canPublish={canPublish}
              busyId={busyId}
              onPublishToggle={togglePublish}
              onSubmit={submitLesson}
              onWithdraw={withdrawLesson}
              onDelete={removeLesson}
            />
          ))
        )}
      </div>
    </div>
  )
}
