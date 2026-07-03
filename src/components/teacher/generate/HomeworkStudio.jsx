import { useState } from 'react'
import {
  generateHomework,
  TEACHER_LANGUAGES,
  CURRICULUM_TERMS,
  TOTAL_LESSONS_OPTIONS,
  LESSON_NUMBER_OPTIONS,
  LEARNING_ENVIRONMENT_OPTIONS,
} from '../../../utils/teacherTools'
import { downloadHomeworkDocx } from '../../../utils/homeworkToDocx'
import { downloadHomeworkPdf } from '../../../utils/homeworkToPdf'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'
import { attachLibraryToGeneration, isFreePlanTeacher } from '../../../utils/teacherLibraryService'
import { captureQuestionsToBank } from '../../../utils/questionBankService'
import { homeworkQuestionToBank } from '../../../utils/questionBankCore'
import { useAuth } from '../../../contexts/AuthContext'
import { useGenerationGate } from '../../../hooks/useGenerationGate'
import { useIsMounted } from '../../../hooks/useIsMounted'
import { LIBRARY_TYPES } from '../../../config/library'
import LiveGenerationCanvas from '../../ui/LiveGenerationCanvas'
import { FieldTextarea, FieldSelect } from './studioFields'
import StudioCurriculumSelector from '../curriculum/StudioCurriculumSelector'
import StudioOutputBoundary from '../StudioOutputBoundary'
import HomeworkView from '../views/HomeworkView'
import { curriculumSeedFromProfile, preferredDifficulty, preferredTermYear } from '../../../utils/teacherDefaults'

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
  // Read once on mount by the selector — never re-seeds reactively.
  const [selectorSeed] = useState(() =>
    urlDefaults && (urlDefaults.grade || urlDefaults.subject || urlDefaults.topic)
      ? urlDefaults
      : curriculumSeedFromProfile(userProfile),
  )
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
    }
  }

  async function regenerateSection(sectionId) {
    const res = await generateHomework(buildPayload())
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
    setHandedOff(false)
    setStatus('generating')
    setErrorMessage('')
    setWarning('')
    setHomework(null)
    // Teacher Settings → My AI → homework difficulty rides along inside
    // buildPayload() as an extra instruction line (server caps at 500 chars).
    const res = await generateHomework(buildPayload())
    if (!isMounted.current) return
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
    if (res.data.generationId) {
      attachLibraryToGeneration(res.data.generationId, {
        libraryType: LIBRARY_TYPES.ASSESSMENTS,
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
    <div className="studio-page">
      <SeoHelmet title="Homework studio" noIndex />
      <div className="max-w-7xl mx-auto">
        <StudioPageHeader
          eyebrow="Homework Studio"
          title="Short take-home practice"
          subtitle="Grounded on the verified curriculum module — questions, answer key and a note for parents."
          emoji="🏠"
        />
        <div className="grid grid-cols-1 gap-6">
          <form onSubmit={onGenerate}
            className="studio-card p-5 space-y-4 h-fit w-full max-w-2xl mx-auto">
            <StudioCurriculumSelector
              value={selectorSeed}
              onChange={setCurr}
            />
            <FieldSelect label="Term" value={form.term}
              options={CURRICULUM_TERMS} onChange={(v) => set('term', v)} />
            <FieldSelect label="Number of lessons for this sub-topic"
              value={form.totalLessons} options={TOTAL_LESSONS_OPTIONS}
              onChange={(v) => set('totalLessons', v)} />
            <FieldSelect label="Lesson number" value={form.lessonNumber}
              options={LESSON_NUMBER_OPTIONS}
              onChange={(v) => set('lessonNumber', v)} />
            <FieldSelect label="Learning environment"
              value={form.learningEnvironment}
              options={LEARNING_ENVIRONMENT_OPTIONS}
              onChange={(v) => set('learningEnvironment', v)} />
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
            <FieldSelect label="Language" value={form.language}
              options={TEACHER_LANGUAGES} onChange={(v) => set('language', v)} />
            <FieldTextarea label="Extra instructions (optional)"
              placeholder="e.g. One word problem about the market."
              value={form.instructions}
              onChange={(v) => set('instructions', v)} maxLength={500} />
            <button type="submit" disabled={status === 'generating'}
              className="studio-btn-primary w-full py-3">
              {status === 'generating' ? 'Generating…' : '▶ Generate Homework'}
            </button>
            {usage && (
              <div className="text-xs theme-text-secondary text-center">
                {usage.used}/{usage.limit} homeworks used on the{' '}
                <span className="font-bold capitalize">{usage.plan}</span>{' '}
                plan this month
              </div>
            )}
          </form>

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
                    <p className="text-xs" style={{ color: '#566f76' }}>
                      ~{homework.header?.estimatedMinutes} min · review, export, print.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="flex items-center gap-2 text-sm px-3 py-2 rounded-xl cursor-pointer"
                      style={{ color: '#0e2a32', border: '1.5px solid #d9cfb8' }}>
                      <input type="checkbox" checked={showAnswers}
                        onChange={(e) => setShowAnswers(e.target.checked)}
                        style={{ accentColor: '#ff7a2e' }} />
                      Show answers
                    </label>
                    <button onClick={() => onExport(false)} className="studio-btn-ghost">
                      📄 Pupil sheet .docx
                    </button>
                    <button onClick={() => onExportPdf(false)} className="studio-btn-ghost">
                      📄 Pupil sheet .pdf
                    </button>
                    <button onClick={() => onExport(true)} className="studio-btn-primary">
                      🔑 With answer key .docx
                    </button>
                    <button onClick={() => onExportPdf(true)} className="studio-btn-ghost">
                      🔑 With answer key .pdf
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
              emptyState={
                <Centered emoji="🏠" title="Ready to set homework"
                  body="Pick the grade, subject and (ideally) a stored sub-topic. You'll get questions, an answer key and a parent note." />
              }
              errorMessage={errorMessage}
              savedToLibrary={Boolean(generationId)}
              onStop={() => setStatus('idle')}
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

function Centered({ emoji, title, body, action }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div className="text-5xl mb-3">{emoji}</div>
      <h3 className="studio-display" style={{ fontSize: 20 }}>{title}</h3>
      <p className="text-sm max-w-md mt-1" style={{ color: '#566f76' }}>{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

