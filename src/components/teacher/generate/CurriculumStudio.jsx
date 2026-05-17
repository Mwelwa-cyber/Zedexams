import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TEACHER_GRADES,
  CURRICULUM_TERMS,
  TOTAL_LESSONS_OPTIONS,
  LESSON_NUMBER_OPTIONS,
  LEARNING_ENVIRONMENT_OPTIONS,
  getSubjectsForGrade,
  isSubjectValidForGrade,
  defaultSubjectForGrade,
} from '../../../utils/teacherTools'
import {
  listCbcTopics, listLessons, curriculumTopicDocId,
} from '../../../utils/adminCbcKbService'
import { buildGeneratorQueryString } from '../../../utils/useFormDefaultsFromUrl'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'

/**
 * Curriculum Studio — the curriculum-driven front door for generation.
 *
 * The teacher narrows down to a VERIFIED stored sub-topic module
 * (Grade → Subject → Term → Topic → Sub-topic), chooses how many lessons
 * to split it into + which lesson + the learning environment, then launches
 * a curriculum-grounded generator with everything pre-filled. Generation,
 * preview, edit, save and export are handled by the existing (Phase-1
 * grounded) generators — this page just makes sure the AI is anchored to a
 * real stored module instead of free-text guessing.
 */

// Content types: those wired to a curriculum-grounded generator today, plus
// the ones queued for a later phase (shown disabled, never broken).
const CONTENT_TYPES = [
  { key: 'lesson_plan', label: 'Lesson Plan', emoji: '📋',
    route: '/teacher/generate/lesson-plan-cbc', ready: true },
  { key: 'exercise', label: 'Exercise / Worksheet', emoji: '✏️',
    route: '/teacher/generate/worksheet', ready: true },
  { key: 'learner_notes', label: 'Learner Notes', emoji: '📖', ready: false },
  { key: 'full_lesson', label: 'Full Lesson', emoji: '🎓', ready: false },
  { key: 'homework', label: 'Homework', emoji: '🏠', ready: false },
  { key: 'quiz', label: 'Quiz', emoji: '❓', ready: false },
  { key: 'assessment', label: 'Assessment', emoji: '📝', ready: false },
]

