import { useState, useMemo, useEffect } from 'react'
import {
  generateExamPaper,
  TEACHER_GRADES,
  getSubjectsForGrade,
  isSubjectValidForGrade,
  defaultSubjectForGrade,
} from '../../../utils/teacherTools'
import {
  getTopicsForTeacherSubject,
  getSubtopicsForTeacherSubject,
} from '../../../config/curriculum'
import { downloadQuizDocx } from '../../../utils/quizToDocx'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'
import { attachLibraryToGeneration } from '../../../utils/teacherLibraryService'
import { LIBRARY_TYPES } from '../../../config/library'

/**
 * Exam Studio — generates fresh practice questions in the authentic ECZ
 * Grade 7 PSLE style (modelled on real past papers). The teacher drives it
 * with cascading syllabus dropdowns: pick a grade → subjects appear → pick a
 * subject → topics and sub-topics appear to choose from. Topic catalogues
 * come from src/config/curriculum.js via the teacher-subject bridge; subjects
 * without catalogue data degrade to a free-text topic field so every subject
 * still works.
 */
export default function ExamStudio() {
  const urlDefaults = useFormDefaultsFromUrl()
  const [form, setForm] = useState(() => ({
    grade: 'G7',
    subject: 'creative_and_technology_studies',
    topic: '',
    subtopic: '',
    count: 40,
    optionCount: 4,
    difficulty: 'mixed',
    instructions: '',
    ...urlDefaults,
  }))
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [paper, setPaper] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')
  const [showAnswers, setShowAnswers] = useState(false)

  const subjectOptions = useMemo(
    () => getSubjectsForGrade(form.grade), [form.grade],
  )
  useEffect(() => {
    if (!isSubjectValidForGrade(form.subject, form.grade)) {
      setForm((f) => ({ ...f, subject: defaultSubjectForGrade(f.grade), topic: '', subtopic: '' }))
    }
  }, [form.grade, form.subject])

  // Cascading syllabus dropdowns sourced from the curriculum catalogue.
  const topicOptions = useMemo(
    () => getTopicsForTeacherSubject(form.subject, form.grade),
    [form.subject, form.grade],
  )
  const subtopicOptions = useMemo(
    () => getSubtopicsForTeacherSubject(form.subject, form.grade, form.topic),
    [form.subject, form.grade, form.topic],
  )

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  function onChangeGrade(v) {
    setForm((f) => ({ ...f, grade: v, topic: '', subtopic: '' }))
  }
  function onChangeSubject(v) {
    setForm((f) => ({ ...f, subject: v, topic: '', subtopic: '' }))
  }
  function onChangeTopic(v) {
    setForm((f) => ({ ...f, topic: v, subtopic: '' }))
  }

  async function onGenerate(e) {
    e.preventDefault()
    setStatus('generating')
    setErrorMessage('')
    setWarning('')
    setPaper(null)
    const res = await generateExamPaper(form)
    if (!res.ok) {
      setStatus('error')
      setErrorMessage(res.error || 'Generation failed.')
      return
    }
    setPaper(res.data.examPaper)
    setGenerationId(res.data.generationId)
    setUsage(res.data.usage)
    setWarning(res.data.warning || '')
    setStatus('success')
    if (res.data.generationId) {
      attachLibraryToGeneration(res.data.generationId, {
        libraryType: LIBRARY_TYPES.ASSESSMENTS,
        grade: form.grade,
        subject: form.subject,
        assessmentType: 'exam',
      }).catch(() => {})
    }
  }

  function onExport() {
    if (!paper) return
    const slug = (s) => String(s || '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    const name = [
      slug(form.grade), slug(form.subject),
      slug(paper.header?.topic || form.topic || 'mock'), 'exam',
      new Date().toISOString().slice(0, 10),
    ].filter(Boolean).join('_')
    // The exam paper shares the quiz document shape, so the quiz exporter
    // renders it (questions + teacher answer key) unchanged.
    downloadQuizDocx(paper, `${name}.docx`)
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8" style={{ background: '#f5efe1' }}>
      <SeoHelmet title="Exam studio" noIndex />
      <div className="max-w-7xl mx-auto">
        <StudioPageHeader
          eyebrow="Exam Studio"
          title="ECZ-style practice questions"
          subtitle="Fresh multiple-choice questions written in the voice of the Grade 7 examination — pick a grade, subject, and topic, and get a ready answer key."
          emoji="📝"
        />
        <div className="grid grid-cols-1 gap-6">
          <form onSubmit={onGenerate}
            className="studio-card p-5 space-y-4 h-fit w-full max-w-2xl mx-auto">
            <FieldSelect label="Grade" value={form.grade}
              options={TEACHER_GRADES} onChange={onChangeGrade} />
            <FieldSelect label="Subject" value={form.subject}
              options={subjectOptions} onChange={onChangeSubject} />

            {topicOptions.length > 0 ? (
              <FieldSelect label="Topic"
                value={form.topic}
                options={[
                  { value: '', label: 'All topics (full mock paper)' },
                  ...topicOptions.map((t) => ({ value: t, label: t })),
                ]}
                onChange={onChangeTopic} />
            ) : (
              <FieldText label="Topic (optional)"
                placeholder="Leave blank for a full mock paper across the subject"
                value={form.topic}
                onChange={onChangeTopic} maxLength={120} />
            )}

            {form.topic && subtopicOptions.length > 0 && (
              <FieldSelect label="Sub-topic (optional)"
                value={form.subtopic}
                options={[
                  { value: '', label: 'Whole topic' },
                  ...subtopicOptions.map((s) => ({ value: s, label: s })),
                ]}
                onChange={(v) => set('subtopic', v)} />
            )}

            <FieldSelect label="Number of questions"
              value={String(form.count)}
              options={[10, 20, 30, 40, 50, 60].map((n) => ({
                value: String(n), label: `${n} questions`,
              }))}
              onChange={(v) => set('count', Number(v))} />
            <FieldSelect label="Options per question"
              value={String(form.optionCount)}
              options={[3, 4, 5].map((n) => ({
                value: String(n), label: `${n} options (A–${'ABCDE'[n - 1]})`,
              }))}
              onChange={(v) => set('optionCount', Number(v))} />
            <FieldSelect label="Difficulty"
              value={form.difficulty}
              options={[
                { value: 'mixed', label: 'Mixed — like a real paper' },
                { value: 'easy', label: 'Easy' },
                { value: 'medium', label: 'Medium' },
                { value: 'hard', label: 'Hard' },
              ]}
              onChange={(v) => set('difficulty', v)} />
            <FieldTextarea label="Extra instructions (optional)"
              placeholder="e.g. Include a few scenario questions about markets and money."
              value={form.instructions}
              onChange={(v) => set('instructions', v)} maxLength={500} />
            <button type="submit" disabled={status === 'generating'}
              className="studio-btn-primary w-full py-3">
              {status === 'generating' ? 'Generating…' : '▶ Generate Questions'}
            </button>
            {usage && (
              <div className="text-xs theme-text-secondary text-center">
                {usage.used}/{usage.limit} exam papers used on the{' '}
                <span className="font-bold capitalize">{usage.plan}</span>{' '}
                plan this month
              </div>
            )}
          </form>

          <section className="studio-card p-5 min-h-[400px]">
            {status === 'idle' && (
              <Centered emoji="📝" title="Ready to write exam questions"
                body="Pick a grade, subject and topic. You'll get fresh ECZ-style multiple-choice questions with a teacher answer key." />
            )}
            {status === 'generating' && (
              <Centered emoji="✍️" title="Writing the questions…"
                body="A full paper can take up to two minutes." />
            )}
            {status === 'error' && (
              <Centered emoji="⚠️" title="Something went wrong"
                body={errorMessage}
                action={<button onClick={() => setStatus('idle')}
                  className="studio-btn-ghost">Try again</button>} />
            )}
            {status === 'success' && paper && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="studio-display"
                      style={{ fontSize: 22, color: '#0e2a32', margin: '0 0 2px' }}>
                      {paper.header?.title || 'Exam questions'}
                    </h2>
                    <p className="text-xs" style={{ color: '#566f76' }}>
                      {(paper.questions || []).length} questions ·{' '}
                      {paper.header?.optionCount || form.optionCount} options each
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
                <PaperView paper={paper} showAnswers={showAnswers} />
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
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} maxLength={maxLength}
        className="studio-input" autoComplete="off" />
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

function PaperView({ paper, showAnswers }) {
  const h = paper.header || {}
  return (
    <article className="space-y-4">
      <div className="rounded-xl border theme-border p-4 bg-slate-50/50 dark:bg-slate-900/20">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm theme-text">
          <div><span className="font-bold">Grade: </span>{h.grade}</div>
          <div><span className="font-bold">Subject: </span>{h.subject}</div>
          {h.topic && <div><span className="font-bold">Topic: </span>{h.topic}</div>}
          {h.subtopic && <div><span className="font-bold">Sub-topic: </span>{h.subtopic}</div>}
        </div>
        {h.instructions && (
          <p className="mt-3 text-sm italic theme-text-secondary">{h.instructions}</p>
        )}
      </div>
      {(paper.questions || []).map((q) => (
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
    </article>
  )
}
