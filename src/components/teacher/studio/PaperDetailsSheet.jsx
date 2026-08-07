import { clampInt } from '../../../utils/inputs.js'
import { TERMS } from '../AssessmentStudio'
import {
  paperGradeLabel, TEST_ASSESSMENT_TYPES, EXAMINATION_ASSESSMENT_TYPES,
} from '../paperTaxonomy'
import { ASSESSMENT_TYPE_LABELS } from '../assessmentStudioMeta'
import { buildDocTitle, paperFromStudioForm } from './docTitleParts'
import Icon from './studioIcons'

/**
 * The phone bottom sheet behind the document title.
 *
 * The two-line title on a phone is necessarily terser than the wide one, so
 * tapping it opens this: the paper's FULL name, and the header fields a teacher
 * most often needs to correct after the fact — the type, the term, the year,
 * the duration, the school.
 *
 * Grade and subject are shown but not edited here on purpose. Changing either
 * re-scopes the syllabus (which subjects that grade teaches, which topics that
 * subject has) and snaps a now-invalid subject onto a valid one — a cascade
 * that lives in HeaderBlock. A second editor for those two fields would be a
 * second copy of that cascade, and the two would drift. "Edit full header"
 * opens the real form instead.
 */
export default function PaperDetailsSheet({ open, form, setF, onClose, onEditHeader }) {
  if (!open) return null
  const built = buildDocTitle(paperFromStudioForm(form || {}))

  return (
    <>
      <div className="sv-scrim open" onClick={onClose} />
      <div className="sv-sheet" role="dialog" aria-modal="true" aria-label="Paper details">
        <div className="sv-sheet-grabber" aria-hidden="true" />
        <div className="sv-sheet-head">
          <div className="sv-sheet-title">{built.full}</div>
          <button type="button" className="sv-icon-btn" onClick={onClose} aria-label="Close paper details">
            <Icon name="remove" size={18} />
          </button>
        </div>

        <div className="sv-sheet-facts">
          <span><strong>{paperGradeLabel(form?.grade) || '—'}</strong> level</span>
          <span><strong>{form?.subject || '—'}</strong> subject</span>
        </div>

        <div className="sv-sheet-body">
          <div className="sv-field">
            <label htmlFor="sv-sheet-school">School name</label>
            <input
              id="sv-sheet-school"
              type="text"
              value={form?.schoolName ?? ''}
              onChange={e => setF('schoolName', e.target.value)}
              placeholder="e.g. Jemareen Academy"
            />
          </div>
          <div className="sv-field">
            <label htmlFor="sv-sheet-class">Class (optional)</label>
            <input
              id="sv-sheet-class"
              type="text"
              value={form?.className ?? ''}
              onChange={e => setF('className', e.target.value)}
              placeholder="e.g. 4A"
            />
          </div>
          <div className="sv-field">
            <label htmlFor="sv-sheet-type">Assessment type</label>
            <select id="sv-sheet-type" value={form?.assessmentType ?? ''} onChange={e => setF('assessmentType', e.target.value)}>
              <optgroup label="Tests">
                {TEST_ASSESSMENT_TYPES.map(t => <option key={t} value={t}>{ASSESSMENT_TYPE_LABELS[t]}</option>)}
              </optgroup>
              <optgroup label="Examinations">
                {EXAMINATION_ASSESSMENT_TYPES.map(t => <option key={t} value={t}>{ASSESSMENT_TYPE_LABELS[t]}</option>)}
              </optgroup>
            </select>
          </div>
          <div className="sv-row-2">
            <div className="sv-field">
              <label htmlFor="sv-sheet-term">Term</label>
              <select id="sv-sheet-term" value={form?.term ?? ''} onChange={e => setF('term', e.target.value)}>
                {TERMS.map(t => <option key={t} value={t}>Term {t}</option>)}
              </select>
            </div>
            <div className="sv-field">
              <label htmlFor="sv-sheet-year">Year</label>
              <input
                id="sv-sheet-year"
                type="number"
                value={form?.year ?? ''}
                onChange={e => setF('year', e.target.value)}
                onBlur={e => setF('year', clampInt(e.target.value, 2020, 2099, new Date().getFullYear()))}
              />
            </div>
          </div>
          <div className="sv-field">
            <label htmlFor="sv-sheet-duration">Duration (minutes)</label>
            <input
              id="sv-sheet-duration"
              type="number"
              value={form?.duration ?? ''}
              onChange={e => setF('duration', e.target.value)}
              onBlur={e => setF('duration', clampInt(e.target.value, 5, 600, 60))}
            />
          </div>
        </div>

        <div className="sv-sheet-foot">
          <button type="button" className="sv-btn sv-btn-outline" onClick={onEditHeader}>
            <Icon name="header" size={14} /> Edit full header
          </button>
          <button type="button" className="sv-btn sv-btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </>
  )
}
