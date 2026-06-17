// "Create paper with AI" — full-paper generation inside the Assessment
// Studio. Wraps the existing generateAssessment Cloud Function (which is
// grounded on the CBC knowledge base AND the Zambian assessment format
// profiles), then converts the returned paper into editable studio
// blocks via aiPaperToSections. The teacher reviews/edits before saving
// — nothing is auto-saved.

import { useEffect, useMemo, useState } from 'react'
import { generateAssessment } from '../../utils/teacherTools'
import { aiAssessmentToStudioBlocks } from '../../utils/aiPaperToSections'
import {
  useSyllabusTopicOptions, useSyllabusSubjectOptions, CURRICULUM_FRAMEWORKS,
} from './syllabusTopicOptions'
import {
  PAPER_TYPES, PAPER_GRADE_OPTIONS, isPaperGrade, maxTopicsFor,
  isCumulativeType, subjectLabel, toKbSubjectKey, studioGradeToKbGrade,
  FALLBACK_SUBJECT_KEYS,
} from './paperTaxonomy'
import AiGenerationProgress from '../ui/AiGenerationProgress'

const QUESTION_TYPE_OPTIONS = [
  { key: 'multiple choice', label: 'Multiple choice' },
  { key: 'true/false', label: 'True / False' },
  { key: 'short answer', label: 'Short answer' },
  { key: 'fill-in-the-blank', label: 'Fill in the blank' },
  { key: 'matching (match Column A with Column B)', label: 'Matching' },
  { key: 'structured (multi-part)', label: 'Structured' },
  { key: 'calculation (show working)', label: 'Calculation' },
  { key: 'essay/composition', label: 'Essay / Composition' },
]

const MARKS_OPTIONS = [20, 30, 40, 50, 60, 80, 100]
const DURATION_OPTIONS = [30, 40, 60, 90, 120, 150, 180]

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 95,
  background: 'rgba(14, 42, 50, 0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 16,
}
const modalStyle = {
  background: 'var(--sv-paper, #fff)', borderRadius: 16,
  width: 'min(640px, 100%)', maxHeight: '90vh',
  display: 'flex', flexDirection: 'column', padding: 18,
  overflowY: 'auto',
}
const fieldLabel = { fontSize: 12, fontWeight: 700, color: 'var(--sv-muted, #566f76)', display: 'block', marginBottom: 4 }
const inputStyle = {
  width: '100%', border: '1px solid var(--sv-border, #d9cfb8)',
  borderRadius: 8, padding: '8px 10px', fontSize: 14,
  background: '#fff', fontFamily: 'inherit',
}
const chipStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: 'var(--sv-tinted, #f3ead5)', borderRadius: 999,
  padding: '4px 10px', fontSize: 13, color: 'var(--sv-text, #0e2a32)',
}

// Small "Pick from syllabus / Write my own" segmented toggle shown next to
// the topic + sub-topic labels.
function ModeToggle({ value, onChange, pickLabel = 'From syllabus', writeLabel = 'Write my own', pickDisabled = false }) {
  const baseBtn = {
    border: 'none', background: 'none', cursor: 'pointer',
    fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
    lineHeight: 1.6, color: 'var(--sv-muted, #566f76)',
  }
  const onStyle = {
    background: 'var(--sv-tinted, #fff3e8)', color: 'var(--sv-text, #0e2a32)',
    boxShadow: 'inset 0 0 0 1.5px var(--sv-primary, #ff7a2e)',
  }
  return (
    <div style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 999, background: 'var(--sv-soft, #f3ead5)' }}>
      <button type="button"
        onClick={() => !pickDisabled && onChange('pick')}
        disabled={pickDisabled}
        title={pickDisabled ? 'No syllabus topics on file for this selection yet' : undefined}
        style={{ ...baseBtn, ...(value === 'pick' ? onStyle : null), opacity: pickDisabled ? 0.45 : 1, cursor: pickDisabled ? 'not-allowed' : 'pointer' }}>
        {pickLabel}
      </button>
      <button type="button"
        onClick={() => onChange('write')}
        style={{ ...baseBtn, ...(value === 'write' ? onStyle : null) }}>
        {writeLabel}
      </button>
    </div>
  )
}

const labelRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }

