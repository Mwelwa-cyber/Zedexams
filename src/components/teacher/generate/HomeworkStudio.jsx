import { useState, useMemo, useEffect } from 'react'
import {
  generateHomework,
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
import { downloadHomeworkDocx } from '../../../utils/homeworkToDocx'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'
import { attachLibraryToGeneration } from '../../../utils/teacherLibraryService'
import { LIBRARY_TYPES } from '../../../config/library'
import TopicSubtopicPicker from './TopicSubtopicPicker'

/**
 * Homework Studio — short take-home practice grounded on the stored
 * curriculum module. Usually launched from the Curriculum Studio with
 * everything pre-filled; also usable standalone.
 */
export default function HomeworkStudio() {
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
    count: 6,
    estimatedMinutes: 20,
    language: 'english',
    instructions: '',
    ...urlDefaults,
  }))
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [homework, setHomework] = useState(null)
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
    setHomework(null)
    const res = await generateHomework(form)
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
        grade: form.grade,
        subject: form.subject,
        assessmentType: 'homework',
      }).catch(() => {})
    }
  }

  function onExport() {
    if (!homework) return
    const slug = (s) => String(s || '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    const name = [
      slug(form.grade), slug(form.subject),
      slug(homework.header?.topic || form.topic), 'homework',
      new Date().toISOString().slice(0, 10),
    ].filter(Boolean).join('_')
    downloadHomeworkDocx(homework, `${name}.docx`)
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8" style={{ background: '#f5efe1' }}>
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

          <section className="studio-card p-5 min-h-[400px]">
            {status === 'idle' && (
              <Centered emoji="🏠" title="Ready to set homework"
                body="Pick the grade, subject and (ideally) a stored sub-topic. You'll get questions, an answer key and a parent note." />
            )}
            {status === 'generating' && (
              <Centered emoji="✍️" title="Setting homework…"
                body="About half a minute." />
            )}
            {status === 'error' && (
              <Centered emoji="⚠️" title="Something went wrong"
                body={errorMessage}
                action={<button onClick={() => setStatus('idle')}
                  className="studio-btn-ghost">Try again</button>} />
            )}
            {status === 'success' && homework && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="studio-display"
                      style={{ fontSize: 22, color: '#0e2a32', margin: '0 0 2px' }}>
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
                <HomeworkView hw={homework} showAnswers={showAnswers} />
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

function HomeworkView({ hw, showAnswers }) {
  const h = hw.header || {}
  return (
    <article className="space-y-4">
      <div className="rounded-xl border theme-border p-4 bg-slate-50/50 dark:bg-slate-900/20">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm theme-text">
          <div><span className="font-bold">Grade: </span>{h.grade}</div>
          <div><span className="font-bold">Subject: </span>{h.subject}</div>
          <div><span className="font-bold">Topic: </span>{h.topic}</div>
          {h.subtopic && <div><span className="font-bold">Sub-topic: </span>{h.subtopic}</div>}
        </div>
        {hw.instructions && (
          <p className="mt-3 text-sm italic theme-text-secondary">{hw.instructions}</p>
        )}
      </div>
      <ol className="list-decimal pl-5 space-y-3 text-sm theme-text">
        {(hw.questions || []).map((q) => (
          <li key={q.number}>
            <p>{q.prompt}</p>
            {showAnswers && (
              <div className="mt-1 pt-1 border-t theme-border">
                <p className="text-emerald-700 dark:text-emerald-400">
                  <span className="font-bold">Answer: </span>{q.answer}
                </p>
                {q.workingNotes && (
                  <p className="text-xs theme-text-secondary italic mt-0.5">
                    {q.workingNotes}
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      {hw.parentNote && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
          <h4 className="font-bold text-sm text-sky-900 mb-1">Note for parent / guardian</h4>
          <p className="text-sm text-sky-800">{hw.parentNote}</p>
        </div>
      )}
      {showAnswers && hw.answerKey?.markingNotes && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h4 className="font-bold text-sm text-emerald-900 mb-1">Marking guidance</h4>
          <p className="text-sm text-emerald-800">{hw.answerKey.markingNotes}</p>
        </div>
      )}
    </article>
  )
}
