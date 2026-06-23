import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { generateLessonActivities } from '../../../utils/teacherTools'
import { downloadActivityDocx } from '../../../utils/activityToDocx'
import { activityToBankQuestions } from '../../../utils/activityBankCore'
import { saveQuestionToBank } from '../../../utils/questionBankService'
import { attachLibraryToGeneration, isFreePlanTeacher } from '../../../utils/teacherLibraryService'
import { resolveTeacherPlan } from '../../../utils/teacherPlans'
import { LIBRARY_TYPES } from '../../../config/library'
import { buildDownloadName } from '../../../utils/downloadFilename'

// Generation modes shown to the teacher. The lesson plan already exists in the
// studio, so "Lesson Plan Only" simply runs nothing here.
const MODES = [
  { value: 'none', label: 'Lesson Plan Only' },
  { value: 'exercise', label: '+ Class Exercise' },
  { value: 'homework', label: '+ Homework' },
  { value: 'both', label: '+ Exercise & Homework' },
]

const DIFFICULTIES = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'challenging', label: 'Challenging' },
]

const QUESTION_TYPES = [
  { value: 'multiple_choice', label: 'Multiple Choice' },
  { value: 'short_answer', label: 'Short Answer' },
  { value: 'fill_in_blank', label: 'Fill in the Blanks' },
  { value: 'matching', label: 'Matching' },
  { value: 'structured', label: 'Structured' },
  { value: 'mixed', label: 'Mixed' },
]

const card = {
  border: '1px solid var(--line, #e5ddd0)', borderRadius: '10px',
  background: 'var(--paper, #faf6ef)', padding: '14px', marginBottom: '12px',
}
const labelStyle = { fontSize: '12px', fontWeight: 700, color: '#7a6d5d', display: 'block', marginBottom: '4px' }
const inputStyle = { width: '100%', padding: '6px 8px', borderRadius: '7px', border: '1px solid var(--line, #d9cfbe)', fontSize: '13px' }
const btnStyle = {
  padding: '7px 12px', borderRadius: '8px', border: '1px solid var(--accent, #0a5454)',
  background: 'var(--accent, #0a5454)', color: '#faf6ef', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
}
const btnGhost = { ...btnStyle, background: 'transparent', color: 'var(--accent, #0a5454)' }

function TypePicker({ selected, onToggle }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
      {QUESTION_TYPES.map((t) => {
        const on = selected.includes(t.value)
        return (
          <button
            key={t.value} type="button" onClick={() => onToggle(t.value)}
            style={{
              padding: '4px 10px', borderRadius: '999px', fontSize: '12px', cursor: 'pointer',
              border: `1px solid ${on ? 'var(--accent, #0a5454)' : 'var(--line, #d9cfbe)'}`,
              background: on ? 'var(--accent, #0a5454)' : 'transparent',
              color: on ? '#faf6ef' : '#5a4f42', fontWeight: on ? 700 : 500,
            }}
          >{t.label}</button>
        )
      })}
    </div>
  )
}

