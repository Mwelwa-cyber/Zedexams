import { useState, useMemo, useEffect } from 'react'
import {
  generateFullLesson,
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
import { downloadFullLessonDocx } from '../../../utils/fullLessonToDocx'
import { useFormDefaultsFromUrl } from '../../../utils/useFormDefaultsFromUrl'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'
import { attachLibraryToGeneration } from '../../../utils/teacherLibraryService'
import { LIBRARY_TYPES } from '../../../config/library'

/**
 * Full Lesson Studio — a complete, ready-to-deliver CBC lesson, grounded on
 * the stored curriculum module when grade+subject+topic+sub-topic+term
 * resolve one. Usually launched from the Curriculum Studio with everything
 * pre-filled (useFormDefaultsFromUrl); also usable standalone.
 */
export default function FullLessonStudio() {
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
  const [lesson, setLesson] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [usage, setUsage] = useState(null)
  const [warning, setWarning] = useState('')

  const subjectOptions = useMemo(
    () => getSubjectsForGrade(form.grade),
    [form.grade],
  )
  useEffect(() => {
    if (!isSubjectValidForGrade(form.subject, form.grade)) {
      setForm((f) => ({ ...f, subject: defaultSubjectForGrade(f.grade) }))
    }
  }, [form.grade, form.subject])

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

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
    setLesson(null)

    const res = await generateFullLesson(form)
    if (!res.ok) {
      setStatus('error')
      setErrorMessage(res.error || 'Generation failed.')
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
      }).catch(() => {})
    }
  }

  function onExport() {
    if (!lesson) return
    const slug = (s) => String(s || '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    const name = [
      slug(form.grade), slug(form.subject),
      slug(lesson.header?.topic || form.topic), 'full-lesson',
      new Date().toISOString().slice(0, 10),
    ].filter(Boolean).join('_')
    downloadFullLessonDocx(lesson, `${name}.docx`)
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8" style={{ background: '#f5efe1' }}>
      <SeoHelmet title="Full lesson studio" noIndex />
      <div className="max-w-7xl mx-auto">
        <StudioPageHeader
          eyebrow="Full Lesson Studio"
          title="A complete lesson, ready to teach"
          subtitle="Grounded on the verified curriculum module — objectives, content, examples, practice, checks and homework."
          emoji="🎓"
        />

        <div className="grid grid-cols-1 gap-6">
          <form
            onSubmit={onGenerate}
            className="studio-card p-5 space-y-4 h-fit w-full max-w-2xl mx-auto"
          >
            <FieldSelect label="Grade" value={form.grade}
              options={TEACHER_GRADES}
              onChange={(v) => updateField('grade', v)} />
            <FieldSelect label="Subject" value={form.subject}
              options={subjectOptions}
              onChange={(v) => updateField('subject', v)} />
            <FieldText label="Topic *" placeholder="e.g. Fractions"
              value={form.topic}
              onChange={(v) => updateField('topic', v)} maxLength={120} />
            <FieldText label="Sub-topic (optional)"
              placeholder="e.g. Adding Fractions with Unlike Denominators"
              value={form.subtopic}
              onChange={(v) => updateField('subtopic', v)} maxLength={160} />
            <FieldSelect label="Term" value={form.term}
              options={CURRICULUM_TERMS}
              onChange={(v) => updateField('term', v)} />
            <FieldSelect label="Number of lessons for this sub-topic"
              value={form.totalLessons}
              options={TOTAL_LESSONS_OPTIONS}
              onChange={(v) => updateField('totalLessons', v)} />
            <FieldSelect label="Lesson number" value={form.lessonNumber}
              options={LESSON_NUMBER_OPTIONS}
              onChange={(v) => updateField('lessonNumber', v)} />
            <FieldSelect label="Learning environment"
              value={form.learningEnvironment}
              options={LEARNING_ENVIRONMENT_OPTIONS}
              onChange={(v) => updateField('learningEnvironment', v)} />
            <FieldSelect label="Lesson duration"
              value={String(form.durationMinutes)}
              options={[20, 30, 40, 60, 80, 90, 120].map((m) => ({
                value: String(m), label: `${m} min`,
              }))}
              onChange={(v) => updateField('durationMinutes', Number(v))} />
            <FieldSelect label="Language" value={form.language}
              options={TEACHER_LANGUAGES}
              onChange={(v) => updateField('language', v)} />
            <FieldTextarea label="Extra instructions (optional)"
              placeholder="e.g. Emphasise group work and a real market example."
              value={form.instructions}
              onChange={(v) => updateField('instructions', v)} maxLength={500} />

            <button type="submit" disabled={status === 'generating'}
              className="studio-btn-primary w-full py-3">
              {status === 'generating' ? 'Generating…' : '▶ Generate Full Lesson'}
            </button>

            {usage && (
              <div className="text-xs theme-text-secondary text-center">
                {usage.used}/{usage.limit} full lessons used on the{' '}
                <span className="font-bold capitalize">{usage.plan}</span>{' '}
                plan this month
              </div>
            )}
          </form>

          <section className="studio-card p-5 min-h-[400px]">
            {status === 'idle' && (
              <Centered emoji="🎓" title="Ready to build a full lesson"
                body="Pick the grade, subject and (ideally) a stored sub-topic. You'll get a complete lesson you can teach and export to Word." />
            )}
            {status === 'generating' && (
              <Centered emoji="✍️" title="Writing the lesson…"
                body="Objectives, content, worked examples, practice, checks and homework — about a minute." />
            )}
            {status === 'error' && (
              <Centered emoji="⚠️" title="Something went wrong"
                body={errorMessage}
                action={<button onClick={() => setStatus('idle')}
                  className="studio-btn-ghost">Try again</button>} />
            )}
            {status === 'success' && lesson && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="studio-display"
                      style={{ fontSize: 22, color: '#0e2a32', margin: '0 0 2px' }}>
                      {lesson.header?.title || 'Full Lesson'}
                    </h2>
                    <p className="text-xs" style={{ color: '#566f76' }}>
                      Review, export, print.
                    </p>
                  </div>
                  <button onClick={onExport} className="studio-btn-primary">
                    📄 Export .docx
                  </button>
                </div>
                {warning && (
                  <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
                    ⚠️ {warning}
                  </div>
                )}
                <LessonView lesson={lesson} />
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

/* ── Inputs ─────────────────────────────────────────────────── */

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
      <h3 className="studio-display" style={{ fontSize: 20, color: '#0e2a32' }}>
        {title}
      </h3>
      <p className="text-sm max-w-md mt-1" style={{ color: '#566f76' }}>{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/* ── Rendered lesson ────────────────────────────────────────── */

function Sec({ title, children }) {
  return (
    <section className="mb-5">
      <h3 className="text-base font-black theme-text border-b theme-border pb-1 mb-2">
        {title}
      </h3>
      {children}
    </section>
  )
}

function List({ items, ordered }) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-1 text-sm theme-text`}>
      {(items || []).map((it, i) => <li key={i}>{it}</li>)}
    </Tag>
  )
}

function LessonView({ lesson }) {
  const h = lesson.header || {}
  const intro = lesson.introduction || {}
  const a = lesson.assessment || {}
  const hw = lesson.homework || {}
  return (
    <article className="space-y-1">
      <div className="rounded-xl border theme-border p-4 bg-slate-50/50 dark:bg-slate-900/20 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm theme-text">
          <div><span className="font-bold">Grade: </span>{h.grade}</div>
          <div><span className="font-bold">Subject: </span>{h.subject}</div>
          <div><span className="font-bold">Topic: </span>{h.topic}</div>
          {h.subtopic && (
            <div><span className="font-bold">Sub-topic: </span>{h.subtopic}</div>
          )}
          {h.term && <div><span className="font-bold">Term: </span>{h.term}</div>}
          <div><span className="font-bold">Duration: </span>{h.durationMinutes} min</div>
        </div>
      </div>

      {lesson.objectives?.length > 0 && (
        <Sec title="Objectives"><List items={lesson.objectives} /></Sec>
      )}
      {lesson.keyVocabulary?.length > 0 && (
        <Sec title="Key Vocabulary">
          <ul className="space-y-1 text-sm theme-text">
            {lesson.keyVocabulary.map((g, i) => (
              <li key={i}><span className="font-bold">{g.term}: </span>{g.definition}</li>
            ))}
          </ul>
        </Sec>
      )}
      {(intro.hook || intro.priorKnowledge) && (
        <Sec title="Introduction">
          {intro.hook && <p className="text-sm theme-text mb-2"><span className="font-bold">Hook: </span>{intro.hook}</p>}
          {intro.priorKnowledge && <p className="text-sm theme-text"><span className="font-bold">Prior knowledge: </span>{intro.priorKnowledge}</p>}
        </Sec>
      )}
      {lesson.teaching?.length > 0 && (
        <Sec title="Lesson Content">
          {lesson.teaching.map((t, i) => (
            <div key={i} className="mb-3">
              <p className="font-bold text-sm theme-text">{t.heading}</p>
              <p className="text-sm theme-text">{t.explanation}</p>
            </div>
          ))}
        </Sec>
      )}
      {lesson.workedExamples?.length > 0 && (
        <Sec title="Worked Examples">
          {lesson.workedExamples.map((w, i) => (
            <div key={i} className="mb-3">
              <p className="font-bold text-sm theme-text">Example {i + 1}: {w.problem}</p>
              {w.steps?.length > 0 && (
                <ol className="list-decimal pl-5 text-sm theme-text">
                  {w.steps.map((s, j) => <li key={j}>{s}</li>)}
                </ol>
              )}
              {w.answer && <p className="text-sm text-emerald-700 dark:text-emerald-400"><span className="font-bold">Answer: </span>{w.answer}</p>}
            </div>
          ))}
        </Sec>
      )}
      {lesson.guidedPractice?.length > 0 && (
        <Sec title="Guided Practice"><List items={lesson.guidedPractice} ordered /></Sec>
      )}
      {lesson.learnerActivities?.length > 0 && (
        <Sec title="Learner Activities"><List items={lesson.learnerActivities} /></Sec>
      )}
      {a.checks?.length > 0 && (
        <Sec title="Formative Checks">
          <List items={a.checks} ordered />
          {a.answers?.length > 0 && (
            <div className="mt-2">
              <p className="font-bold text-sm theme-text">Answer key</p>
              <List items={a.answers} ordered />
            </div>
          )}
        </Sec>
      )}
      {lesson.summary && (
        <Sec title="Summary"><p className="text-sm theme-text">{lesson.summary}</p></Sec>
      )}
      {hw.task && (
        <Sec title="Homework">
          <p className="text-sm theme-text">{hw.task}</p>
          {hw.answerGuide && <p className="text-sm theme-text-secondary mt-1"><span className="font-bold">Answer guide: </span>{hw.answerGuide}</p>}
        </Sec>
      )}
      {lesson.references?.length > 0 && (
        <Sec title="References"><List items={lesson.references} /></Sec>
      )}
    </article>
  )
}
