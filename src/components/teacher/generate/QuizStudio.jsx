import { useState, useMemo, useEffect } from 'react'
import {
  generateQuiz,
  TEACHER_GRADES,
  TEACHER_LANGUAGES,
  CURRICULUM_TERMS,
  TOTAL_LESSONS_OPTIONS,
  LESSON_NUMBER_OPTIONS,
  LEARNING_ENVIRONMENT_OPTIONS,
  getSubjectsForGrade,
  isSubjectValidForGrade,
  defaultSubjectForGrade,
} from '../../../utils/teacherTools'
import { downloadQuizDocx } from '../../../utils/quizToDocx'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'
import { attachLibraryToGeneration } from '../../../utils/teacherLibraryService'
import { LIBRARY_TYPES } from '../../../config/library'

/**
 * Quiz Studio — a short formative quiz grounded on the stored curriculum
 * module. Usually launched from the Curriculum Studio with everything
 * pre-filled; also usable standalone. Distinct from the quiz-editor.
 */
export default function QuizStudio() {
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
    count: 10,
    durationMinutes: 15,
    language: 'english',
    instructions: '',
    ...urlDefaults,
  }))
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [quiz, setQuiz] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')
  const [showAnswers, setShowAnswers] = useState(false)

  const subjectOptions = useMemo(
    () => getSubjectsForGrade(form.grade), [form.grade],
  )
  useEffect(() => {
    if (!isSubjectValidForGrade(form.subject, form.grade)) {
      setForm((f) => ({ ...f, subject: defaultSubjectForGrade(f.grade) }))
    }
  }, [form.grade, form.subject])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function onGenerate(e) {
    e.preventDefault()
    if (!form.topic.trim()) {
      setErrorMessage('Please enter a topic.')
      setStatus('error')
      return
    }
    setStatus('generating')
    setErrorMessage('')
    setWarning('')
    setQuiz(null)
    const res = await generateQuiz(form)
    if (!res.ok) {
      setStatus('error')
      setErrorMessage(res.error || 'Generation failed.')
      return
    }
    setQuiz(res.data.quiz)
    setGenerationId(res.data.generationId)
    setUsage(res.data.usage)
    setWarning(res.data.warning || '')
    setStatus('success')
    if (res.data.generationId) {
      attachLibraryToGeneration(res.data.generationId, {
        libraryType: LIBRARY_TYPES.ASSESSMENTS,
        grade: form.grade,
        subject: form.subject,
        assessmentType: 'quiz',
      }).catch(() => {})
    }
  }

  function onExport() {
    if (!quiz) return
    const slug = (s) => String(s || '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    const name = [
      slug(form.grade), slug(form.subject),
      slug(quiz.header?.topic || form.topic), 'quiz',
      new Date().toISOString().slice(0, 10),
    ].filter(Boolean).join('_')
    downloadQuizDocx(quiz, `${name}.docx`)
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8" style={{ background: '#f5efe1' }}>
      <SeoHelmet title="Quiz studio" noIndex />
      <div className="max-w-7xl mx-auto">
        <StudioPageHeader
          eyebrow="Quiz Studio"
          title="A quick formative quiz"
          subtitle="Grounded on the verified curriculum module — mostly multiple-choice, with an answer key."
          emoji="❓"
        />
        <div className="grid grid-cols-1 gap-6">
          <form onSubmit={onGenerate}
            className="studio-card p-5 space-y-4 h-fit w-full max-w-2xl mx-auto">
            <FieldSelect label="Grade" value={form.grade}
              options={TEACHER_GRADES} onChange={(v) => set('grade', v)} />
            <FieldSelect label="Subject" value={form.subject}
              options={subjectOptions} onChange={(v) => set('subject', v)} />
            <FieldText label="Topic *" placeholder="e.g. Fractions"
              value={form.topic} onChange={(v) => set('topic', v)} maxLength={120} />
            <FieldText label="Sub-topic (optional)"
              placeholder="e.g. Adding Fractions"
              value={form.subtopic} onChange={(v) => set('subtopic', v)} maxLength={160} />
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
              options={[5, 8, 10, 12, 15, 20].map((n) => ({
                value: String(n), label: `${n} questions`,
              }))}
              onChange={(v) => set('count', Number(v))} />
            <FieldSelect label="Time (estimate)"
              value={String(form.durationMinutes)}
              options={[10, 15, 20, 30, 45].map((m) => ({
                value: String(m), label: `${m} min`,
              }))}
              onChange={(v) => set('durationMinutes', Number(v))} />
            <FieldSelect label="Language" value={form.language}
              options={TEACHER_LANGUAGES} onChange={(v) => set('language', v)} />
            <FieldTextarea label="Extra instructions (optional)"
              placeholder="e.g. Focus on word problems."
              value={form.instructions}
              onChange={(v) => set('instructions', v)} maxLength={500} />
            <button type="submit" disabled={status === 'generating'}
              className="studio-btn-primary w-full py-3">
              {status === 'generating' ? 'Generating…' : '▶ Generate Quiz'}
            </button>
            {usage && (
              <div className="text-xs theme-text-secondary text-center">
                {usage.used}/{usage.limit} quizzes used on the{' '}
                <span className="font-bold capitalize">{usage.plan}</span>{' '}
                plan this month
              </div>
            )}
          </form>

          <section className="studio-card p-5 min-h-[400px]">
            {status === 'idle' && (
              <Centered emoji="❓" title="Ready to make a quiz"
                body="Pick the grade, subject and (ideally) a stored sub-topic. You'll get a short quiz with an answer key." />
            )}
            {status === 'generating' && (
              <Centered emoji="✍️" title="Writing the quiz…" body="About half a minute." />
            )}
            {status === 'error' && (
              <Centered emoji="⚠️" title="Something went wrong"
                body={errorMessage}
                action={<button onClick={() => setStatus('idle')}
                  className="studio-btn-ghost">Try again</button>} />
            )}
            {status === 'success' && quiz && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="studio-display"
                      style={{ fontSize: 22, color: '#0e2a32', margin: '0 0 2px' }}>
                      {quiz.header?.title || 'Quiz'}
                    </h2>
                    <p className="text-xs" style={{ color: '#566f76' }}>
                      {(quiz.questions || []).length} questions ·{' '}
                      {quiz.header?.durationMinutes} min
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
                <QuizView quiz={quiz} showAnswers={showAnswers} />
                {generationId && (
                  <div className="mt-6 text-xs theme-text-secondary">
                    Saved to your Library as <code>{generationId}</code>.
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

function FieldLabel({ children }) {
  return <label className="studio-label">{children}</label>
}
function FieldText({ label, value, onChange, placeholder, maxLength }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input type="text" value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} maxLength={maxLength}
        className="studio-input" />
    </div>
  )
}
function FieldTextarea({ label, value, onChange, placeholder, maxLength }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <textarea value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} maxLength={maxLength} rows={3}
        className="studio-input resize-none" />
    </div>
  )
}
function FieldSelect({ label, value, options, onChange }) {
  const groups = []
  let cur = null
  for (const o of options) {
    if (o.group !== undefined) {
      if (cur) groups.push(cur)
      cur = { label: o.group, items: [] }
    } else {
      if (!cur) cur = { label: null, items: [] }
      cur.items.push(o)
    }
  }
  if (cur) groups.push(cur)
  const flat = groups.length === 1 && !groups[0].label
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="studio-input">
        {flat
          ? groups[0].items.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))
          : groups.map((g, i) => (g.label
            ? <optgroup key={i} label={g.label}>
              {g.items.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
            : g.items.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))
          ))}
      </select>
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

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

