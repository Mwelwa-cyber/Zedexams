/**
 * Renders a Lesson Activities generation ({ exercise, homework }) in the
 * teacher library detail view. Each activity is shown as a titled card with a
 * metadata strip and a numbered, type-aware question list. Answers + the
 * marking guide are revealed by the parent's `showAnswers` toggle.
 */

import { resolveActivityWordBank } from '../../utils/activityWordBank'

function titleCase(s) {
  return String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function MetaStrip({ header = {}, kind }) {
  const bits = [
    kind === 'homework' ? 'Homework' : 'Class Exercise',
    [header.topic, header.subtopic].filter(Boolean).join(' · '),
    header.totalMarks ? `${header.totalMarks} marks` : '',
    header.estimatedMinutes ? `${header.estimatedMinutes} min` : '',
    header.difficulty ? titleCase(header.difficulty) : '',
  ].filter(Boolean)
  return (
    <div className="text-xs mb-2" style={{ color: '#566f76' }}>{bits.join(' · ')}</div>
  )
}

function Question({ q, showAnswers }) {
  return (
    <li style={{ marginBottom: 12 }}>
      <span style={{ color: '#0e2a32' }}>{q.prompt}{q.marks ? ` [${q.marks}]` : ''}</span>

      {q.type === 'multiple_choice' && Array.isArray(q.options) && (
        <div style={{ marginTop: 4, paddingLeft: 10, color: '#3a4d52' }}>
          {q.options.map((o, oi) => {
            const isAnswer = showAnswers && String(q.answer || '').trim().toUpperCase() === String.fromCharCode(65 + oi)
            return (
              <div key={oi} style={isAnswer ? { fontWeight: 700, color: '#0a7d4d' } : undefined}>
                {String.fromCharCode(65 + oi)}) {o}
              </div>
            )
          })}
        </div>
      )}

      {q.type === 'matching' && Array.isArray(q.matchPairs) && (
        <div style={{ marginTop: 4, paddingLeft: 10, color: '#3a4d52' }}>
          {q.matchPairs.map((p, pi) => (
            <div key={pi}>{p.left} — {showAnswers ? <strong style={{ color: '#0a7d4d' }}>{p.right}</strong> : '____'}</div>
          ))}
        </div>
      )}

      {q.type === 'structured' && Array.isArray(q.parts) && (
        <div style={{ marginTop: 4, paddingLeft: 10, color: '#3a4d52' }}>
          {q.parts.map((p, pi) => (
            <div key={pi}>
              {p.label} {p.prompt}{p.marks ? ` [${p.marks}]` : ''}
              {showAnswers && p.answer && <span style={{ color: '#0a7d4d', fontWeight: 600 }}> — {p.answer}</span>}
            </div>
          ))}
        </div>
      )}

      {showAnswers && q.type !== 'matching' && q.type !== 'structured' && (q.answer || q.modelAnswer) && (
        <div style={{ marginTop: 4, paddingLeft: 10, color: '#0a7d4d', fontWeight: 600 }}>
          Answer: {q.answer || q.modelAnswer}
        </div>
      )}
      {showAnswers && q.modelAnswer && q.answer && q.modelAnswer !== q.answer && (
        <div style={{ marginTop: 2, paddingLeft: 10, color: '#566f76', fontStyle: 'italic' }}>{q.modelAnswer}</div>
      )}
    </li>
  )
}

function WordBox({ words }) {
  if (!words || !words.length) return null
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#566f76', marginBottom: 4 }}>Word Box</div>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 6, padding: 10,
        border: '1px solid #c8d3d6', borderRadius: 8, background: '#fff',
      }}>
        {words.map((w, i) => (
          <span key={i} style={{
            padding: '3px 10px', border: '1px solid #d6dee0', borderRadius: 6,
            background: '#f7fafa', fontSize: 13, color: '#0e2a32',
          }}>{w}</span>
        ))}
      </div>
    </div>
  )
}

function ActivityCard({ activity, showAnswers }) {
  if (!activity) return null
  const header = activity.header || {}
  const { words, instructions } = resolveActivityWordBank(activity)
  return (
    <div style={{ marginBottom: 24 }}>
      <h2 className="studio-display" style={{ fontSize: 20, margin: 0 }}>
        {header.title || (activity.kind === 'homework' ? 'Homework' : 'Class Exercise')}
      </h2>
      <MetaStrip header={header} kind={activity.kind} />
      {instructions && (
        <p style={{ color: '#3a4d52', fontSize: 14, marginBottom: 8 }}>{instructions}</p>
      )}
      <WordBox words={words} />
      <ol style={{ paddingLeft: 22, margin: 0, fontSize: 14 }}>
        {(activity.questions || []).map((q, i) => (
          <Question key={i} q={q} showAnswers={showAnswers} />
        ))}
      </ol>
      {activity.kind === 'homework' && activity.parentNote && (
        <p style={{ marginTop: 10, fontSize: 13, color: '#3a4d52' }}>
          <strong>Note for parent / guardian:</strong> {activity.parentNote}
        </p>
      )}
      {showAnswers && activity.answerKey?.markingNotes && (
        <p style={{ marginTop: 8, fontSize: 13, color: '#566f76' }}>
          <strong>Marking guide:</strong> {activity.answerKey.markingNotes}
        </p>
      )}
    </div>
  )
}

export default function LessonActivitiesView({ activities, showAnswers = false }) {
  if (!activities || (!activities.exercise && !activities.homework)) {
    return <p className="text-sm theme-text-secondary italic">No activities to display.</p>
  }
  return (
    <div>
      <ActivityCard activity={activities.exercise} showAnswers={showAnswers} />
      <ActivityCard activity={activities.homework} showAnswers={showAnswers} />
    </div>
  )
}
