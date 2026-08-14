import { useState, useRef, useEffect } from 'react'
import {
  generateWorksheet,
  generateWorksheetStream,
  TEACHER_LANGUAGES,
  WORKSHEET_DIFFICULTIES,
  WORKSHEET_STYLES,
  WORKSHEET_GRID_COLUMNS,
  WORKSHEET_PASSAGE_LENGTHS,
  WORKSHEET_QUESTION_COUNTS,
  WORKSHEET_DURATIONS,
  CURRICULUM_TERMS,
  LESSON_NUMBER_OPTIONS,
  TOTAL_LESSONS_OPTIONS,
  LEARNING_ENVIRONMENT_OPTIONS,
} from '../../../utils/teacherTools'
import { downloadWorksheetDocx } from '../../../engines/export-engine/worksheetToDocx'
import { downloadWorksheetPdf } from '../../../engines/export-engine/worksheetToPdf'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { checkDownload } from '../../../utils/downloadGuard'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import { friendlyMessage } from '../../../utils/friendlyErrors'
import { PencilRuler } from 'lucide-react'
import GeneratorStudioShell, { useStudioSetupForYou } from '../../../components/teacher/generate/GeneratorStudioShell'
import { attachLibraryToGeneration, isFreePlanTeacher } from '../../../utils/teacherLibraryService'
import { useAuth } from '../../../contexts/AuthContext'
import { useGenerationGate } from '../../../hooks/useGenerationGate'
import { LIBRARY_TYPES } from '../../../config/library'
import StudioCurriculumSelector from '../../../components/teacher/curriculum/StudioCurriculumSelector'
import LiveGenerationCanvas from '../../../shared/components/LiveGenerationCanvas'
import { useAiOperationLock } from '../../../hooks/useAiOperationLock'
import { stableFingerprint } from '../../../hooks/aiOperationLockCore'
import { useStudioInputDraft } from '../../../hooks/draft/useStudioInputDraft'
import { worksheetInputDescriptor } from '../../../hooks/draft/descriptors'
import {
  FieldTextarea,
  FieldSelect,
  FieldGrid,
  AdvancedOptions,
  GenerateButton,
} from '../../../shared/components/studioFields'
import Icon from '../../../shared/components/Icon'
import { Download, Key } from '../../../shared/components/icons'
import WorksheetView from '../components/WorksheetView'
import StudioOutputBoundary from '../../../shared/components/StudioOutputBoundary'
import { curriculumSeedFromProfile, preferredDifficulty, preferredTermYear } from '../../../utils/teacherDefaults'
import { readActiveAssignmentSeed, resolveStudioSeed } from '../../../utils/activeAssignmentSeed'
import CreatedFromLessonPlanNotice from '../../../components/teacher/generate/CreatedFromLessonPlanNotice'
import StudioAssignmentChangeNotice from '../../../components/teacher/generate/StudioAssignmentChangeNotice'

/**
 * Worksheet Generator — pupil-facing worksheet + separate answer-key export.
 */
