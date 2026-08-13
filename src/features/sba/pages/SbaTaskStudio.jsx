/**
 * SBA Studio — /teacher/generate/sba
 *
 * Generates ONE ECZ-compliant School Based Assessment task (Grades 5–7) with
 * the marking artefact its task type requires. Distinct from the Assessment
 * Generator (formal graded test): SBA tasks follow the per-subject ECZ task
 * taxonomy, never use MCQs, and carry an observation sheet / method marks /
 * rubric rather than a plain answer key.
 *
 * The mark-aggregation side lives in the SBA Mark Tracker
 * (/teacher/generate/sba-tracker).
 */

import { useEffect, useMemo, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { generateSbaTask, TEACHER_LANGUAGES } from '../../../utils/teacherTools'
import {
  SBA_GRADES,
  SBA_SUBJECTS,
  SBA_CTS_COMPONENTS,
  SBA_BLOOM_LEVELS,
  getSbaSubject,
  getSbaTaskTypes,
  getSbaTaskType,
} from '../../../config/sba'
import { downloadSbaTaskDocx } from '../../../engines/export-engine/sbaTaskToDocx'
import { downloadSbaTaskPdf } from '../../../engines/export-engine/sbaTaskToPdf'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { checkDownload } from '../../../utils/downloadGuard'
import { attachLibraryToGeneration, isFreePlanTeacher } from '../../../utils/teacherLibraryService'
import { LIBRARY_TYPES } from '../../../config/library'
import { useAuth } from '../../../contexts/AuthContext'
import { useGenerationGate } from '../../../hooks/useGenerationGate'
import { useIsMounted } from '../../../hooks/useIsMounted'
import { useAiOperationLock } from '../../../hooks/useAiOperationLock'
import { stableFingerprint } from '../../../hooks/aiOperationLockCore'
import StudioPageHeader from '../../../shared/components/StudioPageHeader'
import StudioOutputBoundary from '../../../shared/components/StudioOutputBoundary'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import { useDraftManager } from '../../../hooks/draft/useDraftManager'
import { sbaTaskInputDescriptor } from '../../../hooks/draft/descriptors'
import { usePlatformSettings } from '../../../contexts/PlatformSettingsContext'
import DraftStatusIndicator from '../../../components/draft/DraftStatusIndicator'
import DraftRecoveryPrompt from '../../../components/draft/DraftRecoveryPrompt'
import LiveGenerationCanvas from '../../../components/ui/LiveGenerationCanvas'
import { useToast } from '../../../components/ui/Toast'
import SbaTaskView from '../components/SbaTaskView'
import SbaWorkflowNote from '../components/SbaWorkflowNote'
import TopicSubtopicPicker from '../../../components/teacher/generate/TopicSubtopicPicker'

const TERMS = [
  { value: '', label: '— Term (optional) —' },
  { value: 'Term 1', label: 'Term 1' },
  { value: 'Term 2', label: 'Term 2' },
  { value: 'Term 3', label: 'Term 3' },
]

export default function SbaTaskStudio() {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const { ensureCanGenerate } = useGenerationGate(currentUser?.uid)
  const [form, setForm] = useState({
    grade: 'G5',
    subject: 'english',
    taskType: 'reading_comprehension',
    component: '',
    term: '',
    topic: '',
    outcome: '',
    bloomLevel: '',
    language: 'english',
    instructions: '',
  })
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const isMounted = useIsMounted()
  const [task, setTask] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')
  const [showAnswers, setShowAnswers] = useState(true)
  // Live Generation Canvas hand-off: watch the task build section by section,
  // then click through to the full editable/export view (see HomeworkStudio).
  const [handedOff, setHandedOff] = useState(false)
  // Per-run token: stops a resolved callable from hijacking the UI if Stop was
  // clicked before the response landed.
  const runRef = useRef(0)
  // Idempotency lock: one logical generation → one provider call + one saved
  // doc + one usage charge, even across a double-click / rapid tap / refresh /
  // a second tab. generateSbaTask.js's server-side reservation enforces this;
  // this is the client-side belt (mints + persists the key). Separate lock keys
  // for the full generate vs a per-section regenerate so they never collide.
  const { run: runGenerateLocked } = useAiOperationLock('sba-studio:generate')
  const { run: runRegenerateLocked } = useAiOperationLock('sba-studio:regenerate')
  const toast = useToast()
  // School name on the task banner — pre-filled from the teacher's registration
  // profile, but editable in case they set tasks for more than one school.
  const [schoolName, setSchoolName] = useState(
    userProfile?.school || userProfile?.schoolName || '',
  )

  // Keep the field in sync once the profile loads (it can arrive after mount).
  useEffect(() => {
    setSchoolName((prev) => prev || userProfile?.school || userProfile?.schoolName || '')
  }, [userProfile?.school, userProfile?.schoolName])

  // Universal Draft Manager: auto-save the SBA task inputs.
  const { featureFlags } = usePlatformSettings().settings
  const draft = useDraftManager({
    studioId: 'sba_task',
    uid: currentUser?.uid,
    draftId: 'sba_task-current',
    descriptor: sbaTaskInputDescriptor,
    state: { form },
    enabled: Boolean(currentUser?.uid && featureFlags?.universalDrafts !== false),
    onRestore: (payload) => { if (payload?.form) setForm((f) => ({ ...f, ...payload.form })) },
  })

  const subjectMeta = getSbaSubject(form.subject)
  const taskTypeOptions = useMemo(() => getSbaTaskTypes(form.subject), [form.subject])
  const currentTaskType = getSbaTaskType(form.subject, form.taskType)
  const needsComponent = Boolean(currentTaskType?.needsComponent)

  // Which 2013 syllabus to draw topics/outcomes from. SBA is the Grade 5–7
  // School Based Assessment instrument, which sits on the 2013 OBC curriculum.
  // CTS has no syllabus of its own — its components are the KB subjects, so
  // route the picker through the chosen component. The 2013 OBC names the
  // technical strand "Design & Technology" (not "Technology Studies"); the
  // other components map 1:1. (Where the syllabus has no rows, the picker
  // degrades to free text on its own.)
  const syllabusSubject = form.subject === 'creative_and_technology_studies' && form.component
    ? (form.component === 'technology_studies' ? 'design_and_technology' : form.component)
    : form.subject

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // Keep task type valid when the subject changes.
  useEffect(() => {
    if (!getSbaTaskType(form.subject, form.taskType)) {
      const first = getSbaTaskTypes(form.subject)[0]
      if (first) setForm((f) => ({ ...f, taskType: first.value }))
    }
  }, [form.subject, form.taskType])

  // Default a CTS component when one is required, clear it otherwise.
  useEffect(() => {
    if (needsComponent && !form.component) {
      setForm((f) => ({ ...f, component: SBA_CTS_COMPONENTS[0].value }))
    } else if (!needsComponent && form.component) {
      setForm((f) => ({ ...f, component: '' }))
    }
  }, [needsComponent, form.component])

  const sbaLibraryMeta = () => ({
    libraryType: LIBRARY_TYPES.SBA_TASKS,
    syllabusHint: 'OBC',
    grade: form.grade,
    subject: form.subject,
    term: form.term ? Number(form.term.replace(/\D/g, '')) : null,
  })

  // Regenerate a single revealed section: re-run the generator and swap only
  // that key on the current task, leaving the rest of the reveal in place.
  async function regenerateSection(sectionId) {
    if (!ensureCanGenerate('sba_task')) return null
    const lockResult = await runRegenerateLocked({
      // Section-scoped fingerprint so a regenerate mints its own key rather
      // than resuming the full-generate result.
      fingerprint: stableFingerprint({ ...form, __regenerateSection: sectionId }),
      action: async (idempotencyKey) => {
        const outcome = await generateSbaTask({ ...form, idempotencyKey })
        if (!outcome.ok) {
          const err = new Error(outcome.error || 'Generation failed')
          err.response = outcome
          throw err
        }
        return outcome
      },
    })
    if (lockResult.reason === 'locked') return null
    const res = lockResult.ok ? lockResult.data : (lockResult.error?.response || { ok: false })
    if (res.ok && res.data?.task) {
      const fresh = res.data.task
      setTask((prev) => (prev ? { ...prev, [sectionId]: fresh[sectionId] } : fresh))
      return fresh
    }
    return null
  }

  function saveToLibrary() {
    if (!generationId) return
    attachLibraryToGeneration(generationId, sbaLibraryMeta()).catch(() => {})
  }

  async function onGenerate(e) {
    e?.preventDefault?.()
    if (!ensureCanGenerate('sba_task')) return
    const run = ++runRef.current
    setHandedOff(false)
    setStatus('generating')
    setErrorMessage('')
    setErrorDetail('')
    setWarning('')
    setTask(null)
    setGenerationId(null)
    const lockResult = await runGenerateLocked({
      fingerprint: stableFingerprint(form),
      action: async (idempotencyKey) => {
        const outcome = await generateSbaTask({ ...form, idempotencyKey })
        if (!outcome.ok) {
          // generateSbaTask() resolves rather than throws; a genuine failure
          // must be THROWN so the lock keeps the key reserved for a same-input
          // retry (never re-billed) instead of minting a fresh key.
          const err = new Error(outcome.error || 'Generation failed')
          err.response = outcome
          throw err
        }
        return outcome
      },
    })
    if (run !== runRef.current) return
    if (!isMounted.current) return
    if (lockResult.reason === 'locked') return // a duplicate click slipped past the disabled button
    const res = lockResult.ok ? lockResult.data : (lockResult.error?.response || {
      ok: false, error: lockResult.error?.message || 'Generation failed. Please try again.',
    })
    if (res.ok && res.data?.status === 'processing') {
      // The server already has this exact request in flight (a retried network
      // call or another tab) — leave "Generating…" showing; the owning call
      // completes it.
      return
    }
    if (!res.ok) {
      setStatus('error')
      setErrorMessage(res.error || 'Generation failed.')
      setErrorDetail(
        [res.code && `code: ${res.code}`, res.rawMessage && `detail: ${res.rawMessage}`]
          .filter(Boolean).join(' · '),
      )
      return
    }
    setTask(res.data.task)
    setGenerationId(res.data.generationId)
    setUsage(res.data.usage)
    setWarning(res.data.warning || '')
    setStatus('success')
    draft.clear().catch(() => {})
    if (res.data.generationId) {
      attachLibraryToGeneration(res.data.generationId, sbaLibraryMeta()).catch(() => {})
    }
  }

  async function onExport(includeAnswers) {
    if (!task) return
    const name = buildDownloadName({
      docType: includeAnswers ? 'SBA Task' : 'SBA Task (learner)',
      grade: form.grade,
      subject: form.subject,
      topic: task.header?.taskType || currentTaskType?.label || 'task',
    })
    // Deterministic, zero-cost guard: warn (never block) if the file is junk-named,
    // titleless, or doesn't match the requested grade/subject.
    const { ok, problems } = checkDownload({
      tool: 'sbaTask',
      filename: name,
      output: task,
      inputs: { grade: form.grade, subject: form.subject, topic: task.header?.taskType },
    })
    if (!ok) setWarning(`Heads up: ${problems.map((p) => p.message).join(' ')}`)
    try {
      await downloadSbaTaskDocx(task, name, {
        includeAnswers,
        schoolName,
        attribution: isFreePlanTeacher({ userProfile, isAdmin }),
      })
    } catch (err) {
      console.error('[SbaTaskStudio] export failed', err)
      toast.error('Could not create the file. Please try again.')
    }
  }

  async function onExportPdf(includeAnswers) {
    if (!task) return
    const name = buildDownloadName({
      docType: includeAnswers ? 'SBA Task' : 'SBA Task (learner)',
      grade: form.grade,
      subject: form.subject,
      topic: task.header?.taskType || currentTaskType?.label || 'task',
      ext: 'pdf',
    })
    try {
      await downloadSbaTaskPdf(task, name, {
        includeAnswers,
        schoolName,
        attribution: isFreePlanTeacher({ userProfile, isAdmin }),
      })
    } catch (err) {
      console.error('[SbaTaskStudio] pdf export failed', err)
      toast.error('Could not create the PDF. Please try again.')
    }
  }

  return (
    <div className="studio-page">
      <SeoHelmet title="SBA Studio" noIndex />
      <div className="w-full">
        <StudioPageHeader
          eyebrow="SBA Studio"
          title="School Based Assessment tasks, the ECZ way"
          subtitle="One compliant task at a time — the right task type, Bloom level and marking scheme for Grades 5–7. No multiple choice."
          emoji="🏫"
        />

        <SbaWorkflowNote current="studio" />

        <div className="flex flex-wrap gap-2 mb-4 text-xs">
          <Link to="/teacher/generate/sba-tracker" className="studio-btn-ghost">
            🧮 Open the SBA Mark Tracker →
          </Link>
          <Link to="/teacher/generate/sba-planner" className="studio-btn-ghost">
            🗂️ Open the SBA Year Planner →
          </Link>
        </div>

        <div className="mb-4"><DraftRecoveryPrompt {...draft} label="SBA task" /></div>

        <div className="grid lg:grid-cols-5 gap-6">
          {/* ── Form ── */}
          <form onSubmit={onGenerate} className="lg:col-span-2 studio-card p-5 space-y-4 self-start">
            <div className="flex justify-end">
              <DraftStatusIndicator status={draft.status} savedAt={draft.savedAt} online={draft.online} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="studio-label">Grade</label>
                <select value={form.grade}
                  onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value, topic: '', outcome: '' }))}
                  className="studio-input">
                  {SBA_GRADES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </div>
              <div>
                <label className="studio-label">Subject</label>
                <select value={form.subject}
                  onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value, topic: '', outcome: '' }))}
                  className="studio-input">
                  {SBA_SUBJECTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="studio-label">Task type</label>
              <select value={form.taskType} onChange={(e) => set('taskType', e.target.value)} className="studio-input">
                {taskTypeOptions.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.group && subjectMeta?.kind === 'language' ? `${t.group} · ` : ''}{t.label} ({t.defaultMarks})
                  </option>
                ))}
              </select>
            </div>

            {needsComponent && (
              <div>
                <label className="studio-label">CTS component</label>
                <select value={form.component}
                  onChange={(e) => setForm((f) => ({ ...f, component: e.target.value, topic: '', outcome: '' }))}
                  className="studio-input">
                  {SBA_CTS_COMPONENTS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="studio-label">Term</label>
                <select value={form.term} onChange={(e) => set('term', e.target.value)} className="studio-input">
                  {TERMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="studio-label">Bloom level</label>
                <select value={form.bloomLevel} onChange={(e) => set('bloomLevel', e.target.value)} className="studio-input">
                  <option value="">— Any (optional) —</option>
                  {SBA_BLOOM_LEVELS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            </div>

            <TopicSubtopicPicker
              grade={form.grade}
              subject={syllabusSubject}
              framework="2013"
              topic={form.topic}
              subtopic={form.outcome}
              onChangeTopic={(v) => set('topic', v)}
              onChangeSubtopic={(v) => set('outcome', v)}
              topicLabel="Topic / focus"
              subtopicLabel={<>Syllabus outcome <span className="font-normal opacity-70">(optional)</span></>}
              topicPlaceholder="e.g. The environment, Fractions, The human body"
              subtopicPlaceholder="e.g. Add fractions with the same denominator"
              topicMaxLength={160}
              subtopicMaxLength={200}
            />
            <p className="text-[11px] -mt-2" style={{ color: 'var(--zt-text-muted)' }}>
              Topics come from the <strong>2013 (OBC)</strong> syllabus — the curriculum SBA is assessed against.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="studio-label">Language</label>
                <select value={form.language} onChange={(e) => set('language', e.target.value)} className="studio-input">
                  {TEACHER_LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="studio-label">Extra instructions <span className="font-normal opacity-70">(optional)</span></label>
              <textarea value={form.instructions} maxLength={500} rows={2}
                onChange={(e) => set('instructions', e.target.value)}
                placeholder="Anything specific you want this task to cover."
                className="studio-input" />
            </div>

            <button type="submit" disabled={status === 'generating'}
              className="studio-btn-primary w-full disabled:opacity-50">
              {status === 'generating' ? 'Generating…' : '✨ Generate SBA task'}
            </button>
            {usage && (
              <div className="text-xs theme-text-secondary text-center">
                {usage.used}/{usage.limit} SBA tasks used on the{' '}
                <span className="font-bold capitalize">{usage.plan}</span> plan this month
              </div>
            )}
          </form>

          {/* ── Result ── */}
          <StudioOutputBoundary onRetry={() => setStatus('idle')}>
          <div className="lg:col-span-3">
            {handedOff && status === 'success' && task ? (
              <div className="studio-card p-5 space-y-4">
                <div>
                  <label className="studio-label">School name</label>
                  <input
                    type="text"
                    value={schoolName}
                    maxLength={120}
                    onChange={(e) => setSchoolName(e.target.value)}
                    placeholder="Your school name"
                    className="studio-input"
                  />
                  <p className="text-[11px] mt-1" style={{ color: 'var(--zt-text-muted)' }}>
                    Pulled from your profile — edit it here and it appears on the task sheet and the download.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs font-bold theme-text">
                    <input type="checkbox" checked={showAnswers} onChange={(e) => setShowAnswers(e.target.checked)} />
                    Show marking scheme
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" onClick={() => onExport(false)} className="studio-btn-ghost">
                      📄 Learner copy
                    </button>
                    <button type="button" onClick={() => onExportPdf(false)} className="studio-btn-ghost">
                      📄 Learner copy (.pdf)
                    </button>
                    <button type="button" onClick={() => onExport(true)} className="studio-btn-primary">
                      📄 Teacher copy (.docx)
                    </button>
                    <button type="button" onClick={() => onExportPdf(true)} className="studio-btn-ghost">
                      🔑 Teacher copy (.pdf)
                    </button>
                  </div>
                </div>
                {warning && (
                  <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
                    {warning}
                  </p>
                )}
                {generationId && (
                  <p className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>
                    Saved to your library — <Link to={`/teacher/library/${generationId}`} className="font-bold underline">open the saved copy</Link>.
                  </p>
                )}
                <SbaTaskView task={task} showAnswers={showAnswers} schoolName={schoolName} />
              </div>
            ) : (
              <LiveGenerationCanvas
                tool="sba"
                status={status}
                result={task}
                docTitle={task?.header?.title || currentTaskType?.label}
                title="Setting your SBA task…"
                subtitle="Task, stimulus and marking scheme, the ECZ way."
                emptyState={
                  <div className="rounded-xl border border-dashed theme-border bg-white/60 py-16 text-center text-sm" style={{ color: 'var(--zt-text-muted)' }}>
                    Choose a subject and task type, then generate. Your ECZ-compliant SBA task appears here.
                  </div>
                }
                errorMessage={[errorMessage, errorDetail].filter(Boolean).join(' — ')}
                savedToLibrary={Boolean(generationId)}
                onStop={() => { runRef.current += 1; setStatus('idle') }}
                onRegenerate={() => onGenerate()}
                onRegenerateSection={regenerateSection}
                onSaveToLibrary={saveToLibrary}
                onContinueEditing={() => setHandedOff(true)}
                onRetry={() => setStatus('idle')}
                continueLabel="Continue to editing & export"
              />
            )}
          </div>
          </StudioOutputBoundary>
        </div>
      </div>
    </div>
  )
}
