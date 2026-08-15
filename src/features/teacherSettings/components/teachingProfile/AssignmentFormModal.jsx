import { useMemo, useRef, useState } from 'react'
import useFocusTrap from '../../../../hooks/useFocusTrap'
import StudioCurriculumSelector from '../../../../shared/components/StudioCurriculumSelector'
import {
  foldFormCodeToGrade,
  assignmentGradeToStudioLabel,
} from '../../../../shared/utils/curriculumSelectorConstants'
import { matchFrameworkSubject } from '../../../../utils/frameworkSubjectMatch'
import {
  normalizeAssignment,
  validateAssignment,
  assignmentNeedsReview,
  findDuplicateAssignment,
  gradeLabel,
  subjectLabel,
  curriculumTypeLabel,
} from '../../../../utils/teachingProfileCore'
import FieldRow from '../fields/FieldRow'

/**
 * Add / edit a teaching assignment. Centred modal on desktop & tablet, bottom
 * sheet on mobile (CSS). Focus-trapped, Escape-cancellable, labelled.
 *
 * The Curriculum → Grade/Form → Subject cascade is the platform-standard
 * StudioCurriculumSelector — the SAME syllabus-catalog-backed picker every
 * generate studio uses — so the Teaching Profile carries no hardcoded grade or
 * subject lists of its own:
 *   • Curriculum is chosen FIRST; Grade/Form is disabled until then; Subject is
 *     disabled until a grade is chosen.
 *   • Each curriculum offers its OWN grade/form structure (stage headings are
 *     non-selectable <optgroup> labels), filtered to grades with syllabus data.
 *   • Subjects are only the ones the syllabus catalog carries for that exact
 *     curriculum + grade — never a generic all-subjects fallback.
 *   • Changing the curriculum clears grade + subject; changing the grade clears
 *     the subject (the selector's own cascading resets).
 *
 * The selector emits KB codes (G4 / F1 / ECE_N + canonical subject slugs);
 * F-codes are folded onto the stored G-code space (F1 → G8) so existing
 * assignments, weekly targets and studio seeds keep working unchanged.
 *
 * Props:
 *   open, mode ('add'|'edit'), initial (assignment being edited, incl. id),
 *   existing (all assignments — for duplicate detection),
 *   onSubmit(payload) → Promise (throws to surface a save error),
 *   onClose()
 */
