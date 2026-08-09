import { useState, useRef } from 'react'
import {
  generateRubric,
  TEACHER_LANGUAGES,
  RUBRIC_TASK_TYPES,
  RUBRIC_TOTAL_MARKS,
  RUBRIC_CRITERIA_COUNTS,
} from '../../../utils/teacherTools'
import { downloadRubricDocx } from '../../../engines/export-engine/rubricToDocx'
import { downloadRubricPdf } from '../../../engines/export-engine/rubricToPdf'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import RubricView from '../components/RubricView'
import { ListChecks } from 'lucide-react'
import GeneratorStudioShell, { useStudioSetupForYou } from '../../../components/teacher/generate/GeneratorStudioShell'
import { attachLibraryToGeneration, isFreePlanTeacher } from '../../../utils/teacherLibraryService'
import { useAuth } from '../../../contexts/AuthContext'
import { useGenerationGate } from '../../../hooks/useGenerationGate'
import { useIsMounted } from '../../../hooks/useIsMounted'
import { LIBRARY_TYPES } from '../../../config/library'
import LiveGenerationCanvas from '../../../components/ui/LiveGenerationCanvas'
import StudioCurriculumSelector from '../../../components/teacher/curriculum/StudioCurriculumSelector'
import { curriculumSeedFromProfile } from '../../../utils/teacherDefaults'
import { readActiveAssignmentSeed, resolveStudioSeed } from '../../../utils/activeAssignmentSeed'
import StudioAssignmentChangeNotice from '../../../components/teacher/generate/StudioAssignmentChangeNotice'
import {
  FieldTextarea,
  FieldSelect,
  FieldNumberCombo,
  FieldGrid,
  GenerateButton,
} from '../../../components/teacher/generate/studioFields'
import Icon from '../../../components/ui/Icon'
import { Download, RefreshCw } from '../../../components/ui/icons'
import StudioOutputBoundary from '../../../components/teacher/StudioOutputBoundary'
import { useAiOperationLock } from '../../../hooks/useAiOperationLock'
import { stableFingerprint } from '../../../hooks/aiOperationLockCore'
import { useStudioInputDraft } from '../../../hooks/draft/useStudioInputDraft'
import { rubricInputDescriptor } from '../../../hooks/draft/descriptors'

