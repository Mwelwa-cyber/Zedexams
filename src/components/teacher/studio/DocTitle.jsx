// The document title in the studio's app bar, and the paper-details sheet a
// phone opens by tapping it.
//
// THE BUG THIS FIXES. The bar rendered one pre-built string —
// "GRADE 4 INTEGRATED SCIENCE - END OF TERM 1 TEST - 2026" — with a CSS
// ellipsis. On a phone that cut it to "GRADE 4 INTEGRATED SCIEN…", so the two
// facts that say WHICH paper is open (the type and the year) were the first
// things thrown away. An ellipsis cannot know that "Integrated" is worth less
// than "2026".
//
// So the title is composed from the paper's FIELDS at three widths
// (paperNaming.composeDocTitle) and degrades by priority: drop the
// redundant word "Test" → abbreviate "End of Term" to "EOT" → move facts to a
// second line. At 360px every distinguishing fact is still on screen.
//
// Width is measured on the title's OWN container, not the viewport: the bar's
// back button, status chip and Save take room the viewport width says nothing
// about. Tests pass `width` directly rather than faking layout.

import { useRef } from 'react'
import { composeDocTitle, DOC_TITLE_MEDIUM } from '../paperNaming'
import { ASSESSMENT_TYPE_LABELS, TERMS } from '../assessmentStudioMeta'
import { assessmentCategory } from '../paperTaxonomy'
import { useElementWidth } from '../../../hooks/useElementWidth'
import Icon from './studioIcons'

// The measurement hook now lives in src/hooks — the past-paper archive needs
// the same container-width reading for the same reason. Re-exported here so
// every existing importer (and its spec) keeps working.
export { useElementWidth }

/**
 * @param {object}   paper     the studio's live `form` (grade / subject /
 *                             assessmentType / term / year / title)
 * @param {string}   status    the one-word save state, folded into line 2 on
 *                             narrow (where the chip is hidden) so the state is
 *                             never the fact that gets dropped
 * @param {function} onOpenDetails  tapping the title on a phone
 * @param {number}   width     explicit width; omit to measure
 */
export function DocTitle({ paper, status = '', onOpenDetails, width: widthProp }) {
  const ref = useRef(null)
  const measured = useElementWidth(ref)
  // Before the first measurement (and in any environment without layout) fall
  // back to the viewport rather than to a guess, so the first paint is close.
  const fallback = typeof window === 'undefined' ? 900 : window.innerWidth
  const width = widthProp ?? (measured || fallback)
  const composed = composeDocTitle(paper, { width, status })
  const isNarrow = composed.mode === 'narrow'

  // The two lines are wrapped in their own column. Without it they are flex
  // siblings of the chevron in a ROW, so instead of stacking they sit beside
  // each other and both get squeezed — which is the original bug wearing a
  // different hat.
  const body = (
    <span className="sv-doctitle-lines">
      <span className={`sv-doctitle-line1${isNarrow ? ' narrow' : ''}`}>{composed.line1}</span>
      {composed.line2 && <span className="sv-doctitle-line2">{composed.line2}</span>}
    </span>
  )

  return (
    <div className="sv-doctitle" ref={ref} data-mode={composed.mode}>
      {isNarrow && onOpenDetails ? (
        <button
          type="button"
          className="sv-doctitle-tap"
          onClick={onOpenDetails}
          aria-label={`Paper details — ${composed.line1}. ${composed.line2}`}
        >
          {body}
          <Icon name="moveDown" size={14} />
        </button>
      ) : body}
    </div>
  )
}

/**
 * The bottom sheet a phone opens from the title.
 *
 * Shows the full, uncut name, then the facts it is built from. The quick edits
 * here are the paper-level fields that stand on their own; grade, subject and
 * curriculum are NOT duplicated as a second picker, because those three are
 * scoped to one another through the live syllabus — a second copy is how a
 * teacher ends up offered a subject their grade does not teach. "Edit all paper
 * details" opens the one header form that knows those rules.
 */
export function PaperDetailsSheet({
  open, paper, onClose, onChange, onEditAll,
  assessmentTypes = [],
}) {
  if (!open) return null
  const full = composeDocTitle(paper, { width: 1400 })
  const tests = assessmentTypes.filter((t) => assessmentCategory(t) === 'test')
  const exams = assessmentTypes.filter((t) => assessmentCategory(t) === 'examination')

  return (
    <>
      <div className="sv-scrim open" onClick={onClose} />
      <div className="sv-sheet" role="dialog" aria-modal="true" aria-label="Paper details">
        <div className="sv-sheet-grip" aria-hidden="true" />
        <div className="sv-sheet-head">
          <h2 className="sv-sheet-title">{full.line1}</h2>
          <button type="button" className="sv-icon-btn" onClick={onClose} aria-label="Close paper details">
            <Icon name="remove" size={18} />
          </button>
        </div>

        <div className="sv-sheet-body">
          <div className="sv-sheet-grid">
            <label className="sv-field">
              <span>Assessment type</span>
              <select
                value={paper.assessmentType}
                onChange={(e) => onChange('assessmentType', e.target.value)}
              >
                {tests.length > 0 && (
                  <optgroup label="Tests">
                    {tests.map((t) => <option key={t} value={t}>{ASSESSMENT_TYPE_LABELS[t]}</option>)}
                  </optgroup>
                )}
                {exams.length > 0 && (
                  <optgroup label="Examinations">
                    {exams.map((t) => <option key={t} value={t}>{ASSESSMENT_TYPE_LABELS[t]}</option>)}
                  </optgroup>
                )}
              </select>
            </label>
            <label className="sv-field">
              <span>Term</span>
              <select value={paper.term} onChange={(e) => onChange('term', e.target.value)}>
                {TERMS.map((t) => <option key={t} value={t}>Term {t}</option>)}
              </select>
            </label>
            <label className="sv-field">
              <span>Year</span>
              <input
                type="number"
                value={paper.year}
                onChange={(e) => onChange('year', e.target.value)}
              />
            </label>
            <label className="sv-field">
              <span>Duration (minutes)</span>
              <input
                type="number"
                value={paper.duration}
                onChange={(e) => onChange('duration', e.target.value)}
              />
            </label>
          </div>

          <button
            type="button"
            className="sv-btn sv-btn-outline"
            style={{ width: '100%', justifyContent: 'center', marginTop: 'var(--sv-s3)' }}
            onClick={() => { onClose?.(); onEditAll?.() }}
          >
            <Icon name="header" size={14} /> Edit all paper details
          </button>
        </div>
      </div>
    </>
  )
}

export { DOC_TITLE_MEDIUM }
