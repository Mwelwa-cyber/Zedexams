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
import useFocusTrap from '../../../hooks/useFocusTrap.js'

// The quick choices, drawn as the stacked fractions they insert rather than
// as the precomposed glyphs (½ ¼ ¾) they used to be labelled with. §5 rules
// those glyphs out as a rendered form anywhere in the editor, and a button
// that shows a typographic symbol and inserts school notation is teaching the
// wrong shape at the moment the teacher is choosing it. `name` carries the
// accessible label, since a stacked "1 over 2" reads as "12" to a screen
// reader (§13).
const PRESETS = [
  { name: 'one half', whole: '', num: '1', den: '2' },
  { name: 'one quarter', whole: '', num: '1', den: '4' },
  { name: 'three quarters', whole: '', num: '3', den: '4' },
  { name: 'one third', whole: '', num: '1', den: '3' },
  { name: 'two thirds', whole: '', num: '2', den: '3' },
  { name: 'one fifth', whole: '', num: '1', den: '5' },
  { name: 'one and one half', whole: '1', num: '1', den: '2' },
  { name: 'one and one third', whole: '1', num: '1', den: '3' },
]

export default function FractionModal({ editor, editState, onClose, mixed = false }) {
  const isEditing = Boolean(editState)
  // Opened from the Mixed number button: same modal, but the caret starts in
  // the whole-number field and the title says which shape is being built, so
  // the two tools are genuinely distinct rather than one relabelled.
  const wholeRef = useRef(null)

  const [whole, setWhole] = useState(editState?.attrs?.whole || '')
  const [num, setNum] = useState(editState?.attrs?.num || '')
  const [den, setDen] = useState(editState?.attrs?.den || '')

  const previewRef = useRef(null)
  // Escape closes, Tab stays inside, focus returns to the editor on close
  // (§13) — the shared behaviour every dialog in the app uses, rather than a
  // third hand-rolled copy of it.
  const panelRef = useRef(null)
  useFocusTrap(panelRef, { onEscape: onClose, initialFocusRef: mixed ? wholeRef : undefined })

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

  // §5 — a denominator of zero is not a fraction. `!den` did not catch it:
  // the field holds a STRING, and `!'0'` is false, so "3 over 0" was
  // insertable and printed onto the paper as a fraction bar over a zero.
  // The message is rendered in a live region below, so a screen-reader user
  // learns why Insert is refused rather than meeting a disabled button with
  // no stated reason (§13).
  const denError = den.trim() !== '' && Number(den) === 0
    ? 'A denominator cannot be zero — nothing can be divided into zero parts.'
    : ''
  const canSave = Boolean(num.trim()) && Boolean(den.trim()) && !denError

  const handleSave = () => {
    if (!editor) return
    if (!canSave) return
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
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={isEditing ? 'Edit fraction' : mixed ? 'Insert mixed number' : 'Insert fraction'}
      >
        <div className="mhd">
          <span className="mtitle">{isEditing ? 'Edit fraction' : mixed ? 'Insert mixed number' : 'Insert fraction'}</span>
          <button className="mx" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="mbd">
          <div className="mlbl">Quick choices</div>
          <div className="frac-presets">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="frac-preset"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply(p)}
                aria-label={p.name}
                title={p.name}
              >
                <span
                  className="math-frac"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: buildFractionInner(p) }}
                />
              </button>
            ))}
          </div>

          <div className="mlbl" style={{ marginTop: 14 }}>Whole number (optional — for mixed fractions)</div>
          <input
            type="text"
            inputMode="decimal"
            className="qe-inp"
            ref={wholeRef}
            value={whole}
            onChange={(e) => setWhole(cleanDigits(e.target.value))}
            placeholder="e.g. 2"
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
                autoFocus={!isEditing && !mixed}
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

          {/* Announced, not just shown: `role="alert"` means the reason
              Insert is unavailable reaches a screen reader at the moment it
              becomes true. */}
          {denError && (
            <div className="frac-error" role="alert">{denError}</div>
          )}

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
            disabled={!canSave}
          >
            {isEditing ? 'Update' : 'Insert'}
          </button>
        </div>
      </div>
    </div>
  )
}
