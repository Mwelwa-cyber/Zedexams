/**
 * LabelDiagram — the prototype's "Label the diagram ✏️" exercise. Drag
 * each word chip onto its box, or tap a word then tap a box — both
 * pointer paths, exactly like the exam. Check marks each placed box
 * green/red and reports the score; Reset restarts.
 *
 * Anchors come from the block as 0–1 fractions of the rendered image.
 * The word bank is alphabetical (labelBankOrder) — slot order would
 * leak the answers. Scoring is pure (readerCore.scoreLabelPlacement).
 */
import { useMemo, useRef, useState } from 'react'
import { labelBankOrder, labelSlotKey, scoreLabelPlacement } from './readerCore'

export default function LabelDiagram({ block }) {
  const items = useMemo(() => block.items || [], [block.items])
  const bank = useMemo(() => labelBankOrder(items), [items])

  const [placed, setPlaced] = useState({})     // slotKey -> label
  const [selected, setSelected] = useState(null) // label picked by tap
  const [overKey, setOverKey] = useState(null)  // slot under an active drag
  const [result, setResult] = useState(null)    // scoreLabelPlacement output
  const diagramRef = useRef(null)
  const dragClone = useRef(null)

  const usedLabels = new Set(Object.values(placed))

  const place = (slotKey, label) => {
    setPlaced((prev) => {
      const next = { ...prev }
      // Un-place the label if it already sits on another slot.
      for (const k of Object.keys(next)) if (next[k] === label) delete next[k]
      next[slotKey] = label
      return next
    })
    setSelected(null)
    setResult(null)
  }
  const clearSlot = (slotKey) => {
    setPlaced((prev) => {
      const next = { ...prev }
      delete next[slotKey]
      return next
    })
    setResult(null)
  }

  const tapSlot = (slotKey) => {
    if (selected) { place(slotKey, selected); return }
    if (placed[slotKey]) clearSlot(slotKey)
  }

  // Pointer drag: >6px of travel turns the press into a drag with a
  // floating clone; releasing over a slot places the label. A press
  // without travel toggles tap-to-select instead.
  const onChipPointerDown = (e, label) => {
    const startX = e.clientX
    const startY = e.clientY
    let moved = false
    const chipEl = e.currentTarget

    const onMove = (ev) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) {
        moved = true
        chipEl.classList.add('is-dragging')
        const clone = document.createElement('div')
        clone.className = 'lhx-lbl-drag-clone'
        clone.textContent = label
        document.body.appendChild(clone)
        dragClone.current = clone
      }
      if (dragClone.current) {
        dragClone.current.style.left = `${ev.clientX - 28}px`
        dragClone.current.style.top = `${ev.clientY - 38}px`
        const el = document.elementFromPoint(ev.clientX, ev.clientY)
        const slot = el && el.closest && el.closest('[data-slot]')
        setOverKey(slot ? slot.dataset.slot : null)
      }
    }
    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      chipEl.classList.remove('is-dragging')
      if (dragClone.current) { dragClone.current.remove(); dragClone.current = null }
      setOverKey(null)
      if (!moved) {
        setSelected((cur) => (cur === label ? null : label))
        return
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY)
      const slot = el && el.closest && el.closest('[data-slot]')
      if (slot) place(slot.dataset.slot, label)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  const check = () => setResult(scoreLabelPlacement(items, placed))
  const reset = () => { setPlaced({}); setSelected(null); setResult(null) }

  return (
    <div className="lhx-lbl-wrap">
      {block.instructions && (
        <p className="lhx-note-p" style={{ fontSize: '14.5px' }}>{block.instructions}</p>
      )}
      <div className="lhx-lbl-diagram" ref={diagramRef}>
        <img className="lhx-lbl-img" src={block.url} alt={block.alt || 'Diagram to label'} draggable={false} />
        {items.map((it) => {
          const key = labelSlotKey(it)
          const label = placed[key]
          const verdict = result?.verdicts?.[key]
          const cls = [
            'lhx-lbl-slot',
            label ? 'is-filled' : '',
            overKey === key ? 'is-over' : '',
            verdict === true ? 'is-ok' : verdict === false ? 'is-no' : '',
          ].filter(Boolean).join(' ')
          return (
            <button
              key={key}
              type="button"
              data-slot={key}
              className={cls}
              style={{ left: `${it.x * 100}%`, top: `${it.y * 100}%` }}
              aria-label={label ? `${label} placed — tap to remove` : 'Empty label box'}
              onClick={() => tapSlot(key)}
            >
              {label || '?'}
            </button>
          )
        })}
      </div>
      <div className="lhx-lbl-bank">
        {bank.filter((label) => !usedLabels.has(label)).map((label) => (
          <button
            key={label}
            type="button"
            className={`lhx-lbl-chip ${selected === label ? 'is-sel' : ''}`}
            aria-pressed={selected === label}
            onPointerDown={(e) => onChipPointerDown(e, label)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="lhx-lbl-actions">
        <button type="button" className="lhx-lbl-reset" onClick={reset}>↺ Reset</button>
        <button type="button" className="lhx-lbl-check" onClick={check}>Check answers</button>
      </div>
      {result && (
        <p
          className="lhx-lbl-score"
          role="status"
          style={{ color: result.perfect ? 'var(--lhx-green-dark)' : 'var(--lhx-ink)' }}
        >
          {result.perfect
            ? `🎉 Perfect! All ${result.total} labelled correctly.`
            : `You got ${result.correct} of ${result.total}. Fix the red boxes and check again!`}
        </p>
      )}
    </div>
  )
}
