import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import {
  getTemplate, rateTemplate, createLessonPlanFromTemplate,
} from '../services/templateBankService'
import { LessonPlanDocumentPreview } from '../../lessonPlanStudio'
import { templateCurriculumMode, templatePreviewMeta } from '../lib/templatePlanPreview'
import { formatDate } from '../../../utils/teacherLibraryService'

const AXIS_LABELS = {
  curriculumAlignment: 'Curriculum alignment',
  completeness: 'Completeness',
  accuracy: 'Accuracy',
  methodology: 'Teaching methodology',
  engagement: 'Learner engagement',
  assessment: 'Assessment quality',
  clarity: 'Clarity',
  resources: 'Resource quality',
}

function QualityBar({ label, value }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-36 shrink-0 text-gray-600">{label}</span>
      <div className="h-2 flex-1 rounded-full bg-gray-100">
        <div
          className="h-2 rounded-full bg-orange-400"
          style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }}
        />
      </div>
      <span className="w-8 text-right font-medium text-gray-700">{Math.round(value || 0)}</span>
    </div>
  )
}

const EMPTY_HEADER = {
  school: '', teacherName: '', date: '', time: '', class: '', learningEnvironment: '',
}

export default function TemplateBankDetail() {
  const { id } = useParams()
  const { currentUser } = useAuth()
  const navigate = useNavigate()

  const [template, setTemplate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showUseForm, setShowUseForm] = useState(false)
  const [header, setHeader] = useState(EMPTY_HEADER)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [myRating, setMyRating] = useState(0)
  const [rateMsg, setRateMsg] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    getTemplate(id)
      .then((t) => { if (alive) setTemplate(t) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [id])

  // A template is previewed as the finished document — same renderer, same
  // stylesheets, same A4 sheets as the Lesson Plan Studio's Preview tab — with
  // the teacher's own fields left as blanks to fill in.
  const previewMeta = useMemo(() => (template ? templatePreviewMeta(template) : null), [template])
  const curriculumMode = useMemo(() => templateCurriculumMode(template), [template])
  const [previewPages, setPreviewPages] = useState(null)

  const handleUse = async () => {
    if (!currentUser?.uid || !template) return
    setBusy(true); setErr(null)
    try {
      const newId = await createLessonPlanFromTemplate({
        uid: currentUser.uid, template, header,
      })
      // Straight into the studio, hydrated from the structured plan we just
      // saved — the teacher lands on the document they previewed and can edit
      // and export it there. Sending them to the library instead showed them a
      // read-only copy of a plan they had just chosen to work on.
      navigate(`/teacher/lesson-plans/${newId}/edit`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const handleRate = async (value) => {
    if (!template) return
    setMyRating(value)
    try {
      await rateTemplate(template.id, value)
      setRateMsg('Thanks — your rating was saved.')
    } catch (e) {
      setRateMsg(e instanceof Error ? e.message : 'Could not save your rating.')
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-4xl px-4 py-10 text-sm text-gray-500">Loading template…</div>
  }
  if (!template) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <p className="text-sm text-gray-600">This template could not be found.</p>
        <Link to="/teacher/templates" className="mt-2 inline-block text-sm font-medium text-orange-700">
          ← Back to Template Bank
        </Link>
      </div>
    )
  }

  const breakdown = template.qualityBreakdown || {}

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <SeoHelmet title={`${template.title} — Template Bank`} noindex />

      <Link to="/teacher/templates" className="text-sm font-medium text-orange-700">← Template Bank</Link>

      <header className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{template.title}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[template.curriculum, template.grade, template.subject, template.topic, template.subtopic]
              .filter(Boolean).map((chip) => (
                <span key={chip} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">{chip}</span>
              ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            v{template.version} · {template.usageCount} {template.usageCount === 1 ? 'use' : 'uses'}
            {template.ratingCount > 0 ? ` · ★ ${template.ratingAvg} (${template.ratingCount})` : ' · no ratings yet'}
            {template.curriculumVersion ? ` · Curriculum: ${template.curriculumVersion}` : ''}
            {template.updatedAt ? ` · Updated ${formatDate(template.updatedAt)}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowUseForm((v) => !v)}
          className="shrink-0 rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-orange-700"
        >
          Use Template
        </button>
      </header>

      {template.status === 'outdated' ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          This template may be out of date with the current curriculum. Review before use.
        </div>
      ) : null}

      {/* Use Template form */}
      {showUseForm ? (
        <section className="mt-4 rounded-2xl border border-orange-200 bg-orange-50/60 p-4">
          <h2 className="text-sm font-semibold text-gray-900">Create your lesson plan</h2>
          <p className="mt-0.5 text-xs text-gray-600">
            This makes a NEW private lesson plan in your library — the original template is never changed.
            Fill in your class details, then edit any part before saving.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              ['school', 'School', 'text'],
              ['teacherName', 'Teacher name', 'text'],
              ['date', 'Date', 'date'],
              ['time', 'Time', 'time'],
              ['class', 'Class', 'text'],
              ['learningEnvironment', 'Learning environment', 'text'],
            ].map(([key, label, type]) => (
              <label key={key} className="flex flex-col text-xs font-medium text-gray-600">
                {label}
                <input
                  type={type}
                  className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  value={header[key]}
                  onChange={(e) => setHeader((h) => ({ ...h, [key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          {err ? <p className="mt-2 text-xs text-rose-600">{err}</p> : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleUse}
              className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
            >
              {busy ? 'Creating…' : 'Create lesson plan'}
            </button>
            <button
              type="button"
              onClick={() => setShowUseForm(false)}
              className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-white"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Plan preview — the whole document, on real A4 sheets */}
        <div className="lg:col-span-2">
          <h2 className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-gray-900">
            Preview
            {previewPages ? (
              <span className="text-xs font-normal text-gray-500">
                {previewPages} {previewPages === 1 ? 'page' : 'pages'} · A4
              </span>
            ) : null}
          </h2>
          {template.content ? (
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-2 sm:p-4">
              <LessonPlanDocumentPreview
                planJson={template.content}
                meta={previewMeta}
                curriculumMode={curriculumMode}
                onPageCount={setPreviewPages}
                className="w-full"
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
              {template.preview || 'No preview available.'}
            </div>
          )}
        </div>

        {/* Quality + AI recommendations + rating */}
        <aside className="space-y-5">
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h3 className="mb-2 flex items-center justify-between text-sm font-semibold text-gray-900">
              AI Quality Score
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-sm font-bold text-emerald-700">
                {template.qualityScore}
              </span>
            </h3>
            <div className="space-y-1.5">
              {Object.entries(AXIS_LABELS).map(([key, label]) => (
                <QualityBar key={key} label={label} value={breakdown[key]} />
              ))}
            </div>
          </section>

          {template.aiRecommendations?.length ? (
            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <h3 className="mb-2 text-sm font-semibold text-gray-900">AI recommendations</h3>
              <ul className="list-disc space-y-1 pl-4 text-xs text-gray-600">
                {template.aiRecommendations.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </section>
          ) : null}

          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold text-gray-900">Rate this template</h3>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => handleRate(n)}
                  className={`text-2xl ${n <= myRating ? 'text-amber-500' : 'text-gray-300'} hover:text-amber-500`}
                  aria-label={`Rate ${n} star${n > 1 ? 's' : ''}`}
                >
                  ★
                </button>
              ))}
            </div>
            {rateMsg ? <p className="mt-1 text-xs text-gray-500">{rateMsg}</p> : null}
          </section>
        </aside>
      </div>
    </div>
  )
}