export default function AssignmentFormModal({ open, mode = 'add', initial = null, existing = [], onSubmit, onClose }) {
  const panelRef = useRef(null)
  const firstFieldRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // The stored values being edited (normalized once) — the selector seed, the
  // needs-review banner and the periods restore-on-same-selection all key off it.
  const [base] = useState(() => normalizeAssignment(initial || {}))

  const [form, setForm] = useState(() => ({
    // curriculumType stays '' until the teacher actually picks a curriculum in
    // add mode — nothing is pre-selected, so the dependency order is honest.
    curriculumType: initial ? base.curriculumType : '',
    grade: initial ? base.grade : '',
    subject: initial ? base.subject : '',
    className: base.className,
    periodsPerWeek: base.periodsPerWeek,
    lessonDurationMinutes: base.lessonDurationMinutes,
  }))

  // Edit-mode review flag: a stored combination that is no longer valid
  // (stale local data / old generic-list selection) is surfaced to the teacher
  // with its ORIGINAL values — never silently rewritten. The selector clears
  // the invalid parts, so a valid re-selection is required before saving.
  const review = useMemo(
    () => (mode === 'edit' && initial ? assignmentNeedsReview(base) : { needsReview: false, reasons: [] }),
    [mode, initial, base],
  )

  // Seed the cascade from the assignment being edited. Grade codes map to the
  // studio label shape PER CURRICULUM (CBC secondary is 'Form 1', the 2013 set
  // 'Grade 8'); a label the catalog doesn't carry is cleared by the selector.
  const [selectorSeed] = useState(() => (initial
    ? {
        curriculumMode: base.curriculumType,
        gradeLabel: assignmentGradeToStudioLabel(base.grade, base.curriculumType),
        subjectKey: base.subject,
      }
    : null))

  useFocusTrap(panelRef, {
    active: open,
    initialFocusRef: firstFieldRef,
    onEscape: () => { if (!saving) onClose?.() },
  })

  if (!open) return null

  const setField = (patch) => setForm((f) => ({ ...f, ...patch }))

  // Periods per week for a (grade, subject) selection: the stored value when
  // the teacher is back on the assignment's original selection (edit mode),
  // else the official curriculum allocation where the framework carries one,
  // else empty for manual entry. Never carried over from a previously selected
  // subject — the teacher can always edit the field afterwards.
  const periodsForSelection = (grade, subject) => {
    if (!grade || !subject) return null
    if (initial && grade === base.grade && subject === base.subject) return base.periodsPerWeek
    return matchFrameworkSubject(grade, subject)?.periodsPerWeek ?? null
  }

  const onSelectionChange = (payload) => {
    const grade = foldFormCodeToGrade(payload.grade)
    const subject = payload.subject || ''
    setForm((f) => {
      const selectionChanged = grade !== f.grade || subject !== f.subject
      return {
        ...f,
        curriculumType: payload.curriculumMode || '',
        grade,
        subject,
        periodsPerWeek: selectionChanged ? periodsForSelection(grade, subject) : f.periodsPerWeek,
      }
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.curriculumType) {
      setError('Choose a curriculum first.')
      return
    }
    // Hard combination check — the cascade only offers catalog-valid options,
    // but stale state or old saved data must never slip through on trust.
    const check = validateAssignment(form)
    if (!check.valid) {
      setError(check.errors[0])
      return
    }
    const dup = findDuplicateAssignment(existing, form, mode === 'edit' ? initial?.id : null)
    if (dup) {
      setError('This teaching assignment has already been added.')
      return
    }
    setSaving(true)
    try {
      await onSubmit(normalizeAssignment(form))
      // Parent closes on success. Do NOT clear the form here (section 31: keep
      // values on failure) — only a thrown error keeps us open.
    } catch (err) {
      console.error('Assignment save failed:', err)
      setError('Could not save — please check your connection and try again.')
      setSaving(false)
    }
  }

  const titleId = 'tp-assign-modal-title'

  return (
    <div className="tset-tp-modal__overlay" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget && !saving) onClose?.()
    }}>
      <div
        className="tset-tp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
      >
        <div className="tset-tp-modal__handle" aria-hidden="true" />
        <header className="tset-tp-modal__head">
          <h2 id={titleId} className="tset-section__title">
            {mode === 'edit' ? 'Edit teaching assignment' : 'Add teaching assignment'}
          </h2>
          <button type="button" className="tset-tp-iconbtn" onClick={() => onClose?.()} aria-label="Close" disabled={saving}>
            ✕
          </button>
        </header>

        <form className="tset-tp-modal__body" onSubmit={handleSubmit}>
          {review.needsReview && (
            <p className="tset-savebar__status tset-savebar__status--error" role="alert">
              This assignment needs review — its saved values ({gradeLabel(base.grade)} · {subjectLabel(base.subject)} · {curriculumTypeLabel(base.curriculumType)})
              are not a valid combination any more. Re-select a valid grade and subject below, then save.
            </p>
          )}

          {/* firstFieldRef target for initial focus */}
          <span ref={firstFieldRef} tabIndex={-1} style={{ display: 'contents' }}>
            <StudioCurriculumSelector
              value={selectorSeed}
              onChange={onSelectionChange}
              showTopicSubtopic={false}
              gradeFieldLabel="Grade or Form"
              disabled={saving}
            />
          </span>

          <div className="tset-grid" style={{ marginTop: 14 }}>
            <FieldRow label="Class or stream (optional)" htmlFor="tp-class" help="Helps when you teach the same subject to more than one class.">
              <input
                id="tp-class"
                className="studio-input"
                type="text"
                value={form.className}
                onChange={(e) => setField({ className: e.target.value })}
                placeholder="e.g. 4A"
                maxLength={40}
              />
            </FieldRow>
            <FieldRow label="Periods per week" htmlFor="tp-periods" help="Pre-filled from the official curriculum allocation when available; a connected Class Timetable takes over on your weekly targets. Adjust it to your real timetable.">
              <input
                id="tp-periods"
                className="studio-input"
                type="number"
                min={0}
                max={60}
                value={form.periodsPerWeek ?? ''}
                onChange={(e) => setField({ periodsPerWeek: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="e.g. 5"
              />
            </FieldRow>
            <FieldRow label="Lesson duration (optional)" htmlFor="tp-duration" help="Minutes per period.">
              <input
                id="tp-duration"
                className="studio-input"
                type="number"
                min={5}
                max={240}
                value={form.lessonDurationMinutes ?? ''}
                onChange={(e) => setField({ lessonDurationMinutes: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="e.g. 40"
              />
            </FieldRow>
          </div>

          {error && (
            <p className="tset-savebar__status tset-savebar__status--error" role="alert">{error}</p>
          )}

          <div className="tset-tp-modal__actions">
            <button type="button" className="tset-btn tset-btn--ghost" onClick={() => onClose?.()} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="tset-btn" disabled={saving}>
              {saving ? 'Saving…' : 'Save assignment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
