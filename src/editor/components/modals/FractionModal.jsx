/**
 * src/editor/components/modals/FractionModal.jsx
 *
 * Insert / edit a fraction (proper, improper, or mixed). The numerator is
 * stacked above the denominator on display, and an optional whole-number
 * field gives mixed-fraction support like 1 1/3.
 *
 * Props:
 *   editor      Tiptap editor instance
 *   editState   { attrs, pos } when editing; null on insert
 *   onClose     ()
 */

import { useState, useEffect, useRef } from 'react'
import { buildFractionInner } from '../../extensions/MathFraction.js'

const PRESETS = [
  { label: '½', whole: '', num: '1', den: '2' },
  { label: '¼', whole: '', num: '1', den: '4' },
  { label: '¾', whole: '', num: '3', den: '4' },
  { label: '⅓', whole: '', num: '1', den: '3' },
  { label: '⅔', whole: '', num: '2', den: '3' },
  { label: '⅕', whole: '', num: '1', den: '5' },
  { label: '1 ½', whole: '1', num: '1', den: '2' },
  { label: '1 ⅓', whole: '1', num: '1', den: '3' },
]

export default function FractionModal({ editor, editState, onClose }) {
  const isEditing = Boolean(editState)

  const [whole, setWhole] = useState(editState?.attrs?.whole || '')
  const [num, setNum] = useState(editState?.attrs?.num || '')
  const [den, setDen] = useState(editState?.attrs?.den || '')

  const previewRef = useRef(null)

  useEffect(() => {
    if (previewRef.current) {
      previewRef.current.innerHTML = buildFractionInner({ whole, num, den })
    }
  }, [whole, num, den])

  const apply = (preset) => {
    setWhole(preset.whole)
    setNum(preset.num)
    setDen(preset.den)
  }

  const handleSave = () => {
    if (!editor) return
    if (!num || !den) return
    const attrs = {
      whole: String(whole || '').trim(),
      num: String(num).trim(),
      den: String(den).trim(),
    }
    if (isEditing && editState.pos !== null) {
      const { state, view } = editor
      const tr = state.tr
      tr.setNodeMarkup(editState.pos, undefined, attrs)
      view.dispatch(tr)
    } else {
      editor.chain().focus().insertMathFraction(attrs).run()
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

  const cleanDigits = (v) => String(v ?? '').replace(/[^0-9.-]/g, '')

  return (
    <div
      className="overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="modal math-modal frac-modal"
        role="dialog"
        aria-modal="true"
        aria-label={isEditing ? 'Edit fraction' : 'Insert fraction'}
      >
        <div className="mhd">
          <span className="mtitle">{isEditing ? '✏️ Edit Fraction' : '⅗ Insert Fraction'}</span>
          <button className="mx" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="mbd">
          <div className="mlbl">Quick choices</div>
          <div className="frac-presets">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="frac-preset"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply(p)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="mlbl" style={{ marginTop: 14 }}>Whole number (optional — for mixed fractions)</div>
          <input
            type="text"
            inputMode="decimal"
            className="qe-inp"
            value={whole}
            onChange={(e) => setWhole(cleanDigits(e.target.value))}
            placeholder="e.g. 1"
            aria-label="Whole number"
          />

          <div className="frac-num-den">
            <div className="frac-field">
              <label className="mlbl">Numerator</label>
              <input
                type="text"
                inputMode="decimal"
                className="qe-inp"
                value={num}
                onChange={(e) => setNum(cleanDigits(e.target.value))}
                placeholder="1"
                aria-label="Numerator"
                autoFocus={!isEditing}
              />
            </div>
            <div className="frac-divider" aria-hidden="true">/</div>
            <div className="frac-field">
              <label className="mlbl">Denominator</label>
              <input
                type="text"
                inputMode="decimal"
                className="qe-inp"
                value={den}
                onChange={(e) => setDen(cleanDigits(e.target.value))}
                placeholder="3"
                aria-label="Denominator"
              />
            </div>
          </div>

          <div className="mlbl" style={{ marginTop: 14 }}>Preview</div>
          <div className="frac-preview">
            <span className="math-frac" ref={previewRef} />
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
          <button
            type="button"
            className="btn btn-p"
            onClick={handleSave}
            disabled={!num || !den}
          >
            {isEditing ? 'Update' : 'Insert'}
          </button>
        </div>
      </div>
    </div>
  )
}
