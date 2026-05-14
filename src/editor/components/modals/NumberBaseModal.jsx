/**
 * src/editor/components/modals/NumberBaseModal.jsx
 *
 * Insert / edit a number-base block. Used for Grade 7 questions on base
 * conversions, e.g. 313₅, 142₅, 121₅. The "5" appears as a subscript on
 * the right of the number.
 *
 * Props:
 *   editor      Tiptap editor instance
 *   editState   { attrs, pos } when editing; null on insert
 *   onClose     ()
 */

import { useState, useEffect, useRef } from 'react'
import { buildNumberBaseInner } from '../../extensions/NumberBase.js'

const COMMON_BASES = ['2', '3', '4', '5', '6', '7', '8', '10', '12', '16']

export default function NumberBaseModal({ editor, editState, onClose }) {
  const isEditing = Boolean(editState)

  const [number, setNumber] = useState(editState?.attrs?.number || '')
  const [base, setBase] = useState(editState?.attrs?.base || '5')

  const previewRef = useRef(null)

  useEffect(() => {
    if (previewRef.current) {
      previewRef.current.innerHTML = buildNumberBaseInner({ number, base })
    }
  }, [number, base])

  const handleSave = () => {
    if (!editor) return
    if (!number) return
    const attrs = {
      number: String(number).trim(),
      base: String(base || '').trim(),
    }
    if (isEditing && editState.pos !== null) {
      const { state, view } = editor
      const tr = state.tr
      tr.setNodeMarkup(editState.pos, undefined, attrs)
      view.dispatch(tr)
    } else {
      editor.chain().focus().insertNumberBase(attrs).run()
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

  // Allow alphanumerics so hex (e.g. 1A) and other bases work.
  const cleanNumber = (v) => String(v ?? '').replace(/[^0-9A-Fa-f.]/g, '')
  const cleanBase = (v) => String(v ?? '').replace(/[^0-9]/g, '')

  return (
    <div
      className="overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="modal math-modal nb-modal"
        role="dialog"
        aria-modal="true"
        aria-label={isEditing ? 'Edit number base' : 'Insert number base'}
      >
        <div className="mhd">
          <span className="mtitle">{isEditing ? '✏️ Edit Number Base' : 'ₙ Insert Number Base'}</span>
          <button className="mx" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="mbd">
          <div className="nb-grid">
            <div>
              <label className="mlbl">Number</label>
              <input
                type="text"
                inputMode="numeric"
                className="qe-inp"
                value={number}
                onChange={(e) => setNumber(cleanNumber(e.target.value))}
                placeholder="313"
                aria-label="Number"
                autoFocus
              />
            </div>
            <div className="nb-sub-glyph" aria-hidden="true">ₙ</div>
            <div>
              <label className="mlbl">Base</label>
              <input
                type="text"
                inputMode="numeric"
                className="qe-inp"
                value={base}
                onChange={(e) => setBase(cleanBase(e.target.value))}
                placeholder="5"
                aria-label="Base"
              />
            </div>
          </div>

          <div className="mlbl" style={{ marginTop: 12 }}>Common bases</div>
          <div className="nb-bases">
            {COMMON_BASES.map((b) => (
              <button
                key={b}
                type="button"
                className={`nb-base-chip${base === b ? ' on' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setBase(b)}
              >
                base {b}
              </button>
            ))}
          </div>

          <div className="mlbl" style={{ marginTop: 14 }}>Preview</div>
          <div className="nb-preview">
            <span className="num-base" ref={previewRef} />
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
            disabled={!number}
          >
            {isEditing ? 'Update' : 'Insert'}
          </button>
        </div>
      </div>
    </div>
  )
}
