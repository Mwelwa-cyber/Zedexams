import { useState, useEffect } from 'react'
import {
  generateExamPaper,
  TEACHER_GRADES,
  TEACHER_LANGUAGES,
  defaultSubjectForGrade,
} from '../../../utils/teacherTools'
import { useCurriculumOptions } from '../../../hooks/useCurriculumOptions'
import { downloadQuizDocx } from '../../../utils/quizToDocx'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'
import MaxStudioBanner from './MaxStudioBanner'
import { paywall } from '../../../utils/paywall'
import { useAuth } from '../../../contexts/AuthContext'
import { useGenerationGate } from '../../../hooks/useGenerationGate'
import { useIsMounted } from '../../../hooks/useIsMounted'
import { attachLibraryToGeneration } from '../../../utils/teacherLibraryService'
import { LIBRARY_TYPES } from '../../../config/library'
import TopicSubtopicPicker from './TopicSubtopicPicker'
import AiGenerationProgress from '../../ui/AiGenerationProgress'
import { FieldTextarea, FieldSelect } from './studioFields'
import StudioOutputBoundary from '../StudioOutputBoundary'

/**
 * Exam Paper Generator ("Exam Studio") — fresh ECZ Grade 7 PSLE-style
 * single-best-answer multiple-choice questions with a teacher answer key.
 * Grounded on the verified curriculum module when grade+subject(+topic)
 * resolve one. A saved, exportable document like the other studios.
 *
 * A Max-only studio: Free/Pro get one taster a month, then the "Upgrade to
 * Max" paywall (server marks the quota error details.reason === 'max-only').
 */
