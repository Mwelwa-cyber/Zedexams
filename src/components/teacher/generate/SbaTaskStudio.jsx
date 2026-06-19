/**
 * SBA Studio — /teacher/generate/sba
 *
 * Generates ONE ECZ-compliant School Based Assessment task (Grades 5–7) with
 * the marking artefact its task type requires. Distinct from the Assessment
 * Generator (formal graded test): SBA tasks follow the per-subject ECZ task
 * taxonomy, never use MCQs, and carry an observation sheet / method marks /
 * rubric rather than a plain answer key.
 *
 * The mark-aggregation side lives in the SBA Mark Tracker
 * (/teacher/generate/sba-tracker).
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { generateSbaTask, TEACHER_LANGUAGES } from '../../../utils/teacherTools'
import {
  SBA_GRADES,
  SBA_SUBJECTS,
  SBA_CTS_COMPONENTS,
  SBA_BLOOM_LEVELS,
  getSbaSubject,
  getSbaTaskTypes,
  getSbaTaskType,
} from '../../../config/sba'
import { downloadSbaTaskDocx } from '../../../utils/sbaTaskToDocx'
import { buildDownloadName } from '../../../utils/downloadFilename'
import { attachLibraryToGeneration, isFreePlanTeacher } from '../../../utils/teacherLibraryService'
import { LIBRARY_TYPES } from '../../../config/library'
import { useAuth } from '../../../contexts/AuthContext'
import { useGenerationGate } from '../../../hooks/useGenerationGate'
import StudioPageHeader from '../StudioPageHeader'
import SeoHelmet from '../../seo/SeoHelmet'
import AiGenerationProgress from '../../ui/AiGenerationProgress'
import SbaTaskView from '../views/SbaTaskView'
import SbaWorkflowNote from '../SbaWorkflowNote'
import TopicSubtopicPicker from './TopicSubtopicPicker'

const TERMS = [
  { value: '', label: '— Term (optional) —' },
  { value: 'Term 1', label: 'Term 1' },
  { value: 'Term 2', label: 'Term 2' },
  { value: 'Term 3', label: 'Term 3' },
]

export default function SbaTaskStudio() {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const { ensureCanGenerate } = useGenerationGate(currentUser?.uid)
  const [form, setForm] = useState({
    grade: 'G5',
    subject: 'english',
    taskType: 'reading_comprehension',
    component: '',
    term: '',
    topic: '',
    outcome: '',
    bloomLevel: '',
    language: 'english',
    instructions: '',
  })
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [task, setTask] = useState(null)
  const [generationId, setGenerationId] = useState(null)
  const [warning, setWarning] = useState('')
  const [showAnswers, setShowAnswers] = useState(true)
  // School name on the task banner — pre-filled from the teacher's registration
  // profile, but editable in case they set tasks for more than one school.
  const [schoolName, setSchoolName] = useState(
    userProfile?.school || userProfile?.schoolName || '',
  )

  // Keep the field in sync once the profile loads (it can arrive after mount).
  useEffect(() => {
    setSchoolName((prev) => prev || userProfile?.school || userProfile?.schoolName || '')
  }, [userProfile?.school, userProfile?.schoolName])

  const subjectMeta = getSbaSubject(form.subject)
  const taskTypeOptions = useMemo(() => getSbaTaskTypes(form.subject), [form.subject])
  const currentTaskType = getSbaTaskType(form.subject, form.taskType)
  const needsComponent = Boolean(currentTaskType?.needsComponent)

  // Which 2013 syllabus to draw topics/outcomes from. SBA is the Grade 5–7
  // School Based Assessment instrument, which sits on the 2013 OBC curriculum.
  // CTS has no syllabus of its own — its components are the KB subjects, so
  // route the picker through the chosen component. The 2013 OBC names the
  // technical strand "Design & Technology" (not "Technology Studies"); the
  // other components map 1:1. (Where the syllabus has no rows, the picker
  // degrades to free text on its own.)
  const syllabusSubject = form.subject === 'creative_and_technology_studies' && form.component
    ? (form.component === 'technology_studies' ? 'design_and_technology' : form.component)
    : form.subject

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // Keep task type valid when the subject changes.
  useEffect(() => {
    if (!getSbaTaskType(form.subject, form.taskType)) {
      const first = getSbaTaskTypes(form.subject)[0]
      if (first) setForm((f) => ({ ...f, taskType: first.value }))
    }
  }, [form.subject, form.taskType])

  // Default a CTS component when one is required, clear it otherwise.
  useEffect(() => {
    if (needsComponent && !form.component) {
      setForm((f) => ({ ...f, component: SBA_CTS_COMPONENTS[0].value }))
    } else if (!needsComponent && form.component) {
      setForm((f) => ({ ...f, component: '' }))
    }
  }, [needsComponent, form.component])

  async function onGenerate(e) {
    e.preventDefault()
    if (!ensureCanGenerate('sba_task')) return
    setStatus('generating')
    setErrorMessage('')
    setWarning('')
    setTask(null)
    setGenerationId(null)
    const res = await generateSbaTask(form)
    if (!res.ok) {
      setStatus('error')
      setErrorMessage(res.error || 'Generation failed.')
      return
    }
    setTask(res.data.task)
    setGenerationId(res.data.generationId)
    setWarning(res.data.warning || '')
    setStatus('success')
    if (res.data.generationId) {
      attachLibraryToGeneration(res.data.generationId, {
        libraryType: LIBRARY_TYPES.SBA_TASKS,
        syllabusHint: 'OBC',
        grade: form.grade,
        subject: form.subject,
        term: form.term ? Number(form.term.replace(/\D/g, '')) : null,
      }).catch(() => {})
    }
  }

  function onExport(includeAnswers) {
    if (!task) return
    const name = buildDownloadName({
      docType: includeAnswers ? 'SBA Task' : 'SBA Task (learner)',
      grade: form.grade,
      subject: form.subject,
      topic: task.header?.taskType || currentTaskType?.label || 'task',
    })
    downloadSbaTaskDocx(task, name, {
      includeAnswers,
      schoolName,
      attribution: isFreePlanTeacher({ userProfile, isAdmin }),
    })
  }

  return (
    <div className="min-h-screen py-4 sm:py-6 lg:py-8" style={{ background: '#f5efe1' }}>
      <SeoHelmet title="SBA Studio" noIndex />
      <div className="max-w-7xl mx-auto">
        <StudioPageHeader
          eyebrow="SBA Studio"
          title="School Based Assessment tasks, the ECZ way"
          subtitle="One compliant task at a time — the right task type, Bloom level and marking scheme for Grades 5–7. No multiple choice."
          emoji="🏫"
        />

        <SbaWorkflowNote current="studio" />

        <div className="flex flex-wrap gap-2 mb-4 text-xs">
          <Link to="/teacher/generate/sba-tracker" className="studio-btn-ghost">
            🧮 Open the SBA Mark Tracker →
          </Link>
          <Link to="/teacher/generate/sba-planner" className="studio-btn-ghost">
            🗂️ Open the SBA Year Planner →
          </Link>
        </div>

        <div className="grid lg:grid-cols-5 gap-6">
          {/* ── Form ── */}
          <form onSubmit={onGenerate} className="lg:col-span-2 studio-card p-5 space-y-4 self-start">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="studio-label">Grade</label>
                <select value={form.grade}
                  onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value, topic: '', outcome: '' }))}
                  className="studio-input">
                  {SBA_GRADES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </div>
              <div>
                <label className="studio-label">Subject</label>
                <select value={form.subject}
                  onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value, topic: '', outcome: '' }))}
                  className="studio-input">
                  {SBA_SUBJECTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="studio-label">Task type</label>
              <select value={form.taskType} onChange={(e) => set('taskType', e.target.value)} className="studio-input">
                {taskTypeOptions.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.group && subjectMeta?.kind === 'language' ? `${t.group} · ` : ''}{t.label} ({t.defaultMarks})
                  </option>
                ))}
              </select>
            </div>

            {needsComponent && (
              <div>
                <label className="studio-label">CTS component</label>
                <select value={form.component}
                  onChange={(e) => setForm((f) => ({ ...f, component: e.target.value, topic: '', outcome: '' }))}
                  className="studio-input">
                  {SBA_CTS_COMPONENTS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="studio-label">Term</label>
                <select value={form.term} onChange={(e) => set('term', e.target.value)} className="studio-input">
                  {TERMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="studio-label">Bloom level</label>
                <select value={form.bloomLevel} onChange={(e) => set('bloomLevel', e.target.value)} className="studio-input">
                  <option value="">— Any (optional) —</option>
                  {SBA_BLOOM_LEVELS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            </div>

            <TopicSubtopicPicker
              grade={form.grade}
              subject={syllabusSubject}
              framework="2013"
              topic={form.topic}
              subtopic={form.outcome}
              onChangeTopic={(v) => set('topic', v)}
              onChangeSubtopic={(v) => set('outcome', v)}
              topicLabel="Topic / focus"
              subtopicLabel={<>Syllabus outcome <span className="font-normal opacity-70">(optional)</span></>}
              topicPlaceholder="e.g. The environment, Fractions, The human body"
              subtopicPlaceholder="e.g. Add fractions with the same denominator"
              topicMaxLength={160}
              subtopicMaxLength={200}
            />
            <p className="text-[11px] -mt-2" style={{ color: '#7a8e94' }}>
              Topics come from the <strong>2013 (OBC)</strong> syllabus — the curriculum SBA is assessed against.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="studio-label">Language</label>
                <select value={form.language} onChange={(e) => set('language', e.target.value)} className="studio-input">
                  {TEACHER_LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="studio-label">Extra instructions <span className="font-normal opacity-70">(optional)</span></label>
              <textarea value={form.instructions} maxLength={500} rows={2}
                onChange={(e) => set('instructions', e.target.value)}
                placeholder="Anything specific you want this task to cover."
                className="studio-input" />
            </div>

            <button type="submit" disabled={status === 'generating'}
              className="studio-btn-primary w-full disabled:opacity-50">
              {status === 'generating' ? 'Generating…' : '✨ Generate SBA task'}
            </button>
            {status === 'error' && (
              <p className="text-sm text-rose-700 font-bold">{errorMessage}</p>
            )}
          </form>

          {/* ── Result ── */}
          <div className="lg:col-span-3 studio-card p-5">
            {status === 'generating' && (
              <AiGenerationProgress variant="card" preset="assessment" running title="Setting your SBA task and its marking scheme…" />
            )}

            {status !== 'generating' && !task && (
              <div className="rounded-xl border border-dashed theme-border bg-white/60 py-16 text-center text-sm" style={{ color: '#566f76' }}>
                Choose a subject and task type, then generate. Your ECZ-compliant SBA task appears here.
              </div>
            )}

            {task && (
              <div className="space-y-4">
                <div>
                  <label className="studio-label">School name</label>
                  <input
                    type="text"
                    value={schoolName}
                    maxLength={120}
                    onChange={(e) => setSchoolName(e.target.value)}
                    placeholder="Your school name"
                    className="studio-input"
                  />
                  <p className="text-[11px] mt-1" style={{ color: '#7a8e94' }}>
                    Pulled from your profile — edit it here and it appears on the task sheet and the download.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs font-bold theme-text">
                    <input type="checkbox" checked={showAnswers} onChange={(e) => setShowAnswers(e.target.checked)} />
                    Show marking scheme
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" onClick={() => onExport(false)} className="studio-btn-ghost">
                      📄 Learner copy
                    </button>
                    <button type="button" onClick={() => onExport(true)} className="studio-btn-primary">
                      📄 Teacher copy (.docx)
                    </button>
                  </div>
                </div>
                {warning && (
                  <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
                    {warning}
                  </p>
                )}
                {generationId && (
                  <p className="text-xs" style={{ color: '#566f76' }}>
                    Saved to your library — <Link to={`/teacher/library/${generationId}`} className="font-bold underline">open the saved copy</Link>.
                  </p>
                )}
                <SbaTaskView task={task} showAnswers={showAnswers} schoolName={schoolName} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
