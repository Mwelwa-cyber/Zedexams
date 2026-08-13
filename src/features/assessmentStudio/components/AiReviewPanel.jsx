/**
 * AiReviewPanel — the accept/discard pass for the AI slide-over's quick
 * "Generate questions" flow.
 *
 * Generated questions used to be appended straight into the paper with only
 * a toast; incomplete ones were silently filtered. Now the batch lands here
 * first: every kept question is previewed with an accept checkbox (default
 * on), the header states exactly how many were generated and how many were
 * incomplete-and-dropped, and nothing touches the paper until the teacher
 * clicks "Add N questions".
 */

import { useEffect, useState } from 'react'
import Icon from './studioIcons'
import {
  questionTypeLabel,
  questionPreviewText,
  optionPreviewTexts,
} from '../lib/aiQuestionReview'

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

export default function AiReviewPanel({ review, onConfirm, onDiscard }) {
  const questions = Array.isArray(review?.questions) ? review.questions : []
  // Accepted flags by index — default everything on; unticking is the
  // exception path (a bad question), not the norm.
  const [accepted, setAccepted] = useState(() => questions.map(() => true))
  // A fresh generation replaces the panel contents — re-arm the checkboxes.
  useEffect(() => { setAccepted(questions.map(() => true)) }, [review]) // eslint-disable-line react-hooks/exhaustive-deps

  const acceptedCount = accepted.filter(Boolean).length
  const dropped = Number(review?.droppedCount || 0)

  function toggle(i) {
    setAccepted(prev => prev.map((v, j) => (j === i ? !v : v)))
  }

  return (
    <div className="sv-ai-review">
      <div
        style={{
          background: '#f0faf4', border: '1.5px solid #6ee7b7',
          borderRadius: 10, padding: '10px 14px', fontSize: 12, marginBottom: 10,
        }}
      >
        <strong style={{ color: 'var(--success-fg)' }}>
          {questions.length} question{questions.length === 1 ? '' : 's'} generated
        </strong>
        {dropped > 0 && (
          <span style={{ color: '#92400e', marginLeft: 8 }}>
            · {dropped} incomplete and dropped
          </span>
        )}
        <div style={{ color: 'var(--zt-text-muted)', marginTop: 4 }}>
          Untick any question you don&apos;t want, then add the rest to your paper.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {questions.map((q, i) => {
          const isOn = Boolean(accepted[i])
          const options = optionPreviewTexts(q)
          return (
            <label
              key={i}
              style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer',
                border: `1.5px solid ${isOn ? 'var(--sv-primary)' : 'var(--sv-border)'}`,
                borderRadius: 10, padding: '10px 12px',
                background: isOn ? 'var(--sv-paper)' : 'var(--sv-canvas-2)',
                opacity: isOn ? 1 : 0.6,
              }}
            >
              <input
                type="checkbox"
                checked={isOn}
                onChange={() => toggle(i)}
                aria-label={`Keep question ${i + 1}`}
                style={{ accentColor: 'var(--sv-primary)', marginTop: 3 }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                  <strong style={{ fontSize: 12 }}>Q{i + 1}</strong>
                  <span className="sv-chip" style={{ fontSize: 10, padding: '1px 8px' }}>
                    {questionTypeLabel(q?.type)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--sv-muted)' }}>
                    {Number(q?.marks) > 0 ? `${q.marks} mark${Number(q.marks) === 1 ? '' : 's'}` : '1 mark'}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--sv-text)', lineHeight: 1.45 }}>
                  {questionPreviewText(q) || '(no question text)'}
                </div>
                {options.length > 0 && (
                  <ul style={{ margin: '6px 0 0', paddingLeft: 0, listStyle: 'none', fontSize: 12, color: 'var(--sv-muted)' }}>
                    {options.slice(0, 6).map((opt, oi) => (
                      <li key={oi}>{LETTERS[oi]}. {opt}</li>
                    ))}
                  </ul>
                )}
              </div>
            </label>
          )
        })}
      </div>

      <button
        className="sv-btn sv-btn-primary sv-btn-full"
        onClick={() => onConfirm(questions.filter((_, i) => accepted[i]))}
        disabled={acceptedCount === 0}
      >
        <Icon name="add" size={15} /> Add {acceptedCount} question{acceptedCount === 1 ? '' : 's'} to the paper
      </button>
      <button
        className="sv-btn sv-btn-full"
        onClick={onDiscard}
        style={{ marginTop: 6 }}
      >
        Discard all
      </button>
    </div>
  )
}