function ActivityView({ activity, showAnswers }) {
  if (!activity) return null
  const h = activity.header || {}
  return (
    <div style={{ marginTop: '10px' }}>
      <div style={{ fontWeight: 800, fontSize: '15px', marginBottom: '2px' }}>{h.title}</div>
      <div style={{ fontSize: '12px', color: '#7a6d5d', marginBottom: '8px' }}>
        {[h.topic, h.subtopic].filter(Boolean).join(' · ')}
        {h.totalMarks ? ` · ${h.totalMarks} marks` : ''}
        {h.estimatedMinutes ? ` · ${h.estimatedMinutes} min` : ''}
        {h.difficulty ? ` · ${h.difficulty}` : ''}
      </div>
      {activity.instructions && (
        <div style={{ fontSize: '13px', fontStyle: 'italic', color: '#5a4f42', marginBottom: '8px' }}>{activity.instructions}</div>
      )}
      <ol style={{ paddingLeft: '20px', margin: 0 }}>
        {(activity.questions || []).map((q, i) => (
          <li key={i} style={{ marginBottom: '10px', fontSize: '13px' }}>
            <span>{q.prompt}{q.marks ? ` [${q.marks}]` : ''}</span>
            {q.type === 'multiple_choice' && Array.isArray(q.options) && (
              <div style={{ marginTop: '3px', paddingLeft: '8px', color: '#5a4f42' }}>
                {q.options.map((o, oi) => (
                  <div key={oi}>{String.fromCharCode(65 + oi)}) {o}</div>
                ))}
              </div>
            )}
            {q.type === 'matching' && Array.isArray(q.matchPairs) && (
              <div style={{ marginTop: '3px', paddingLeft: '8px', color: '#5a4f42' }}>
                {q.matchPairs.map((p, pi) => (
                  <div key={pi}>{p.left} — {showAnswers ? p.right : '____'}</div>
                ))}
              </div>
            )}
            {q.type === 'structured' && Array.isArray(q.parts) && (
              <div style={{ marginTop: '3px', paddingLeft: '8px', color: '#5a4f42' }}>
                {q.parts.map((p, pi) => (
                  <div key={pi}>{p.label} {p.prompt}{p.marks ? ` [${p.marks}]` : ''}{showAnswers && p.answer ? ` — ${p.answer}` : ''}</div>
                ))}
              </div>
            )}
            {showAnswers && q.type !== 'matching' && q.type !== 'structured' && (q.answer || q.modelAnswer) && (
              <div style={{ marginTop: '3px', paddingLeft: '8px', color: '#0a5454', fontWeight: 600 }}>
                Answer: {q.answer || q.modelAnswer}
              </div>
            )}
          </li>
        ))}
      </ol>
      {showAnswers && activity.answerKey?.markingNotes && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: '#5a4f42' }}>
          <strong>Marking guide:</strong> {activity.answerKey.markingNotes}
        </div>
      )}
    </div>
  )
}

/**
 * "Assessment Activities" — generates a class exercise and/or homework from the
 * lesson the teacher just created in the Lesson Plan Studio. `kit` carries the
 * CBC-normalised coords ({grade, subject, topic, subtopic, term}) the studio
 * surfaces after a successful generation.
 */
