import { useState, useRef, useEffect, useMemo } from 'react'
import {
  generateWorksheetStream,
  TEACHER_GRADES,
  TEACHER_LANGUAGES,
  WORKSHEET_DIFFICULTIES,
  WORKSHEET_QUESTION_COUNTS,
  WORKSHEET_DURATIONS,
  CURRICULUM_TERMS,
  LESSON_NUMBER_OPTIONS,
  TOTAL_LESSONS_OPTIONS,
  LEARNING_ENVIRONMENT_OPTIONS,
  getSubjectsForGrade,
  isSubjectValidForGrade,
  defaultSubjectForGrade,
} from '../../../utils/teacherTools'
import { downloadWorksheetDocx } from '../../../utils/worksheetToDocx'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'
import { attachLibraryToGeneration, isFreePlanTeacher } from '../../../utils/teacherLibraryService'
import { useAuth } from '../../../contexts/AuthContext'
import { LIBRARY_TYPES } from '../../../config/library'
import TopicSubtopicPicker from './TopicSubtopicPicker'
import AiGenerationProgress from '../../ui/AiGenerationProgress'
import { mapWorksheetPhaseToStage } from '../../ui/aiGenerationStages'

/**
 * Worksheet Generator — pupil-facing worksheet + separate answer-key export.
 */
