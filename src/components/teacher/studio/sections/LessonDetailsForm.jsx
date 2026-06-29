import { useState, useEffect } from 'react'
import { useSubjectsForGrade } from '../hooks/useSubjectsForGrade.js'
import { useAvailableGrades } from '../hooks/useAvailableGrades.js'
import { cleanSubjectName } from '../utils/subjectName.js'

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

// Shared Tailwind classes for form controls inside the section body
const INPUT_CLS =
  'w-full rounded-lg border border-[#d9cfbe] bg-white px-2.5 py-1.5 text-[13px] text-[#3d3529] focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400'
const LABEL_CLS = 'block text-[11px] font-semibold text-[#7a6d5d] mb-1'

/**
 * LessonDetailsForm — collapsible sidebar section for lesson metadata.
 *
 * Props:
 *   lessonDetails: { grade, subject, duration, medium, date, time }
 *   curriculumMode: 'cbc' | 'previous' | null
 *   onChange: (field, value) => void
 *   disabled: boolean — true when curriculumMode is null
 */
export function LessonDetailsForm({ lessonDetails, curriculumMode, onChange, disabled }) {
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

  return (
    <div
      className={[
        'border-b border-[#e5ddd0]',
        disabled ? 'pointer-events-none opacity-50' : '',
      ].join(' ')}
    >
      {/* Section header — always visible */}
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

      {/* Collapsible body */}
      {open && (
        <div className="px-4 pb-4 space-y-3">

          {/* Class */}
          <div>
            <label htmlFor="ldf-grade" className={LABEL_CLS}>Class</label>
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

          {/* Subject */}
          <div>
            <label htmlFor="ldf-subject" className={LABEL_CLS}>Subject</label>
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

          {/* Duration — Medium now lives in Format & Options → Advanced */}
          <div>
            <label htmlFor="ldf-duration" className={LABEL_CLS}>Duration</label>
            <div className="relative">
              <input
                id="ldf-duration"
                type="number"
                min={20}
                max={120}
                step={5}
                value={lessonDetails.duration}
                onChange={(e) => onChange('duration', e.target.value)}
                className={INPUT_CLS + ' pr-10'}
                disabled={disabled}
              />
              <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-[#a39d8e]">
                mins
              </span>
            </div>
          </div>

          {/* Date + Time — two columns */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="ldf-date" className={LABEL_CLS}>Date</label>
              <input
                id="ldf-date"
                type="date"
                value={lessonDetails.date}
                onChange={(e) => onChange('date', e.target.value)}
                className={INPUT_CLS}
                disabled={disabled}
              />
            </div>

            <div>
              <label htmlFor="ldf-time" className={LABEL_CLS}>Time</label>
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

          {/* Teacher Name */}
          <div>
            <label htmlFor="ldf-teacher" className={LABEL_CLS}>Teacher Name <span className="font-normal text-[#a39d8e]">(optional)</span></label>
            <input
              id="ldf-teacher"
              type="text"
              value={lessonDetails.teacherName}
              onChange={(e) => onChange('teacherName', e.target.value)}
              className={INPUT_CLS}
              disabled={disabled}
            />
          </div>

          {/* School */}
          <div>
            <label htmlFor="ldf-school" className={LABEL_CLS}>School <span className="font-normal text-[#a39d8e]">(optional)</span></label>
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
      )}
    </div>
  )
}
