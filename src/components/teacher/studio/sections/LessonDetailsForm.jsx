import { useState, useEffect } from 'react'
import { GraduationCap, BookOpen, Clock, Calendar, User, School } from '../../../ui/icons'
import { useSubjectsForGrade } from '../hooks/useSubjectsForGrade.js'
import { useAvailableGrades } from '../hooks/useAvailableGrades.js'
import { cleanSubjectName } from '../utils/subjectName.js'
import { SCHOOL_RESOURCE_LEVELS, DEFAULT_SCHOOL_RESOURCES } from '../../../../config/schoolResources.js'

/**
 * Turn a syllabi subject key into a friendlier label for the dropdown while
 * the stored value stays the exact key (so topic lookup still matches).
 *   "Mathematics Syllabus (Grades 4-6)" → "Mathematics"
 *   "Lower Primary Syllabi (Grades 1-3)" → "Lower Primary"
 * Shared with the generator (utils/subjectName) so the dropdown label and the
 * subject printed on the finished plan stay identical.
 */
const subjectLabel = cleanSubjectName

/**
 * Grade lists per curriculum mode.
 *
 * Each entry: { value: string, label: string, group: string }
 */
const CBC_GRADES = [
  { group: 'ECE',            value: 'Nursery',    label: 'Nursery' },
  { group: 'ECE',            value: 'Reception',  label: 'Reception' },
  { group: 'Lower Primary',  value: 'Grade 1',    label: 'Grade 1' },
  { group: 'Lower Primary',  value: 'Grade 2',    label: 'Grade 2' },
  { group: 'Lower Primary',  value: 'Grade 3',    label: 'Grade 3' },
  { group: 'Upper Primary',  value: 'Grade 4',    label: 'Grade 4' },
  { group: 'Upper Primary',  value: 'Grade 5',    label: 'Grade 5' },
  { group: 'Upper Primary',  value: 'Grade 6',    label: 'Grade 6' },
  { group: 'Secondary',      value: 'Form 1',     label: 'Form 1' },
  { group: 'Secondary',      value: 'Form 2',     label: 'Form 2' },
  { group: 'Secondary',      value: 'Form 3',     label: 'Form 3' },
  { group: 'Secondary',      value: 'Form 4',     label: 'Form 4' },
]

// 2013 / previous curriculum. The data file (/syllabi/curriculum-data-2013.json)
// stores one sheet per grade ("Grade 1" … "Grade 12"), so each entry's `value`
// must be the literal grade — a group name like "Lower Primary" matches no sheet
// and yields an empty subject list. Grades with no data in the 2013 file (ECE,
// Grade 9) are intentionally omitted so the dropdown never offers a dead option.
const PREVIOUS_GRADES = [
  { group: 'Lower Primary',  value: 'Grade 1',    label: 'Grade 1' },
  { group: 'Lower Primary',  value: 'Grade 2',    label: 'Grade 2' },
  { group: 'Lower Primary',  value: 'Grade 3',    label: 'Grade 3' },
  { group: 'Lower Primary',  value: 'Grade 4',    label: 'Grade 4' },
  { group: 'Upper Primary',  value: 'Grade 5',    label: 'Grade 5' },
  { group: 'Upper Primary',  value: 'Grade 6',    label: 'Grade 6' },
  { group: 'Upper Primary',  value: 'Grade 7',    label: 'Grade 7' },
  { group: 'Secondary',      value: 'Grade 8',    label: 'Grade 8' },
  { group: 'Secondary',      value: 'Grade 10',   label: 'Grade 10' },
  { group: 'Secondary',      value: 'Grade 11',   label: 'Grade 11' },
  { group: 'Secondary',      value: 'Grade 12',   label: 'Grade 12' },
]

// Lesson duration choices offered in the dropdown. Values are strings so they
// match how the studio stores `lessonDetails.duration` ('40' by default). The
// common Zambian period lengths are annotated so teachers can pick at a glance.
const DURATION_OPTIONS = [
  { value: '30', label: '30 mins' },
  { value: '35', label: '35 mins' },
  { value: '40', label: '40 mins (single period)' },
  { value: '45', label: '45 mins' },
  { value: '60', label: '60 mins (1 hour)' },
  { value: '70', label: '70 mins (double period)' },
  { value: '80', label: '80 mins (double period)' },
  { value: '90', label: '90 mins' },
  { value: '120', label: '120 mins' },
]