export default function WorksheetGenerator() {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const { ensureCanGenerate } = useGenerationGate(currentUser?.uid)
  const urlDefaults = useFormDefaultsFromUrl()
  const [form, setForm] = useState(() => ({
    // Saved current term (Teacher Settings → Calendar) pre-fills the Term
    // select; a deep-link term in urlDefaults still wins via the spread.
    term: preferredTermYear(userProfile).term,
    lessonNumber: '',
    totalLessons: '',
    learningEnvironment: '',
    count: 10,
    style: 'auto',
    gridColumns: 0,
    passageLength: '',
    // Teacher Settings → My AI assessment-difficulty default ('mixed' when
    // unset); a deep-link difficulty in urlDefaults still wins via the spread.
    difficulty: preferredDifficulty(userProfile, 'assessment'),
    durationMinutes: 30,
    language: 'english',
    instructions: '',
    includeAnswerKey: true,
    ...urlDefaults,
  }))
  // Standardized curriculum selection (CBC/Previous → grade → subject → topic →
  // subtopic). `curr` holds the latest payload, including the server-ready
  // grade/subject/curriculum/framework fields.
  const [curr, setCurr] = useState({})
  // Selector seed: deep-link handoff wins; else the teacher's saved
  // curriculum defaults (read once on mount by the selector). Recovering a draft
  // re-seeds it and bumps selectorKey to remount the selector on the saved
  // curriculum (the selector reads its seed once on mount). The INITIAL seed is
  // kept separately so useStudioSetupForYou can tell whether the studio opened
  // empty (only then may the Weekly-Forecast suggestion seed the selector).
  const [initialSeed] = useState(() =>
    resolveStudioSeed({
      urlSeed: urlDefaults,
      activeSeed: readActiveAssignmentSeed(currentUser?.uid),
      profileSeed: curriculumSeedFromProfile(userProfile),
    }),
  )
  const [selectorSeed, setSelectorSeed] = useState(initialSeed)
  const [selectorKey, setSelectorKey] = useState(0)
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [worksheet, setWorksheet] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')
  const [showAnswers, setShowAnswers] = useState(false)
  const [progress, setProgress] = useState(null)
  // Live Generation Canvas: while false the teacher watches the worksheet being
  // built section by section; "Continue editing" flips it true to reveal the
  // full editable/exportable view below.
  const [handedOff, setHandedOff] = useState(false)
  const cancelRef = useRef(null)

  // Both actions on this screen are locked, and the MAIN generate is the one
  // that needed it most.
  //
  // It goes through the streaming `generateWorksheetStream` SSE endpoint rather
  // than the callable, and until Phase 6 that endpoint forwarded no idempotency
  // key at all — so the button teachers actually press had no client lock, no
  // server reservation and no deterministic result id, while the per-section
  // regenerate beside it was fully protected. `runStreamingGenerator` forwards
  // `inputs` verbatim to both the SSE body and the Capacitor/DEV callable
  // fallback, so putting the key in `inputs` covers both doors at once.
  const { run: runGenerateLocked } = useAiOperationLock('worksheet-studio:generate')
  const { run: runRegenerateLocked } = useAiOperationLock('worksheet-studio:regenerate')

  // Lets onCancel settle the promise the lock is waiting on. Without it a
  // cancelled stream would hold the lock until the page unloaded, and the
  // teacher's next Generate would be silently refused as a duplicate.
  const settleStreamRef = useRef(null)

  // Universal Draft Manager: auto-save the worksheet inputs so a refresh /
  // crash / offline drop never loses a half-filled form.
  const draft = useStudioInputDraft({
    descriptor: worksheetInputDescriptor,
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

  useEffect(() => {
    return () => {
      try { cancelRef.current?.() } catch { /* ignore */ }
    }
  }, [])

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function buildInputs() {
    return {
      ...form,
      grade: curr.grade,
      subject: curr.subject,
      topic: curr.topic,
      subtopic: curr.subtopic,
      curriculum: curr.curriculum,
      framework: curr.framework,
      // Link back to the source lesson plan (Lesson Plan → Worksheet
      // inheritance), persisted in the generation's inputs. '' when standalone.
      sourceLessonPlanId: urlDefaults.sourceLessonPlanId || '',
    }
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
    if (!curr.topic || !curr.topic.trim()) {
      setErrorMessage('Please select a topic.')
      setStatus('error')
      return
    }
    // Fail fast: out of quota (and no top-up credit) → open the pay/upgrade
    // prompt now, before flipping into the "Generating…" state.
    if (!ensureCanGenerate('worksheet')) return
    try { cancelRef.current?.() } catch { /* ignore */ }
    setHandedOff(false)
    setStatus('generating')
    setErrorMessage('')
    setWarning('')
    setWorksheet(null)
    setProgress({ phase: 'queued', elapsedMs: 0 })

    const inputs = buildInputs()
    const lockResult = await runGenerateLocked({
      fingerprint: stableFingerprint(inputs),
      // The stream reports through callbacks and returns a cancel handle, so
      // the lock is given a promise that settles when the stream does.
      action: (idempotencyKey) => new Promise((resolve, reject) => {
        settleStreamRef.current = { resolve, reject }
        cancelRef.current = generateWorksheetStream({ ...inputs, idempotencyKey }, {
          onProgress: (p) => setProgress(p),
          onResult: (data) => {
            settleStreamRef.current = null
            setWorksheet(data.worksheet)
            setGenerationId(data.generationId)
            setUsage(data.usage)
            setWarning(data.warning || '')
            setStatus('success')
            cancelRef.current = null
            // The output is now persisted server-side (aiGenerations) — the
            // input draft is no longer "unfinished", so clear it to avoid a
            // stale recovery prompt on the next visit.
            draft.clear().catch(() => {})
            if (data.generationId) {
              // Worksheets surface in the Assessments section of the library —
              // they're the "Topic Test" of a teacher's day-to-day routine.
              attachLibraryToGeneration(data.generationId, {
                libraryType:    LIBRARY_TYPES.ASSESSMENTS,
                syllabusHint:   curr.curriculum === 'previous' ? 'OBC' : 'CBC',
                grade:          curr.grade,
                subject:        curr.subject,
                assessmentType: 'topic',
              }).catch((err) => console.error('[library attach]', err))
            }
            resolve(data)
          },
          onError: (err) => {
            settleStreamRef.current = null
            setStatus('error')
            setErrorMessage(friendlyMessage(err, 'Generation failed. Please try again.'))
            cancelRef.current = null
            reject(err)
          },
        })
      }),
    })
    // A refused duplicate is not an error the teacher caused — the in-flight
    // generation is still running and will report through its own callbacks.
    if (lockResult.reason === 'locked') return
    if (!lockResult.ok && lockResult.error?.cancelled) return
  }

  function onCancel() {
    try { cancelRef.current?.() } catch { /* ignore */ }
    cancelRef.current = null
    // Release the operation lock. Resolving rather than rejecting keeps this
    // off the error path — onCancel has already put the UI back to idle, and a
    // rejection here would overwrite that with a failure message.
    const settle = settleStreamRef.current
    settleStreamRef.current = null
    settle?.resolve(null)
    setStatus('idle')
    setProgress(null)
  }

  // Regenerate a single section: re-run the generator and merge just that
  // section's fresh content back into the worksheet (so both the live preview
  // and the exported file stay in sync).
  async function regenerateSection(sectionId) {
    if (!ensureCanGenerate('worksheet')) return null
    const inputs = buildInputs()
    const lockResult = await runRegenerateLocked({
      // Section-scoped fingerprint so a regenerate mints its own key rather
      // than resuming a prior result.
      fingerprint: stableFingerprint({ ...inputs, __regenerateSection: sectionId }),
      action: async (idempotencyKey) => {
        const outcome = await generateWorksheet({ ...inputs, idempotencyKey })
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
    if (res.ok && res.data?.worksheet) {
      const fresh = res.data.worksheet
      setWorksheet((prev) => (prev ? { ...prev, [sectionId]: fresh[sectionId] } : fresh))
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

  function buildFilename(mode) {
    return buildDownloadName({
      docType: 'Worksheet',
      grade: curr.grade,
      subject: curr.subjectLabel || curr.subject,
      topic: worksheet?.header?.topic || curr.topic,
      variant: mode === 'answer_key' ? 'Answer Key' : undefined,
    })
  }

  // Deterministic, zero-cost guard: warn (never block) if the file we're about
  // to save has a junk name, no title, doesn't match the requested
  // grade/subject, or is structurally empty.
  function guardDownload(filename) {
    const { ok, problems } = checkDownload({
      tool: 'worksheet',
      filename,
      output: worksheet,
      inputs: { grade: curr.grade, subject: curr.subjectLabel || curr.subject, topic: worksheet?.header?.topic || curr.topic },
    })
    if (!ok) setWarning(`Heads up: ${problems.map((p) => p.message).join(' ')}`)
  }

  function onExportPupil() {
    if (!worksheet) return
    const filename = buildFilename('worksheet')
    guardDownload(filename)
    downloadWorksheetDocx(worksheet, filename, { mode: 'worksheet', attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
  }

  function onExportAnswerKey() {
    if (!worksheet) return
    const filename = buildFilename('answer_key')
    guardDownload(filename)
    downloadWorksheetDocx(worksheet, filename, { mode: 'answer_key', attribution: isFreePlanTeacher({ userProfile, isAdmin }) })
  }

  function onExportPupilPdf() {
    if (!worksheet) return
    const filename = buildDownloadName({
      docType: 'Worksheet', grade: curr.grade, subject: curr.subjectLabel || curr.subject,
      topic: worksheet?.header?.topic || curr.topic, ext: 'pdf',
    })
    downloadWorksheetPdf(worksheet, filename, {
      mode: 'worksheet',
      attribution: isFreePlanTeacher({ userProfile, isAdmin }),
    })
  }

  function onExportAnswerKeyPdf() {
    if (!worksheet) return
    const filename = buildDownloadName({
      docType: 'Worksheet', grade: curr.grade, subject: curr.subjectLabel || curr.subject,
      topic: worksheet?.header?.topic || curr.topic, variant: 'Answer Key', ext: 'pdf',
    })
    downloadWorksheetPdf(worksheet, filename, {
      mode: 'answer_key',
      attribution: isFreePlanTeacher({ userProfile, isAdmin }),
    })
  }

  return (
    <GeneratorStudioShell
      seoTitle="Worksheet studio"
      header={{
        eyebrow: 'Teaching materials',
        title: 'Worksheet Studio',
        description: 'Print-ready practice — Zambian CBC worksheets with a separate, fully-answered marking key, in under a minute.',
        icon: PencilRuler,
      }}
      notices={
        <>
          <CreatedFromLessonPlanNotice urlDefaults={urlDefaults} />
          <StudioAssignmentChangeNotice
            uid={currentUser?.uid}
            currentSeed={{ grade: curr.grade || selectorSeed?.grade || '', subject: curr.subject || selectorSeed?.subject || '', curriculum: curr.curriculum || selectorSeed?.curriculum || '' }}
            onApply={(seed) => { setSelectorSeed(seed); setSelectorKey((k) => k + 1); setCurr({}) }}
            hasUnsavedChanges={draft.status !== 'idle'}
            saveDraft={draft.flush}
          />
        </>
      }
      draft={draft}
      draftLabel="worksheet"
      setupForYou={setupForYou}
      onSubmit={onGenerate}
      selector={
        <div ref={selectorAnchorRef}>
          <StudioCurriculumSelector
            key={selectorKey}
            value={selectorSeed}
            onChange={setCurr}
            curriculumPickerVariant="segmented"
            defaultCurriculumMode="cbc"
          />
        </div>
      }
      form={
        <>
          <FieldGrid>
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
          </FieldGrid>
          <AdvancedOptions
            label="Format & style"
            hint="Auto ✓ — worksheet style, grid columns, passage length"
          >
            <FieldSelect
              label="Worksheet style"
              value={form.style}
              options={WORKSHEET_STYLES}
              onChange={(v) => updateField('style', v)}
            />
            {(form.style === 'auto' || form.style === 'grid') && (
              <FieldSelect
                label="Grid columns (practice grids)"
                value={String(form.gridColumns)}
                options={WORKSHEET_GRID_COLUMNS.map((p) => ({
                  value: String(p.value), label: p.label,
                }))}
                onChange={(v) => updateField('gridColumns', Number(v))}
              />
            )}
            {(form.style === 'auto' || form.style === 'comprehension') && (
              <FieldSelect
                label="Reading passage length"
                value={form.passageLength}
                options={WORKSHEET_PASSAGE_LENGTHS}
                onChange={(v) => updateField('passageLength', v)}
              />
            )}
          </AdvancedOptions>
          <AdvancedOptions hint="Term, lesson numbering, timing, language">
            <FieldSelect
              label="Term"
              value={form.term}
              options={CURRICULUM_TERMS}
              onChange={(v) => updateField('term', v)}
            />
            <FieldGrid>
              <FieldSelect
                label="Lessons for this sub-topic"
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
            </FieldGrid>
            <FieldSelect
              label="Learning environment"
              value={form.learningEnvironment}
              options={LEARNING_ENVIRONMENT_OPTIONS}
              onChange={(v) => updateField('learningEnvironment', v)}
            />
            <FieldGrid>
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
            </FieldGrid>
          </AdvancedOptions>
          <FieldTextarea
            label="Extra instructions (optional)"
            placeholder="e.g. Include at least one word problem about the market."
            value={form.instructions}
            onChange={(v) => updateField('instructions', v)}
            maxLength={500}
          />
        </>
      }
      generateButton={
        <GenerateButton generating={status === 'generating'}>
          Generate Worksheet
        </GenerateButton>
      }
      usageLine={usage ? (
        <>
          {usage.used}/{usage.limit} worksheets used on the{' '}
          <span className="font-bold capitalize">{usage.plan}</span> plan this month
        </>
      ) : null}
      status={status}
      emptyState={{
        icon: PencilRuler,
        tone: '#d8ecd0',
        title: 'Ready to make a worksheet',
        text: 'Pick the grade, subject and topic on the left — you get a printable worksheet plus a separate answer key.',
      }}
      output={
        <StudioOutputBoundary onRetry={() => setStatus('idle')}>
          {handedOff && status === 'success' && worksheet ? (
          <section className="studio-card p-5 min-h-[400px]">
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="studio-display" style={{ fontSize: 22, margin: '0 0 2px' }}>
                      {worksheet.header?.title || 'Worksheet'}
                    </h2>
                    <p className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>
                      {worksheet.header?.totalMarks} marks · review, export, print.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label
                      className="flex items-center gap-2 text-sm px-3 py-2 rounded-xl cursor-pointer"
                      style={{ color: 'var(--zt-text)', border: '1.5px solid #d9cfb8' }}
                    >
                      <input
                        type="checkbox"
                        checked={showAnswers}
                        onChange={(e) => setShowAnswers(e.target.checked)}
                        style={{ accentColor: '#d97757' }}
                      />
                      Show answers
                    </label>
                    <button onClick={onExportPupil} className="studio-btn-ghost">
                      <Icon as={Download} size="sm" /> Worksheet .docx
                    </button>
                    <button onClick={onExportPupilPdf} className="studio-btn-ghost">
                      <Icon as={Download} size="sm" /> Worksheet .pdf
                    </button>
                    <button onClick={onExportAnswerKey} className="studio-btn-primary">
                      <Icon as={Key} size="sm" /> Answer Key .docx
                    </button>
                    <button onClick={onExportAnswerKeyPdf} className="studio-btn-ghost">
                      <Icon as={Key} size="sm" /> Answer Key .pdf
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
          </section>
          ) : (
            <LiveGenerationCanvas
              tool="worksheet"
              status={status}
              result={worksheet}
              docTitle={worksheet?.header?.title}
              title="Writing your worksheet…"
              errorMessage={errorMessage}
              progress={progress}
              savedToLibrary={Boolean(generationId)}
              onStop={onCancel}
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