export default function RubricGenerator() {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const { ensureCanGenerate } = useGenerationGate(currentUser?.uid)
  const urlDefaults = useFormDefaultsFromUrl()
  // Selector seed: a deep-link handoff (?grade=…) wins; otherwise the
  // teacher's saved curriculum defaults (Teacher Settings → My Teaching).
  // Read once on mount by the selector — never re-seeds reactively. The
  // INITIAL seed is kept separately so useStudioSetupForYou can tell whether
  // the studio opened empty (only then may the suggestion seed the selector).
  const [initialSeed] = useState(() =>
    resolveStudioSeed({
      urlSeed: urlDefaults,
      activeSeed: readActiveAssignmentSeed(currentUser?.uid),
      profileSeed: curriculumSeedFromProfile(userProfile),
    }),
  )
  const [selectorSeed, setSelectorSeed] = useState(initialSeed)
  const [selectorKey, setSelectorKey] = useState(0)
  const [form, setForm] = useState(() => ({
    taskType: 'essay',
    taskDescription: '',
    totalMarks: 20,
    numberOfCriteria: 4,
    language: 'english',
    instructions: '',
    ...urlDefaults,
  }))
  // Standardized curriculum selection (CBC/Previous → grade → subject). `curr`
  // holds the latest payload, including the server-ready grade/subject/
  // curriculum/framework fields.
  const [curr, setCurr] = useState({})
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const isMounted = useIsMounted()
  const [rubric, setRubric] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')
  // Live Generation Canvas hand-off (see WorksheetGenerator for the pattern).
  const [handedOff, setHandedOff] = useState(false)
  // Per-run token: stops a resolved callable from hijacking the UI if Stop was
  // clicked before the response landed.
  const runRef = useRef(0)

  // Idempotency lock: one logical generation → one provider call + one saved
  // doc + one usage charge, even across a double-click / rapid tap / refresh /
  // a second tab. The server-side reservation enforces this; this is the
  // client-side belt (mints + persists the key). Separate lock keys for the
  // full generate vs a per-section regenerate so they never collide.
  const { run: runGenerateLocked } = useAiOperationLock('rubric-studio:generate')
  const { run: runRegenerateLocked } = useAiOperationLock('rubric-studio:regenerate')

  // Universal Draft Manager: auto-save the rubric inputs.
  const draft = useStudioInputDraft({
    descriptor: rubricInputDescriptor,
    uid: currentUser?.uid,
    form, setForm, curr, setCurr,
    onReseedSelector: (c) => { setSelectorSeed(c); setSelectorKey((k) => k + 1) },
  })

  // "Set up for you" (I3): when the studio opened with no grade/subject seed,
  // prefill from the teacher's Weekly Forecast and show the suggestion card.
  // Chips derive from the LIVE `curr` payload — see GeneratorStudioShell.
  const selectorAnchorRef = useRef(null)
  const setupForYou = useStudioSetupForYou({
    uid: currentUser?.uid,
    initialSeed,
    curr,
    applySeed: (seed) => { setSelectorSeed(seed); setSelectorKey((k) => k + 1) },
    selectorAnchorRef,
  })

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function buildInputs() {
    return {
      ...form,
      grade: curr.grade,
      subject: curr.subject,
      curriculum: curr.curriculum,
      framework: curr.framework,
    }
  }

  async function regenerateSection(sectionId) {
    if (!ensureCanGenerate('rubric')) return null
    const inputs = buildInputs()
    const lockResult = await runRegenerateLocked({
      // Section-scoped fingerprint so a regenerate mints its own key rather
      // than resuming the full-generate result.
      fingerprint: stableFingerprint({ ...inputs, __regenerateSection: sectionId }),
      action: async (idempotencyKey) => {
        const outcome = await generateRubric({ ...inputs, idempotencyKey })
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
    if (res.ok && res.data?.rubric) {
      const fresh = res.data.rubric
      setRubric((prev) => (prev ? { ...prev, [sectionId]: fresh[sectionId] } : fresh))
      return fresh
    }
    return null
  }

  function saveToLibrary() {
    if (!generationId) return
    attachLibraryToGeneration(generationId, {
      libraryType: LIBRARY_TYPES.ASSESSMENTS,
      syllabusHint: curr.curriculum === 'previous' ? 'OBC' : 'CBC',
      grade: curr.grade,
      subject: curr.subject,
      assessmentType: 'topic',
    }).catch((err) => console.error('[library attach]', err))
  }

  async function onGenerate(e) {
    e?.preventDefault?.()
    if (!curr.curriculumMode) {
      setErrorMessage('Please choose a curriculum.')
      setStatus('error')
      return
    }
    if (!curr.grade || !curr.subject) {
      setErrorMessage('Please select a class and subject.')
      setStatus('error')
      return
    }
    if (!form.taskDescription.trim()) {
      setErrorMessage('Please describe the task being graded.')
      setStatus('error')
      return
    }
    if (!ensureCanGenerate('rubric')) return
    const run = ++runRef.current
    setHandedOff(false)
    setStatus('generating')
    setErrorMessage('')
    setWarning('')
    setRubric(null)

    const inputs = buildInputs()
    const lockResult = await runGenerateLocked({
      fingerprint: stableFingerprint(inputs),
      action: async (idempotencyKey) => {
        const outcome = await generateRubric({ ...inputs, idempotencyKey })
        if (!outcome.ok) {
          // generateRubric() resolves rather than throws; a genuine failure
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
      setErrorMessage(res.error)
      return
    }
    setRubric(res.data.rubric)
    setGenerationId(res.data.generationId)
    setUsage(res.data.usage)
    setWarning(res.data.warning || '')
    setStatus('success')
    draft.clear().catch(() => {})

    if (res.data.generationId) {
      // Rubrics file under Assessments — they're scoring guides for tests.
      attachLibraryToGeneration(res.data.generationId, {
        libraryType:    LIBRARY_TYPES.ASSESSMENTS,
        syllabusHint:   curr.curriculum === 'previous' ? 'OBC' : 'CBC',
        grade:          curr.grade,
        subject:        curr.subject,
        assessmentType: 'topic',
      }).catch((err) => console.error('[library attach]', err))
    }
  }

  function onExport() {
    if (!rubric) return
    const name = buildDownloadName({
      docType: 'Rubric',
      grade: curr.grade,
      subject: curr.subjectLabel || curr.subject,
      topic: form.taskType,
    })
    downloadRubricDocx(rubric, name, { attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
  }

  function onExportPdf() {
    if (!rubric) return
    const name = buildDownloadName({
      docType: 'Rubric',
      grade: curr.grade,
      subject: curr.subjectLabel || curr.subject,
      topic: form.taskType,
      ext: 'pdf',
    })
    downloadRubricPdf(rubric, name, { attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
  }

  return (
    <GeneratorStudioShell
      seoTitle="Rubric studio"
      header={{
        eyebrow: 'Assessment',
        title: 'Rubric Studio',
        description: 'Mark consistently — four-level rubrics with clear descriptors for essays, projects, presentations, and practicals.',
        icon: ListChecks,
      }}
      notices={
        <StudioAssignmentChangeNotice
          uid={currentUser?.uid}
          currentSeed={{ grade: curr.grade || selectorSeed?.grade || '', subject: curr.subject || selectorSeed?.subject || '', curriculum: curr.curriculum || selectorSeed?.curriculum || '' }}
          onApply={(seed) => { setSelectorSeed(seed); setSelectorKey((k) => k + 1); setCurr({}) }}
          hasUnsavedChanges={draft.status !== 'idle'}
          saveDraft={draft.flush}
        />
      }
      draft={draft}
      draftLabel="rubric"
      setupForYou={setupForYou}
      onSubmit={onGenerate}
      formCardClassName="sticky top-4"
      selector={
        <div ref={selectorAnchorRef}>
          <StudioCurriculumSelector
            key={selectorKey}
            value={selectorSeed}
            onChange={setCurr}
            showTopicSubtopic={false}
            curriculumPickerVariant="segmented"
            defaultCurriculumMode="cbc"
          />
        </div>
      }
      form={
        <>
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
          <FieldGrid>
            <FieldNumberCombo
              label="Total marks"
              value={form.totalMarks}
              min={5}
              max={100}
              options={RUBRIC_TOTAL_MARKS.map((m) => ({ value: m.value, label: m.label }))}
              onChange={(v) => updateField('totalMarks', v)}
            />
            <FieldSelect
              label="# of criteria"
              value={String(form.numberOfCriteria)}
              options={RUBRIC_CRITERIA_COUNTS.map((c) => ({ value: String(c.value), label: c.label }))}
              onChange={(v) => updateField('numberOfCriteria', Number(v))}
            />
          </FieldGrid>
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
        </>
      }
      generateButton={
        <GenerateButton generating={status === 'generating'}>
          Generate Rubric
        </GenerateButton>
      }
      usageLine={usage ? (
        <>
          {usage.used}/{usage.limit} rubrics used on the{' '}
          <span className="font-bold capitalize">{usage.plan}</span> plan this month
        </>
      ) : null}
      status={status}
      emptyState={{
        icon: ListChecks,
        tone: '#f0d6e0',
        title: 'Consistent marking in seconds',
        text: 'Describe the task and pick total marks — you get a four-level rubric with clear descriptors.',
      }}
      output={
        <StudioOutputBoundary onRetry={() => setStatus('idle')}>
          {handedOff && status === 'success' && rubric ? (
          <section className="studio-card p-5 min-h-[400px]">
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="studio-display" style={{ fontSize: 22, margin: '0 0 2px' }}>{rubric.header?.title}</h2>
                    <p className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>
                      {rubric.header?.totalMarks} marks · {rubric.criteria?.length} criteria
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={onExport} className="studio-btn-ghost">
                      <Icon as={Download} size="sm" /> Download .docx (landscape)
                    </button>
                    <button onClick={onExportPdf} className="studio-btn-ghost">
                      <Icon as={Download} size="sm" /> Download .pdf
                    </button>
                    <button onClick={() => setStatus('idle')} className="studio-btn-primary">
                      <Icon as={RefreshCw} size="sm" /> Generate Another
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
          </section>
          ) : (
            <LiveGenerationCanvas
              tool="rubric"
              status={status}
              result={rubric}
              docTitle={rubric?.header?.title}
              title="Designing your rubric…"
              errorMessage={errorMessage}
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
        </StudioOutputBoundary>
      }
    />
  )
}


