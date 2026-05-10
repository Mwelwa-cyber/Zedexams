import { useState, useRef, useEffect, useMemo } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  generateLessonPlanStream,
  TEACHER_GRADES,
  TEACHER_LANGUAGES,
  DURATION_PRESETS,
  getSubjectsForGrade,
  isSubjectValidForGrade,
  defaultSubjectForGrade,
} from '../../../utils/teacherTools'
import { downloadLessonPlanDocx } from '../../../utils/lessonPlanToDocx'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import { printLessonPlanAsPdf } from '../../../utils/lessonPlanToPdf'
import StudioPageHeader from '../StudioPageHeader'
import { attachLibraryToGeneration } from '../../../utils/teacherLibraryService'
import { LIBRARY_TYPES } from '../../../config/library'

/**
 * Zambian CBC Lesson Plan Generator — teacher-facing MVP.
 *
 * Two-column layout: inputs on the left, generated plan on the right.
 * On mobile the columns stack.
 */
export default function LessonPlanGenerator() {
  const { userProfile } = useAuth()
  const urlDefaults = useFormDefaultsFromUrl()
  const [form, setForm] = useState(() => ({
    grade: 'G5',
    subject: 'mathematics',
    topic: '',
    subtopic: '',
    durationMinutes: 40,
    language: 'english',
    teacherName: userProfile?.displayName || userProfile?.fullName || '',
    school: userProfile?.schoolName || '',
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
  const subjectOptions = useMemo(
    () => getSubjectsForGrade(form.grade),
    [form.grade],
  )

  // If the teacher switches to a grade where their previously-picked
  // subject isn't taught (e.g. G5 Mathematics → ECE, where it's Numeracy),
  // snap the subject to the first valid one for that grade.
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
    // Abort any prior in-flight generation before kicking off a new one.
    try { cancelRef.current?.() } catch { /* ignore */ }
    setStatus('generating')
    setErrorMessage('')
    setErrorDetail('')
    setWarning('')
    setLessonPlan(null)
    setProgress({ phase: 'queued', elapsedMs: 0 })

    cancelRef.current = generateLessonPlanStream(form, {
      onProgress: (p) => setProgress(p),
      onResult: (data) => {
        setLessonPlan(data.lessonPlan)
        setGenerationId(data.generationId)
        setUsage(data.usage)
        setWarning(data.warning || '')
        setStatus('success')
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

  function onExportDocx() {
    if (!lessonPlan) return
    const filename = buildFilename(form, lessonPlan)
    downloadLessonPlanDocx(lessonPlan, filename)
  }

  function onExportPdf() {
    if (!lessonPlan) return
    try {
      const titleForDoc = lessonPlan.header?.topic
        ? `CBC Lesson Plan — ${lessonPlan.header.topic}`
        : 'CBC Lesson Plan'
      printLessonPlanAsPdf(lessonPlan, titleForDoc)
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
    <div className="min-h-screen p-4 sm:p-6 lg:p-8" style={{ background: '#f5efe1' }}>
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
              <GeneratingState progress={progress} onCancel={onCancel} />
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

function GeneratingState({ progress, onCancel }) {
  // progress is null on the very first paint, then {phase, approxOutputTokens?, elapsedMs}
  // once the SSE stream emits its first event. Translate phase → user-friendly label.
  const phase = progress?.phase
  const tokens = progress?.approxOutputTokens
  const seconds = progress?.elapsedMs ? Math.round(progress.elapsedMs / 1000) : null
  const phaseLabel = (() => {
    if (!phase || phase === 'queued') return 'Loading curriculum context…'
    if (phase === 'claude_started') return 'Asking the AI to draft your plan…'
    if (phase === 'token') {
      return tokens
        ? `Drafting your plan… ~${tokens.toLocaleString()} tokens written`
        : 'Drafting your plan…'
    }
    if (phase === 'claude_done') return 'Polishing the lesson plan…'
    return 'Working…'
  })()

  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div className="text-5xl mb-3 animate-bounce">🧠</div>
      <h3 className="studio-display" style={{ fontSize: 20, color: '#0e2a32' }}>
        Writing your lesson plan…
      </h3>
      <p className="text-sm max-w-md mt-1" style={{ color: '#566f76' }}>
        {phaseLabel}
        {seconds != null && phase !== 'queued' ? ` · ${seconds}s` : ''}
      </p>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-4 text-xs underline"
          style={{ color: '#566f76' }}
        >
          Cancel
        </button>
      )}
    </div>
  )
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
      <p className="text-[10px] mt-4 max-w-md" style={{ color: '#8a9aa1' }}>
        See DEBUG_LESSON_PLAN.md in your project root for the diagnostic checklist.
      </p>
    </div>
  )
}

/* ── Rendered lesson plan ───────────────────────────────────────── */

/**
 * Render a lesson plan. Supports both schemas:
 *   • v2 (Bernard Tito CBC) — uses lessonProgression (5E), lessonGoal,
 *     lessonCompetencies, methodology, learningEnvironment, etc.
 *   • v1 (legacy) — uses lessonDevelopment (Introduction/Development/Conclusion),
 *     specificOutcomes, keyCompetencies, values.
 * Detection is by field presence so older saved plans render without error.
 */
function LessonPlanView({ plan }) {
  const isV2 = !!plan.lessonProgression || !!plan.lessonCompetencies || plan.schemaVersion === '2.0'
  return isV2 ? <LessonPlanViewV2 plan={plan} /> : <LessonPlanViewV1 plan={plan} />
}

function LessonPlanViewV2({ plan }) {
  const lc = plan.lessonCompetencies || {}
  const le = plan.learningEnvironment || {}
  const m  = plan.methodology || {}
  const cc = plan.competenceContinuity || {}
  const lp = plan.lessonProgression || {}
  return (
    <article className="space-y-6 print:space-y-4">
      <HeaderBlock header={plan.header} />

      {plan.lessonGoal && (
        <Section title="Lesson Goal (SMART)">
          <p className="text-sm theme-text leading-relaxed">{plan.lessonGoal}</p>
        </Section>
      )}

      <Section title="Competences">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MiniSection title="Broad Competences" items={plan.broadCompetences} />
          <div className="rounded-xl border theme-border p-3">
            <h4 className="font-bold text-sm mb-2 theme-text">Expected Target Competence</h4>
            {plan.expectedTargetCompetence
              ? <p className="text-sm theme-text">{plan.expectedTargetCompetence}</p>
              : <p className="text-sm theme-text-secondary italic">—</p>}
          </div>
        </div>
        <div className="mt-4 rounded-xl border theme-border p-3">
          <h4 className="font-bold text-sm mb-2 theme-text">Lesson Competencies</h4>
          <ol className="list-decimal list-inside space-y-1.5 text-sm theme-text">
            {lc.competency1 && <li><span className="font-bold">Higher-order thinking —</span> {lc.competency1}</li>}
            {lc.competency2 && <li><span className="font-bold">Thinking process —</span> {lc.competency2}</li>}
            {lc.competency3 && <li><span className="font-bold">Tangible output —</span> {lc.competency3}</li>}
            {!lc.competency1 && !lc.competency2 && !lc.competency3 && (
              <li className="list-none theme-text-secondary italic">—</li>
            )}
          </ol>
        </div>
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="Methodology & Strategies">
          <div className="space-y-2 text-sm">
            {m.approach && (
              <p className="theme-text"><span className="font-bold">Approach: </span>{m.approach}</p>
            )}
            {m.strategies?.length > 0 && (
              <div>
                <span className="font-bold theme-text">Strategies: </span>
                <UnorderedList items={m.strategies} />
              </div>
            )}
            {!m.approach && !(m.strategies?.length) && (
              <p className="theme-text-secondary italic">—</p>
            )}
          </div>
        </Section>
        <Section title="Learning Environment">
          <div className="text-sm space-y-1">
            <p className="theme-text">
              <span className="font-bold capitalize">{le.category || 'classroom'}</span>
              {le.specific && <> — {le.specific}</>}
            </p>
            {le.rationale && <p className="theme-text-secondary text-xs">{le.rationale}</p>}
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MiniSection title="Teaching / Learning Materials" items={plan.teachingLearningMaterials} />
        <MiniSection title="Prior Knowledge" items={plan.prerequisiteKnowledge} />
      </div>

      {plan.interdisciplinaryConnections?.length > 0 && (
        <Section title="Interdisciplinary Connections">
          <div className="rounded-xl border theme-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/30 border-b theme-border">
                  <th className="px-3 py-2 text-left font-bold theme-text w-1/3">Subject</th>
                  <th className="px-3 py-2 text-left font-bold theme-text">How the concept connects</th>
                </tr>
              </thead>
              <tbody>
                {plan.interdisciplinaryConnections.map((c, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-slate-50/50 dark:bg-slate-900/20' : ''}>
                    <td className="px-3 py-2 theme-text font-bold">{c.subject}</td>
                    <td className="px-3 py-2 theme-text">{c.connection}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Lesson Progression (5E)">
        <PhaseBlock phase="1. Engagement — Introduction" minutes={lp.engagement?.durationMinutes} teacher={lp.engagement?.teacherActivities} pupils={lp.engagement?.learnerActivities} criteria={lp.engagement?.assessmentCriteria} />
        <PhaseBlock phase="2. Exploration — Development" minutes={lp.exploration?.durationMinutes} teacher={lp.exploration?.teacherActivities} pupils={lp.exploration?.learnerActivities} criteria={lp.exploration?.assessmentCriteria} />
        <PhaseBlock phase="3. Explanation — Conceptualization" minutes={lp.explanation?.durationMinutes} teacher={lp.explanation?.teacherActivities} pupils={lp.explanation?.learnerActivities} criteria={lp.explanation?.assessmentCriteria} />
        <PhaseBlock phase="4. Synthesis — Continuity & Extension" minutes={lp.synthesis?.durationMinutes} teacher={lp.synthesis?.teacherActivities} pupils={lp.synthesis?.learnerActivities} criteria={lp.synthesis?.assessmentCriteria} />
        <PhaseBlock phase="5. Evaluation & Reflection — Conclusion" minutes={lp.evaluation?.durationMinutes} teacher={lp.evaluation?.teacherActivities} pupils={lp.evaluation?.learnerActivities} criteria={lp.evaluation?.assessmentCriteria} />
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="Assessment">
          <div className="space-y-3">
            <div>
              <h4 className="font-bold text-sm mb-1">Formative</h4>
              <UnorderedList items={plan.assessment?.formative} />
            </div>
            {plan.assessment?.summative?.description && (
              <div>
                <h4 className="font-bold text-sm mb-1">Summative</h4>
                <p className="text-sm theme-text">{plan.assessment.summative.description}</p>
                {plan.assessment.summative.successCriteria && (
                  <p className="text-xs theme-text-secondary mt-1">
                    <span className="font-bold">Success criteria: </span>
                    {plan.assessment.summative.successCriteria}
                  </p>
                )}
              </div>
            )}
          </div>
        </Section>
        <Section title="Differentiation">
          <div className="space-y-3">
            <div>
              <h4 className="font-bold text-sm mb-1">For struggling learners</h4>
              <UnorderedList items={plan.differentiation?.forStruggling} />
            </div>
            <div>
              <h4 className="font-bold text-sm mb-1">For advanced learners</h4>
              <UnorderedList items={plan.differentiation?.forAdvanced} />
            </div>
          </div>
        </Section>
      </div>

      <Section title="Competence Continuity & Strategy">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <MiniSection title="Long-term projects" items={cc.longTermProjects} />
          <MiniSection title="Homework extensions" items={cc.homeworkExtensions} />
          <MiniSection title="Upcoming connections" items={cc.upcomingConnections} />
          <MiniSection title="Teacher actions" items={cc.teacherActions} />
        </div>
      </Section>

      {plan.references?.length > 0 && (
        <Section title="References">
          <ReferencesBlock refs={plan.references} />
        </Section>
      )}

      {plan.homework?.description && (
        <Section title="Homework">
          <p className="text-sm theme-text">{plan.homework.description}</p>
          {plan.homework.estimatedMinutes > 0 && (
            <p className="text-xs theme-text-secondary mt-1">
              Estimated time: {plan.homework.estimatedMinutes} minutes
            </p>
          )}
        </Section>
      )}

      <Section title="Teacher's Reflection (fill in after teaching)">
        <div className="text-sm theme-text-secondary italic">
          — What went well? What will you improve next time? Which learners need follow-up?
        </div>
      </Section>
    </article>
  )
}

function LessonPlanViewV1({ plan }) {
  return (
    <article className="space-y-6 print:space-y-4">
      <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
        ℹ️ This plan was generated with the older template. New plans use the full CBC 5E format.
      </div>
      <HeaderBlock header={plan.header} />
      <Section title="Specific Outcomes">
        <OrderedList items={plan.specificOutcomes} />
      </Section>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MiniSection title="Key Competencies" items={plan.keyCompetencies} />
        <MiniSection title="Values" items={plan.values} />
        <MiniSection title="Prerequisite Knowledge" items={plan.prerequisiteKnowledge} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MiniSection title="Teaching / Learning Materials" items={plan.teachingLearningMaterials} />
        <ReferencesBlock refs={plan.references} />
      </div>
      <Section title="Lesson Development">
        <PhaseBlock phase="Introduction" minutes={plan.lessonDevelopment?.introduction?.durationMinutes} teacher={plan.lessonDevelopment?.introduction?.teacherActivities} pupils={plan.lessonDevelopment?.introduction?.pupilActivities} />
        {(plan.lessonDevelopment?.development || []).map((step) => (
          <PhaseBlock key={step.stepNumber} phase={`Development — Step ${step.stepNumber}: ${step.title}`} minutes={step.durationMinutes} teacher={step.teacherActivities} pupils={step.pupilActivities} />
        ))}
        <PhaseBlock phase="Conclusion" minutes={plan.lessonDevelopment?.conclusion?.durationMinutes} teacher={plan.lessonDevelopment?.conclusion?.teacherActivities} pupils={plan.lessonDevelopment?.conclusion?.pupilActivities} />
      </Section>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="Assessment">
          <div className="space-y-3">
            <div>
              <h4 className="font-bold text-sm mb-1">Formative</h4>
              <UnorderedList items={plan.assessment?.formative} />
            </div>
            {plan.assessment?.summative?.description && (
              <div>
                <h4 className="font-bold text-sm mb-1">Summative</h4>
                <p className="text-sm theme-text">{plan.assessment.summative.description}</p>
                {plan.assessment.summative.successCriteria && (
                  <p className="text-xs theme-text-secondary mt-1">
                    <span className="font-bold">Success criteria: </span>
                    {plan.assessment.summative.successCriteria}
                  </p>
                )}
              </div>
            )}
          </div>
        </Section>
        <Section title="Differentiation">
          <div className="space-y-3">
            <div>
              <h4 className="font-bold text-sm mb-1">For struggling pupils</h4>
              <UnorderedList items={plan.differentiation?.forStruggling} />
            </div>
            <div>
              <h4 className="font-bold text-sm mb-1">For advanced pupils</h4>
              <UnorderedList items={plan.differentiation?.forAdvanced} />
            </div>
          </div>
        </Section>
      </div>
      {plan.homework?.description && (
        <Section title="Homework">
          <p className="text-sm theme-text">{plan.homework.description}</p>
        </Section>
      )}
      <Section title="Teacher's Reflection (fill in after teaching)">
        <div className="text-sm theme-text-secondary italic">
          — What went well? What will you improve next time? Which pupils need follow-up?
        </div>
      </Section>
    </article>
  )
}

function HeaderBlock({ header = {} }) {
  const hasAttendance =
    header.boysPresent != null || header.girlsPresent != null || header.totalPupils != null
  const attendance = hasAttendance
    ? `${header.boysPresent ?? '—'} boys · ${header.girlsPresent ?? '—'} girls · Total: ${header.totalPupils ?? header.numberOfPupils ?? '—'}`
    : header.numberOfPupils
  const rows = [
    ['School', header.school],
    ['Teacher', header.teacherName],
    ['Date', header.date],
    ['Time', header.time],
    ['Duration', header.durationMinutes ? `${header.durationMinutes} min` : ''],
    ['Class', header.class],
    ['Subject', header.subject],
    ['Topic', header.topic],
    ['Sub-topic', header.subtopic],
    ['Term & Week', header.termAndWeek],
    ['Attendance', attendance],
    ['Medium', header.mediumOfInstruction],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '')

  return (
    <div className="rounded-xl border theme-border overflow-hidden">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([k, v], idx) => (
            <tr key={k} className={idx % 2 === 0 ? 'bg-slate-50/50 dark:bg-slate-900/20' : ''}>
              <th className="px-3 py-2 text-left font-bold theme-text w-1/3">{k}</th>
              <td className="px-3 py-2 theme-text">{String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-base font-black theme-text mb-2 border-b theme-border pb-1">
        {title}
      </h3>
      {children}
    </div>
  )
}

function MiniSection({ title, items }) {
  return (
    <div className="rounded-xl border theme-border p-3">
      <h4 className="font-bold text-sm mb-2 theme-text">{title}</h4>
      <UnorderedList items={items} />
    </div>
  )
}

function OrderedList({ items }) {
  if (!items?.length) return <p className="text-sm theme-text-secondary italic">—</p>
  return (
    <ol className="list-decimal list-inside space-y-1 text-sm theme-text">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ol>
  )
}

function UnorderedList({ items }) {
  if (!items?.length) return <p className="text-sm theme-text-secondary italic">—</p>
  return (
    <ul className="list-disc list-inside space-y-1 text-sm theme-text">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  )
}

function ReferencesBlock({ refs }) {
  return (
    <div className="rounded-xl border theme-border p-3">
      <h4 className="font-bold text-sm mb-2 theme-text">References</h4>
      {!refs?.length ? (
        <p className="text-sm theme-text-secondary italic">—</p>
      ) : (
        <ul className="space-y-1 text-sm theme-text">
          {refs.map((r, i) => (
            <li key={i}>
              <span className="font-bold">{r.title}</span>
              {r.publisher && <span> — {r.publisher}</span>}
              {r.pages && <span className="theme-text-secondary"> (pp. {r.pages})</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PhaseBlock({ phase, minutes, teacher = [], pupils = [], criteria }) {
  const hasCriteria = Array.isArray(criteria) && criteria.length > 0
  return (
    <div className="rounded-xl border theme-border overflow-hidden mb-3">
      <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800 border-b theme-border flex justify-between">
        <h4 className="font-bold text-sm theme-text">{phase}</h4>
        {minutes != null && (
          <span className="text-xs theme-text-secondary">{minutes} min</span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x theme-border">
        <div className="p-3">
          <h5 className="text-xs uppercase font-bold theme-text-secondary mb-2">
            Teacher Activities
          </h5>
          <UnorderedList items={teacher} />
        </div>
        <div className="p-3">
          <h5 className="text-xs uppercase font-bold theme-text-secondary mb-2">
            Learner Activities
          </h5>
          <UnorderedList items={pupils} />
        </div>
      </div>
      {hasCriteria && (
        <div className="p-3 border-t theme-border bg-slate-50/60 dark:bg-slate-900/20">
          <h5 className="text-xs uppercase font-bold theme-text-secondary mb-2">
            Assessment Criteria
          </h5>
          <UnorderedList items={criteria} />
        </div>
      )}
    </div>
  )
}

/* ── Helpers ────────────────────────────────────────────────────── */

function buildFilename(form, plan) {
  const slug = (s) => String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  const parts = [
    slug(form.teacherName || 'teacher'),
    slug(form.grade),
    slug(form.subject),
    slug(plan?.header?.topic || form.topic),
    new Date().toISOString().slice(0, 10),
  ].filter(Boolean)
  return `${parts.join('_')}.docx`
}