export default function ExamPaperGenerator() {
  const urlDefaults = useFormDefaultsFromUrl()
  const [form, setForm] = useState(() => ({
    grade: 'G7',
    subject: 'mathematics',
    topic: '',
    subtopic: '',
    count: 40,
    optionCount: 4,
    difficulty: 'mixed',
    language: 'english',
    instructions: '',
    ...urlDefaults,
  }))
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const isMounted = useIsMounted()
  const [examPaper, setExamPaper] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')
  const [showAnswers, setShowAnswers] = useState(false)
  const { currentUser } = useAuth()
  const { ensureCanGenerate } = useGenerationGate(currentUser?.uid)

  const { subjectOptions, subjectValues } = useCurriculumOptions(form.grade)
  useEffect(() => {
    if (form.subject && !subjectValues.has(form.subject)) {
      setForm((f) => ({ ...f, subject: defaultSubjectForGrade(f.grade) }))
    }
  }, [form.grade, form.subject, subjectValues])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function onGenerate(e) {
    e.preventDefault()
    // Fail fast: if the teacher is out of quota (and has no top-up credit),
    // open the pay/upgrade prompt immediately instead of starting a doomed
    // generation. The server enforces the same gate; this just spares the
    // wasted round-trip and the misleading "Generating…" flash.
    if (!ensureCanGenerate('exam_paper')) return
    setStatus('generating')
    setErrorMessage('')
    setErrorDetail('')
    setWarning('')
    setExamPaper(null)
    const res = await generateExamPaper(form)
    if (!isMounted.current) return
    if (!res.ok) {
      // Out of the monthly taster on Free/Pro → open the "Upgrade to Max"
      // paywall instead of just showing the error text (the server marks
      // this with details.reason === 'max-only').
      if (res.details?.reason === 'max-only') {
        paywall.show('max-feature', { feature: 'Exam papers' })
        setStatus('idle')
        return
      }
      setStatus('error')
      setErrorMessage(res.error || 'Generation failed.')
      // Surface the diagnostic code/detail like the other studios do.
      setErrorDetail(
        [res.code && `code: ${res.code}`, res.rawMessage && `detail: ${res.rawMessage}`]
          .filter(Boolean).join(' · '),
      )
      return
    }
    setExamPaper(res.data.examPaper)
    setGenerationId(res.data.generationId)
    setUsage(res.data.usage)
    setWarning(res.data.warning || '')
    setStatus('success')
    if (res.data.generationId) {
      // Exam papers share the Assessments library section (no dedicated
      // exam type) — an exam paper is a kind of assessment.
      attachLibraryToGeneration(res.data.generationId, {
        libraryType: LIBRARY_TYPES.ASSESSMENTS,
        grade: form.grade,
        subject: form.subject,
        assessmentType: 'exam_paper',
      }).catch((err) => console.error('[library attach]', err))
    }
  }

  function onExport() {
    if (!examPaper) return
    const name = buildDownloadName({
      docType: 'Exam Paper',
      grade: form.grade,
      subject: form.subject,
      topic: examPaper.header?.topic || form.topic || 'paper',
    })
    // The exam-paper schema mirrors the quiz shape on purpose, so the quiz
    // exporter renders it unchanged (paper + teacher answer key).
    downloadQuizDocx(examPaper, name.endsWith('.docx') ? name : `${name}.docx`)
  }

  return (
    <div className="studio-page">
      <SeoHelmet title="Exam paper generator" noIndex />
      <div className="max-w-7xl mx-auto">
        <StudioPageHeader
          eyebrow="Exam Studio"
          title="Fresh exam questions from the curriculum"
          subtitle="ECZ-style multiple-choice items pitched at the grade — with a teacher answer key and one-line explanations."
          emoji="🎓"
        />
        <MaxStudioBanner feature="Exam Paper" templates={EXAM_PAPER_TEMPLATES} />
        <div className="grid grid-cols-1 gap-6">
          <form onSubmit={onGenerate}
            className="studio-card p-5 space-y-4 h-fit w-full max-w-2xl mx-auto">
            <FieldSelect label="Grade" value={form.grade}
              options={TEACHER_GRADES} onChange={(v) => set('grade', v)} />
            <FieldSelect label="Subject" value={form.subject}
              options={subjectOptions} onChange={(v) => set('subject', v)} />
            <TopicSubtopicPicker
              grade={form.grade}
              subject={form.subject}
              topic={form.topic}
              subtopic={form.subtopic}
              onChangeTopic={(v) => set('topic', v)}
              onChangeSubtopic={(v) => set('subtopic', v)}
            />
            <FieldSelect label="Number of questions" value={String(form.count)}
              options={[10, 20, 30, 40, 50, 60].map((n) => ({
                value: String(n), label: `${n} questions`,
              }))}
              onChange={(v) => set('count', Number(v))} />
            <FieldSelect label="Options per question"
              value={String(form.optionCount)}
              options={[3, 4, 5].map((n) => ({
                value: String(n), label: `${n} options (A–${LETTERS[n - 1]})`,
              }))}
              onChange={(v) => set('optionCount', Number(v))} />
            <FieldSelect label="Difficulty" value={form.difficulty}
              options={DIFFICULTY_OPTIONS}
              onChange={(v) => set('difficulty', v)} />
            <FieldSelect label="Language" value={form.language}
              options={TEACHER_LANGUAGES} onChange={(v) => set('language', v)} />
            <FieldTextarea label="Extra instructions (optional)"
              placeholder="e.g. Focus on word problems; include a few NOT questions."
              value={form.instructions}
              onChange={(v) => set('instructions', v)} maxLength={500} />
            <button type="submit" disabled={status === 'generating'}
              className="studio-btn-primary w-full py-3">
              {status === 'generating' ? 'Generating…' : '▶ Generate Exam Paper'}
            </button>
            {usage && (
              <div className="text-xs theme-text-secondary text-center">
                {usage.used}/{usage.limit} exam papers used on the{' '}
                <span className="font-bold capitalize">{usage.plan}</span>{' '}
                plan this month
              </div>
            )}
          </form>

          <StudioOutputBoundary onRetry={() => setStatus('idle')}>
          <section className="studio-card p-5 min-h-[400px]">
            {status === 'idle' && (
              <Centered emoji="🎓" title="Ready to build an exam paper"
                body="Pick the grade, subject and (ideally) a stored topic. You'll get numbered multiple-choice questions with a teacher answer key." />
            )}
            {status === 'generating' && (
              <AiGenerationProgress variant="card" preset="assessment" running title="Writing the exam paper…" />
            )}
            {status === 'error' && (
              <Centered emoji="⚠️" title="Something went wrong"
                body={errorDetail
                  ? <>{errorMessage}<br /><span style={{ opacity: 0.6, fontSize: 12 }}>{errorDetail}</span></>
                  : errorMessage}
                action={<button onClick={() => setStatus('idle')}
                  className="studio-btn-ghost">Try again</button>} />
            )}
            {status === 'success' && examPaper && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="studio-display"
                      style={{ fontSize: 22, margin: '0 0 2px' }}>
                      {examPaper.header?.title || 'Exam Paper'}
                    </h2>
                    <p className="text-xs" style={{ color: '#566f76' }}>
                      {(examPaper.questions || []).length} questions ·{' '}
                      {examPaper.header?.optionCount || form.optionCount} options each
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="flex items-center gap-2 text-sm px-3 py-2 rounded-xl cursor-pointer"
                      style={{ color: '#0e2a32', border: '1.5px solid #d9cfb8' }}>
                      <input type="checkbox" checked={showAnswers}
                        onChange={(e) => setShowAnswers(e.target.checked)}
                        style={{ accentColor: '#ff7a2e' }} />
                      Show answer key
                    </label>
                    <button onClick={onExport} className="studio-btn-primary">
                      📄 Export .docx
                    </button>
                  </div>
                </div>
                {warning && (
                  <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
                    ⚠️ {warning}
                  </div>
                )}
                <ExamPaperView paper={examPaper} showAnswers={showAnswers} />
                {generationId && (
                  <div className="mt-6 text-xs theme-text-secondary">
                    Saved to your Library as <code>{generationId}</code>.
                  </div>
                )}
              </>
            )}
          </section>
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

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

// Maps to the `difficulty` input the server prompt accepts (mixed | easy |
// medium | hard) — see functions/teacherTools/examPaperPrompt.js.
const DIFFICULTY_OPTIONS = [
  { value: 'mixed', label: 'Mixed (exam-style spread)' },
  { value: 'easy', label: 'Easy (weaker pupils)' },
  { value: 'medium', label: 'Medium (exam standard)' },
  { value: 'hard', label: 'Hard (application & reasoning)' },
]

// Sample template cards shown in the Max-studio banner to non-Max teachers.
// Illustrative only; clicking any card opens the Max paywall.
const EXAM_PAPER_TEMPLATES = [
  { tag: '40 questions', title: 'Mathematics Mock', meta: 'Grade 7 PSLE · MCQ + answer key' },
  { tag: '50 questions', title: 'Integrated Science', meta: 'Grade 7 · mixed difficulty' },
  { tag: '40 questions', title: 'Social Studies', meta: 'Grade 7 · Zambian context' },
]

function ExamPaperView({ paper, showAnswers }) {
  const h = paper.header || {}
  const questions = paper.questions || []
  return (
    <article className="space-y-4">
      <div className="rounded-xl border theme-border p-4 bg-slate-50/50 dark:bg-slate-900/20">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm theme-text">
          <div><span className="font-bold">Grade: </span>{h.grade}</div>
          <div><span className="font-bold">Subject: </span>{h.subject}</div>
          {h.topic && <div><span className="font-bold">Topic: </span>{h.topic}</div>}
          {h.subtopic && <div><span className="font-bold">Sub-topic: </span>{h.subtopic}</div>}
          <div><span className="font-bold">Questions: </span>{questions.length}</div>
        </div>
        {h.instructions && (
          <p className="mt-3 text-sm italic theme-text-secondary">{h.instructions}</p>
        )}
      </div>

      {questions.map((q) => (
        <div key={q.number} className="rounded-xl border theme-border p-3">
          <div className="flex items-start gap-2">
            <span className="font-black theme-text shrink-0">{q.number}.</span>
            <div className="flex-1">
              <p className="theme-text">{q.question}</p>
              {Array.isArray(q.options) && q.options.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {q.options.map((opt, i) => {
                    const isCorrect = showAnswers &&
                      String(opt).toLowerCase() === String(q.correctAnswer).toLowerCase()
                    return (
                      <li key={i}
                        className={`text-sm ${isCorrect ? 'text-emerald-700 dark:text-emerald-400 font-bold' : 'theme-text'}`}>
                        <span className="font-bold mr-2">{LETTERS[i] || '•'}.</span>{opt}
                        {isCorrect && <span className="ml-2">✓</span>}
                      </li>
                    )
                  })}
                </ul>
              )}
              {showAnswers && (
                <div className="mt-2 pt-2 border-t theme-border">
                  <p className="text-sm text-emerald-700 dark:text-emerald-400">
                    <span className="font-bold">✓ Answer: </span>{q.correctAnswer}
                  </p>
                  {q.explanation && (
                    <p className="text-xs theme-text-secondary italic mt-1">{q.explanation}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}

      {showAnswers && paper.answerKey?.notes && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h4 className="font-bold text-sm text-emerald-900 mb-1">Answer key notes</h4>
          <p className="text-sm text-emerald-800">{paper.answerKey.notes}</p>
        </div>
      )}
    </article>
  )
}
