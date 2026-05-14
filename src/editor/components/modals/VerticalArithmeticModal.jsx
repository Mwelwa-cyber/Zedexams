/**
 * src/editor/components/modals/VerticalArithmeticModal.jsx
 *
 * Insert / edit a vertical-arithmetic block (column-aligned addition,
 * subtraction, multiplication, division). Matches the way Grade 7 Zambian
 * exam papers print arithmetic questions.
 *
 * Props:
 *   editor      Tiptap editor instance
 *   editState   { attrs, pos } when editing an existing block; null on insert
 *   onClose     ()
 */

import { useState, useEffect, useRef } from 'react'
import { VERT_OPERATORS, buildVerticalArithmeticInner } from '../../extensions/VerticalArithmetic.js'

const OPERATOR_LABELS = {
  '+': 'Add',
  '−': 'Subtract',
  '×': 'Multiply',
  '÷': 'Divide',
}

export default function VerticalArithmeticModal({ editor, editState, onClose }) {
  const isEditing = Boolean(editState)

  const [operator, setOperator] = useState(editState?.attrs?.operator || '−')
  const [lines, setLines] = useState(
    Array.isArray(editState?.attrs?.lines) && editState.attrs.lines.length
      ? editState.attrs.lines
      : ['2376', '1154']
  )
  const [answer, setAnswer] = useState(editState?.attrs?.answer || '')
  const [working, setWorking] = useState(Boolean(editState?.attrs?.working))

  const previewRef = useRef(null)

  // Keep a live preview that matches the rendered block exactly.
  useEffect(() => {
    if (previewRef.current) {
      previewRef.current.innerHTML = buildVerticalArithmeticInner({
        operator, lines, answer, working,
      })
    }
  }, [operator, lines, answer, working])

  const updateLine = (idx, value) => {
    const next = [...lines]
    next[idx] = value.replace(/[^0-9.\-]/g, '')
    setLines(next)
  }

  const addLine = () => {
    if (lines.length >= 5) return
    setLines([...lines, ''])
  }

  const removeLine = (idx) => {
    if (lines.length <= 2) return
    setLines(lines.filter((_, i) => i !== idx))
  }

  const handleSave = () => {
    if (!editor) return
    const cleanLines = lines.map((l) => String(l ?? '').trim()).filter((l, i) => {
      if (i < 2) return true  // always keep first two lines (even if blank)
      return l.length > 0
    })

    const attrs = {
      operator,
      lines: cleanLines.length ? cleanLines : ['', ''],
      answer: String(answer || '').trim(),
      working,
    }

    if (isEditing && editState.pos !== null) {
      const { state, view } = editor
      const tr = state.tr
      tr.setNodeMarkup(editState.pos, undefined, attrs)
      view.dispatch(tr)
    } else {
      editor.chain().focus().insertVerticalArithmetic(attrs).run()
    }
    onClose()
  }

  const handleDelete = () => {
    if (!editor || !isEditing || editState.pos === null) return
    const { state, view } = editor
    const node = state.doc.nodeAt(editState.pos)
    if (node) {
      const tr = state.tr
      tr.delete(editState.pos, editState.pos + node.nodeSize)
      view.dispatch(tr)
    }
    onClose()
  }

  return (
    <div
      className="overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="modal math-modal va-modal"
        role="dialog"
        aria-modal="true"
        aria-label={isEditing ? 'Edit vertical arithmetic' : 'Insert vertical arithmetic'}
      >
        <div className="mhd">
          <span className="mtitle">{isEditing ? '✏️ Edit Vertical Sum' : '🧮 Insert Vertical Sum'}</span>
          <button className="mx" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="mbd">
          <div className="mlbl">Operator</div>
          <div className="va-op-row va-op-picker">
            {VERT_OPERATORS.map((op) => (
              <button
                key={op}
                type="button"
                className={`va-op-btn${operator === op ? ' on' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOperator(op)}
                aria-pressed={operator === op}
                title={OPERATOR_LABELS[op]}
              >
                <span className="va-op-glyph">{op}</span>
                <span className="va-op-name">{OPERATOR_LABELS[op]}</span>
              </button>
            ))}
          </div>

          <div className="mlbl" style={{ marginTop: 14 }}>Numbers (top → bottom)</div>
          <div className="va-line-list">
            {lines.map((line, idx) => (
              <div className="va-line-edit" key={idx}>
                <span className="va-line-lbl">
                  {idx === lines.length - 1 ? operator : ' '}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="qe-inp va-line-input"
                  value={line}
                  onChange={(e) => updateLine(idx, e.target.value)}
                  placeholder={idx === 0 ? 'e.g. 2376' : 'e.g. 1154'}
                  aria-label={`Line ${idx + 1}`}
                />
                {lines.length > 2 && (
                  <button
                    type="button"
                    className="btn-x"
                    onClick={() => removeLine(idx)}
                    aria-label={`Remove line ${idx + 1}`}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {lines.length < 5 && (
              <button
                type="button"
                className="btn btn-s va-line-add"
                onClick={addLine}
              >
                + Add line
              </button>
            )}
          </div>

          <div className="mlbl" style={{ marginTop: 14 }}>Answer (leave blank for pupil to fill)</div>
          <input
            type="text"
            inputMode="decimal"
            className="qe-inp va-answer-input"
            value={answer}
            onChange={(e) => setAnswer(e.target.value.replace(/[^0-9.\-]/g, ''))}
            placeholder="Leave blank or type the answer"
            aria-label="Answer"
          />

          <label className="va-working-toggle">
            <input
              type="checkbox"
              checked={working}
              onChange={(e) => setWorking(e.target.checked)}
            />
            <span>Include extra working lines below</span>
          </label>

          <div className="mlbl" style={{ marginTop: 12 }}>Preview</div>
          <div className="va-preview">
            <div className="vert-arith" ref={previewRef} />
          </div>
        </div>

        <div className="mft">
          {isEditing && (
            <button type="button" className="btn btn-d" onClick={handleDelete}>
              Delete
            </button>
          )}
          <button type="button" className="btn btn-s" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-p" onClick={handleSave}>
            {isEditing ? 'Update' : 'Insert'}
          </button>
        </div>
      </div>
    </div>
  )
}
