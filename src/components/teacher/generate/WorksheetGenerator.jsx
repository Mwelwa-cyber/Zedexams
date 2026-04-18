import { useState } from 'react'
import {
  generateWorksheet,
  TEACHER_GRADES,
  TEACHER_SUBJECTS,
  TEACHER_LANGUAGES,
  WORKSHEET_DIFFICULTIES,
  WORKSHEET_QUESTION_COUNTS,
  WORKSHEET_DURATIONS,
} from '../../../utils/teacherTools'
import { downloadWorksheetDocx } from '../../../utils/worksheetToDocx'

/**
 * Worksheet Generator — pupil-facing worksheet + separate answer-key export.
 */
export default function WorksheetGenerator() {
  const [form, setForm] = useState({
    grade: 'G5',
    subject: 'mathematics',
    topic: '',
    subtopic: '',
    count: 10,
    difficulty: 'mixed',
    durationMinutes: 30,
    language: 'english',
    instructions: '',
    includeAnswerKey: true,
  })
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [worksheet, setWorksheet] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')
  const [showAnswers, setShowAnswers] = useState(false)

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function onGenerate(e) {
    e.preventDefault()
    if (!form.topic.trim()) {
      setErrorMessage('Please enter a topic.')
      setStatus('error')
      return
    }
    setStatus('generating')
    setErrorMessage('')
    setErrorDetail('')
    setWarning('')
    setWorksheet(null)

    const res = await generateWorksheet(form)
    if (!res.ok) {
      setStatus('error')
      setErrorMessage(res.error)
      setErrorDetail(
        [res.code && `code: ${res.code}`, res.rawMessage && `detail: ${res.rawMessage}`]
          .filter(Boolean).join(' · '),
      )
      return
    }
    setWorksheet(res.data.worksheet)
    setGenerationId(res.data.generationId)
    setUsage(res.data.usage)
    setWarning(res.data.warning || '')
    setStatus('success')
  }

  function buildFilename(mode) {
    const slug = (s) => String(s || '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    const parts = [
      slug(form.grade),
      slug(form.subject),
      slug(worksheet?.header?.topic || form.topic),
      mode === 'answer_key' ? 'ANSWER-KEY' : 'worksheet',
      new Date().toISOString().slice(0, 10),
    ].filter(Boolean)
    return `${parts.join('_')}.docx`
  }

  function onExportPupil() {
    if (!worksheet) return
    downloadWorksheetDocx(worksheet, buildFilename('worksheet'), { mode: 'worksheet' })
  }

  function onExportAnswerKey() {
    if (!worksheet) return
    downloadWorksheetDocx(worksheet, buildFilename('answer_key'), { mode: 'answer_key' })
  }

  return (
    <div className="min-h-screen theme-bg p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-black theme-text">
            Worksheet Generator
          </h1>
          <p className="text-sm theme-text-secondary mt-1">
            Printable Zambian CBC worksheets with complete answer keys — in seconds.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
          {/* Input panel */}
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
            <FieldText
              label="Topic *"
              placeholder="e.g. Fractions"
              value={form.topic}
              onChange={(v) => updateField('topic', v)}
              maxLength={120}
            />
            <FieldText
              label="Sub-topic (optional)"
              placeholder="e.g. Adding Fractions with Unlike Denominators"
              value={form.subtopic}
              onChange={(v) => updateField('subtopic', v)}
              maxLength={160}
            />
            <FieldSelect
              label="Number of questions"
              value={String(form.count)}
              options={WORKSHEET_QUESTION_COUNTS.map((p) => ({
                value: String(p.value), label: p.label,
              }))}
              onChange={(v) => updateField('count', Number(v))}
            />
            <FieldSelect
              label="Difficulty"
              value={form.difficulty}
              options={WORKSHEET_DIFFICULTIES}
              onChange={(v) => updateField('difficulty', v)}
            />
            <FieldSelect
              label="Pupil time (estimate)"
              value={String(form.durationMinutes)}
              options={WORKSHEET_DURATIONS.map((p) => ({
                value: String(p.value), label: p.label,
              }))}
              onChange={(v) => updateField('durationMinutes', Number(v))}
            />
            <FieldSelect
              label="Language"
              value={form.language}
              options={TEACHER_LANGUAGES}
              onChange={(v) => updateField('language', v)}
            />
            <FieldTextarea
              label="Extra instructions (optional)"
              placeholder="e.g. Include at least one word problem about the market."
              value={form.instructions}
              onChange={(v) => updateField('instructions', v)}
              maxLength={500}
            />

            <button
              type="submit"
              disabled={status === 'generating'}
              className="w-full py-3 rounded-xl font-black text-white bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {status === 'generating' ? 'Generating…' : '📝 Generate Worksheet'}
            </button>

            {usage && (
              <div className="text-xs theme-text-secondary text-center">
                {usage.used}/{usage.limit} worksheets used on the{' '}
                <span className="font-bold capitalize">{usage.plan}</span> plan this month
              </div>
            )}
          </form>

          {/* Output panel */}
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
            {status === 'success' && worksheet && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="text-lg font-black theme-text">
                      {worksheet.header?.title || 'Worksheet'}
                    </h2>
                    <p className="text-xs theme-text-secondary">
                      {worksheet.header?.totalMarks} marks · review, export, print.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="flex items-center gap-2 text-sm theme-text px-3 py-2 rounded-xl border theme-border cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showAnswers}
                        onChange={(e) => setShowAnswers(e.target.checked)}
                        className="accent-indigo-500"
                      />
                      Show answers
                    </label>
                    <button
                      onClick={onExportPupil}
                      className="px-4 py-2 rounded-xl text-sm font-bold border theme-border hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                    >
                      📄 Worksheet .docx
                    </button>
                    <button
                      onClick={onExportAnswerKey}
                      className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-indigo-500 to-purple-500"
                    >
                      🔑 Answer Key .docx
                    </button>
                  </div>
                </div>
                {warning && (
                  <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
                    ⚠️ {warning}
                  </div>
                )}
                <WorksheetView worksheet={worksheet} showAnswers={showAnswers} />
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

/* ── Inputs ─────────────────────────────────────────────────── */

function FieldLabel({ children }) {
  return (
    <label className="block text-xs font-bold uppercase tracking-wide theme-text-secondary mb-1">
      {children}
    </label>
  )
}

function FieldText({ label, value, onChange, placeholder, maxLength }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="w-full px-3 py-2 rounded-lg border theme-border bg-transparent theme-text focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
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
        className="w-full px-3 py-2 rounded-lg border theme-border bg-transparent theme-text focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
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
        className="w-full px-3 py-2 rounded-lg border theme-border bg-transparent theme-text focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
      <div className="text-5xl mb-3">📝</div>
      <h3 className="text-lg font-black theme-text mb-1">Ready to make a worksheet</h3>
      <p className="text-sm theme-text-secondary max-w-md">
        Pick the grade, subject and topic on the left. You'll get a printable
        worksheet plus a separate answer key file for marking.
      </p>
    </div>
  )
}

function GeneratingState() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div className="text-5xl mb-3 animate-bounce">✍️</div>
      <h3 className="text-lg font-black theme-text mb-1">Writing questions…</h3>
      <p className="text-sm theme-text-secondary max-w-md">
        Usually takes 10–20 seconds. Answer key is generated at the same time.
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
        <p className="text-xs theme-text-secondary/70 max-w-md mb-4 font-mono break-all px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800">
          {detail}
        </p>
      )}
      <button
        onClick={onDismiss}
        className="px-4 py-2 rounded-xl text-sm font-bold border theme-border"
      >
        Try again
      </button>
    </div>
  )
}