export default function AssessmentActivitiesPanel({ kit }) {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const isFree = resolveTeacherPlan(userProfile) === 'free' && !isAdmin

  const [mode, setMode] = useState('none')
  const [exDifficulty, setExDifficulty] = useState('medium')
  const [exCount, setExCount] = useState(5)
  const [exTypes, setExTypes] = useState(['multiple_choice', 'short_answer'])
  const [hwDifficulty, setHwDifficulty] = useState('medium')
  const [hwCount, setHwCount] = useState(6)
  const [hwMinutes, setHwMinutes] = useState(20)
  const [hwTypes, setHwTypes] = useState(['short_answer', 'fill_in_blank'])
  const [includeMarkingGuide, setIncludeMarkingGuide] = useState(true)
  const [includeModelAnswers, setIncludeModelAnswers] = useState(true)

  const [status, setStatus] = useState('idle') // idle | generating | success | error
  const [error, setError] = useState('')
  const [result, setResult] = useState(null) // { exercise, homework }
  const [warning, setWarning] = useState('')
  const [showAnswers, setShowAnswers] = useState(true)
  const [savedMsg, setSavedMsg] = useState('')

  if (!kit) return null

  const toggle = (list, setList) => (value) => {
    setList(list.includes(value) ? list.filter(v => v !== value) : [...list, value])
  }

  async function onGenerate() {
    if (mode === 'none') return
    setStatus('generating')
    setError('')
    setWarning('')
    setResult(null)
    setSavedMsg('')
    const res = await generateLessonActivities({
      grade: kit.grade,
      subject: kit.subject,
      topic: kit.topic,
      subtopic: kit.subtopic,
      term: kit.term,
      activities: mode,
      exercise: { count: exCount, difficulty: exDifficulty, questionTypes: exTypes },
      homework: { count: hwCount, difficulty: hwDifficulty, estimatedMinutes: hwMinutes, questionTypes: hwTypes },
      includeMarkingGuide,
      includeModelAnswers,
    })
    if (!res.ok) {
      setStatus('error')
      setError(res.error || 'Could not generate the activities.')
      return
    }
    setResult(res.data.activities || null)
    setWarning(res.data.warning || '')
    setStatus('success')
    // Auto-file into the teacher library like the other studios do.
    if (res.data.generationId) {
      attachLibraryToGeneration(res.data.generationId, {
        libraryType: LIBRARY_TYPES.ASSESSMENTS,
        grade: kit.grade,
        subject: kit.subject,
        assessmentType: 'topic',
      }).catch(() => {})
    }
  }

  function onDownload(activity, includeAnswers) {
    if (!activity) return
    const docType = `${activity.kind === 'homework' ? 'Homework' : 'Class Exercise'}${includeAnswers ? '' : ' (pupil)'}`
    const name = buildDownloadName({
      docType, grade: kit.grade, subject: kit.subject, topic: activity.header?.topic,
    })
    downloadActivityDocx(activity, name, {
      includeAnswers,
      includeModelAnswers,
      attribution: isFreePlanTeacher({ userProfile, isAdmin }),
    })
  }

  async function onSaveToBank(activity) {
    const uid = currentUser?.uid
    if (!uid || !activity) return
    setSavedMsg('Saving to question bank…')
    const { questions, skipped } = activityToBankQuestions(activity, { topic: kit.topic })
    let saved = 0
    for (const q of questions) {
      try {
        await saveQuestionToBank(uid, q, { grade: kit.grade, subject: kit.subject, topic: kit.topic })
        saved += 1
      } catch { /* keep going — best effort */ }
    }
    setSavedMsg(
      saved
        ? `Saved ${saved} question${saved === 1 ? '' : 's'} to your question bank${skipped ? ` (${skipped} multi-part question${skipped === 1 ? '' : 's'} skipped)` : ''}.`
        : 'No questions could be saved to the bank.',
    )
  }

  const wantEx = mode === 'exercise' || mode === 'both'
  const wantHw = mode === 'homework' || mode === 'both'

  return (
    <div style={{ padding: '14px', borderTop: '1px solid var(--line, #e5ddd0)', background: 'var(--bg, #fff)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>Assessment Activities</h3>
        <span style={{ fontSize: '12px', color: '#7a6d5d' }}>Build follow-up work straight from this lesson</span>
      </div>
      <p style={{ fontSize: '12px', color: '#7a6d5d', marginTop: 0, marginBottom: '10px' }}>
        Aligned to {kit.grade} · {String(kit.subject || '').replace(/_/g, ' ')} · {kit.topic}{kit.subtopic ? ` · ${kit.subtopic}` : ''}
      </p>

      {isFree && (
        <div style={{ ...card, borderColor: '#caa14a', background: '#fdf6e3' }}>
          <strong style={{ fontSize: '13px' }}>Class Exercise & Homework are a Pro feature.</strong>
          <div style={{ fontSize: '12px', color: '#5a4f42', marginTop: '4px' }}>
            Your lesson plan is free. To auto-generate aligned exercises and homework,{' '}
            <Link to="/pricing" style={{ color: 'var(--accent, #0a5454)', fontWeight: 700 }}>upgrade to Pro</Link>.
          </div>
        </div>
      )}

      {/* Mode selector */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
        {MODES.map((m) => (
          <button
            key={m.value} type="button" onClick={() => setMode(m.value)}
            style={{
              padding: '6px 12px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', fontWeight: mode === m.value ? 700 : 500,
              border: `1px solid ${mode === m.value ? 'var(--accent, #0a5454)' : 'var(--line, #d9cfbe)'}`,
              background: mode === m.value ? 'var(--accent, #0a5454)' : 'transparent',
              color: mode === m.value ? '#faf6ef' : '#5a4f42',
            }}
          >{m.label}</button>
        ))}
      </div>

      {wantEx && (
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px' }}>Class Exercise settings</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label style={labelStyle}>Number of questions</label>
              <input type="number" min="2" max="20" value={exCount} style={inputStyle}
                onChange={(e) => setExCount(Number(e.target.value) || 5)} />
            </div>
            <div>
              <label style={labelStyle}>Difficulty</label>
              <select value={exDifficulty} style={inputStyle} onChange={(e) => setExDifficulty(e.target.value)}>
                {DIFFICULTIES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          </div>
          <label style={labelStyle}>Question types</label>
          <TypePicker selected={exTypes} onToggle={toggle(exTypes, setExTypes)} />
        </div>
      )}

      {wantHw && (
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px' }}>Homework settings</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label style={labelStyle}>Questions</label>
              <input type="number" min="2" max="20" value={hwCount} style={inputStyle}
                onChange={(e) => setHwCount(Number(e.target.value) || 6)} />
            </div>
            <div>
              <label style={labelStyle}>Difficulty</label>
              <select value={hwDifficulty} style={inputStyle} onChange={(e) => setHwDifficulty(e.target.value)}>
                {DIFFICULTIES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Time (min)</label>
              <input type="number" min="5" max="120" value={hwMinutes} style={inputStyle}
                onChange={(e) => setHwMinutes(Number(e.target.value) || 20)} />
            </div>
          </div>
          <label style={labelStyle}>Question types</label>
          <TypePicker selected={hwTypes} onToggle={toggle(hwTypes, setHwTypes)} />
        </div>
      )}

      {mode !== 'none' && (
        <div style={{ ...card, display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input type="checkbox" checked={includeMarkingGuide} onChange={(e) => setIncludeMarkingGuide(e.target.checked)} />
            Include marking guide
          </label>
          <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input type="checkbox" checked={includeModelAnswers} onChange={(e) => setIncludeModelAnswers(e.target.checked)} />
            Include model answers
          </label>
        </div>
      )}

      {mode !== 'none' && (
        <button type="button" onClick={onGenerate} disabled={status === 'generating'}
          style={{ ...btnStyle, opacity: status === 'generating' ? 0.6 : 1 }}>
          {status === 'generating' ? 'Generating…' : `Generate ${mode === 'both' ? 'exercise + homework' : mode}`}
        </button>
      )}

      {status === 'error' && (
        <div style={{ marginTop: '10px', color: '#b91c1c', fontSize: '13px' }}>{error}</div>
      )}
      {warning && status === 'success' && (
        <div style={{ marginTop: '10px', color: '#92600a', fontSize: '12px' }}>{warning}</div>
      )}

      {status === 'success' && result && (
        <div style={{ marginTop: '14px' }}>
          <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', cursor: 'pointer' }}>
            <input type="checkbox" checked={showAnswers} onChange={(e) => setShowAnswers(e.target.checked)} />
            Show answers in preview
          </label>

          {[result.exercise, result.homework].filter(Boolean).map((activity) => (
            <div key={activity.kind} style={{ ...card, background: 'var(--bg, #fff)' }}>
              <ActivityView activity={activity} showAnswers={showAnswers} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                <button type="button" style={btnStyle} onClick={() => onDownload(activity, false)}>Download Word (pupil)</button>
                <button type="button" style={btnGhost} onClick={() => onDownload(activity, true)}>Download Word (answer key)</button>
                <button type="button" style={btnGhost} onClick={() => onSaveToBank(activity)}>Save to Question Bank</button>
              </div>
            </div>
          ))}

          {savedMsg && <div style={{ fontSize: '12px', color: '#0a5454', marginTop: '4px' }}>{savedMsg}</div>}
          <div style={{ fontSize: '12px', color: '#7a6d5d', marginTop: '4px' }}>
            Saved to your <Link to="/teacher/library" style={{ color: 'var(--accent, #0a5454)' }}>teacher library</Link>.
          </div>
        </div>
      )}
    </div>
  )
}
