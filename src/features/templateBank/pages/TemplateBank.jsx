import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import { searchTemplates } from '../services/templateBankService'
import {
  SYLLABUS_OPTIONS,
  getActiveGradeForms,
  getSubjectsForGradeForm,
} from '../../../config/library'
import { formatDate } from '../../../utils/teacherLibraryService'

const EMPTY_FILTERS = {
  curriculum: '', grade: '', subject: '', topic: '', subtopic: '',
  competency: '', specificOutcome: '', keywords: '',
}

function QualityBadge({ score }) {
  const tone = score >= 80 ? 'bg-emerald-100 text-emerald-700'
    : score >= 60 ? 'bg-amber-100 text-amber-700'
      : 'bg-rose-100 text-rose-700'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
      ★ {score}
    </span>
  )
}

function Stars({ value }) {
  const full = Math.round(value)
  return (
    <span className="text-amber-500" aria-label={`${value} out of 5`}>
      {'★'.repeat(full)}<span className="text-gray-300">{'★'.repeat(5 - full)}</span>
    </span>
  )
}

function TemplateCard({ t }) {
  return (
    <Link
      to={`/teacher/templates/${t.id}`}
      className="group flex flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-orange-300 hover:shadow-md"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-sm font-semibold text-gray-900 group-hover:text-orange-700">
          {t.title}
        </h3>
        <QualityBadge score={t.qualityScore} />
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {[t.grade, t.subject, t.topic].filter(Boolean).map((chip) => (
          <span key={chip} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
            {chip}
          </span>
        ))}
      </div>
      {t.subtopic ? (
        <p className="mb-1 text-xs font-medium text-gray-500">{t.subtopic}</p>
      ) : null}
      <p className="mb-3 line-clamp-3 flex-1 text-xs text-gray-600">{t.preview}</p>
      <div className="mt-auto flex items-center justify-between text-[11px] text-gray-500">
        <span className="flex items-center gap-2">
          {t.ratingCount > 0 ? (
            <span className="flex items-center gap-1"><Stars value={t.ratingAvg} />({t.ratingCount})</span>
          ) : <span className="text-gray-400">No ratings yet</span>}
        </span>
        <span>{t.usageCount} {t.usageCount === 1 ? 'use' : 'uses'}</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
        <span>{t.curriculumVersion ? `Curriculum: ${t.curriculumVersion}` : ''}</span>
        <span>{t.updatedAt ? `Updated ${formatDate(t.updatedAt)}` : ''}</span>
      </div>
    </Link>
  )
}

export default function TemplateBank() {
  const { currentUser } = useAuth()
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const gradeForms = useMemo(
    () => (filters.curriculum ? getActiveGradeForms(filters.curriculum) : []),
    [filters.curriculum],
  )
  const subjects = useMemo(
    () => (filters.curriculum && filters.grade
      ? getSubjectsForGradeForm(filters.curriculum, filters.grade) : []),
    [filters.curriculum, filters.grade],
  )

  // Re-run the (cached, instant) search whenever a filter changes — debounced
  // lightly so typing in the keyword box stays smooth.
  useEffect(() => {
    let alive = true
    setLoading(true)
    const handle = setTimeout(() => {
      searchTemplates(filters)
        .then((res) => { if (alive) { setRows(res); setError(null) } })
        .catch((err) => { if (alive) setError(err.message || String(err)) })
        .finally(() => { if (alive) setLoading(false) })
    }, 120)
    return () => { alive = false; clearTimeout(handle) }
  }, [filters])

  const update = (patch) => setFilters((f) => {
    const next = { ...f, ...patch }
    // Reset dependent dropdowns when a parent changes.
    if ('curriculum' in patch) { next.grade = ''; next.subject = '' }
    if ('grade' in patch) next.subject = ''
    return next
  })

  if (!currentUser) return null

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <SeoHelmet title="Template Bank — ZedExams" noindex />

      <header className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Template Bank</h1>
        <p className="mt-1 text-sm text-gray-600">
          Find, copy, and customise professionally structured lesson plan templates.
          Templates are anonymised, curriculum-aligned, and improve as more teachers plan.
        </p>
      </header>

      {/* Filters */}
      <div className="mb-5 grid grid-cols-2 gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 sm:grid-cols-3 lg:grid-cols-4">
        <label className="flex flex-col text-xs font-medium text-gray-600">
          Curriculum
          <select
            className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            value={filters.curriculum}
            onChange={(e) => update({ curriculum: e.target.value })}
          >
            <option value="">All</option>
            {SYLLABUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
          </select>
        </label>

        <label className="flex flex-col text-xs font-medium text-gray-600">
          Grade
          <select
            className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100"
            value={filters.grade}
            disabled={!filters.curriculum}
            onChange={(e) => update({ grade: e.target.value })}
          >
            <option value="">All</option>
            {gradeForms.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </label>

        <label className="flex flex-col text-xs font-medium text-gray-600">
          Subject
          <select
            className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100"
            value={filters.subject}
            disabled={!filters.grade}
            onChange={(e) => update({ subject: e.target.value })}
          >
            <option value="">All</option>
            {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label className="flex flex-col text-xs font-medium text-gray-600">
          Topic
          <input
            className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            value={filters.topic}
            placeholder="e.g. Fractions"
            onChange={(e) => update({ topic: e.target.value })}
          />
        </label>

        <label className="flex flex-col text-xs font-medium text-gray-600">
          Subtopic
          <input
            className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            value={filters.subtopic}
            placeholder="e.g. Equivalent fractions"
            onChange={(e) => update({ subtopic: e.target.value })}
          />
        </label>

        <label className="flex flex-col text-xs font-medium text-gray-600">
          Competency
          <input
            className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            value={filters.competency}
            onChange={(e) => update({ competency: e.target.value })}
          />
        </label>

        <label className="flex flex-col text-xs font-medium text-gray-600 sm:col-span-2">
          Keywords
          <input
            className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            value={filters.keywords}
            placeholder="Search titles, topics, vocabulary…"
            onChange={(e) => update({ keywords: e.target.value })}
          />
        </label>

        <div className="col-span-full flex items-center justify-between pt-1">
          <span className="text-xs text-gray-500">
            {loading ? 'Searching…' : `${rows.length} template${rows.length === 1 ? '' : 's'}`}
          </span>
          <button
            type="button"
            className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-white"
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            Clear filters
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : null}

      {!error && !loading && rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
          No templates match yet. As teachers create lesson plans, the bank fills automatically.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((t) => <TemplateCard key={t.id} t={t} />)}
      </div>
    </div>
  )
}
