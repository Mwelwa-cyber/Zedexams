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
import { downloadWorksheetDocx } from '../../../utils/worksheetToDocx'
import { downloadWorksheetPdf } from '../../../utils/worksheetToPdf'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { checkDownload } from '../../../utils/downloadGuard'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import { friendlyMessage } from '../../../utils/friendlyErrors'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'
import { attachLibraryToGeneration, isFreePlanTeacher } from '../../../utils/teacherLibraryService'
import { useAuth } from '../../../contexts/AuthContext'
import { useGenerationGate } from '../../../hooks/useGenerationGate'
import { LIBRARY_TYPES } from '../../../config/library'
import StudioCurriculumSelector from '../curriculum/StudioCurriculumSelector'
import LiveGenerationCanvas from '../../ui/LiveGenerationCanvas'
import { useStudioInputDraft } from '../../../hooks/draft/useStudioInputDraft'
import { worksheetInputDescriptor } from '../../../hooks/draft/descriptors'
import DraftStatusIndicator from '../../draft/DraftStatusIndicator'
import DraftRecoveryPrompt from '../../draft/DraftRecoveryPrompt'
import {
  FieldTextarea,
  FieldSelect,
  FieldGrid,
  AdvancedOptions,
  GenerateButton,
  StudioEmptyState,
} from './studioFields'
import Icon from '../../ui/Icon'
import { Download, Key } from '../../ui/icons'
import WorksheetView from '../views/WorksheetView'
import StudioOutputBoundary from '../StudioOutputBoundary'
import { curriculumSeedFromProfile, preferredDifficulty, preferredTermYear } from '../../../utils/teacherDefaults'

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
  // curriculum (the selector reads its seed once on mount).
  const [selectorSeed, setSelectorSeed] = useState(() =>
    urlDefaults && (urlDefaults.grade || urlDefaults.subject || urlDefaults.topic)
      ? urlDefaults
      : curriculumSeedFromProfile(userProfile),
  )
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

  // Universal Draft Manager: auto-save the worksheet inputs so a refresh /
  // crash / offline drop never loses a half-filled form.
  const draft = useStudioInputDraft({
    descriptor: worksheetInputDescriptor,
    uid: currentUser?.uid,
    form, setForm, curr, setCurr,
    onReseedSelector: (c) => { setSelectorSeed(c); setSelectorKey((k) => k + 1) },
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
    }
  }

  function onGenerate(e) {
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

    cancelRef.current = generateWorksheetStream(buildInputs(), {
      onProgress: (p) => setProgress(p),
      onResult: (data) => {
        setWorksheet(data.worksheet)
        setGenerationId(data.generationId)
        setUsage(data.usage)
        setWarning(data.warning || '')
        setStatus('success')
        cancelRef.current = null
        // The output is now persisted server-side (aiGenerations) — the input
        // draft is no longer "unfinished", so clear it to avoid a stale
        // recovery prompt on the next visit.
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
      },
      onError: (err) => {
        setStatus('error')
        setErrorMessage(friendlyMessage(err, 'Generation failed. Please try again.'))
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

  // Regenerate a single section: re-run the generator and merge just that
  // section's fresh content back into the worksheet (so both the live preview
  // and the exported file stay in sync).
  async function regenerateSection(sectionId) {
    const res = await generateWorksheet(buildInputs())
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
    <div className="studio-page">
      <SeoHelmet title="Worksheet studio" noIndex />
      <div className="w-full">
        <StudioPageHeader
          eyebrow="Worksheet Studio"
          title="Print-ready practice"
          subtitle="Zambian CBC worksheets with a separate, fully-answered marking key — in under a minute."
          emoji="🐢"
        />

        <div className="mb-4">
          <DraftRecoveryPrompt {...draft} label="worksheet" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
          {/* Input panel */}
          <form
            onSubmit={onGenerate}
            className="studio-card p-5 space-y-4 h-fit"
          >
            <div className="flex justify-end">
              <DraftStatusIndicator status={draft.status} savedAt={draft.savedAt} online={draft.online} />
            </div>
            <StudioCurriculumSelector
              key={selectorKey}
              value={selectorSeed}
              onChange={setCurr}
            />
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

            <GenerateButton generating={status === 'generating'}>
              Generate Worksheet
            </GenerateButton>

            {usage && (
              <div className="text-xs theme-text-secondary text-center">
                {usage.used}/{usage.limit} worksheets used on the{' '}
                <span className="font-bold capitalize">{usage.plan}</span> plan this month
              </div>
            )}
          </form>

          {/* Output panel */}
          <StudioOutputBoundary onRetry={() => setStatus('idle')}>
          {handedOff && status === 'success' && worksheet ? (
          <section className="studio-card p-5 min-h-[400px]">
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="studio-display" style={{ fontSize: 22, margin: '0 0 2px' }}>
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
              emptyState={<EmptyState />}
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
        </div>
      </div>
    </div>
  )
}

/* ── States ─────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <StudioEmptyState emoji="🐢" tone="#d8ecd0" title="Ready to make a worksheet">
      Pick the grade, subject and topic on the left. You'll get a printable
      worksheet plus a separate answer key file for marking.
    </StudioEmptyState>
  )
}