/* ── Rendered worksheet ─────────────────────────────────────── */

function WorksheetView({ worksheet, showAnswers }) {
  return (
    <article className="space-y-5">
      <div className="rounded-xl border theme-border p-4 bg-slate-50/50 dark:bg-slate-900/20">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm theme-text">
          <div><span className="font-bold">Grade: </span>{worksheet.header?.grade}</div>
          <div><span className="font-bold">Subject: </span>{worksheet.header?.subject}</div>
          <div><span className="font-bold">Topic: </span>{worksheet.header?.topic}</div>
          {worksheet.header?.subtopic && (
            <div><span className="font-bold">Sub-topic: </span>{worksheet.header.subtopic}</div>
          )}
          <div><span className="font-bold">Duration: </span>{worksheet.header?.duration}</div>
          <div><span className="font-bold">Total marks: </span>{worksheet.header?.totalMarks}</div>
        </div>
        {worksheet.header?.instructions && (
          <p className="mt-3 text-sm italic theme-text-secondary">
            {worksheet.header.instructions}
          </p>
        )}
      </div>

      {(worksheet.sections || []).map((section, idx) => (
        <div key={idx} className="space-y-3">
          <h3 className="text-base font-black theme-text border-b theme-border pb-1">
            {section.title}
          </h3>
          {section.instructions && (
            <p className="text-sm italic theme-text-secondary">{section.instructions}</p>
          )}
          {(section.questions || []).map((q) => (
            <QuestionView key={q.number} q={q} showAnswers={showAnswers} />
          ))}
        </div>
      ))}

      {showAnswers && worksheet.answerKey?.markingNotes && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h4 className="font-bold text-sm text-emerald-900 mb-1">Marking Guidance</h4>
          <p className="text-sm text-emerald-800">{worksheet.answerKey.markingNotes}</p>
        </div>
      )}
    </article>
  )
}

function QuestionView({ q, showAnswers }) {
  const letters = ['A', 'B', 'C', 'D', 'E']
  return (
    <div className="rounded-xl border theme-border p-3">
      <div className="flex items-start gap-2">
        <span className="font-black theme-text shrink-0">{q.number}.</span>
        <div className="flex-1">
          <p className="theme-text">{q.prompt}</p>
          {(q.type === 'multiple_choice' || q.type === 'true_false') && q.options?.length > 0 && (
            <ul className="mt-2 space-y-1">
              {q.options.map((opt, i) => (
                <li key={i} className="text-sm theme-text">
                  <span className="font-bold mr-2">{letters[i] || '•'}.</span>{opt}
                </li>
              ))}
            </ul>
          )}
          {showAnswers && q.answer && (
            <div className="mt-2 pt-2 border-t theme-border">
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                <span className="font-bold">✓ Answer: </span>{q.answer}
              </p>
              {q.workingNotes && (
                <p className="text-xs theme-text-secondary italic mt-1">
                  {q.workingNotes}
                </p>
              )}
            </div>
          )}
        </div>
        <span className="text-xs theme-text-secondary shrink-0 ml-2">
          [{q.marks}]
        </span>
      </div>
    </div>
  )
}
