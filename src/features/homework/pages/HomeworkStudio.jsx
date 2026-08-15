import { useState, useRef } from 'react'
import {
  generateHomework,
  TEACHER_LANGUAGES,
  CURRICULUM_TERMS,
  TOTAL_LESSONS_OPTIONS,
  LESSON_NUMBER_OPTIONS,
  LEARNING_ENVIRONMENT_OPTIONS,
} from '../../../utils/teacherTools'
import { downloadHomeworkDocx } from '../../../engines/export-engine/homeworkToDocx'
import { downloadHomeworkPdf } from '../../../engines/export-engine/homeworkToPdf'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import { House } from 'lucide-react'
import GeneratorStudioShell, { useStudioSetupForYou } from '../../../shared/components/GeneratorStudioShell'
import { attachLibraryToGeneration, isFreePlanTeacher } from '../../../utils/teacherLibraryService'
import { captureQuestionsToBank } from '../../../utils/questionBankService'
import { homeworkQuestionToBank } from '../../../utils/questionBankCore'
import { useAuth } from '../../../contexts/AuthContext'
import { useGenerationGate } from '../../../hooks/useGenerationGate'
import { useIsMounted } from '../../../hooks/useIsMounted'
import { LIBRARY_TYPES } from '../../../config/library'
import LiveGenerationCanvas from '../../../shared/components/LiveGenerationCanvas'
import {
  FieldTextarea,
  FieldSelect,
  FieldGrid,
  AdvancedOptions,
  GenerateButton,
} from '../../../shared/components/studioFields'
import Icon from '../../../shared/components/Icon'
import { Download, Key } from '../../../shared/components/icons'
import StudioCurriculumSelector from '../../../shared/components/StudioCurriculumSelector'
import StudioOutputBoundary from '../../../shared/components/StudioOutputBoundary'
import HomeworkView from '../components/HomeworkView'
import { useAiOperationLock } from '../../../hooks/useAiOperationLock'
import { stableFingerprint } from '../../../hooks/aiOperationLockCore'
import { useStudioInputDraft } from '../../../hooks/draft/useStudioInputDraft'
import { homeworkInputDescriptor } from '../../../hooks/draft/descriptors'
import { curriculumSeedFromProfile, preferredDifficulty, preferredTermYear } from '../../../utils/teacherDefaults'
import { readActiveAssignmentSeed, resolveStudioSeed } from '../../../utils/activeAssignmentSeed'
import CreatedFromLessonPlanNotice from '../../../shared/components/CreatedFromLessonPlanNotice'
import StudioAssignmentChangeNotice from '../../../shared/components/StudioAssignmentChangeNotice'

/**
 * Homework Studio — short take-home practice grounded on the stored
 * curriculum module. Usually launched from the Curriculum Studio with
 * everything pre-filled; also usable standalone.
 */
