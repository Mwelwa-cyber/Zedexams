import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  generateLessonPlanStream,
  TEACHER_GRADES,
  TEACHER_LANGUAGES,
  DURATION_PRESETS,
  CURRICULUM_TERMS,
  LESSON_NUMBER_OPTIONS,
  TOTAL_LESSONS_OPTIONS,
  LEARNING_ENVIRONMENT_OPTIONS,
  defaultSubjectForGrade,
} from '../../../utils/teacherTools'
import { useCurriculumOptions } from '../../../hooks/useCurriculumOptions'
import { downloadLessonPlanDocx } from '../../../utils/lessonPlanToDocx'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import { downloadLessonPlanPdf } from '../../../utils/lessonPlanToPdf'
import { generateDiagram } from '../../../utils/generateDiagram'
import { buildLessonDiagramPrompt } from '../../../utils/lessonDiagramPrompt'
import StudioPageHeader from '../StudioPageHeader'
import LessonPlanView from '../views/LessonPlanView'
import { attachLibraryToGeneration, isFreePlanTeacher } from '../../../utils/teacherLibraryService'
import { LIBRARY_TYPES } from '../../../config/library'
import AiGenerationProgress from '../../ui/AiGenerationProgress'
import { mapWorksheetPhaseToStage } from '../../ui/aiGenerationStages'

/**
 * Zambian CBC Lesson Plan Generator — teacher-facing MVP.
 *
 * Two-column layout: inputs on the left, generated plan on the right.
 * On mobile the columns stack.
 */
