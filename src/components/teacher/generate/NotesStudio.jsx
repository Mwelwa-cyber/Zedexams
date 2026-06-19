import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import {
  generateNotes,
  TEACHER_GRADES,
  TEACHER_LANGUAGES,
  DURATION_PRESETS,
  defaultSubjectForGrade,
} from '../../../utils/teacherTools'
import { useCurriculumOptions } from '../../../hooks/useCurriculumOptions'
import { downloadNotesDocx } from '../../../utils/notesToDocx'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import SeoHelmet from '../../seo/SeoHelmet'
import {
  listMyGenerations,
  titleForGeneration,
  formatDate,
  attachLibraryToGeneration,
  isFreePlanTeacher,
} from '../../../utils/teacherLibraryService'
import { LIBRARY_TYPES } from '../../../config/library'
import NotesView from '../views/NotesView'
import StudioPageHeader from '../StudioPageHeader'
import AiGenerationProgress from '../../ui/AiGenerationProgress'
import TopicSubtopicPicker from './TopicSubtopicPicker'
import { FieldLabel, FieldText, FieldTextarea, FieldSelect } from './studioFields'

const MODE_FROM_PLAN = 'from_plan'
const MODE_STANDALONE = 'standalone'

export default function NotesStudio() {
  const navigate = useNavigate()
  const { currentUser, userProfile, isAdmin } = useAuth()
  const urlDefaults = useFormDefaultsFromUrl()

  // If a lessonPlanId is in the URL, default to the from-plan tab.
  const initialMode = urlDefaults.lessonPlanId ? MODE_FROM_PLAN : MODE_STANDALONE
  const [mode, setMode] = useState(initialMode)

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
    instructions: '',
    lessonPlanId: '',
    ...urlDefaults,
  }))

  const [plans, setPlans] = useState([])
  const [plansLoading, setPlansLoading] = useState(true)
  const [plansError, setPlansError] = useState(false)
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [notes, setNotes] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')

  // Back-fill teacher name + school once the profile resolves. The lazy
  // initializer above runs before the async profile loads, so on a cold load
  // these stay blank; fill them in when the profile arrives, but only if the
  // teacher hasn't already typed something (never clobber an edit or a URL
  // default).
  useEffect(() => {
    if (!userProfile) return
    setForm((f) => {
      const teacherName = f.teacherName || userProfile.displayName || userProfile.fullName || ''
      const school = f.school || userProfile.school || userProfile.schoolName || ''
      if (teacherName === f.teacherName && school === f.school) return f
      return { ...f, teacherName, school }
    })
  }, [userProfile])

  // Load the user's lesson plans for the from-plan picker.
  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    setPlansLoading(true)
    setPlansError(false)
    listMyGenerations({ uid: currentUser.uid, tool: 'lesson_plan' })
      .then((rows) => { if (!cancelled) setPlans(rows) })
      .catch(() => { if (!cancelled) { setPlans([]); setPlansError(true) } })
      .finally(() => { if (!cancelled) setPlansLoading(false) })
    return () => { cancelled = true }
  }, [currentUser])

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const { subjectOptions, subjectValues } = useCurriculumOptions(form.grade)

  useEffect(() => {
    if (form.subject && !subjectValues.has(form.subject)) {
      setForm((f) => ({ ...f, subject: defaultSubjectForGrade(f.grade) }))
    }
  }, [form.grade, form.subject, subjectValues])

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === form.lessonPlanId) || null,
    [plans, form.lessonPlanId],
  )

  async function onGenerate(e) {
    e.preventDefault()

    if (mode === MODE_FROM_PLAN) {
      if (!form.lessonPlanId) {
        setErrorMessage('Pick a lesson plan to generate notes from.')
        setStatus('error')
        return
      }
    } else {
      if (!form.topic.trim()) {
        setErrorMessage('Please enter a topic.')
        setStatus('error')
        return
      }
    }

    setStatus('generating')
    setErrorMessage('')
    setErrorDetail('')
    setWarning('')
    setNotes(null)

    const payload = mode === MODE_FROM_PLAN
      ? { lessonPlanId: form.lessonPlanId, instructions: form.instructions }
      : { ...form, lessonPlanId: '' }

    const res = await generateNotes(payload)
    if (!res.ok) {
      setStatus('error')
      setErrorMessage(res.error)
      setErrorDetail(
        [res.code && `code: ${res.code}`, res.rawMessage && `detail: ${res.rawMessage}`]
          .filter(Boolean).join(' · '),
      )
      return
    }
    setNotes(res.data.notes)
    setGenerationId(res.data.generationId)
    setUsage(res.data.usage)
    setWarning(res.data.warning || '')
    setStatus('success')

    if (res.data.generationId) {
      // For from-plan mode, the term hint may not be in the form — fall
      // back to the source plan's term (best-effort).
      const sourcePlan = mode === MODE_FROM_PLAN ? selectedPlan : null
      const grade   = res.data.notes?.header?.grade   || form.grade   || sourcePlan?.inputs?.grade
      const subject = res.data.notes?.header?.subject || form.subject || sourcePlan?.inputs?.subject
      const term    = sourcePlan?.inputs?.term || sourcePlan?.library?.term
      attachLibraryToGeneration(res.data.generationId, {
        libraryType: LIBRARY_TYPES.NOTES,
        grade,
        term,
        subject,
      }).catch(() => {})
    }
  }

  function onExportDocx() {
    if (!notes) return
    const name = buildDownloadName({
      docType: 'Notes',
      grade: notes.header?.grade || form.grade,
      subject: notes.header?.subject || form.subject,
      topic: notes.header?.topic || form.topic,
    })
    downloadNotesDocx(notes, name, { attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
  }

  return (
    <div className="min-h-screen py-4 sm:py-6 lg:py-8" style={{ background: '#f5efe1' }}>
      <SeoHelmet title="Teaching Notes Studio" noIndex />
      <div className="max-w-7xl mx-auto">
        <StudioPageHeader
          eyebrow="Teaching Notes Studio"
          title="Write delivery notes"
          subtitle="Hooks, worked examples, common pupil questions, misconceptions, and discussion prompts — built from a saved plan or from scratch."
          emoji="🦉"
        />

        <div className="grid grid-cols-1 gap-6">
          {/* ── Input panel ─────────────────────────────────────── */}
          <form
            onSubmit={onGenerate}
            className="studio-card p-5 space-y-4 h-fit w-full max-w-2xl mx-auto"
          >
            {/* Mode tabs */}
            <div
              role="tablist"
              className="flex rounded-xl overflow-hidden"
              style={{ border: '2px solid #0e2a32' }}
            >
              <ModeTab
                active={mode === MODE_FROM_PLAN}
                onClick={() => setMode(MODE_FROM_PLAN)}
              >
                📘 From a plan
              </ModeTab>
              <ModeTab
                active={mode === MODE_STANDALONE}
                onClick={() => setMode(MODE_STANDALONE)}
              >
                ✨ Standalone
              </ModeTab>
            </div>

            {mode === MODE_FROM_PLAN && (
              <PlanPicker
                plans={plans}
                loading={plansLoading}
                error={plansError}
                selectedId={form.lessonPlanId}
                onSelect={(id) => updateField('lessonPlanId', id)}
                onBrowseLibrary={() => navigate('/teacher/library?tool=lesson_plan')}
              />
            )}

            {mode === MODE_FROM_PLAN && selectedPlan && (
              <SelectedPlanSummary plan={selectedPlan} />
            )}

            {mode === MODE_STANDALONE && (
              <>
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
                  topicPlaceholder="e.g. Photosynthesis"
                  subtopicPlaceholder="e.g. Light-dependent reactions"
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
              </>
            )}

            <FieldTextarea
              label="Extra instructions (optional)"
              placeholder={
                mode === MODE_FROM_PLAN
                  ? 'e.g. Keep examples short. Use Bemba for the hook only.'
                  : 'e.g. Include a real-life Lusaka example for the hook.'
              }
              value={form.instructions}
              onChange={(v) => updateField('instructions', v)}
              maxLength={500}
            />

            <button
              type="submit"
              disabled={status === 'generating'}
              className="studio-btn-primary w-full py-3"
            >
              {status === 'generating' ? 'Writing notes…' : '▶ Generate Notes'}
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
            {status === 'idle' && <EmptyState mode={mode} />}
            {status === 'generating' && (
              <AiGenerationProgress variant="card" preset="notes" running title="Writing your notes…" />
            )}
            {status === 'error' && (
              <ErrorState
                message={errorMessage}
                detail={errorDetail}
                onDismiss={() => setStatus('idle')}
              />
            )}
            {status === 'success' && notes && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="studio-display" style={{ fontSize: 22, color: '#0e2a32', margin: '0 0 2px' }}>Your Teacher Notes</h2>
                    <p className="text-xs" style={{ color: '#566f76' }}>
                      Skim before class — or print and tuck into your lesson plan.
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={onExportDocx} className="studio-btn-ghost">
                      📄 Download .docx
                    </button>
                    <button onClick={() => setStatus('idle')} className="studio-btn-primary">
                      ▶ Generate Another
                    </button>
                  </div>
                </div>
                {warning && (
                  <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
                    ⚠️ {warning}
                  </div>
                )}
                <NotesView notes={notes} />
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

/* ── Subcomponents ─────────────────────────────────────────────── */

function ModeTab({ active, onClick, children }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="flex-1 px-3 py-2 text-sm font-black transition"
      style={
        active
          ? { background: '#ff7a2e', color: '#fff' }
          : { background: 'transparent', color: '#0e2a32' }
      }
    >
      {children}
    </button>
  )
}

function PlanPicker({ plans, loading, error, selectedId, onSelect, onBrowseLibrary }) {
  if (loading) {
    return (
      <div className="rounded-xl border-2 border-dashed p-4 text-center text-sm" style={{ borderColor: '#d9cfb8', color: '#566f76' }}>
        Loading your lesson plans…
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-xl border-2 border-dashed p-4 text-center" style={{ borderColor: '#e6b8b8' }}>
        <p className="text-sm mb-2" style={{ color: '#0e2a32' }}>
          Couldn't load your lesson plans.
        </p>
        <p className="text-xs" style={{ color: '#566f76' }}>
          Check your connection and try again, or switch to <strong>Standalone</strong> to write notes without a plan.
        </p>
      </div>
    )
  }
  if (plans.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed p-4 text-center" style={{ borderColor: '#d9cfb8' }}>
        <p className="text-sm mb-2" style={{ color: '#0e2a32' }}>
          You don't have any saved lesson plans yet.
        </p>
        <p className="text-xs" style={{ color: '#566f76' }}>
          Switch to <strong>Standalone</strong> for now, or generate a plan in
          the Lesson Plan Studio first.
        </p>
      </div>
    )
  }
  return (
    <div>
      <FieldLabel>Lesson plan *</FieldLabel>
      <select
        value={selectedId || ''}
        onChange={(e) => onSelect(e.target.value)}
        className="studio-input"
      >
        <option value="">— Choose a saved plan —</option>
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {titleForGeneration(p)} · {p.inputs?.grade || ''} · {formatDate(p.createdAt)}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onBrowseLibrary}
        className="mt-1.5 text-xs font-bold hover:underline"
        style={{ color: '#ff7a2e' }}
      >
        Browse in library →
      </button>
    </div>
  )
}

function SelectedPlanSummary({ plan }) {
  const h = plan.output?.header || {}
  return (
    <div className="rounded-xl p-3" style={{ background: '#fff5e6', border: '1.5px solid #ff7a2e' }}>
      <p className="text-[10px] font-black uppercase tracking-wide mb-1" style={{ color: '#ff7a2e' }}>
        Source plan
      </p>
      <p className="text-sm font-bold" style={{ color: '#0e2a32' }}>
        {titleForGeneration(plan)}
      </p>
      <p className="text-xs mt-0.5" style={{ color: '#566f76' }}>
        {[h.class || plan.inputs?.grade, h.subject || plan.inputs?.subject]
          .filter(Boolean).join(' · ')}
      </p>
    </div>
  )
}

/* ── Form fields ──────────────────────────────────────────────── */

/* ── State views ──────────────────────────────────────────────── */

function EmptyState({ mode }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div style={{ width: 86, height: 86, borderRadius: '50%', background: '#dbe7f4', display: 'grid', placeItems: 'center', fontSize: 44 }}>
        🦉
      </div>
      <h3 className="studio-display mt-4" style={{ fontSize: 20, color: '#0e2a32' }}>Notes ready when you are</h3>
      <p className="text-sm max-w-md mt-1" style={{ color: '#566f76' }}>
        {mode === MODE_FROM_PLAN
          ? 'Pick one of your saved lesson plans on the left and we\'ll write delivery notes that match it.'
          : 'Tell us the grade, subject and topic on the left and we\'ll write teacher notes you can skim before class.'}
      </p>
    </div>
  )
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
