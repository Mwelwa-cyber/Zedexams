import { useMemo, useRef, useState } from 'react'
import useFocusTrap from '../../../../hooks/useFocusTrap'
import { TEACHER_GRADES, getSubjectsForGrade, defaultSubjectForGrade } from '../../../../config/teacherTaxonomy'
import {
  normalizeAssignment,
  validateAssignment,
  findDuplicateAssignment,
} from '../../../../utils/teachingProfileCore'
import FieldRow from '../fields/FieldRow'
import SelectField from '../fields/SelectField'

const GRADE_OPTIONS = TEACHER_GRADES // includes { group } headers → optgroups below
const CURRICULUM_OPTIONS = [
  { value: 'cbc', label: 'New Curriculum (CBC)' },
  { value: 'previous', label: 'Old Curriculum (OBC)' },
]

// Grade select needs optgroups (ECE / Lower Primary / …), which SelectField's
// flat list doesn't render — so this modal uses a native <select> directly.
function GradeSelect({ id, value, onChange }) {
  return (
    <select id={id} className="studio-input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select grade or form</option>
      {GRADE_OPTIONS.map((g, i) =>
        g.group ? (
          <optgroup key={`g-${i}`} label={g.group} />
        ) : (
          <option key={g.value} value={g.value}>
            {g.label}
          </option>
        ),
      )}
    </select>
  )
}

/**
 * Add / edit a teaching assignment. Centred modal on desktop & tablet, bottom
 * sheet on mobile (CSS). Focus-trapped, Escape-cancellable, labelled.
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

  const [form, setForm] = useState(() => {
    const base = normalizeAssignment(initial || {})
    return {
      grade: base.grade,
      subject: base.subject,
      className: base.className,
      curriculumType: base.curriculumType,
      periodsPerWeek: base.periodsPerWeek,
      lessonDurationMinutes: base.lessonDurationMinutes,
    }
  })

  useFocusTrap(panelRef, {
    active: open,
    initialFocusRef: firstFieldRef,
    onEscape: () => { if (!saving) onClose?.() },
  })

  const subjectOptions = useMemo(() => {
    // No grade chosen yet → show NO subjects. getSubjectsForGrade('') returns
    // the full cross-level, cross-curriculum list, which is the "subjects are
    // mixed" bug: a teacher opening the form saw every subject at once. The
    // grade is picked first, then the list is scoped to that grade + curriculum.
    if (!form.grade) return []
    // Filter to pedagogically-valid subjects for the chosen grade AND curriculum,
    // so switching the Curriculum selector actually changes the subject list
    // (e.g. the OBC's Principles of Accounts vs the CBC's Commerce & Principles
    // of Accounts).
    return getSubjectsForGrade(form.grade, form.curriculumType).filter((s) => s.value)
  }, [form.grade, form.curriculumType])

  if (!open) return null

  const setField = (patch) => setForm((f) => ({ ...f, ...patch }))

  const onGradeChange = (grade) => {
    // When the grade changes, keep the subject if still valid for the current
    // curriculum, else pick a sane default.
    const stillValid = getSubjectsForGrade(grade, form.curriculumType).some((s) => s.value === form.subject)
    setField({ grade, subject: stillValid ? form.subject : (grade ? defaultSubjectForGrade(grade, form.curriculumType) : '') })
  }

  const onCurriculumChange = (curriculumType) => {
    // Switching curriculum can drop the selected subject (e.g. Commerce &
    // Principles of Accounts exists only in the CBC). Keep it if still valid for
    // the new curriculum, else fall back to a valid default for the grade.
    const stillValid = getSubjectsForGrade(form.grade, curriculumType).some((s) => s.value === form.subject)
    setField({
      curriculumType,
      subject: stillValid ? form.subject : (form.grade ? defaultSubjectForGrade(form.grade, curriculumType) : ''),
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
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
          <div className="tset-grid">
            <FieldRow label="Grade or Form" htmlFor="tp-grade">
              {/* firstFieldRef target for initial focus */}
              <span ref={firstFieldRef} tabIndex={-1} style={{ display: 'contents' }}>
                <GradeSelect id="tp-grade" value={form.grade} onChange={onGradeChange} />
              </span>
            </FieldRow>
            <FieldRow label="Subject" htmlFor="tp-subject">
              <SelectField
                id="tp-subject"
                value={form.subject}
                onChange={(subject) => setField({ subject })}
                options={subjectOptions}
                placeholder={form.grade ? 'Select subject' : 'Select a grade or form first'}
                disabled={!form.grade}
              />
            </FieldRow>
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
            <FieldRow label="Curriculum" htmlFor="tp-curric">
              <SelectField
                id="tp-curric"
                value={form.curriculumType}
                onChange={onCurriculumChange}
                options={CURRICULUM_OPTIONS}
              />
            </FieldRow>
            <FieldRow label="Periods per week" htmlFor="tp-periods" help="Used for your weekly targets when no class timetable is connected.">
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