export default function CurriculumStudio() {
  const navigate = useNavigate()
  const [grade, setGrade] = useState('G4')
  const [subject, setSubject] = useState('integrated_science')
  const [term, setTerm] = useState('')
  const [topic, setTopic] = useState('')
  const [subtopicId, setSubtopicId] = useState('')
  const [totalLessons, setTotalLessons] = useState('')
  const [lessonNumber, setLessonNumber] = useState('')
  const [learningEnvironment, setLearningEnvironment] = useState('')

  const [allTopics, setAllTopics] = useState(null) // null = loading
  const [modules, setModules] = useState([]) // sub-topic modules for topic
  const [modulesLoading, setModulesLoading] = useState(false)

  // Load the full topic list once (teacher-readable; Firestore rules allow
  // any signed-in user to read cbcKnowledgeBase).
  useEffect(() => {
    let active = true
    listCbcTopics()
      .then((t) => { if (active) setAllTopics(t || []) })
      .catch(() => { if (active) setAllTopics([]) })
    return () => { active = false }
  }, [])

  const subjectOptions = useMemo(
    () => getSubjectsForGrade(grade), [grade],
  )
  useEffect(() => {
    if (!isSubjectValidForGrade(subject, grade)) {
      setSubject(defaultSubjectForGrade(grade))
    }
  }, [grade, subject])

  // Topics that exist for this grade + subject.
  const topicOptions = useMemo(() => {
    if (!allTopics) return []
    const seen = new Set()
    const out = []
    for (const t of allTopics) {
      if (String(t.grade || '').toUpperCase() !== String(grade).toUpperCase()) continue
      if (String(t.subject || '').toLowerCase() !== String(subject).toLowerCase()) continue
      const name = String(t.topic || '').trim()
      if (!name || seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      out.push(name)
    }
    return out.sort((a, b) => a.localeCompare(b))
  }, [allTopics, grade, subject])

  // Reset the cascade when a higher selector changes.
  useEffect(() => { setTopic(''); setSubtopicId('') }, [grade, subject, term])
  useEffect(() => { setSubtopicId('') }, [topic])

  // Load the stored sub-topic modules for the chosen topic + term.
  useEffect(() => {
    if (!topic || !term) { setModules([]); return }
    const topicId = curriculumTopicDocId({ grade, subject, topic })
    if (!topicId) { setModules([]); return }
    let active = true
    setModulesLoading(true)
    listLessons(topicId)
      .then((rows) => {
        if (!active) return
        setModules((rows || []).filter(
          (m) => Number(m.term) === Number(term),
        ))
      })
      .catch(() => { if (active) setModules([]) })
      .finally(() => { if (active) setModulesLoading(false) })
    return () => { active = false }
  }, [topic, term, grade, subject])

  const selectedModule = useMemo(
    () => modules.find((m) => m.id === subtopicId) || null,
    [modules, subtopicId],
  )

  // Default the lesson split to the module's suggestion when one is picked.
  useEffect(() => {
    if (selectedModule) {
      setTotalLessons(String(selectedModule.suggestedLessons || 1))
      setLessonNumber('1')
      setLearningEnvironment('')
    }
  }, [selectedModule])

  // Constrain the environment list to the module's options, if it has any.
  const envOptions = useMemo(() => {
    const allowed = selectedModule?.learningEnvironmentOptions
    if (!allowed || allowed.length === 0) return LEARNING_ENVIRONMENT_OPTIONS
    return [
      LEARNING_ENVIRONMENT_OPTIONS[0],
      ...LEARNING_ENVIRONMENT_OPTIONS.filter(
        (o) => o.value && allowed.includes(o.value),
      ),
    ]
  }, [selectedModule])

  const lessonNumberOptions = useMemo(() => {
    const n = Number(totalLessons)
    if (!Number.isInteger(n) || n < 1) return LESSON_NUMBER_OPTIONS
    return [
      LESSON_NUMBER_OPTIONS[0],
      ...Array.from({ length: n }, (_, i) => ({
        value: String(i + 1), label: `Lesson ${i + 1}`,
      })),
    ]
  }, [totalLessons])

  function launch(ct) {
    if (!ct.ready || !selectedModule) return
    const qs = buildGeneratorQueryString({
      grade,
      subject,
      topic: selectedModule.topic,
      subtopic: selectedModule.subtopic,
      term: Number(term),
      totalLessons: Number(totalLessons) || undefined,
      lessonNumber: Number(lessonNumber) || undefined,
      learningEnvironment: learningEnvironment || undefined,
    })
    navigate(`${ct.route}${qs}`)
  }

  const ready = Boolean(selectedModule)

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8" style={{ background: '#f5efe1' }}>
      <SeoHelmet title="Curriculum studio" noIndex />
      <div className="max-w-3xl mx-auto">
        <StudioPageHeader
          eyebrow="Curriculum Studio"
          title="Generate from the verified curriculum"
          subtitle="Pick a stored CBC module — the AI builds on it instead of guessing."
          emoji="🧭"
        />

        <div className="studio-card p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldSelect label="Grade" value={grade}
              options={TEACHER_GRADES} onChange={setGrade} />
            <FieldSelect label="Subject" value={subject}
              options={subjectOptions} onChange={setSubject} />
            <FieldSelect label="Term" value={term}
              options={CURRICULUM_TERMS} onChange={setTerm} />
            <FieldSelect
              label="Topic"
              value={topic}
              disabled={!term || allTopics === null}
              options={[
                { value: '', label: allTopics === null ?
                  'Loading…' : (!term ? 'Pick a term first' :
                    (topicOptions.length ? '— Select topic —' :
                      'No stored topics for this grade/subject')) },
                ...topicOptions.map((t) => ({ value: t, label: t })),
              ]}
              onChange={setTopic}
            />
          </div>

          <FieldSelect
            label="Sub-topic (verified module)"
            value={subtopicId}
            disabled={!topic || modulesLoading}
            options={[
              { value: '', label: modulesLoading ? 'Loading modules…' :
                (modules.length ? '— Select sub-topic —' :
                  (topic ? 'No stored modules for this topic/term yet' :
                    'Pick a topic first')) },
              ...modules.map((m) => ({
                value: m.id,
                label: `${m.subtopic} (~${m.suggestedLessons || 1} lesson${
                  (m.suggestedLessons || 1) === 1 ? '' : 's'})`,
              })),
            ]}
            onChange={setSubtopicId}
          />

          {selectedModule && (
            <div className="rounded-xl border-2 theme-border bg-white/60 p-4 text-sm">
              <p className="font-black text-slate-800 mb-1">
                {selectedModule.topic} → {selectedModule.subtopic}
              </p>
              <p className="text-xs text-slate-500 mb-2">
                Term {selectedModule.term} · {selectedModule.outcomes?.length || 0}{' '}
                outcome(s) · suggested {selectedModule.suggestedLessons || 1} lesson(s)
              </p>
              {selectedModule.outcomes?.length > 0 && (
                <ul className="list-disc pl-5 space-y-0.5 text-slate-700">
                  {selectedModule.outcomes.slice(0, 4).map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                  {selectedModule.outcomes.length > 4 && (
                    <li className="text-slate-400">
                      +{selectedModule.outcomes.length - 4} more…
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}

          {selectedModule && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FieldSelect label="Number of lessons" value={totalLessons}
                options={TOTAL_LESSONS_OPTIONS} onChange={setTotalLessons} />
              <FieldSelect label="Lesson number" value={lessonNumber}
                options={lessonNumberOptions} onChange={setLessonNumber} />
              <FieldSelect label="Learning environment"
                value={learningEnvironment}
                options={envOptions} onChange={setLearningEnvironment} />
            </div>
          )}

          <div>
            <p className="studio-label mb-2">Generate</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {CONTENT_TYPES.map((ct) => (
                <button
                  key={ct.key}
                  type="button"
                  disabled={!ct.ready || !ready}
                  onClick={() => launch(ct)}
                  title={!ct.ready ? 'Coming in a later phase' :
                    (!ready ? 'Pick a sub-topic module first' : '')}
                  className={`flex flex-col items-center gap-1 px-3 py-3 rounded-xl border-2 text-sm font-bold transition ${
                    ct.ready && ready
                      ? 'border-emerald-300 bg-white hover:bg-emerald-50 text-slate-800'
                      : 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <span className="text-xl">{ct.emoji}</span>
                  {ct.label}
                  {!ct.ready && (
                    <span className="text-[10px] font-normal">soon</span>
                  )}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Lesson Plan & Exercise are wired to the verified curriculum now.
              The others are queued for the next phase. Generation, preview,
              editing and Word/PDF export open in the matching studio with
              everything pre-filled.
            </p>
          </div>

          {allTopics !== null && allTopics.length === 0 && (
            <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              No curriculum modules are stored yet. An admin can add them at
              <strong> Admin → CBC Knowledge Base → Bulk-import lesson modules</strong>.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FieldSelect({ label, value, options, onChange, disabled }) {
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
      <label className="studio-label">{label}</label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="studio-input disabled:opacity-60"
      >
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
