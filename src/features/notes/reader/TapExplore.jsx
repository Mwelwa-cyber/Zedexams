/**
 * TapExplore — the prototype's organ grid: a card per item, and tapping
 * one opens a bottom sheet with a real picture and what that part does.
 *
 * Two decisions worth knowing:
 *
 *   • The sheet is a real dialog, not a styled div. It takes focus on
 *     open, restores it to the card that opened it on close, closes on
 *     Escape and on a backdrop tap, and traps nothing else — a child
 *     using a screen reader or a keyboard gets the same content in the
 *     same order as a child tapping.
 *
 *   • A card with no picture still opens. The picture is the reward, but
 *     the ROLE text is the lesson, and an item whose image has not been
 *     drawn yet must not become untappable — that would quietly remove a
 *     part of the syllabus from the note.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export default function TapExplore({ block }) {
  const items = Array.isArray(block?.items) ? block.items : []
  const [openIndex, setOpenIndex] = useState(null)
  const openerRef = useRef(null)
  const sheetRef = useRef(null)

  const close = useCallback(() => {
    setOpenIndex(null)
    // Focus goes back to the card that opened the sheet, not to the top
    // of the note — losing your place in a grid of eight is disorienting.
    openerRef.current?.focus?.()
  }, [])

  useEffect(() => {
    if (openIndex == null) return undefined
    sheetRef.current?.focus?.()
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [openIndex, close])

  if (items.length === 0) return null
  const active = openIndex == null ? null : items[openIndex]

  return (
    <>
      {block.prompt && <p className="lhx-note-p">{block.prompt}</p>}
      <ul className="lhx-organ-grid">
        {items.map((item, i) => (
          <li key={item.key || item.name || i}>
            <button
              type="button"
              className="lhx-organ-chip lhx-press"
              aria-haspopup="dialog"
              onClick={(e) => { openerRef.current = e.currentTarget; setOpenIndex(i) }}
            >
              <span className="lhx-organ-pic" aria-hidden="true">
                {item.url ? <img src={item.url} alt="" loading="lazy" /> : <span>🔍</span>}
              </span>
              <span className="lhx-organ-name">{item.name}</span>
            </button>
          </li>
        ))}
      </ul>

      {active && (
        <div className="lhx-organ-backdrop" onClick={close} role="presentation">
          <div
            ref={sheetRef}
            className="lhx-organ-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={active.name}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            {active.url && (
              <img className="lhx-organ-hero" src={active.url} alt={active.name} loading="lazy" />
            )}
            <h3 className="lhx-organ-title">{active.name}</h3>
            <p className="lhx-organ-role">{active.role}</p>
            {active.parts && <p className="lhx-organ-parts">{active.parts}</p>}
            <button type="button" className="lhx-btn lhx-btn-soft lhx-btn-block" onClick={close}>
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  )
}