export default function CreatePaperModal({ paperMeta, onApply, onClose }) {
  const [form, setForm] = useState(() => ({
    grade: isPaperGrade(String(paperMeta?.grade)) ? String(paperMeta.grade) : '4',
    subject: toKbSubjectKey(paperMeta?.subject) || 'english',
    framework: '2023',
    assessmentType: 'end_of_term',
    term: paperMeta?.term || '1',
    topicInput: '',
    topics: [],
    subtopicInput: '',
    subtopics: [],
    totalMarks: 40,
    durationMinutes: 60,
    questionTypes: ['multiple choice', 'short answer', 'structured (multi-part)'],
    comprehension: false,
    autoDiagrams: true,
    extra: '',
  }))
  const [status, setStatus] = useState('idle') // idle | generating | done | error
  const [error, setError] = useState('')
  const [result, setResult] = useState(null) // { assessment, blocks, warning }
  // How the teacher supplies topics / sub-topics: 'pick' = choose from the
  // syllabus drop-down, 'write' = type their own. Defaults to the syllabus
  // drop-down; falls back to 'write' automatically when the chosen
  // grade/subject/framework has no syllabus entries on file.
  const [topicMode, setTopicMode] = useState('pick') // 'pick' | 'write'
  const [subtopicMode, setSubtopicMode] = useState('pick') // 'pick' | 'write'
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  // Grade/subject/curriculum changes invalidate the chosen topics — they
  // belong to a different syllabus page.
  const setMeta = (k, v) => setForm((f) => ({
    ...f, [k]: v, topics: [], topicInput: '', subtopics: [], subtopicInput: '',
  }))

  const maxTopics = maxTopicsFor(form.assessmentType)
  const cumulative = isCumulativeType(form.assessmentType)

  // Subjects actually present in the syllabus for this grade + framework.
  // Falls back to a static list only after the fetch settles (so the
  // dropdown isn't briefly empty), keeping every grade — including Grade 1
  // and ECE — reachable.
  const { subjects: syllabusSubjects, loading: subjectsLoading } =
    useSyllabusSubjectOptions(form.grade, form.framework)
  const subjectChoices = (!subjectsLoading && syllabusSubjects.length > 0)
    ? syllabusSubjects
    : FALLBACK_SUBJECT_KEYS.map((key) => ({ key, label: subjectLabel(key) }))

  // Keep the selected subject valid for the chosen grade. When the syllabus
  // for a grade doesn't carry the current subject, snap to the first one it
  // does (and drop now-stale topics).
  useEffect(() => {
    if (subjectsLoading || syllabusSubjects.length === 0) return
    if (!syllabusSubjects.some((s) => s.key === form.subject)) {
      setForm((f) => ({
        ...f, subject: syllabusSubjects[0].key,
        topics: [], topicInput: '', subtopics: [], subtopicInput: '',
      }))
    }
  }, [subjectsLoading, syllabusSubjects, form.subject])

  const { topics: topicOptions, subtopics: subtopicOptions, loading: syllabiLoading } =
    useSyllabusTopicOptions(form.grade, form.subject, form.topics, form.framework)
  // The topic drop-down only makes sense once we know the grade/subject has
  // rows in the merged syllabi — i.e. after the fetch settles. While loading
  // we keep "pick" enabled so it can populate.
  const topicPickEmpty = !syllabiLoading && topicOptions.length === 0

  // When the chosen grade/subject/framework genuinely has no syllabus rows,
  // the drop-down would be a dead end — drop the teacher into "Write my own".
  // Their explicit choice is otherwise kept. Guarded by !loading so the
  // async syllabi fetch doesn't flip the default before data arrives.
  useEffect(() => {
    if (topicPickEmpty && topicMode === 'pick') setTopicMode('write')
  }, [topicPickEmpty, topicMode])

  const topicList = useMemo(() => {
    const fromChips = form.topics
    const typed = form.topicInput.trim()
    return typed && !fromChips.includes(typed) ? [...fromChips, typed] : fromChips
  }, [form.topics, form.topicInput])

  const subtopicList = useMemo(() => {
    const fromChips = form.subtopics
    const typed = form.subtopicInput.trim()
    return typed && !fromChips.includes(typed) ? [...fromChips, typed] : fromChips
  }, [form.subtopics, form.subtopicInput])

  // Add a topic chip from either the typed input or the syllabus drop-down.
  function addTopicValue(value) {
    const t = String(value || '').trim().slice(0, 80)
    if (!t) return
    setForm((f) => (f.topics.includes(t) || f.topics.length >= maxTopicsFor(f.assessmentType)
      ? f
      : { ...f, topics: [...f.topics, t], topicInput: '' }))
  }
  function addTopic() {
    addTopicValue(form.topicInput)
  }
  // Cumulative papers (end of term / mock) cover everything learned — let the
  // teacher tick every syllabus topic in one click, up to the type's cap.
  function addAllTopics() {
    setForm((f) => {
      const cap = maxTopicsFor(f.assessmentType)
      const next = [...f.topics]
      for (const t of topicOptions) {
        if (next.length >= cap) break
        if (!next.includes(t)) next.push(t)
      }
      return { ...f, topics: next, topicInput: '' }
    })
  }
  // Switching to the drop-down clears any half-typed free text so it can't
  // silently leak into the generated paper (topicList folds a non-empty
  // topicInput in as a topic).
  function changeTopicMode(mode) {
    if (mode === 'pick') set('topicInput', '')
    setTopicMode(mode)
  }

  function addSubtopicValue(value) {
    const s = String(value || '').trim().slice(0, 80)
    if (!s) return
    setForm((f) => (f.subtopics.includes(s)
      ? f
      : { ...f, subtopics: [...f.subtopics, s], subtopicInput: '' }))
  }
  function addSubtopic() {
    addSubtopicValue(form.subtopicInput)
  }
  function changeSubtopicMode(mode) {
    if (mode === 'pick') set('subtopicInput', '')
    setSubtopicMode(mode)
  }

  // Changing the test type re-scopes how many topics are allowed; trim any
  // overflow so the count never exceeds the new cap.
  function changeAssessmentType(value) {
    setForm((f) => ({
      ...f, assessmentType: value,
      topics: f.topics.slice(0, maxTopicsFor(value)),
    }))
  }

  function toggleType(key) {
    setForm((f) => ({
      ...f,
      questionTypes: f.questionTypes.includes(key) ?
        f.questionTypes.filter((t) => t !== key) : [...f.questionTypes, key],
    }))
  }

  function buildInstructions() {
    const bits = []
    if (form.questionTypes.length > 0) {
      bits.push(`Use ONLY these question types: ${form.questionTypes.join(', ')}.`)
    }
    if (form.comprehension) {
      bits.push('Include a reading comprehension passage with questions on it.')
    }
    if (form.assessmentType === 'end_of_term' || form.assessmentType === 'mock_exam') {
      bits.push(
        'This is a cumulative paper that tests EVERYTHING the learners have ' +
        'covered: distribute the questions across ALL the listed topics, ' +
        'weighting each by how much it matters — do not over-focus on one topic.',
      )
    } else if (form.assessmentType === 'monthly_test') {
      bits.push(
        'This is a monthly test covering only what was taught this month: ' +
        'keep it tightly focused on the listed topics and sub-topics.',
      )
    } else if (topicList.length > 1) {
      bits.push('Spread the questions across all the listed topics.')
    }
    if (subtopicList.length > 0) {
      bits.push(`Restrict the questions to these sub-topics only: ${subtopicList.join(', ')}.`)
    }
    if (form.extra.trim()) bits.push(form.extra.trim())
    return bits.join(' ').slice(0, 500)
  }

  async function onGenerate() {
    if (topicList.length === 0) {
      setError('Add at least one topic.')
      setStatus('error')
      return
    }
    if (form.questionTypes.length === 0) {
      setError('Pick at least one question type.')
      setStatus('error')
      return
    }
    setStatus('generating')
    setError('')
    const res = await generateAssessment({
      grade: studioGradeToKbGrade(form.grade),
      subject: toKbSubjectKey(form.subject),
      framework: form.framework,
      topic: topicList.join('; ').slice(0, 240),
      subtopic: subtopicList.join('; ').slice(0, 300),
      term: form.term ? Number(form.term) : null,
      totalMarks: Number(form.totalMarks),
      durationMinutes: Number(form.durationMinutes),
      assessmentType: form.assessmentType,
      instructions: buildInstructions(),
    })
    if (!res.ok) {
      setStatus('error')
      setError(res.error || 'Generation failed. Please try again.')
      return
    }
    const assessment = res.data?.assessment
    const blocks = aiAssessmentToStudioBlocks(assessment)
    if (blocks.questionCount === 0) {
      setStatus('error')
      setError('The AI returned no usable questions — try again or adjust the topics.')
      return
    }
    setResult({ assessment, blocks, warning: res.data?.warning || '' })
    setStatus('done')
  }

  function apply(mode) {
    if (!result) return
    onApply({ blocks: result.blocks, assessment: result.assessment, form, mode })
  }

  const showAddAll = topicMode === 'pick' && cumulative &&
    topicOptions.some((t) => !form.topics.includes(t)) &&
    form.topics.length < maxTopics

  return (
    <div style={overlayStyle} onClick={status === 'generating' ? undefined : onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontWeight: 900, fontSize: 19, color: 'var(--sv-text, #0e2a32)' }}>
              📄 Create paper with AI
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--sv-muted, #566f76)' }}>
              The paper follows the Zambian format for the chosen test type and
              lands as editable blocks — review every question before saving.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={status === 'generating'}
            style={{ fontSize: 22, lineHeight: 1, border: 'none', background: 'none', cursor: 'pointer' }}
            aria-label="Close">×</button>
        </div>

        {status !== 'done' && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={fieldLabel}>Grade</label>
                <select style={inputStyle} value={form.grade}
                  onChange={(e) => setMeta('grade', e.target.value)}>
                  {PAPER_GRADE_OPTIONS.map((g) => (
                    <option key={g.value} value={g.value}>{g.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={fieldLabel}>Subject</label>
                <select style={inputStyle} value={form.subject}
                  disabled={subjectsLoading}
                  onChange={(e) => setMeta('subject', e.target.value)}>
                  {subjectsLoading && <option value={form.subject}>Loading subjects…</option>}
                  {subjectChoices.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label style={fieldLabel}>Curriculum</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {CURRICULUM_FRAMEWORKS.map((f) => (
                  <button key={f.value} type="button"
                    onClick={() => setMeta('framework', f.value)}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: 10, fontSize: 13, cursor: 'pointer',
                      border: `1.5px solid ${form.framework === f.value ? 'var(--sv-primary, #ff7a2e)' : 'var(--sv-border, #d9cfb8)'}`,
                      background: form.framework === f.value ? 'var(--sv-tinted, #fff3e8)' : '#fff',
                      color: 'var(--sv-text, #0e2a32)', fontWeight: form.framework === f.value ? 700 : 400,
                    }}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={fieldLabel}>Test type</label>
                <select style={inputStyle} value={form.assessmentType}
                  onChange={(e) => changeAssessmentType(e.target.value)}>
                  {PAPER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={fieldLabel}>Term</label>
                <select style={inputStyle} value={form.term}
                  onChange={(e) => set('term', e.target.value)}>
                  {['1', '2', '3'].map((t) => <option key={t} value={t}>Term {t}</option>)}
                </select>
              </div>
            </div>

            <div>
              <div style={labelRow}>
                <label style={{ ...fieldLabel, marginBottom: 0 }}>
                  Topics from the syllabus (up to {maxTopics}) *
                </label>
                <ModeToggle value={topicMode} onChange={changeTopicMode} pickDisabled={topicPickEmpty} />
              </div>
              {cumulative && (
                <p style={{ fontSize: 12, color: 'var(--sv-muted, #566f76)', margin: '0 0 6px' }}>
                  This is a cumulative paper — add every topic the class has covered.
                </p>
              )}
              {form.topics.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {form.topics.map((t) => (
                    <span key={t} style={chipStyle}>
                      {t}
                      <button type="button" aria-label={`Remove ${t}`}
                        onClick={() => set('topics', form.topics.filter((x) => x !== t))}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              {form.topics.length >= maxTopics ? (
                <p style={{ fontSize: 12, color: 'var(--sv-muted, #566f76)', margin: 0 }}>
                  Maximum of {maxTopics} topics added — remove one to change it.
                </p>
              ) : topicMode === 'pick' ? (
                <>
                  <select
                    style={inputStyle}
                    value=""
                    disabled={syllabiLoading}
                    onChange={(e) => { addTopicValue(e.target.value); e.target.value = '' }}>
                    <option value="" disabled>
                      {syllabiLoading
                        ? 'Loading syllabus topics…'
                        : form.topics.length > 0 ? 'Add another topic from the syllabus…' : 'Choose a topic from the syllabus…'}
                    </option>
                    {topicOptions
                      .filter((t) => !form.topics.includes(t))
                      .map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {showAddAll && (
                    <button type="button" className="sv-btn" style={{ marginTop: 6 }}
                      onClick={addAllTopics}>
                      + Add all {topicOptions.length} topics
                    </button>
                  )}
                </>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    list="cpm-topic-options"
                    value={form.topicInput}
                    onChange={(e) => set('topicInput', e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTopic() } }}
                    placeholder={topicOptions[0] ? `e.g. ${topicOptions[0]}` : 'Type a topic'}
                  />
                  <button type="button" className="sv-btn"
                    onClick={addTopic}
                    disabled={!form.topicInput.trim() || form.topics.length >= maxTopics}>
                    + Add
                  </button>
                  <datalist id="cpm-topic-options">
                    {topicOptions.map((t) => <option key={t} value={t} />)}
                  </datalist>
                </div>
              )}
            </div>

            <div>
              <div style={labelRow}>
                <label style={{ ...fieldLabel, marginBottom: 0 }}>Sub-topics (optional)</label>
                <ModeToggle value={subtopicMode} onChange={changeSubtopicMode}
                  pickDisabled={subtopicOptions.length === 0} />
              </div>
              <p style={{ fontSize: 12, color: 'var(--sv-muted, #566f76)', margin: '0 0 6px' }}>
                Pick the sub-topics actually covered — handy for a monthly test
                that only did part of a topic. Leave empty to cover the whole topic.
              </p>
              {form.subtopics.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {form.subtopics.map((s) => (
                    <span key={s} style={chipStyle}>
                      {s}
                      <button type="button" aria-label={`Remove ${s}`}
                        onClick={() => set('subtopics', form.subtopics.filter((x) => x !== s))}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              {subtopicMode === 'pick' ? (
                <select
                  style={inputStyle}
                  value=""
                  disabled={subtopicOptions.length === 0}
                  onChange={(e) => { addSubtopicValue(e.target.value); e.target.value = '' }}>
                  <option value="" disabled>
                    {subtopicOptions.length === 0
                      ? 'Add a topic first to see its sub-topics'
                      : form.subtopics.length > 0 ? 'Add another sub-topic…' : 'Choose a sub-topic…'}
                  </option>
                  {subtopicOptions
                    .filter((s) => !form.subtopics.includes(s))
                    .map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ ...inputStyle, flex: 1 }} list="cpm-subtopic-options"
                    value={form.subtopicInput}
                    onChange={(e) => set('subtopicInput', e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtopic() } }}
                    placeholder="Type a sub-topic" />
                  <button type="button" className="sv-btn"
                    onClick={addSubtopic}
                    disabled={!form.subtopicInput.trim()}>
                    + Add
                  </button>
                  <datalist id="cpm-subtopic-options">
                    {subtopicOptions.map((s) => <option key={s} value={s} />)}
                  </datalist>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={fieldLabel}>Total marks</label>
                <select style={inputStyle} value={String(form.totalMarks)}
                  onChange={(e) => set('totalMarks', Number(e.target.value))}>
                  {MARKS_OPTIONS.map((m) => <option key={m} value={m}>{m} marks</option>)}
                </select>
              </div>
              <div>
                <label style={fieldLabel}>Duration</label>
                <select style={inputStyle} value={String(form.durationMinutes)}
                  onChange={(e) => set('durationMinutes', Number(e.target.value))}>
                  {DURATION_OPTIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
                </select>
              </div>
            </div>

            <div>
              <label style={fieldLabel}>Question types</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {QUESTION_TYPE_OPTIONS.map((t) => {
                  const on = form.questionTypes.includes(t.key)
                  return (
                    <button key={t.key} type="button" onClick={() => toggleType(t.key)}
                      style={{
                        padding: '6px 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
                        border: `1.5px solid ${on ? 'var(--sv-primary, #ff7a2e)' : 'var(--sv-border, #d9cfb8)'}`,
                        background: on ? 'var(--sv-tinted, #fff3e8)' : '#fff',
                        color: 'var(--sv-text, #0e2a32)', fontWeight: on ? 700 : 400,
                      }}>
                      {t.label}
                    </button>
                  )
                })}
                <button type="button" onClick={() => set('comprehension', !form.comprehension)}
                  style={{
                    padding: '6px 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
                    border: `1.5px solid ${form.comprehension ? 'var(--sv-primary, #ff7a2e)' : 'var(--sv-border, #d9cfb8)'}`,
                    background: form.comprehension ? 'var(--sv-tinted, #fff3e8)' : '#fff',
                    color: 'var(--sv-text, #0e2a32)', fontWeight: form.comprehension ? 700 : 400,
                  }}>
                  Comprehension passage
                </button>
              </div>
            </div>

            <div>
              <label style={fieldLabel}>Anything else? (optional)</label>
              <textarea style={{ ...inputStyle, resize: 'vertical' }} rows={2}
                maxLength={300}
                value={form.extra}
                onChange={(e) => set('extra', e.target.value)}
                placeholder="e.g. Focus on word problems about money." />
            </div>

            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer',
              border: '1px solid var(--sv-border, #d9cfb8)', borderRadius: 10, padding: '10px 12px',
            }}>
              <input type="checkbox" checked={form.autoDiagrams}
                onChange={(e) => set('autoDiagrams', e.target.checked)}
                style={{ marginTop: 2 }} />
              <span style={{ fontSize: 13, color: 'var(--sv-text, #0e2a32)' }}>
                <strong>Draw diagrams automatically</strong>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--sv-muted, #566f76)', marginTop: 2 }}>
                  When the paper needs figures (science diagrams, picture options,
                  shapes), generate black-and-white line art for them right away.
                  Adds a few seconds per figure; you can still fine-tune or replace any of them.
                </span>
              </span>
            </label>

            {status === 'error' && (
              <div style={{ borderRadius: 10, border: '1px solid #fca5a5', background: '#fef2f2', color: '#991b1b', padding: '8px 12px', fontSize: 13 }}>
                ⚠️ {error}
              </div>
            )}

            <button type="button" className="sv-btn sv-btn-primary sv-btn-full"
              onClick={onGenerate} disabled={status === 'generating'}>
              {status === 'generating' ? '✦ Writing the paper… (about a minute)' : '✦ Generate paper'}
            </button>

            {status === 'generating' && (
              <div style={{ marginTop: 14 }}>
                <AiGenerationProgress
                  variant="card"
                  running
                  title="Writing your paper…"
                  preset={form.autoDiagrams
                    ? ['reading', 'curriculum', 'content', 'diagrams', 'answerKey', 'preview']
                    : ['reading', 'curriculum', 'content', 'answerKey', 'preview']}
                />
              </div>
            )}
          </div>
        )}

        {status === 'done' && result && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ borderRadius: 10, border: '1px solid var(--sv-border, #d9cfb8)', padding: 12, fontSize: 14, color: 'var(--sv-text, #0e2a32)' }}>
              <strong>{result.assessment?.header?.title || 'Paper ready'}</strong>
              <div style={{ fontSize: 13, color: 'var(--sv-muted, #566f76)', marginTop: 4 }}>
                {result.blocks.questionCount} questions · {result.blocks.totalMarks} marks ·{' '}
                {result.blocks.parts.length} section{result.blocks.parts.length === 1 ? '' : 's'} —
                with answers and a marking guide on every question.
              </div>
              {result.warning && (
                <div style={{ fontSize: 12, color: '#92400e', marginTop: 6 }}>⚠️ {result.warning}</div>
              )}
              {result.blocks.warnings.length > 0 && (
                <div style={{ fontSize: 12, color: '#92400e', marginTop: 6 }}>
                  {result.blocks.warnings.length} question(s) flagged for your review
                  (diagrams to attach or answers to confirm) — they're marked in the builder.
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="sv-btn sv-btn-primary" style={{ flex: 1 }}
                onClick={() => apply('replace')}>
                Use as the paper (replace)
              </button>
              <button type="button" className="sv-btn" style={{ flex: 1 }}
                onClick={() => apply('append')}>
                Add to existing questions
              </button>
            </div>
            <button type="button" className="sv-btn" onClick={() => { setResult(null); setStatus('idle') }}>
              ← Change settings and regenerate
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