export default function HomeworkStudio() {
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
    count: 6,
    estimatedMinutes: 20,
    language: 'english',
    instructions: '',
    ...urlDefaults,
  }))
  // Standardized curriculum selection (CBC/Previous → grade → subject → topic →
  // subtopic) sourced from the Syllabus Studio. `curr` holds the latest payload,
  // including the server-ready grade/subject/curriculum/framework fields.
  const [curr, setCurr] = useState({})
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
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const isMounted = useIsMounted()
  const [homework, setHomework] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')
  const [showAnswers, setShowAnswers] = useState(false)
  // Live Generation Canvas hand-off (see WorksheetGenerator for the pattern).
  const [handedOff, setHandedOff] = useState(false)
  // Per-run token: stops a resolved callable from hijacking the UI if Stop was
  // clicked before the response landed.
  const runRef = useRef(0)

  // Idempotency lock: one logical generation → one provider call + one saved
  // doc + one usage charge, even across a double-click / rapid tap / refresh /
  // a second tab. generateHomework.js's server-side reservation enforces this;
  // this is the client-side belt (mints + persists the key). Separate lock keys
  // for the full generate vs a per-section regenerate so they never collide.
  // See CreatePaperModal for the reference wiring.
  const { run: runGenerateLocked } = useAiOperationLock('homework-studio:generate')
  const { run: runRegenerateLocked } = useAiOperationLock('homework-studio:regenerate')

  // Universal Draft Manager: auto-save the homework inputs.
  const draft = useStudioInputDraft({
    descriptor: homeworkInputDescriptor,
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

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  function buildPayload() {
    const difficulty = preferredDifficulty(userProfile, 'homework')
    const difficultyLine =
      difficulty === 'easy'
        ? 'Keep the questions gentle and confidence-building, with scaffolding.'
        : difficulty === 'hard'
          ? 'Make the questions challenging, with stretch tasks that need deeper thinking.'
          : ''
    return {
      ...form,
      instructions: (() => {
        const joined = [form.instructions, difficultyLine].filter(Boolean).join('\n')
        return joined.length <= 500 ? joined : form.instructions
      })(),
      grade: curr.grade,
      subject: curr.subject,
      topic: curr.topic,
      subtopic: curr.subtopic,
      curriculum: curr.curriculum,
      framework: curr.framework,
      // Link back to the source lesson plan (Lesson Plan → Homework
      // inheritance), persisted in the generation's inputs. '' when standalone.
      sourceLessonPlanId: urlDefaults.sourceLessonPlanId || '',
    }
  }

  async function regenerateSection(sectionId) {
    if (!ensureCanGenerate('homework')) return null
    const payload = buildPayload()
    const lockResult = await runRegenerateLocked({
      // Section-scoped fingerprint so a regenerate mints its own key rather
      // than resuming the full-generate result.
      fingerprint: stableFingerprint({ ...payload, __regenerateSection: sectionId }),
      action: async (idempotencyKey) => {
        const outcome = await generateHomework({ ...payload, idempotencyKey })
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
    if (res.ok && res.data?.homework) {
      const fresh = res.data.homework
      setHomework((prev) => (prev ? { ...prev, [sectionId]: fresh[sectionId] } : fresh))
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
      assessmentType: 'homework',
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
    if (!curr.topic || !curr.topic.trim()) {
      setErrorMessage('Please select a topic.')
      setStatus('error')
      return
    }
    if (!ensureCanGenerate('homework')) return
    const run = ++runRef.current
    setHandedOff(false)
    setStatus('generating')
    setErrorMessage('')
    setWarning('')
    setHomework(null)
    // Teacher Settings → My AI → homework difficulty rides along inside
    // buildPayload() as an extra instruction line (server caps at 500 chars).
    const payload = buildPayload()
    const lockResult = await runGenerateLocked({
      fingerprint: stableFingerprint(payload),
      action: async (idempotencyKey) => {
        const outcome = await generateHomework({ ...payload, idempotencyKey })
        if (!outcome.ok) {
          // generateHomework() resolves rather than throws; a genuine failure
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
      return
    }
    setHomework(res.data.homework)
    setGenerationId(res.data.generationId)
    setUsage(res.data.usage)
    setWarning(res.data.warning || '')
    setStatus('success')
    draft.clear().catch(() => {})
    if (res.data.generationId) {
      attachLibraryToGeneration(res.data.generationId, {
        libraryType: LIBRARY_TYPES.ASSESSMENTS,
        syllabusHint: curr.curriculum === 'previous' ? 'OBC' : 'CBC',
        grade: curr.grade,
        subject: curr.subject,
        assessmentType: 'homework',
      }).catch((err) => console.error('[library attach]', err))
    }
    // Central Question Bank — capture the homework questions in the background
    // (no Share button). Homework items are plain short-answer, mapped to the
    // editor shape the bank stores. Fire-and-forget: must never affect the UX.
    if (currentUser?.uid) {
      const topic = res.data.homework?.header?.topic || curr.topic
      const banked = (res.data.homework?.questions || [])
        .map((q) => homeworkQuestionToBank(q, { topic }))
        .filter(Boolean)
      captureQuestionsToBank(
        currentUser.uid,
        banked,
        { subject: curr.subject, grade: curr.grade, topic },
        'homework_studio',
      )
    }
  }

  function onExport(includeAnswers) {
    if (!homework) return
    const name = buildDownloadName({
      docType: includeAnswers ? 'Homework' : 'Homework (pupil)',
      grade: curr.grade,
      subject: curr.subjectLabel || curr.subject,
      topic: homework.header?.topic || curr.topic,
    })
    downloadHomeworkDocx(homework, name, {
      attribution: isFreePlanTeacher({ userProfile, isAdmin }),
      includeAnswers,
    })
  }

  function onExportPdf(includeAnswers) {
    if (!homework) return
    const name = buildDownloadName({
      docType: includeAnswers ? 'Homework' : 'Homework (pupil)',
      grade: curr.grade,
      subject: curr.subjectLabel || curr.subject,
      topic: homework.header?.topic || curr.topic,
      ext: 'pdf',
    })
    downloadHomeworkPdf(homework, name, {
      attribution: isFreePlanTeacher({ userProfile, isAdmin }),
      includeAnswers,
    })
  }

  return (
    <GeneratorStudioShell
      seoTitle="Homework studio"
      header={{
        eyebrow: 'Teaching materials',
        title: 'Homework Studio',
        description: 'Short take-home practice grounded on the verified curriculum module — questions, answer key and a note for parents.',
        icon: House,
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
      draftLabel="homework"
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
            <FieldSelect label="Number of questions"
              value={String(form.count)}
              options={[3, 5, 6, 8, 10, 12].map((n) => ({
                value: String(n), label: `${n} questions`,
              }))}
              onChange={(v) => set('count', Number(v))} />
            <FieldSelect label="Time at home (estimate)"
              value={String(form.estimatedMinutes)}
              options={[10, 15, 20, 30, 45, 60].map((m) => ({
                value: String(m), label: `${m} min`,
              }))}
              onChange={(v) => set('estimatedMinutes', Number(v))} />
          </FieldGrid>
          <AdvancedOptions hint="Term, lesson numbering, language">
            <FieldSelect label="Term" value={form.term}
              options={CURRICULUM_TERMS} onChange={(v) => set('term', v)} />
            <FieldGrid>
              <FieldSelect label="Lessons for this sub-topic"
                value={form.totalLessons} options={TOTAL_LESSONS_OPTIONS}
                onChange={(v) => set('totalLessons', v)} />
              <FieldSelect label="Lesson number" value={form.lessonNumber}
                options={LESSON_NUMBER_OPTIONS}
                onChange={(v) => set('lessonNumber', v)} />
            </FieldGrid>
            <FieldSelect label="Learning environment"
              value={form.learningEnvironment}
              options={LEARNING_ENVIRONMENT_OPTIONS}
              onChange={(v) => set('learningEnvironment', v)} />
            <FieldSelect label="Language" value={form.language}
              options={TEACHER_LANGUAGES} onChange={(v) => set('language', v)} />
          </AdvancedOptions>
          <FieldTextarea label="Extra instructions (optional)"
            placeholder="e.g. One word problem about the market."
            value={form.instructions}
            onChange={(v) => set('instructions', v)} maxLength={500} />
        </>
      }
      generateButton={
        <GenerateButton generating={status === 'generating'}>
          Generate Homework
        </GenerateButton>
      }
      usageLine={usage ? (
        <>
          {usage.used}/{usage.limit} homeworks used on the{' '}
          <span className="font-bold capitalize">{usage.plan}</span>{' '}
          plan this month
        </>
      ) : null}
      status={status}
      emptyState={{
        icon: House,
        tone: '#dbe7f4',
        title: 'Ready to set homework',
        text: 'Pick the grade, subject and (ideally) a stored sub-topic — you get questions, an answer key and a parent note.',
      }}
      output={
        <StudioOutputBoundary onRetry={() => setStatus('idle')}>
          {handedOff && status === 'success' && homework ? (
          <section className="studio-card p-5 min-h-[400px]">
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="studio-display"
                      style={{ fontSize: 22, margin: '0 0 2px' }}>
                      {homework.header?.title || 'Homework'}
                    </h2>
                    <p className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>
                      ~{homework.header?.estimatedMinutes} min · review, export, print.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="flex items-center gap-2 text-sm px-3 py-2 rounded-xl cursor-pointer"
                      style={{ color: 'var(--zt-text)', border: '1.5px solid #d9cfb8' }}>
                      <input type="checkbox" checked={showAnswers}
                        onChange={(e) => setShowAnswers(e.target.checked)}
                        style={{ accentColor: '#d97757' }} />
                      Show answers
                    </label>
                    <button onClick={() => onExport(false)} className="studio-btn-ghost">
                      <Icon as={Download} size="sm" /> Pupil sheet .docx
                    </button>
                    <button onClick={() => onExportPdf(false)} className="studio-btn-ghost">
                      <Icon as={Download} size="sm" /> Pupil sheet .pdf
                    </button>
                    <button onClick={() => onExport(true)} className="studio-btn-primary">
                      <Icon as={Key} size="sm" /> With answer key .docx
                    </button>
                    <button onClick={() => onExportPdf(true)} className="studio-btn-ghost">
                      <Icon as={Key} size="sm" /> With answer key .pdf
                    </button>
                  </div>
                </div>
                {warning && (
                  <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
                    ⚠️ {warning}
                  </div>
                )}
                <HomeworkView hw={homework} showAnswers={showAnswers} />
                {generationId && (
                  <div className="mt-6 text-xs theme-text-secondary">
                    Saved to your Library as <code>{generationId}</code>.
                  </div>
                )}
              </>
          </section>
          ) : (
            <LiveGenerationCanvas
              tool="homework"
              status={status}
              result={homework}
              docTitle={homework?.header?.title}
              title="Setting homework…"
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