export default function WorksheetGenerator() {
  const { userProfile, isAdmin } = useAuth()
  const urlDefaults = useFormDefaultsFromUrl()
  const [form, setForm] = useState(() => ({
    grade: 'G5',
    subject: 'mathematics',
    topic: '',
    subtopic: '',
    term: '',
    lessonNumber: '',
    totalLessons: '',
    learningEnvironment: '',
    count: 10,
    difficulty: 'mixed',
    durationMinutes: 30,
    language: 'english',
    instructions: '',
    includeAnswerKey: true,
    ...urlDefaults,
  }))
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [worksheet, setWorksheet] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')
  const [showAnswers, setShowAnswers] = useState(false)
  const [progress, setProgress] = useState(null)
  const cancelRef = useRef(null)

  useEffect(() => {
    return () => {
      try { cancelRef.current?.() } catch { /* ignore */ }
    }
  }, [])

  const subjectOptions = useMemo(
    () => getSubjectsForGrade(form.grade),
    [form.grade],
  )

  useEffect(() => {
    if (!isSubjectValidForGrade(form.subject, form.grade)) {
      setForm((f) => ({ ...f, subject: defaultSubjectForGrade(f.grade) }))
    }
  }, [form.grade, form.subject])

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function onGenerate(e) {
    e.preventDefault()
    if (!form.topic.trim()) {
      setErrorMessage('Please enter a topic.')
      setStatus('error')
      return
    }
    try { cancelRef.current?.() } catch { /* ignore */ }
    setStatus('generating')
    setErrorMessage('')
    setErrorDetail('')
    setWarning('')
    setWorksheet(null)
    setProgress({ phase: 'queued', elapsedMs: 0 })

    cancelRef.current = generateWorksheetStream(form, {
      onProgress: (p) => setProgress(p),
      onResult: (data) => {
        setWorksheet(data.worksheet)
        setGenerationId(data.generationId)
        setUsage(data.usage)
        setWarning(data.warning || '')
        setStatus('success')
        cancelRef.current = null
        if (data.generationId) {
          // Worksheets surface in the Assessments section of the library —
          // they're the "Topic Test" of a teacher's day-to-day routine.
          attachLibraryToGeneration(data.generationId, {
            libraryType:    LIBRARY_TYPES.ASSESSMENTS,
            grade:          form.grade,
            subject:        form.subject,
            assessmentType: 'topic',
          }).catch(() => {})
        }
      },
      onError: (err) => {
        setStatus('error')
        setErrorMessage(err?.message || 'Generation failed.')
        setErrorDetail('')
        cancelRef.current = null
      },
    })
  }

  function onCancel() {
    try { cancelRef.current?.() } catch { /* ignore */ }
    cancelRef.current = null
    setStatus('idle')
    setProgress(null)
  }

  function buildFilename(mode) {
    return buildDownloadName({
      docType: 'Worksheet',
      grade: form.grade,
      subject: form.subject,
      topic: worksheet?.header?.topic || form.topic,
      variant: mode === 'answer_key' ? 'Answer Key' : undefined,
    })
  }

  function onExportPupil() {
    if (!worksheet) return
    downloadWorksheetDocx(worksheet, buildFilename('worksheet'), { mode: 'worksheet', attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
  }

  function onExportAnswerKey() {
    if (!worksheet) return
    downloadWorksheetDocx(worksheet, buildFilename('answer_key'), { mode: 'answer_key', attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
  }

  return (
    <div className="min-h-screen py-4 sm:py-6 lg:py-8" style={{ background: '#f5efe1' }}>
      <SeoHelmet title="Worksheet studio" noIndex />
      <div className="max-w-7xl mx-auto">
        <StudioPageHeader
          eyebrow="Worksheet Studio"
          title="Print-ready practice"
          subtitle="Zambian CBC worksheets with a separate, fully-answered marking key — in under a minute."
          emoji="🐢"
        />

        <div className="grid grid-cols-1 gap-6">
          {/* Input panel */}
          <form
            onSubmit={onGenerate}
            className="studio-card p-5 space-y-4 h-fit w-full max-w-2xl mx-auto"
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
              options={subjectOptions}
              onChange={(v) => updateField('subject', v)}
            />
            <TopicSubtopicPicker
              grade={form.grade}
              subject={form.subject}
              topic={form.topic}
              subtopic={form.subtopic}
              onChangeTopic={(v) => updateField('topic', v)}
              onChangeSubtopic={(v) => updateField('subtopic', v)}
              subtopicPlaceholder="e.g. Adding Fractions with Unlike Denominators"
            />
            <FieldSelect
              label="Term"
              value={form.term}
              options={CURRICULUM_TERMS}
              onChange={(v) => updateField('term', v)}
            />
            <FieldSelect
              label="Number of lessons for this sub-topic"
              value={form.totalLessons}
              options={TOTAL_LESSONS_OPTIONS}
              onChange={(v) => updateField('totalLessons', v)}
            />
            <FieldSelect
              label="Lesson number"
              value={form.lessonNumber}
              options={LESSON_NUMBER_OPTIONS}
              onChange={(v) => updateField('lessonNumber', v)}
            />
            <FieldSelect
              label="Learning environment"
              value={form.learningEnvironment}
              options={LEARNING_ENVIRONMENT_OPTIONS}
              onChange={(v) => updateField('learningEnvironment', v)}
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
              className="studio-btn-primary w-full py-3"
            >
              {status === 'generating' ? 'Generating…' : '▶ Generate Worksheet'}
            </button>

            {usage && (
              <div className="text-xs theme-text-secondary text-center">
                {usage.used}/{usage.limit} worksheets used on the{' '}
                <span className="font-bold capitalize">{usage.plan}</span> plan this month
              </div>
            )}
          </form>

          {/* Output panel */}
          <section className="studio-card p-5 min-h-[400px]">
            {status === 'idle' && <EmptyState />}
            {status === 'generating' && (
              <AiGenerationProgress
                variant="card"
                preset="worksheet"
                running
                title="Writing your worksheet…"
                subtitle={worksheetProgressSubtitle(progress)}
                activeStageId={mapWorksheetPhaseToStage(progress?.phase)}
                onCancel={onCancel}
              />
            )}
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
                    <h2 className="studio-display" style={{ fontSize: 22, color: '#0e2a32', margin: '0 0 2px' }}>
                      {worksheet.header?.title || 'Worksheet'}
                    </h2>
                    <p className="text-xs" style={{ color: '#566f76' }}>
                      {worksheet.header?.totalMarks} marks · review, export, print.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label
                      className="flex items-center gap-2 text-sm px-3 py-2 rounded-xl cursor-pointer"
                      style={{ color: '#0e2a32', border: '1.5px solid #d9cfb8' }}
                    >
                      <input
                        type="checkbox"
                        checked={showAnswers}
                        onChange={(e) => setShowAnswers(e.target.checked)}
                        style={{ accentColor: '#ff7a2e' }}
                      />
                      Show answers
                    </label>
                    <button onClick={onExportPupil} className="studio-btn-ghost">
                      📄 Worksheet .docx
                    </button>
                    <button onClick={onExportAnswerKey} className="studio-btn-primary">
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
  return <label className="studio-label">{children}</label>
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
        className="studio-input resize-none"
      />
    </div>
  )
}

function FieldSelect({ label, value, options, onChange }) {
  const groups = []
  let cur = null
  for (const o of options) {
    if (o.group !== undefined) { if (cur) groups.push(cur); cur = { label: o.group, items: [] } }
    else { if (!cur) cur = { label: null, items: [] }; cur.items.push(o) }
  }
  if (cur) groups.push(cur)
  const flat = groups.length === 1 && !groups[0].label
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="studio-input"
      >
        {flat
          ? groups[0].items.map(o => <option key={o.value} value={o.value}>{o.label}</option>)
          : groups.map((g, i) => g.label
              ? <optgroup key={i} label={g.label}>{g.items.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
              : g.items.map(o => <option key={o.value} value={o.value}>{o.label}</option>)
          )
        }
      </select>
    </div>
  )
}

/* ── States ─────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div style={{ width: 86, height: 86, borderRadius: '50%', background: '#d8ecd0', display: 'grid', placeItems: 'center', fontSize: 44 }}>
        🐢
      </div>
      <h3 className="studio-display mt-4" style={{ fontSize: 20, color: '#0e2a32' }}>Ready to make a worksheet</h3>
      <p className="text-sm max-w-md mt-1" style={{ color: '#566f76' }}>
        Pick the grade, subject and topic on the left. You'll get a printable
        worksheet plus a separate answer key file for marking.
      </p>
    </div>
  )
}

// Secondary line under the progress tracker. Surfaces the live token count and
// elapsed seconds from the real SSE stream when available.
function worksheetProgressSubtitle(progress) {
  const tokens = progress?.approxOutputTokens
  const seconds = progress?.elapsedMs ? Math.round(progress.elapsedMs / 1000) : null
  const parts = []
  if (tokens) parts.push(`~${tokens.toLocaleString()} tokens written`)
  if (seconds != null && progress?.phase && progress.phase !== 'queued') parts.push(`${seconds}s`)
  return parts.length ? parts.join(' · ') : undefined
}

function ErrorState({ message, detail, onDismiss }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div className="text-5xl mb-3">⚠️</div>
      <h3 className="studio-display" style={{ fontSize: 20, color: '#0e2a32' }}>Something went wrong</h3>
      <p className="text-sm max-w-md mb-3 mt-1" style={{ color: '#566f76' }}>{message}</p>
      {detail && (
        <p className="text-xs max-w-md mb-4 font-mono break-all px-3 py-2 rounded-lg" style={{ background: '#f5efe1', color: '#566f76' }}>
          {detail}
        </p>
      )}
      <button onClick={onDismiss} className="studio-btn-ghost">
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