export default function LessonPlanGenerator() {
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
    durationMinutes: 40,
    language: 'english',
    teacherName: userProfile?.displayName || userProfile?.fullName || '',
    school: userProfile?.school || userProfile?.schoolName || '',
    // Attendance breakdown (CBC template 1.x)
    boysPresent: 0,
    girlsPresent: 0,
    numberOfPupils: 40,
    instructions: '',
    ...urlDefaults,
  }))
  const [status, setStatus] = useState('idle') // idle | generating | success | error
  const [errorMessage, setErrorMessage] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [lessonPlan, setLessonPlan] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')
  const [progress, setProgress] = useState(null) // {phase, approxOutputTokens?, elapsedMs}
  // Black-and-white lesson drawing (generateDiagram). The diagram itself lives
  // on lessonPlan.lessonDiagram so it flows into the preview + PDF/DOCX exports.
  const [diagramPrompt, setDiagramPrompt] = useState('')
  const [diagramStatus, setDiagramStatus] = useState('idle') // idle | generating | error
  const [diagramError, setDiagramError] = useState('')
  const cancelRef = useRef(null)

  // Cancel any in-flight stream when the component unmounts.
  useEffect(() => {
    return () => {
      try { cancelRef.current?.() } catch { /* ignore */ }
    }
  }, [])

  // Subjects taught at the current grade in the Zambian CBC. Recomputed
  // when the teacher changes grade so a Grade-1 teacher never sees Biology
  // and a Grade-12 teacher never sees Literacy.
  const { subjectOptions, subjectValues } = useCurriculumOptions(form.grade)

  // If the teacher switches to a grade where their previously-picked
  // subject isn't taught (e.g. G5 Mathematics → ECE, where it's Numeracy),
  // snap the subject to the first valid one for that grade.
  useEffect(() => {
    if (form.subject && !subjectValues.has(form.subject)) {
      setForm((f) => ({ ...f, subject: defaultSubjectForGrade(f.grade) }))
    }
  }, [form.grade, form.subject, subjectValues])

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
    // Abort any prior in-flight generation before kicking off a new one.
    try { cancelRef.current?.() } catch { /* ignore */ }
    setStatus('generating')
    setErrorMessage('')
    setErrorDetail('')
    setWarning('')
    setLessonPlan(null)
    setDiagramStatus('idle')
    setDiagramError('')
    setDiagramPrompt('')
    setProgress({ phase: 'queued', elapsedMs: 0 })

    cancelRef.current = generateLessonPlanStream(form, {
      onProgress: (p) => setProgress(p),
      onResult: (data) => {
        setLessonPlan(data.lessonPlan)
        setGenerationId(data.generationId)
        setUsage(data.usage)
        setWarning(data.warning || '')
        setStatus('success')
        // Auto-suggest a drawing prompt from the lesson's topic (teacher can
        // edit it and regenerate before generating the black-and-white image).
        setDiagramPrompt(buildLessonDiagramPrompt({
          topic: data.lessonPlan?.header?.topic || form.topic,
          subtopic: data.lessonPlan?.header?.subtopic || form.subtopic,
          subject: form.subject,
          grade: form.grade,
        }))
        cancelRef.current = null
        if (data.generationId) {
          attachLibraryToGeneration(data.generationId, {
            libraryType: LIBRARY_TYPES.LESSON_PLANS,
            grade:       form.grade,
            term:        data.lessonPlan?.header?.termAndWeek || form.term,
            subject:     form.subject,
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

  // Generate (or regenerate) the black-and-white lesson drawing. Routes through
  // the existing generateDiagram callable (Recraft line-art → OpenAI fallback,
  // both B&W) and stores the stable Storage URL on the plan so the preview and
  // the PDF/Word downloads all pick it up.
  async function onGenerateDiagram() {
    const prompt = diagramPrompt.trim()
    if (!prompt) {
      setDiagramError('Add a short description of the drawing first.')
      setDiagramStatus('error')
      return
    }
    setDiagramStatus('generating')
    setDiagramError('')
    try {
      const result = await generateDiagram({ prompt, style: 'line_art', size: '1365x1024' })
      setLessonPlan((prev) => (prev ? {
        ...prev,
        lessonDiagram: {
          url: result.url,
          prompt,
          size: result.size,
          provider: result.provider,
        },
      } : prev))
      setDiagramStatus('idle')
    } catch (err) {
      setDiagramStatus('error')
      setDiagramError(err?.message || 'Could not generate the drawing. Please try again.')
    }
  }

  function onRemoveDiagram() {
    setLessonPlan((prev) => {
      if (!prev) return prev
      const next = { ...prev }
      delete next.lessonDiagram
      return next
    })
    setDiagramStatus('idle')
    setDiagramError('')
  }

  function onExportDocx() {
    if (!lessonPlan) return
    const filename = buildFilename(form, lessonPlan)
    downloadLessonPlanDocx(lessonPlan, filename, { attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
  }

  async function onExportPdf() {
    if (!lessonPlan) return
    try {
      // Same human-readable base name as the .docx; downloadLessonPlanPdf adds
      // the .pdf extension and falls back to the print dialog if rendering
      // fails (e.g. inside the Android WebView).
      const base = buildFilename(form, lessonPlan).replace(/\.docx$/, '')
      await downloadLessonPlanPdf(lessonPlan, base, `${base}.pdf`)
    } catch (err) {
      // The helper only throws when popups are blocked — surface that
      // message inline via the existing error state.
      setErrorMessage(err?.message || 'Could not open the print window.')
      setStatus('success') // keep the plan visible; we're just flagging the popup
      setErrorDetail('')
      // Use a transient warning banner instead of the full error state
      setWarning(err?.message || 'Could not open the print window.')
    }
  }

  return (
    <div className="min-h-screen py-4 sm:py-6 lg:py-8" style={{ background: '#f5efe1' }}>
      <div className="max-w-7xl mx-auto">
        <StudioPageHeader
          eyebrow="Lesson Plan Studio"
          title="Build a CBC lesson plan"
          subtitle="SMART goal · three-tier Competencies · 5E Lesson Progression · Reflection — print-ready in seconds."
          emoji="🦊"
        />

        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
          {/* ── Input panel ─────────────────────────────────────── */}
          <form
            onSubmit={onGenerate}
            className="studio-card p-5 space-y-4 h-fit sticky top-4"
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
              label="Lesson duration"
              value={String(form.durationMinutes)}
              options={DURATION_PRESETS.map((p) => ({
                value: String(p.value),
                label: p.label,
              }))}
              onChange={(v) => updateField('durationMinutes', Number(v))}
            />
            <FieldSelect
              label="Medium of instruction"
              value={form.language}
              options={TEACHER_LANGUAGES}
              onChange={(v) => updateField('language', v)}
            />
            <div className="grid grid-cols-2 gap-3">
              <FieldNumber
                label="Boys present"
                value={form.boysPresent}
                onChange={(v) => {
                  const boys = Math.max(0, Number(v) || 0)
                  const girls = Math.max(0, Number(form.girlsPresent) || 0)
                  setForm(f => ({ ...f, boysPresent: boys, numberOfPupils: boys + girls }))
                }}
                min={0}
                max={200}
              />
              <FieldNumber
                label="Girls present"
                value={form.girlsPresent}
                onChange={(v) => {
                  const girls = Math.max(0, Number(v) || 0)
                  const boys = Math.max(0, Number(form.boysPresent) || 0)
                  setForm(f => ({ ...f, girlsPresent: girls, numberOfPupils: boys + girls }))
                }}
                min={0}
                max={200}
              />
            </div>
            <div className="text-xs theme-text-secondary -mt-2">
              Total present: <strong>{(Number(form.boysPresent) || 0) + (Number(form.girlsPresent) || 0)}</strong>
            </div>
            <FieldText
              label="School"
              placeholder="School name"
              value={form.school}
              onChange={(v) => updateField('school', v)}
              maxLength={120}
            />
            <FieldText
              label="Teacher name"
              placeholder="Mr / Mrs ..."
              value={form.teacherName}
              onChange={(v) => updateField('teacherName', v)}
              maxLength={80}
            />
            <FieldTextarea
              label="Extra instructions (optional)"
              placeholder="e.g. Include a group activity. Emphasise real-life market examples."
              value={form.instructions}
              onChange={(v) => updateField('instructions', v)}
              maxLength={500}
            />

            <button
              type="submit"
              disabled={status === 'generating'}
              className="studio-btn-primary w-full py-3"
            >
              {status === 'generating' ? 'Generating…' : '▶ Generate Lesson Plan'}
            </button>

            {usage && (
              <div className="text-xs theme-text-secondary text-center">
                {usage.used}/{usage.limit} used on the{' '}
                <span className="font-bold capitalize">{usage.plan}</span> plan this month
              </div>
            )}
          </form>

          {/* ── Output panel ────────────────────────────────────── */}
          <section className="studio-card p-5 min-h-[400px]">
            {status === 'idle' && (
              <EmptyState />
            )}
            {status === 'generating' && (
              <AiGenerationProgress
                variant="card"
                preset="lessonPlan"
                running
                title="Writing your lesson plan…"
                subtitle={lessonPlanProgressSubtitle(progress)}
                activeStageId={mapWorksheetPhaseToStage(progress?.phase, { hasAnswerKey: false })}
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
            {status === 'success' && lessonPlan && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="studio-display" style={{ fontSize: 22, color: '#0e2a32', margin: '0 0 2px' }}>Your Lesson Plan</h2>
                    <p className="text-xs" style={{ color: '#566f76' }}>
                      Review, edit in your document editor, and print for your head teacher.
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={onExportPdf}
                      title="Opens the system print dialog — choose 'Save as PDF' as the destination"
                      className="studio-btn-ghost inline-flex items-center gap-1.5"
                    >
                      📑 Download PDF
                    </button>
                    <button
                      onClick={onExportDocx}
                      className="studio-btn-ghost inline-flex items-center gap-1.5"
                    >
                      📄 Download .docx
                    </button>
                    <button
                      onClick={() => setStatus('idle')}
                      className="studio-btn-primary inline-flex items-center gap-1.5"
                    >
                      ▶ Generate Another
                    </button>
                  </div>
                </div>
                {warning && (
                  <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
                    ⚠️ {warning}
                  </div>
                )}
                <DiagramPanel
                  prompt={diagramPrompt}
                  onPromptChange={setDiagramPrompt}
                  status={diagramStatus}
                  error={diagramError}
                  diagram={lessonPlan.lessonDiagram}
                  onGenerate={onGenerateDiagram}
                  onRemove={onRemoveDiagram}
                />
                <LessonPlanView plan={lessonPlan} />
                {generationId && (
                  <div className="mt-6 text-xs theme-text-secondary">
                    Saved as generation <code>{generationId}</code>. Visit your Library to find it again.
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

/* ── Small input components ─────────────────────────────────────── */

function FieldLabel({ children }) {
  return <label className="studio-label">{children}</label>
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
        className="studio-input"
      />
    </div>
  )
}

function FieldNumber({ label, value, onChange, min, max }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        className="studio-input"
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

/* ── Lesson drawing (black & white) ─────────────────────────────── */

function DiagramPanel({ prompt, onPromptChange, status, error, diagram, onGenerate, onRemove }) {
  const busy = status === 'generating'
  return (
    <div className="studio-card p-4 mb-5" style={{ background: '#fffdf7' }}>
      <h3 className="studio-display" style={{ fontSize: 16, color: '#0e2a32', margin: 0 }}>
        ✏️ Black &amp; white lesson drawing
      </h3>
      <p className="text-xs" style={{ color: '#566f76', margin: '2px 0 10px' }}>
        Auto-suggested from your topic. Generate a clean line drawing — it appears in the plan below and in the PDF &amp; Word downloads.
      </p>
      <textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        rows={2}
        maxLength={400}
        placeholder="Describe the drawing to illustrate this lesson…"
        className="studio-input resize-none"
        disabled={busy}
      />
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy || !prompt.trim()}
          className="studio-btn-primary inline-flex items-center gap-1.5"
        >
          {busy ? 'Drawing…' : diagram ? '↻ Regenerate drawing' : '✏️ Generate drawing'}
        </button>
        {diagram && !busy && (
          <button type="button" onClick={onRemove} className="studio-btn-ghost">
            Remove
          </button>
        )}
      </div>
      {busy && (
        <div className="mt-3 text-xs flex items-center gap-2" style={{ color: '#566f76' }}>
          <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
          Generating a black-and-white drawing… this can take up to a minute.
        </div>
      )}
      {error && (
        <p className="mt-2 text-xs" style={{ color: '#b91c1c' }}>⚠️ {error}</p>
      )}
      {diagram?.url && !busy && (
        <figure className="mt-3 rounded-xl border bg-white p-3 text-center" style={{ borderColor: '#e3dcc9' }}>
          <img
            src={diagram.url}
            alt={diagram.prompt || 'Lesson illustration'}
            loading="lazy"
            className="mx-auto max-h-56 w-auto rounded-lg"
          />
        </figure>
      )}
    </div>
  )
}

/* ── State views ────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div style={{ width: 86, height: 86, borderRadius: '50%', background: '#fde2c4', display: 'grid', placeItems: 'center', fontSize: 44 }}>
        🦊
      </div>
      <h3 className="studio-display mt-4" style={{ fontSize: 20, color: '#0e2a32' }}>Ready when you are</h3>
      <p className="text-sm max-w-md mt-1" style={{ color: '#566f76' }}>
        Fill in the grade, subject and topic on the left, then tap Generate.
        Your lesson plan will appear here — fully formatted in the Zambian CBC style.
      </p>
    </div>
  )
}

// Secondary line under the progress tracker — live token count + elapsed
// seconds from the real SSE stream when available.
function lessonPlanProgressSubtitle(progress) {
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
      <p className="text-sm max-w-md mt-1 mb-3" style={{ color: '#566f76' }}>{message}</p>
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

/* Rendered lesson plan — shared viewer (v3 official / v2 5E / v1 legacy). */

function buildFilename(form, plan) {
  return buildDownloadName({
    docType: 'Lesson Plan',
    grade: form.grade,
    subject: form.subject,
    topic: plan?.header?.topic || form.topic,
  })
}
