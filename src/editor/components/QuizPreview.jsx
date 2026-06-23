import { useEffect, useRef } from 'react'
import { toHTML, hydrateKatex } from '../utils/safeRender.js'
import { canonicalizeQuestionType } from '../schema/question.js'

const QUESTION_TYPES = [
  { v: 'mcq',   l: 'Multiple Choice' },
  { v: 'tf',    l: 'True / False' },
  { v: 'short', l: 'Short Answer' },
  { v: 'fill',  l: 'Fill in the Blank' },
]
const LETTERS = 'ABCDE'

function SafeHTML({ content, className = '' }) {
  const ref = useRef(null)
  const html = toHTML(content)

  useEffect(() => {
    if (ref.current) hydrateKatex(ref.current)
  }, [html])

  if (!html) return null
  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

export default function QuizPreview({ question }) {
  const hasQ = question.questionText !== null && question.questionText !== undefined

  if (!hasQ) {
    return (
      <div className="pempty">
        No question content yet — write something in the Editor tab.
      </div>
    )
  }

  // Fold legacy/aliased spellings ('truefalse' → 'tf', etc.) before switching
  // on the type so an imported true/false question shows its True/False option
  // list and label instead of falling through to the raw-type display.
  const qType = canonicalizeQuestionType(question.type)
  const qtLabel = QUESTION_TYPES.find((t) => t.v === qType)?.l ?? qType

  return (
    <div className="pcard">
      <div className="pmeta">
        <span className="pmarks">
          {question.marks} Mark{question.marks !== 1 ? 's' : ''}
        </span>
        {question.topic && <span className="ptopic">{question.topic}</span>}
        <span style={{ marginLeft: 'auto', fontSize: '10.5px', color: 'var(--sl4)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
          {qtLabel}
        </span>
      </div>

      <SafeHTML content={question.instructions} className="pinstr" />
      <SafeHTML content={question.passage}      className="ppassage" />
      <SafeHTML content={question.questionText} className="pq" />

      {(qType === 'mcq' || qType === 'tf') && (
        <div>
          {(qType === 'tf' ? ['True', 'False'] : question.options).map((opt, i) => (
            <div key={i} className={`popt${i === question.correct ? ' correct' : ''}`}>
              <div className="poltr">{LETTERS[i]}</div>
              <div>
                {opt || <em style={{ color: 'var(--sl4)' }}>Option {LETTERS[i]}</em>}
              </div>
            </div>
          ))}
        </div>
      )}

      {question.explanation && (
        <div className="pexpl">
          <div className="pexpl-hd">💡 Explanation / Model Answer</div>
          <SafeHTML content={question.explanation} />
        </div>
      )}
    </div>
  )
}
