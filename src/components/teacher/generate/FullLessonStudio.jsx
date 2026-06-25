import { useState, useEffect } from 'react'
import {
  generateFullLesson,
  TEACHER_GRADES,
  TEACHER_LANGUAGES,
  CURRICULUM_TERMS,
  TOTAL_LESSONS_OPTIONS,
  LESSON_NUMBER_OPTIONS,
  LEARNING_ENVIRONMENT_OPTIONS,
  DURATION_PRESETS,
  defaultSubjectForGrade,
} from '../../../utils/teacherTools'
import { useCurriculumOptions } from '../../../hooks/useCurriculumOptions'
import { downloadFullLessonDocx } from '../../../utils/fullLessonToDocx'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'
import { attachLibraryToGeneration } from '../../../utils/teacherLibraryService'
import { useAuth } from '../../../contexts/AuthContext'
import { useGenerationGate } from '../../../hooks/useGenerationGate'
import { useIsMounted } from '../../../hooks/useIsMounted'
import { LIBRARY_TYPES } from '../../../config/library'
import TopicSubtopicPicker from './TopicSubtopicPicker'
import AiGenerationProgress from '../../ui/AiGenerationProgress'
import { FieldTextarea, FieldSelect } from './studioFields'
import StudioOutputBoundary from '../StudioOutputBoundary'

/**
 * Full Lesson Studio — generates a complete, ready-to-deliver CBC lesson:
 * objectives, vocabulary, hook, teaching content, worked examples, guided +
 * independent practice, formative checks, summary, and homework.
 */
