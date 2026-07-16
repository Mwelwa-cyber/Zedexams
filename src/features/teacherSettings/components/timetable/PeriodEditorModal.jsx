import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import useFocusTrap from '../../../../hooks/useFocusTrap'
import FieldRow from '../fields/FieldRow'
import {
  normalizeAssignment,
  validateAssignment,
  assignmentLabel,
  gradeLabel,
  subjectLabel,
  curriculumTypeLabel,
} from '../../../../utils/teachingProfileCore'
import {
  TT_DAY_LABELS,
  normalizeTtBlock,
  validateManualBlock,
  computeCoverage,
  nextBlockId,
  timeToMin,
  minToTime,
} from '../../../../utils/teacherTimetableCore'
import { TIMETABLE_DAYS } from '../../../../utils/teacherSettingsCore'

/**
 * Add / edit a manual teaching period. The Teaching Assignment is the
 * curriculum boundary — there are NO grade/subject pickers here: the teacher
 * chooses one of their own valid assignments (curriculum, grade, subject and
 * class come with it), then day → time → duration → single/double → room.
 * Creating a NEW assignment happens in the standard Teaching Profile workflow
 * (linked below), never re-implemented inside this form.
 *
 * Props:
 *   open, initial (block being edited | null), blocks (all current blocks),
 *   assignments (the teacher's assignments incl. ids),
 *   defaultPeriodLengthMinutes, onSubmit(block), onClose()
 */
