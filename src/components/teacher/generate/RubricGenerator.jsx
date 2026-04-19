import { useState } from 'react'
import {
  generateRubric,
  TEACHER_GRADES,
  TEACHER_SUBJECTS,
  TEACHER_LANGUAGES,
  RUBRIC_TASK_TYPES,
  RUBRIC_TOTAL_MARKS,
  RUBRIC_CRITERIA_COUNTS,
} from '../../../utils/teacherTools'
import { downloadRubricDocx } from '../../../utils/rubricToDocx'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import RubricView from '../views/RubricView'

export default function RubricGenerator() {
  const urlDefaults = useFormDefaultsFromUrl()
  const [form, setForm] = useState(() => ({
    grade: 'G9',
    subject: 'english',
    taskType: 'essay',
    taskDescription: '',
    totalMarks: 20,
    numberOfCriteria: 4,
    language: 'english',
    instructions: '',
    ...urlDefaults,
  }))
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [rubric, setRubric] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function onGenerate(e) {
    e.preventDefault()
    if (!form.taskDescription.trim()) {
      setErrorMessage('Please describe the task being graded.')
      setStatus('error')
      return
    }
    setStatus('generating')
    setErrorMessage('')
    setErrorDetail('')
    setWarning('')
    setRubric(null)

    const res = await generateRubric(form)
    if (!res.ok) {
      setStatus('error')
      setErrorMessage(res.error)
      setErrorDetail(
        [res.code && `code: ${res.code}`, res.rawMessage && `detail: ${res.rawMessage}`]
          .filter(Boolean).join(' · '),
      )
      return
    }
    setRubric(res.data.rubric)
    setGenerationId(res.data.generationId)
    setUsage(res.data.usage)
    setWarning(res.data.warning || '')
    setStatus('success')
  }

  function onExport() {
    if (!rubric) return
    const slug = (s) => String(s || '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    const parts = [
      slug(form.grade),
      slug(form.subject),
      slug(form.taskType),
      new Date().toISOString().slice(0, 10),
    ].filter(Boolean)
    downloadRubricDocx(rubric, `${parts.join('_')}_rubric.docx`)
  }

  return (
    <div className="min-h-screen theme-bg p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-black theme-text">
            Rubric Generator
          </h1>
          <p className="text-sm theme-text-secondary mt-1">
            Assessment rubrics for essays, projects, presentations, and practicals — with four performance levels and clear mark bands.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
          <form
            onSubmit={onGenerate}
            className="theme-card border theme-border rounded-2xl p-5 space-y-4 h-fit sticky top-4"
          >
            <FieldSelect
              label="Grade"
              value={form.grade}
              options={TEACHER_GRADES}
              onChange={(v) => updateField('grade', v)}
            />
            <FieldSelect
              label="Subject"
              value={form.subject}
              options={TEACHER_SUBJECTS}
              onChange={(v) => updateField('subject', v)}
            />
            <FieldSelect
              label="Task type"
              value={form.taskType}
              options={RUBRIC_TASK_TYPES}
              onChange={(v) => updateField('taskType', v)}
            />
            <FieldTextarea
              label="What are you grading? *"
              placeholder="e.g. 250-300 word argumentative essay on mobile phones in schools"
              value={form.taskDescription}
              onChange={(v) => updateField('taskDescription', v)}
              maxLength={500}
            />
            <div className="grid grid-cols-2 gap-3">
              <FieldSelect
                label="Total marks"
                value={String(form.totalMarks)}
                options={RUBRIC_TOTAL_MARKS.map((m) => ({ value: String(m.value), label: m.label }))}
                onChange={(v) => updateField('totalMarks', Number(v))}
              />
              <FieldSelect
                label="# of criteria"
                value={String(form.numberOfCriteria)}
                options={RUBRIC_CRITERIA_COUNTS.map((c) => ({ value: String(c.value), label: c.label }))}
                onChange={(v) => updateField('numberOfCriteria', Number(v))}
              />
            </div>
            <FieldSelect
              label="Language"
              value={form.language}
              options={TEACHER_LANGUAGES}
              onChange={(v) => updateField('language', v)}
            />
            <FieldTextarea
              label="Extra instructions (optional)"
              placeholder="e.g. Emphasise citation of Zambian sources."
              value={form.instructions}
              onChange={(v) => updateField('instructions', v)}
              maxLength={500}
            />

            <button
              type="submit"
              disabled={status === 'generating'}
              className="w-full py-3 rounded-xl font-black text-white bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {status === 'generating' ? 'Generating…' : '📋 Generate Rubric'}
            </button>

            {usage && (
              <div className="text-xs theme-text-secondary text-center">
                {usage.used}/{usage.limit} rubrics used on the{' '}
                <span className="font-bold capitalize">{usage.plan}</span> plan this month
              </div>
            )}
          </form>

          <section className="theme-card border theme-border rounded-2xl p-5 min-h-[400px]">
            {status === 'idle' && <EmptyState />}
            {status === 'generating' && <GeneratingState />}
            {status === 'error' && (
              <ErrorState
                message={errorMessage}
                detail={errorDetail}
                onDismiss={() => setStatus('idle')}
              />
            )}
            {status === 'success' && rubric && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="text-lg font-black theme-text">{rubric.header?.title}</h2>
                    <p className="text-xs theme-text-secondary">
                      {rubric.header?.totalMarks} marks · {rubric.criteria?.length} criteria
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={onExport}
                      className="px-4 py-2 rounded-xl text-sm font-bold border theme-border hover:bg-slate-50 transition"
                    >
                      📄 Download .docx (landscape)
                    </button>
                    <button
                      onClick={() => setStatus('idle')}
                      className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-rose-500 to-pink-500"
                    >
                      ✨ Generate Another
                    </button>
                  </div>
                </div>
                {warning && (
                  <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
                    ⚠️ {warning}
                  </div>
                )}
                <RubricView rubric={rubric} />
                {generationId && (
                  <div className="mt-6 text-xs theme-text-secondary">
                    Saved as generation <code>{generationId}</code>.
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

/* ── Inputs (match other generators) ────────────────────────── */

function FieldLabel({ children }) {
  return (
    <label className="block text-xs font-bold uppercase tracking-wide theme-text-secondary mb-1">
      {children}
    </label>
  )
}

function FieldTextarea({ label, value, onChange, placeholder, maxLength }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={3}
        className="w-full px-3 py-2 rounded-lg border theme-border bg-transparent theme-text focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
      />
    </div>
  )
}

function FieldSelect({ label, value, options, onChange }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border theme-border bg-transparent theme-text focus:outline-none focus:ring-2 focus:ring-rose-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

/* ── States ─────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div className="text-5xl mb-3">📋</div>
      <h3 className="text-lg font-black theme-text mb-1">Consistent marking in seconds</h3>
      <p className="text-sm theme-text-secondary max-w-md">
        Describe the task, pick total marks, get a four-level rubric with clear descriptors
        for every criterion. Every teacher in your school can then mark the same piece the same way.
      </p>
    </div>
  )
}

function GeneratingState() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div className="text-5xl mb-3 animate-bounce">📊</div>
      <h3 className="text-lg font-black theme-text mb-1">Designing your rubric…</h3>
      <p className="text-sm theme-text-secondary max-w-md">
        Usually takes 10–20 seconds.
      </p>
    </div>
  )
}

function ErrorState({ message, detail, onDismiss }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div className="text-5xl mb-3">⚠️</div>
      <h3 className="text-lg font-black theme-text mb-1">Something went wrong</h3>
      <p className="text-sm theme-text-secondary max-w-md mb-3">{message}</p>
      {detail && (
        <p className="text-xs theme-text-secondary/70 max-w-md mb-4 font-mono break-all px-3 py-2 rounded-lg bg-slate-100">
          {detail}
        </p>
      )}
      <button onClick={onDismiss} className="px-4 py-2 rounded-xl text-sm font-bold border theme-border">
        Try again
      </button>
    </div>
  )
}
