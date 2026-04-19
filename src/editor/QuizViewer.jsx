/**
 * src/editor/QuizViewer.jsx
 *
 * LEARNER-SIDE RENDERER
 *
 * Renders a saved question for the student to answer.
 * Safe: all HTML goes through toHTML() + hydrateKatex().
 * Interactive: tracks selected answer, shows result on submit.
 *
 * Replace your current learner-side question renderer with this.
 *
 * Usage:
 *   import QuizViewer from './editor/QuizViewer'
 *
 *   // Controlled (parent manages answer state):
 *   <QuizViewer question={q} selected={selected} onSelect={setSelected} onSubmit={handleSubmit} />
 *
 *   // Standalone (internal state):
 *   <QuizViewer question={q} />
 *
 * Props:
 *   question        {object}      Question from DB (any content format — migrated automatically)
 *   selected        {number|null} Currently selected option index (controlled)
 *   onSelect        {function}    Called with option index when student selects
 *   onSubmit        {function}    Called with { selected, correct, isCorrect } on submit
 *   showExplanation {boolean}     Force-show explanation (e.g. after submission from parent)
 *   readOnly        {boolean}     Disable interaction (e.g. in a review/report view)
 *   className       {string}      Optional CSS class
 */

import { useState, useEffect, useRef } from 'react'
import { toHTML, hydrateKatex }  from './utils/safeRender.js'
import { migrateContent }         from './utils/migration.js'
import './editor.css'

const LETTERS = 'ABCDE'

/**
 * SafeHTML — mounts sanitized HTML and hydrates KaTeX math nodes.
 */
function SafeHTML({ content, className = '' }) {
  const ref  = useRef(null)
  const html = toHTML(content)

  useEffect(() => {
    if (ref.current) hydrateKatex(ref.current)
  }, [html])

  if (!html) return null
  return (
    <div
      ref={ref}
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export default function QuizViewer({
  question,
  selected: controlledSelected,
  onSelect,
  onSubmit,
  showExplanation: forceExplanation = false,
  readOnly = false,
  className = '',
}) {
  // Migrate content fields that might still be in legacy format
  const q = {
    ...question,
    instructions: migrateContent(question.instructions),
    passage:       migrateContent(question.passage),
    questionText:  migrateContent(question.questionText),
    explanation:   migrateContent(question.explanation),
  }

  // Internal state (used when component is uncontrolled)
  const [internalSelected, setInternalSelected] = useState(null)
  const [submitted,         setSubmitted]        = useState(false)
  const [showExplanation,   setShowExplanation]  = useState(forceExplanation)

  // Resolve controlled vs uncontrolled
  const isControlled  = controlledSelected !== undefined
  const selected      = isControlled ? controlledSelected : internalSelected

  const handleSelect = (i) => {
    if (readOnly || submitted) return
    if (isControlled) {
      onSelect?.(i)
    } else {
      setInternalSelected(i)
    }
  }

  const handleSubmit = () => {
    if (selected === null || selected === undefined) return
    setSubmitted(true)
    setShowExplanation(true)
    onSubmit?.({
      selected,
      correct:   q.correct,
      isCorrect: selected === q.correct,
    })
  }

  const handleReset = () => {
    setSubmitted(false)
    setShowExplanation(false)
    if (!isControlled) setInternalSelected(null)
  }

  const isTF      = q.type === 'tf'
  const displayOptions = isTF ? ['True', 'False'] : (q.options ?? [])
  const isAnswerable   = q.type === 'mcq' || q.type === 'tf'

  // Compute option state
  const getOptClass = (i) => {
    if (!submitted) return selected === i ? 'popt selected' : 'popt'
    if (i === q.correct)  return 'popt correct'
    if (i === selected)   return 'popt wrong'
    return 'popt'
  }

  return (
    <div className={`pcard viewer ${className}`}>
      {/* Meta */}
      <div className="pmeta">
        <span className="pmarks">
          {q.marks} Mark{q.marks !== 1 ? 's' : ''}
        </span>
        {q.topic && <span className="ptopic">{q.topic}</span>}
        {q.difficulty && (
          <span style={{ marginLeft: 'auto', fontSize: '10.5px', color: 'var(--sl4)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
            {q.difficulty}
          </span>
        )}
      </div>

      {/* Instructions */}
      <SafeHTML content={q.instructions} className="pinstr" />

      {/* Passage */}
      <SafeHTML content={q.passage} className="ppassage" />

      {/* Question */}
      <SafeHTML content={q.questionText} className="pq" />

      {/* Answer options */}
      {isAnswerable && (
        <div>
          {displayOptions.map((opt, i) => (
            <div
              key={i}
              className={getOptClass(i)}
              onClick={() => handleSelect(i)}
              role="radio"
              aria-checked={selected === i}
              tabIndex={readOnly || submitted ? -1 : 0}
              onKeyDown={(e) => e.key === 'Enter' && handleSelect(i)}
            >
              <div className="poltr">{LETTERS[i]}</div>
              <div>{opt}</div>
            </div>
          ))}
        </div>
      )}

      {/* Short answer / fill-in input */}
      {(q.type === 'short' || q.type === 'fill') && (
        <textarea
          className="qe-inp"
          placeholder="Type your answer here…"
          rows={3}
          style={{ resize: 'vertical', marginTop: '8px' }}
          readOnly={readOnly || submitted}
        />
      )}

      {/* Submit / Result row */}
      {isAnswerable && !submitted && !readOnly && (
        <button
          type="button"
          className="btn btn-p"
          style={{ marginTop: '14px', width: '100%' }}
          onClick={handleSubmit}
          disabled={selected === null || selected === undefined}
        >
          Submit Answer
        </button>
      )}
      {submitted && (
        <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            fontSize: '14px', fontWeight: 700,
            color: selected === q.correct ? '#16a34a' : 'var(--ro)',
          }}>
            {selected === q.correct ? '✓ Correct!' : '✗ Incorrect'}
          </span>
          {!readOnly && (
            <button type="button" className="btn btn-s" style={{ marginLeft: 'auto' }}
              onClick={handleReset}>
              Try Again
            </button>
          )}
        </div>
      )}

      {/* Explanation — shown after submit or when forceExplanation */}
      {(showExplanation || forceExplanation) && q.explanation && (
        <div className="pexpl" style={{ marginTop: '14px' }}>
          <div className="pexpl-hd">💡 Explanation / Model Answer</div>
          <SafeHTML content={q.explanation} />
        </div>
      )}
    </div>
  )
}