export default function FullLessonStudio() {
  const { currentUser } = useAuth()
  const { ensureCanGenerate } = useGenerationGate(currentUser?.uid)
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
    instructions: '',
    ...urlDefaults,
  }))
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const isMounted = useIsMounted()
  const [lesson, setLesson] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')
  const [showAnswers, setShowAnswers] = useState(false)

  const { subjectOptions, subjectValues } = useCurriculumOptions(form.grade)
  useEffect(() => {
    if (form.subject && !subjectValues.has(form.subject)) {
      setForm((f) => ({ ...f, subject: defaultSubjectForGrade(f.grade) }))
    }
  }, [form.grade, form.subject, subjectValues])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  function onExportDocx() {
    if (!lesson) return
    const filename = buildDownloadName({
      docType: 'Full Lesson',
      grade: lesson.header?.grade || form.grade,
      subject: lesson.header?.subject || form.subject,
      topic: lesson.header?.topic || form.topic,
    })
    downloadFullLessonDocx(lesson, filename)
  }

  async function onGenerate(e) {
    e.preventDefault()
    if (!form.topic.trim()) {
      setErrorMessage('Please enter a topic.')
      setStatus('error')
      return
    }
    if (!ensureCanGenerate('full_lesson')) return
    setStatus('generating')
    setErrorMessage('')
    setErrorDetail('')
    setWarning('')
    setLesson(null)

    const res = await generateFullLesson(form)
    if (!isMounted.current) return
    if (!res.ok) {
      setStatus('error')
      setErrorMessage(res.error || 'Generation failed.')
      setErrorDetail(
        [res.code && `code: ${res.code}`, res.rawMessage && `detail: ${res.rawMessage}`]
          .filter(Boolean).join(' · '),
      )
      return
    }
    setLesson(res.data.fullLesson)
    setGenerationId(res.data.generationId)
    setUsage(res.data.usage)
    setWarning(res.data.warning || '')
    setStatus('success')
    if (res.data.generationId) {
      attachLibraryToGeneration(res.data.generationId, {
        libraryType: LIBRARY_TYPES.LESSON_PLANS,
        grade: form.grade,
        subject: form.subject,
        assessmentType: 'full_lesson',
      }).catch((err) => console.error('[library attach]', err))
    }
  }

  return (
    <div className="min-h-screen py-4 sm:py-6 lg:py-8" style={{ background: '#f5efe1' }}>
      <SeoHelmet title="Full Lesson Studio" noIndex />
      <div className="max-w-7xl mx-auto">
        <StudioPageHeader
          eyebrow="Full Lesson Studio"
          title="One complete lesson, ready to deliver"
          subtitle="Objectives, vocabulary, hook, teaching content, worked examples, practice, checks, summary and homework — all grounded on the CBC."
          emoji="📖"
        />
        <div className="grid grid-cols-1 gap-6">
          <form
            onSubmit={onGenerate}
            className="studio-card p-5 space-y-4 h-fit w-full max-w-2xl mx-auto"
          >
            <FieldSelect
              label="Grade"
              value={form.grade}
              options={TEACHER_GRADES}
              onChange={(v) => set('grade', v)}
            />
            <FieldSelect
              label="Subject"
              value={form.subject}
              options={subjectOptions}
              onChange={(v) => set('subject', v)}
            />
            <TopicSubtopicPicker
              grade={form.grade}
              subject={form.subject}
              topic={form.topic}
              subtopic={form.subtopic}
              onChangeTopic={(v) => set('topic', v)}
              onChangeSubtopic={(v) => set('subtopic', v)}
            />
            <FieldSelect
              label="Term"
              value={form.term}
              options={CURRICULUM_TERMS}
              onChange={(v) => set('term', v)}
            />
            <FieldSelect
              label="Number of lessons for this sub-topic"
              value={form.totalLessons}
              options={TOTAL_LESSONS_OPTIONS}
              onChange={(v) => set('totalLessons', v)}
            />
            <FieldSelect
              label="Lesson number"
              value={form.lessonNumber}
              options={LESSON_NUMBER_OPTIONS}
              onChange={(v) => set('lessonNumber', v)}
            />
            <FieldSelect
              label="Lesson duration"
              value={String(form.durationMinutes)}
              options={DURATION_PRESETS.map((p) => ({ value: String(p.value), label: p.label }))}
              onChange={(v) => set('durationMinutes', Number(v))}
            />
            <FieldSelect
              label="Learning environment"
              value={form.learningEnvironment}
              options={LEARNING_ENVIRONMENT_OPTIONS}
              onChange={(v) => set('learningEnvironment', v)}
            />
            <FieldSelect
              label="Medium of instruction"
              value={form.language}
              options={TEACHER_LANGUAGES}
              onChange={(v) => set('language', v)}
            />
            <FieldTextarea
              label="Extra instructions (optional)"
              placeholder="e.g. Focus on real-life market examples. Keep vocabulary simple."
              value={form.instructions}
              onChange={(v) => set('instructions', v)}
              maxLength={500}
            />
            <button
              type="submit"
              disabled={status === 'generating'}
              className="studio-btn-primary w-full py-3"
            >
              {status === 'generating' ? 'Generating…' : '▶ Generate Full Lesson'}
            </button>
            {usage && (
              <div className="text-xs theme-text-secondary text-center">
                {usage.used}/{usage.limit} full lessons used on the{' '}
                <span className="font-bold capitalize">{usage.plan}</span> plan this month
              </div>
            )}
          </form>

          <StudioOutputBoundary onRetry={() => setStatus('idle')}>
            <section className="studio-card p-5 min-h-[400px]">
              {status === 'idle' && (
                <Centered
                  emoji="📖"
                  title="Ready to build your lesson"
                  body="Fill in the grade, subject and topic. For best results, pick a stored sub-topic and set the term and lesson number so the generator knows what was already covered."
                />
              )}
              {status === 'generating' && (
                <AiGenerationProgress
                  variant="card"
                  preset="lesson_plan"
                  running
                  title="Building your full lesson…"
                />
              )}
              {status === 'error' && (
                <Centered
                  emoji="⚠️"
                  title="Something went wrong"
                  body={
                    errorDetail
                      ? (
                        <>
                          {errorMessage}
                          <br />
                          <span style={{ opacity: 0.6, fontSize: 12 }}>{errorDetail}</span>
                        </>
                      )
                      : errorMessage
                  }
                  action={
                    <button onClick={() => setStatus('idle')} className="studio-btn-ghost">
                      Try again
                    </button>
                  }
                />
              )}
              {status === 'success' && lesson && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                    <div>
                      <h2
                        className="studio-display"
                        style={{ fontSize: 22, color: '#0e2a32', margin: '0 0 2px' }}
                      >
                        {lesson.header?.title || 'Full Lesson'}
                      </h2>
                      <p className="text-xs" style={{ color: '#566f76' }}>
                        {lesson.header?.grade} · {lesson.header?.subject} ·{' '}
                        {lesson.header?.durationMinutes} min
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
                  <FullLessonView lesson={lesson} showAnswers={showAnswers} />
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
      <h3 className="studio-display" style={{ fontSize: 20, color: '#0e2a32' }}>{title}</h3>
      <p className="text-sm max-w-md mt-1" style={{ color: '#566f76' }}>{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="space-y-2">
      <h3
        className="text-xs font-black uppercase tracking-widest"
        style={{ color: '#ff7a2e' }}
      >
        {title}
      </h3>
      {children}
    </div>
  )
}

function BulletList({ items }) {
  if (!items?.length) return null
  return (
    <ul className="list-disc pl-5 space-y-1 text-sm theme-text">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  )
}

function FullLessonView({ lesson, showAnswers }) {
  const h = lesson.header || {}
  return (
    <article className="space-y-6 text-sm theme-text">
      {/* Header */}
      <div className="rounded-xl border theme-border p-4 bg-slate-50/50 dark:bg-slate-900/20">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div><span className="font-bold">Grade: </span>{h.grade}</div>
          <div><span className="font-bold">Subject: </span>{h.subject}</div>
          <div><span className="font-bold">Topic: </span>{h.topic}</div>
          {h.subtopic && <div><span className="font-bold">Sub-topic: </span>{h.subtopic}</div>}
          {h.term && <div><span className="font-bold">Term: </span>{h.term}</div>}
          <div><span className="font-bold">Duration: </span>{h.durationMinutes} min</div>
          <div><span className="font-bold">Language: </span>{h.language}</div>
        </div>
      </div>

      {/* Objectives */}
      {lesson.objectives?.length > 0 && (
        <Section title="Learning Objectives">
          <BulletList items={lesson.objectives} />
        </Section>
      )}

      {/* Key Vocabulary */}
      {lesson.keyVocabulary?.length > 0 && (
        <Section title="Key Vocabulary">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {lesson.keyVocabulary.map((v, i) => (
              <div key={i}>
                <dt className="font-bold inline">{v.term}: </dt>
                <dd className="inline theme-text-secondary">{v.definition}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {/* Introduction */}
      {(lesson.introduction?.hook || lesson.introduction?.priorKnowledge) && (
        <Section title="Introduction">
          {lesson.introduction.hook && (
            <div>
              <p className="font-semibold mb-1">Hook / Engagement</p>
              <p className="theme-text-secondary">{lesson.introduction.hook}</p>
            </div>
          )}
          {lesson.introduction.priorKnowledge && (
            <div className="mt-3">
              <p className="font-semibold mb-1">Prior Knowledge Check</p>
              <p className="theme-text-secondary">{lesson.introduction.priorKnowledge}</p>
            </div>
          )}
        </Section>
      )}

      {/* Teaching Content */}
      {lesson.teaching?.length > 0 && (
        <Section title="Teaching Content">
          <div className="space-y-4">
            {lesson.teaching.map((block, i) => (
              <div key={i}>
                <p className="font-semibold">{block.heading}</p>
                <p className="theme-text-secondary mt-1">{block.explanation}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Worked Examples */}
      {lesson.workedExamples?.length > 0 && (
        <Section title="Worked Examples">
          <div className="space-y-4">
            {lesson.workedExamples.map((ex, i) => (
              <div
                key={i}
                className="rounded-xl border theme-border p-4"
                style={{ background: '#fffbf5' }}
              >
                <p className="font-semibold mb-2">Example {i + 1}: {ex.problem}</p>
                {ex.steps?.length > 0 && (
                  <ol className="list-decimal pl-5 space-y-1 theme-text-secondary">
                    {ex.steps.map((step, j) => <li key={j}>{step}</li>)}
                  </ol>
                )}
                {ex.answer && (
                  <p className="mt-2 font-bold" style={{ color: '#16a34a' }}>
                    Answer: {ex.answer}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Guided Practice */}
      {lesson.guidedPractice?.length > 0 && (
        <Section title="Guided Practice">
          <BulletList items={lesson.guidedPractice} />
        </Section>
      )}

      {/* Learner Activities */}
      {lesson.learnerActivities?.length > 0 && (
        <Section title="Learner Activities">
          <BulletList items={lesson.learnerActivities} />
        </Section>
      )}

      {/* Formative Assessment */}
      {lesson.assessment?.checks?.length > 0 && (
        <Section title="Formative Assessment Checks">
          <ol className="list-decimal pl-5 space-y-3">
            {lesson.assessment.checks.map((check, i) => (
              <li key={i}>
                <p>{check}</p>
                {showAnswers && lesson.assessment.answers?.[i] && (
                  <p className="mt-1 pt-1 border-t theme-border text-emerald-700 dark:text-emerald-400">
                    <span className="font-bold">Answer: </span>
                    {lesson.assessment.answers[i]}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* Summary */}
      {lesson.summary && (
        <Section title="Lesson Summary">
          <p className="theme-text-secondary">{lesson.summary}</p>
        </Section>
      )}

      {/* Homework */}
      {lesson.homework?.task && (
        <div
          className="rounded-xl border border-sky-200 p-4"
          style={{ background: '#f0f9ff' }}
        >
          <h3
            className="text-xs font-black uppercase tracking-widest mb-2"
            style={{ color: '#0369a1' }}
          >
            Homework
          </h3>
          <p>{lesson.homework.task}</p>
          {showAnswers && lesson.homework.answerGuide && (
            <div className="mt-3 pt-3 border-t border-sky-200">
              <p className="font-semibold text-emerald-700 mb-1">Answer guide</p>
              <p className="theme-text-secondary">{lesson.homework.answerGuide}</p>
            </div>
          )}
        </div>
      )}

      {/* References */}
      {lesson.references?.length > 0 && (
        <Section title="References">
          <BulletList items={lesson.references} />
        </Section>
      )}
    </article>
  )
}
