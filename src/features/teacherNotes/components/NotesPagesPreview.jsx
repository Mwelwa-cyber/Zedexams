/**
 * The paged preview (§6).
 *
 * The studio's preview used to be one continuous web column. A teacher could
 * not see where page 1 ended, which is the only thing they need to know before
 * running forty copies: whether the exercise starts on a fresh sheet, whether
 * the last page holds one line, whether the diagram sits with the section that
 * refers to it. So this draws real sheets — 210 × 297 mm, or 148 × 210 for A5 —
 * separated by a gutter, each labelled with its position.
 *
 * The break between page 1 and page 2 on screen is the break the printer will
 * make, because it is the break the MEASUREMENT found. This component does not
 * decide where pages end; it is told (`notesPagination`).
 *
 * ## While the measurement is out of date
 *
 * It says so, and shows ONE continuous sheet with a "counting pages" note
 * rather than page boxes whose boundaries nobody has verified. Page boxes drawn
 * from a stale measurement are the failure this component exists to prevent,
 * one step removed.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { learnerNotesCss, paperSize } from '../../../utils/learnerNotesPrintable.js'
import {
  measureNotesPages,
  notesFingerprint,
  notesPageLabel,
} from '../lib/notesPagination.js'
import '../styles/notesPreview.css'

const STATES = { IDLE: 'idle', MEASURING: 'measuring', READY: 'ready', FAILED: 'failed' }

export default function NotesPagesPreview({
  notes,
  paper = 'a4',
  boardPreview = false,
  answerPageBlocks = null,
  label = 'Learner pages',
}) {
  const [state, setState] = useState(STATES.IDLE)
  const [plan, setPlan] = useState(null)
  const fingerprint = useMemo(() => notesFingerprint(notes, paper), [notes, paper])
  // The in-flight token is cleared when the DOCUMENT changes, not when the next
  // measurement starts: otherwise a measurement already running for the old
  // document resolves during the debounce window and writes itself back as
  // confidently current.
  const tokenRef = useRef(0)

  useEffect(() => {
    if (!notes) {
      setPlan(null)
      setState(STATES.IDLE)
      return undefined
    }
    const token = ++tokenRef.current
    setState(STATES.MEASURING)
    let cancelled = false
    const timer = setTimeout(async () => {
      const result = await measureNotesPages(notes, paper)
      if (cancelled || token !== tokenRef.current) return
      setPlan(result)
      setState(result.pages && result.pages.length ? STATES.READY : STATES.FAILED)
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [fingerprint, notes, paper])

  const size = paperSize(paper)
  const css = useMemo(() => learnerNotesCss({ paper: size.id, boardPreview }), [size.id, boardPreview])
  const blocks = plan?.blocks || []

  const pages = state === STATES.READY && plan?.pages?.length
    ? plan.pages.map((page) => page.blockIds
      .map((id) => blocks.find((b) => b.id === id))
      .filter(Boolean))
    : null

  return (
    <div className={`ln-preview${boardPreview ? ' ln-board' : ''}`} data-testid="notes-pages-preview">
      <style>{css}</style>
      <div className="ln-preview-bar">
        <span className="ln-preview-label">{label}</span>
        <span className="ln-preview-status">
          {state === STATES.MEASURING && 'Counting pages…'}
          {state === STATES.READY && `${plan.pageCount} page${plan.pageCount === 1 ? '' : 's'} · ${size.label}`}
          {state === STATES.FAILED && 'Page count unavailable'}
        </span>
      </div>

      {pages ? pages.map((pageBlocks, i) => (
        <div key={i} className="ln-sheet-wrap">
          <div
            className="ln-page ln-sheet"
            style={{ minHeight: `${size.heightMm}mm` }}
            // The blocks are built by `learnerNotesPrintable` — the same
            // strings the printer is handed. Rendering them any other way here
            // would make the preview a second renderer, and the two would drift.
            dangerouslySetInnerHTML={{ __html: pageBlocks.map((b) => b.html).join('\n') }}
          />
          <p className="ln-page-indicator">{notesPageLabel(i + 1, plan.pageCount, size.id)}</p>
        </div>
      )) : (
        <div className="ln-sheet-wrap">
          <div
            className="ln-page ln-sheet"
            dangerouslySetInnerHTML={{ __html: blocks.map((b) => b.html).join('\n') }}
          />
          <p className="ln-page-indicator">
            {state === STATES.MEASURING ? 'Counting pages…' : `${size.label} portrait`}
          </p>
        </div>
      )}

      {answerPageBlocks && answerPageBlocks.length > 0 && (
        <div className="ln-sheet-wrap">
          <div
            className="ln-page ln-sheet ln-sheet-answer"
            dangerouslySetInnerHTML={{ __html: answerPageBlocks.map((b) => b.html).join('\n') }}
          />
          <p className="ln-page-indicator">Teacher's answer page · separate file</p>
        </div>
      )}
    </div>
  )
}