function QuizView({ quiz, showAnswers }) {
  const h = quiz.header || {}
  return (
    <article className="space-y-4">
      <div className="rounded-xl border theme-border p-4 bg-slate-50/50 dark:bg-slate-900/20">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm theme-text">
          <div><span className="font-bold">Grade: </span>{h.grade}</div>
          <div><span className="font-bold">Subject: </span>{h.subject}</div>
          <div><span className="font-bold">Topic: </span>{h.topic}</div>
          {h.subtopic && <div><span className="font-bold">Sub-topic: </span>{h.subtopic}</div>}
        </div>
        {h.instructions && (
          <p className="mt-3 text-sm italic theme-text-secondary">{h.instructions}</p>
        )}
      </div>
      {(quiz.questions || []).map((q) => (
        <div key={q.number} className="rounded-xl border theme-border p-3">
          <div className="flex items-start gap-2">
            <span className="font-black theme-text shrink-0">{q.number}.</span>
            <div className="flex-1">
              <p className="theme-text">{q.question}</p>
              {q.options?.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {q.options.map((opt, i) => {
                    const correct = showAnswers && q.correctAnswer &&
                      opt.trim() === String(q.correctAnswer).trim()
                    return (
                      <li key={i}
                        className={`text-sm ${correct ?
                          'text-emerald-700 dark:text-emerald-400 font-bold' :
                          'theme-text'}`}>
                        <span className="font-bold mr-2">{LETTERS[i] || '•'}.</span>
                        {opt}{correct ? '  ✓' : ''}
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
                    <p className="text-xs theme-text-secondary italic mt-1">
                      {q.explanation}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
      {showAnswers && quiz.answerKey?.notes && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h4 className="font-bold text-sm text-emerald-900 mb-1">Marking notes</h4>
          <p className="text-sm text-emerald-800">{quiz.answerKey.notes}</p>
        </div>
      )}
    </article>
  )
}