export default function PeriodEditorModal({
  open,
  initial = null,
  blocks = [],
  assignments = [],
  defaultPeriodLengthMinutes = 40,
  onSubmit,
  onClose,
  onDelete = null,
}) {
  const panelRef = useRef(null)
  const firstFieldRef = useRef(null)
  const [error, setError] = useState('')

  const [base] = useState(() => (initial ? normalizeTtBlock(initial) : null))
  const [form, setForm] = useState(() => ({
    assignmentId: base?.assignmentId || '',
    day: base?.day || 'mon',
    startTime: base?.startTime || '08:00',
    durationMinutes: base?.durationMinutes && base.lengthInPeriods
      ? Math.round(base.durationMinutes / base.lengthInPeriods)
      : null,
    lengthInPeriods: base?.lengthInPeriods || 1,
    roomId: base?.roomId || '',
    notes: base?.notes || '',
  }))

  // Only the teacher's own valid, active assignments are offered. Invalid ones
  // are listed disabled with a pointer to the Teaching Profile so the teacher
  // knows why they're unavailable — never silently hidden.
  const options = useMemo(
    () =>
      (assignments || [])
        .filter((a) => a?.id && normalizeAssignment(a).isActive)
        .map((a) => ({ ...normalizeAssignment(a), id: a.id, valid: validateAssignment(a).valid })),
    [assignments],
  )

  const selected = options.find((a) => a.id === form.assignmentId) || null

  // The per-period duration falls back to the assignment's own duration, then
  // to the page default — the default NEVER overrides an assignment duration.
  const effectiveDuration = form.durationMinutes
    ?? selected?.lessonDurationMinutes
    ?? defaultPeriodLengthMinutes

  const built = useMemo(() => {
    const startMin = timeToMin(form.startTime)
    const total = effectiveDuration * form.lengthInPeriods
    return normalizeTtBlock({
      ...(base || {}),
      blockId: base?.blockId || nextBlockId(blocks, form.day, form.startTime),
      day: form.day,
      startTime: form.startTime,
      endTime: startMin != null ? minToTime(startMin + total) : '',
      lengthInPeriods: form.lengthInPeriods,
      assignmentId: form.assignmentId,
      sourceType: base?.sourceType === 'legacy' ? 'legacy' : 'manual',
      roomId: form.roomId,
      notes: form.notes,
      locked: false,
      // Attaching a valid assignment resolves a legacy review block.
      migrationState: '',
      originalValues: null,
      snapshot: selected
        ? {
            label: assignmentLabel(selected),
            grade: selected.grade,
            subject: selected.subject,
            className: selected.className,
            curriculumType: selected.curriculumType,
          }
        : base?.snapshot,
    })
  }, [form, base, blocks, selected, effectiveDuration])

  const check = useMemo(
    () => validateManualBlock({ block: built, blocks, assignments }),
    [built, blocks, assignments],
  )

  const coverageRow = useMemo(() => {
    if (!selected) return null
    return computeCoverage({ assignments, blocks }).find((c) => c.assignmentId === selected.id) || null
  }, [selected, assignments, blocks])

  useFocusTrap(panelRef, {
    active: open,
    initialFocusRef: firstFieldRef,
    onEscape: () => onClose?.(),
  })

  if (!open) return null

  const setField = (patch) => setForm((f) => ({ ...f, ...patch }))

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')
    if (!check.valid) {
      setError(check.errors[0])
      return
    }
    onSubmit(check.block)
  }

  const titleId = 'tt-period-modal-title'
  const isLegacyReview = base?.migrationState === 'needs-review'

  return (
    <div
      className="tset-tp-modal__overlay"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div className="tset-tp-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panelRef}>
        <div className="tset-tp-modal__handle" aria-hidden="true" />
        <header className="tset-tp-modal__head">
          <h2 id={titleId} className="tset-section__title">
            {base ? 'Edit teaching period' : 'Add teaching period'}
          </h2>
          <button type="button" className="tset-tp-iconbtn" onClick={() => onClose?.()} aria-label="Close">✕</button>
        </header>

        <form className="tset-tp-modal__body" onSubmit={handleSubmit}>
          {isLegacyReview && base?.originalValues && (
            <p className="tset-savebar__status tset-savebar__status--error" role="alert">
              Needs review: this period was saved as{' '}
              {[
                base.originalValues.grade ? gradeLabel(base.originalValues.grade) : '',
                base.originalValues.subject ? subjectLabel(base.originalValues.subject) : '',
                base.originalValues.label,
              ].filter(Boolean).join(' · ') || 'an unrecognised subject'}
              , which does not match any of your current Teaching Assignments. The original values
              have been preserved — attach it to a valid Teaching Assignment below to resolve it.
            </p>
          )}

          <FieldRow label="Teaching Assignment" htmlFor="tt-assignment" full
            help="Curriculum, grade, subject and class come from the assignment — this page never keeps its own lists.">
            <select
              id="tt-assignment"
              ref={firstFieldRef}
              className="studio-input"
              value={form.assignmentId}
              onChange={(e) => setField({ assignmentId: e.target.value })}
            >
              <option value="">Choose an assignment…</option>
              {options.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.valid}>
                  {assignmentLabel(a)}
                  {' — '}
                  {curriculumTypeLabel(a.curriculumType)}
                  {a.periodsPerWeek != null ? ` · ${a.periodsPerWeek} periods/week` : ''}
                  {a.lessonDurationMinutes != null ? ` · ${a.lessonDurationMinutes} min` : ''}
                  {!a.valid ? ' (needs review)' : ''}
                </option>
              ))}
            </select>
          </FieldRow>

          <p className="tset-help">
            Missing an assignment?{' '}
            <Link to="/settings/teaching-profile">Add Teaching Assignment</Link>
          </p>

          {selected && (
            <div className="tset-ttb-assignment-summary">
              <p><strong>{assignmentLabel(selected)}</strong> · {curriculumTypeLabel(selected.curriculumType)}</p>
              <p>
                {selected.periodsPerWeek != null ? `Required load: ${selected.periodsPerWeek} periods/week` : 'No weekly allocation set'}
                {coverageRow ? ` · Scheduled: ${coverageRow.scheduled}` : ''}
                {coverageRow?.remaining != null ? ` · Remaining: ${coverageRow.remaining}` : ''}
              </p>
              <p>Standard duration: {selected.lessonDurationMinutes ?? defaultPeriodLengthMinutes} minutes{selected.lessonDurationMinutes == null ? ' (page default)' : ''}</p>
            </div>
          )}

          <div className="tset-grid" style={{ marginTop: 14 }}>
            <FieldRow label="Day" htmlFor="tt-day">
              <select id="tt-day" className="studio-input" value={form.day} onChange={(e) => setField({ day: e.target.value })}>
                {TIMETABLE_DAYS.map((d) => <option key={d} value={d}>{TT_DAY_LABELS[d]}</option>)}
              </select>
            </FieldRow>
            <FieldRow label="Start time" htmlFor="tt-start">
              <input id="tt-start" className="studio-input" type="time" value={form.startTime}
                onChange={(e) => setField({ startTime: e.target.value })} />
            </FieldRow>
            <FieldRow label="Duration per period (minutes)" htmlFor="tt-duration"
              help={selected?.lessonDurationMinutes != null
                ? `Leave blank to use this assignment's ${selected.lessonDurationMinutes}-minute duration.`
                : `Leave blank to use the default (${defaultPeriodLengthMinutes} minutes).`}>
              <input id="tt-duration" className="studio-input" type="number" min={5} max={240}
                value={form.durationMinutes ?? ''}
                placeholder={String(selected?.lessonDurationMinutes ?? defaultPeriodLengthMinutes)}
                onChange={(e) => setField({ durationMinutes: e.target.value === '' ? null : Number(e.target.value) })} />
            </FieldRow>
            <FieldRow label="Single or double period" htmlFor="tt-length"
              help="A double period is one continuous block of two consecutive periods — it counts as two periods of your weekly load.">
              <select id="tt-length" className="studio-input" value={form.lengthInPeriods}
                onChange={(e) => setField({ lengthInPeriods: Number(e.target.value) })}>
                <option value={1}>Single period</option>
                <option value={2}>Double period</option>
              </select>
            </FieldRow>
            <FieldRow label="Room (optional)" htmlFor="tt-room" help="Used to warn about room clashes.">
              <input id="tt-room" className="studio-input" type="text" maxLength={60} value={form.roomId}
                placeholder="e.g. Science Laboratory" onChange={(e) => setField({ roomId: e.target.value })} />
            </FieldRow>
            <FieldRow label="Notes (optional)" htmlFor="tt-notes">
              <input id="tt-notes" className="studio-input" type="text" maxLength={200} value={form.notes}
                placeholder="e.g. remedial lesson" onChange={(e) => setField({ notes: e.target.value })} />
            </FieldRow>
          </div>

          {built.startTime && built.endTime && (
            <p className="tset-help" aria-live="polite">
              This period runs {TT_DAY_LABELS[built.day]} {built.startTime}–{built.endTime}
              {' '}({built.durationMinutes} minutes{built.blockType === 'double' ? ', double period' : ''}).
            </p>
          )}

          {!check.valid && form.assignmentId && (
            <p className="tset-savebar__status tset-savebar__status--error" role="alert">{check.errors[0]}</p>
          )}
          {check.valid && check.warnings.length > 0 && (
            <p className="tset-ttb-warning" role="status">{check.warnings[0]}</p>
          )}
          {error && <p className="tset-savebar__status tset-savebar__status--error" role="alert">{error}</p>}

          <div className="tset-tp-modal__actions">
            {onDelete && (
              <button type="button" className="tset-btn tset-btn--danger tset-btn--sm" onClick={onDelete}>
                Remove period
              </button>
            )}
            <button type="button" className="tset-btn tset-btn--ghost" onClick={() => onClose?.()}>Cancel</button>
            <button type="submit" className="tset-btn" disabled={!check.valid}>
              {base ? 'Save period' : 'Add period'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
