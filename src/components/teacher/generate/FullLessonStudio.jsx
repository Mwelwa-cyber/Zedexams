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
import FullLessonView from '../views/FullLessonView'
import SeoHelmet from '../../seo/SeoHelmet'
import { attachLibraryToGeneration } from '../../../utils/teacherLibraryService'
import { LIBRARY_TYPES } from '../../../config/library'
import TopicSubtopicPicker from './TopicSubtopicPicker'

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
            <TopicSubtopicPicker
              grade={form.grade}
              subject={form.subject}
              topic={form.topic}
              subtopic={form.subtopic}
              onChangeTopic={(v) => updateField('topic', v)}
              onChangeSubtopic={(v) => updateField('subtopic', v)}
              subtopicPlaceholder="e.g. Adding Fractions with Unlike Denominators"
            />
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
                <FullLessonView lesson={lesson} />
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
