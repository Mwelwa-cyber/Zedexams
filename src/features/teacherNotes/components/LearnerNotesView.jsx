/**
 * A learner-notes document, rendered read-only.
 *
 * Used wherever a saved note is looked at outside the studio — the library
 * detail view, the public share page, the locked-studio sample. It renders the
 * SAME blocks the printer is handed (`learnerNotesPrintable`), as one
 * continuous sheet rather than paged: someone reading a saved note wants to
 * read it, and page boundaries are a question the studio's paged preview
 * answers for the person about to photocopy it.
 *
 * Rendering the print blocks rather than a second set of React components is
 * the point. A library view built from its own markup drifts from the sheet
 * that comes out of the printer, and the drift is invisible until a teacher
 * notices that the thing they approved on screen is not the thing they handed
 * out.
 *
 * The answer page is NOT rendered here, at any strength. It is a separate
 * document with a separate export, and a share link that carried the answers
 * under a collapsed heading would be a share link that carries the answers.
 */

import { useMemo } from 'react'
import {
  buildLearnerNotesBlocks,
  learnerNotesCss,
  paperSize,
} from '../../../utils/learnerNotesPrintable.js'
import { FORMAT_LABELS, normalizeFormat } from '../../../utils/notesOptions.js'
import GroundingChip from './GroundingChip.jsx'
import '../styles/notesPreview.css'

export default function LearnerNotesView({ notes, showGrounding = true }) {
  const paper = paperSize(notes && notes.paperSize)
  const css = useMemo(() => learnerNotesCss({ paper: paper.id }), [paper.id])
  const html = useMemo(
    () => buildLearnerNotesBlocks(notes).map((b) => b.html).join('\n'),
    [notes],
  )
  if (!notes) return null

  const format = normalizeFormat(notes.format)

  return (
    <div className="ln-preview" data-testid="learner-notes-view">
      <style>{css}</style>
      <div className="ln-preview-bar">
        <span className="ln-preview-label">
          Learner notes — {FORMAT_LABELS[format].toLowerCase()}
        </span>
        <span className="ln-preview-status">{paper.label}</span>
      </div>
      {showGrounding && notes.grounding && (
        <div style={{ marginBottom: 12 }}>
          <GroundingChip grounding={notes.grounding} checks={notes.checks} />
        </div>
      )}
      <div className="ln-sheet-wrap">
        <div className="ln-page ln-sheet" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}