/** Return the grade list for the active curriculum mode. */
function gradeListFor(curriculumMode) {
  return curriculumMode === 'previous' ? PREVIOUS_GRADES : CBC_GRADES
}

/** Return all valid grade values for a given mode. */
function gradeValuesFor(curriculumMode) {
  return new Set(gradeListFor(curriculumMode).map((g) => g.value))
}

/** Group grades by their `group` key for <optgroup> rendering. */
function groupedGrades(grades) {
  const map = new Map()
  for (const g of grades) {
    if (!map.has(g.group)) map.set(g.group, [])
    map.get(g.group).push(g)
  }
  return map
}

/** Derive a green/grey status dot: green when grade + subject are both filled. */
function isDone(lessonDetails) {
  return Boolean(lessonDetails.grade && lessonDetails.subject)
}

/**
 * "2026-08-04" → "Tue, 4 Aug 2026" — what the Date CONTROL displays. Built
 * from formatToParts so the shape is locale-stable (en-GB puts no comma after
 * the short weekday on some ICU builds). Empty string for no/invalid date.
 * Parsed as LOCAL midnight so the weekday never shifts a day on either side
 * of UTC.
 */
export function formatFriendlyDate(iso) {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  }).formatToParts(d)
  const get = (type) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('weekday')}, ${get('day')} ${get('month')} ${get('year')}`
}

// Shared Tailwind classes for form controls inside the section body.
// `pl-9` leaves room for the leading field icon rendered by <FieldIcon/>.
const INPUT_CLS =
  'w-full rounded-xl border border-[#e0d7c8] bg-white pl-9 pr-3 py-2 text-[13px] text-[#3d3529] transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30'
const LABEL_CLS = 'block text-[11px] font-semibold text-[#7a6d5d] mb-1'

/** Decorative leading icon positioned inside a relative field wrapper. */
function FieldIcon({ children }) {
  return (
    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#a99e8b]" aria-hidden="true">
      {children}
    </span>
  )
}

/**
 * LessonDetailsForm — collapsible sidebar section for lesson metadata.
 *
 * Props:
 *   lessonDetails: { grade, subject, duration, medium, date, time }
 *   curriculumMode: 'cbc' | 'previous' | null
 *   onChange: (field, value) => void
 *   disabled: boolean — true when curriculumMode is null
 *   embedded: boolean — wizard mode: render the fields only (no collapsible
 *             section chrome); the wizard step supplies the surrounding card
 */
export function LessonDetailsForm({ lessonDetails, curriculumMode, onChange, disabled, dateHint = '', dateWarning = '', embedded = false }) {
  const [open, setOpen] = useState(true)

  // When curriculumMode changes, reset grade if it is no longer valid for the
  // new mode's grade list.
  useEffect(() => {
    if (!curriculumMode) return
    const valid = gradeValuesFor(curriculumMode)
    if (lessonDetails.grade && !valid.has(lessonDetails.grade)) {
      onChange('grade', '')
    }
  }, [curriculumMode, lessonDetails.grade, onChange])

  // The static lists above are the *superset* of grades; the digitised syllabi
  // don't cover every one (e.g. CBC ships no Grade 5/6 or ECE subject data), so
  // we filter the picker down to grades that actually resolve to subjects. This
  // is what fixes the "some classes show no subjects" dead-ends.
  const candidateGradeValues = gradeListFor(curriculumMode).map((g) => g.value)
  const { available: availableGrades, loading: gradesLoading } = useAvailableGrades(
    candidateGradeValues,
    curriculumMode,
  )

  // If a previously-selected (e.g. prefilled / persisted) grade is no longer
  // offered once availability resolves, clear it so we never carry a grade that
  // has no subjects. `availableGrades === null` means "not yet resolved / load
  // failed" — leave the selection untouched in that case.
  useEffect(() => {
    if (!availableGrades) return
    if (lessonDetails.grade && !availableGrades.includes(lessonDetails.grade)) {
      onChange('grade', '')
    }
  }, [availableGrades, lessonDetails.grade, onChange])

  // Subjects come from the syllabi data for the selected grade — NOT a static
  // list — so the picked value is the syllabi subject key the topic/subtopic
  // dropdowns need. Without this the topic list is always empty.
  const { subjects, loading: subjectsLoading } = useSubjectsForGrade(
    lessonDetails.grade,
    curriculumMode,
  )

  // Clear a stale subject when the available list changes (e.g. the teacher
  // switched grade) and the current selection is no longer offered, so we
  // never carry a subject key that has no topics for the new grade.
  useEffect(() => {
    if (
      lessonDetails.subject &&
      !subjectsLoading &&
      subjects.length > 0 &&
      !subjects.includes(lessonDetails.subject)
    ) {
      onChange('subject', '')
    }
  }, [subjects, subjectsLoading, lessonDetails.subject, onChange])

  // Render only grades that have subject data. Until availability resolves (or
  // if the load failed → `null`), fall back to the full candidate list so the
  // picker is never mistakenly empty.
  const grades    = availableGrades
    ? gradeListFor(curriculumMode).filter((g) => availableGrades.includes(g.value))
    : gradeListFor(curriculumMode)
  const grouped   = groupedGrades(grades)
  const done      = isDone(lessonDetails)
  const friendlyDate = formatFriendlyDate(lessonDetails.date)
  const teacherSchoolPrefilled = Boolean(lessonDetails.teacherName && lessonDetails.school)

  return (
    <div
      className={[
        embedded ? '' : 'border-b border-[#e5ddd0]',
        disabled ? 'pointer-events-none opacity-50' : '',
      ].join(' ')}
    >
      {/* Section header — always visible (hidden in embedded wizard mode) */}
      {!embedded && (
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
        disabled={disabled}
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-[#3d3529]">
          {/* Status dot */}
          <span
            className={[
              'inline-block h-2 w-2 rounded-full flex-shrink-0',
              done ? 'bg-green-500' : 'bg-[#c9c0b0]',
            ].join(' ')}
            aria-hidden="true"
          />
          <GraduationCap size={15} className="text-[#a99e8b]" aria-hidden="true" />
          Lesson Details
        </span>

        {/* Chevron */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={[
            'text-[#a39d8e] transition-transform',
            open ? 'rotate-180' : '',
          ].join(' ')}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      )}

      {/* Collapsible body */}
      {(open || embedded) && (
        <div className={embedded ? '' : 'lps-section-enter px-4 pb-4'}>
          <div className={embedded ? 'space-y-3.5' : 'space-y-3.5 rounded-2xl border border-[#ece4d6] bg-white/60 p-3.5 lps-soft-shadow'}>

          {/* Class | Subject — two columns from 640px up */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div>
              <label htmlFor="ldf-grade" className={LABEL_CLS}>Class</label>
              <div className="relative">
                <FieldIcon><GraduationCap size={15} /></FieldIcon>
                <select
                  id="ldf-grade"
                  value={lessonDetails.grade}
                  onChange={(e) => onChange('grade', e.target.value)}
                  className={INPUT_CLS}
                  disabled={disabled}
                >
                  <option value="">
                    {gradesLoading && !availableGrades ? 'Loading classes…' : 'Select class…'}
                  </option>
                  {[...grouped.entries()].map(([groupLabel, items]) => (
                    <optgroup key={groupLabel} label={groupLabel}>
                      {items.map((g) => (
                        <option key={g.value} value={g.value}>{g.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="ldf-subject" className={LABEL_CLS}>Subject</label>
              <div className="relative">
                <FieldIcon><BookOpen size={15} /></FieldIcon>
                <select
                  id="ldf-subject"
                  value={lessonDetails.subject}
                  onChange={(e) => onChange('subject', e.target.value)}
                  className={INPUT_CLS}
                  disabled={disabled || !lessonDetails.grade || subjectsLoading}
                >
                  <option value="">
                    {!lessonDetails.grade
                      ? 'Select a class first…'
                      : subjectsLoading
                        ? 'Loading subjects…'
                        : subjects.length === 0
                          ? 'No subjects for this class yet'
                          : 'Select subject…'}
                  </option>
                  {subjects.map((s) => (
                    <option key={s} value={s}>{subjectLabel(s)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Duration | Date | Time — one compact row from 640px up.
              Medium now lives in Format & Options → Advanced. */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div>
              <label htmlFor="ldf-duration" className={LABEL_CLS}>Duration</label>
              <div className="relative">
                <FieldIcon><Clock size={15} /></FieldIcon>
                <select
                  id="ldf-duration"
                  value={lessonDetails.duration}
                  onChange={(e) => onChange('duration', e.target.value)}
                  className={INPUT_CLS}
                  disabled={disabled}
                >
                  {/* Keep any saved value not in the preset list selectable. */}
                  {lessonDetails.duration &&
                    !DURATION_OPTIONS.some((o) => o.value === String(lessonDetails.duration)) && (
                      <option value={lessonDetails.duration}>{lessonDetails.duration} mins</option>
                    )}
                  {DURATION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Date. The control itself reads "Fri, 7 Aug 2026" — a native
                date input prints 07/08/2026, which is a different day
                depending on where the teacher learned to read a date, and a
                confirmation line UNDER the field asks them to reconcile two
                renderings of one value instead of just showing the one that
                cannot be misread. The real <input type="date"> is still the
                control (same id, same value, same picker, same keyboard); only
                its own text is made transparent so the readable form can be
                painted over it. See `.ldf-date-*` in lessonStudio.css. */}
            <div>
              <label htmlFor="ldf-date" className={LABEL_CLS}>Date</label>
              <div className="relative">
                <FieldIcon><Calendar size={15} /></FieldIcon>
                <input
                  id="ldf-date"
                  type="date"
                  value={lessonDetails.date}
                  onChange={(e) => onChange('date', e.target.value)}
                  className={`${INPUT_CLS} ldf-date-input`}
                  disabled={disabled}
                  aria-describedby={dateWarning ? 'ldf-date-warning' : (dateHint ? 'ldf-date-hint' : undefined)}
                />
                <span
                  className={`ldf-date-display${friendlyDate ? '' : ' ldf-date-display--empty'}`}
                  aria-hidden="true"
                >
                  {friendlyDate || 'Select a date'}
                </span>
              </div>
              {dateWarning ? (
                <p id="ldf-date-warning" className="mt-1 text-[11.5px] leading-snug" style={{ color: '#b45309' }} role="alert">
                  {dateWarning}
                </p>
              ) : dateHint ? (
                <p id="ldf-date-hint" className="mt-1 text-[11.5px] leading-snug" style={{ color: 'var(--zt-text-muted)' }}>
                  {dateHint}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="ldf-time" className={LABEL_CLS}>Time <span className="font-normal text-[#a39d8e]">(optional)</span></label>
              <div className="relative">
                <FieldIcon><Clock size={15} /></FieldIcon>
                <input
                  id="ldf-time"
                  type="time"
                  value={lessonDetails.time}
                  onChange={(e) => onChange('time', e.target.value)}
                  className={INPUT_CLS}
                  disabled={disabled}
                />
              </div>
            </div>
          </div>

          {/* Teacher Name + School — collapsed by default: both are usually
              prefilled from the teacher's last plan, so they rarely need
              editing. Field ids and values are untouched — only the
              disclosure wrapper is new. */}
          <details className="rounded-xl border border-dashed border-[#e0d7c8] bg-white/50 px-3 py-2">
            <summary className="cursor-pointer select-none text-[12px] font-semibold text-[#7a6d5d]">
              {teacherSchoolPrefilled
                ? 'Teacher & school details — prefilled from last time ✓'
                : 'Teacher & school details (optional)'}
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <label htmlFor="ldf-teacher" className={LABEL_CLS}>Teacher Name <span className="font-normal text-[#a39d8e]">(optional)</span></label>
                <div className="relative">
                  <FieldIcon><User size={15} /></FieldIcon>
                  <input
                    id="ldf-teacher"
                    type="text"
                    value={lessonDetails.teacherName}
                    onChange={(e) => onChange('teacherName', e.target.value)}
                    className={INPUT_CLS}
                    disabled={disabled}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="ldf-school" className={LABEL_CLS}>School <span className="font-normal text-[#a39d8e]">(optional)</span></label>
                <div className="relative">
                  <FieldIcon><School size={15} /></FieldIcon>
                  <input
                    id="ldf-school"
                    type="text"
                    value={lessonDetails.school}
                    onChange={(e) => onChange('school', e.target.value)}
                    className={INPUT_CLS}
                    disabled={disabled}
                  />
                </div>
              </div>
            </div>
          </details>

          {/* School resources — constrains generated activities/materials to
              what the school actually has (rural-teacher feedback). */}
          <div>
            <label htmlFor="ldf-resources" className={LABEL_CLS}>School Resources</label>
            <div className="relative">
              <FieldIcon><BookOpen size={15} /></FieldIcon>
              <select
                id="ldf-resources"
                value={lessonDetails.resources || DEFAULT_SCHOOL_RESOURCES}
                onChange={(e) => onChange('resources', e.target.value)}
                className={INPUT_CLS}
                disabled={disabled}
              >
                {SCHOOL_RESOURCE_LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
            <p className="mt-1 text-[11px] text-[#a39d8e]">
              Activities and materials will only use what your school has.
            </p>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}
