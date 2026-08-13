import { CurriculumPicker } from '../../../../../components/teacher/studio/sections/CurriculumPicker.jsx'
import { LessonDetailsForm } from '../../sections/LessonDetailsForm.jsx'
import { CurriculumCompactField } from '../CurriculumCompactField.jsx'

/**
 * Step 1 — Lesson Setup.
 *
 * Curriculum choice plus the lesson details: class, subject, duration, date,
 * time, teacher, school and school resources. All data logic lives in the
 * reused LessonDetailsForm (grade availability, catalogue-driven subjects,
 * stale-value clearing) — this step only arranges it.
 *
 * Once a curriculum is picked the two large cards collapse to a single inline
 * row, and that row is SUPPRESSED entirely while the wizard's "Set up for you"
 * context card is on screen (it already shows the same curriculum chip and
 * Change action). Which of the two is showing is the wizard's call, so the
 * open/closed state of the picker is lifted there too — both Change controls
 * drive the same `changingCurriculum` flag.
 *
 * The details form stays mounted while the picker is re-opened over an
 * existing choice: a teacher who reaches for Change has not asked for the
 * class and subject they already filled in to disappear.
 *
 * Props:
 *   curriculumMode      : 'cbc' | 'previous' | null
 *   onSelectCurriculum  : (mode) => void
 *   changingCurriculum  : boolean — picker re-opened over an existing choice
 *   onChangeCurriculum  : () => void — open the picker
 *   onKeepCurriculum    : () => void — close it without changing anything
 *   showCurriculumRow   : boolean — false while the context card covers it
 *   lessonDetails       : useStudioState().lessonDetails
 *   onChangeDetail      : (field, value) => void
 *   dateHint, dateWarning : strings from the Teaching Profile calendar checks
 */
export function LessonSetupStep({
  curriculumMode,
  onSelectCurriculum,
  changingCurriculum = false,
  onChangeCurriculum,
  onKeepCurriculum,
  showCurriculumRow = true,
  lessonDetails,
  onChangeDetail,
  dateHint = '',
  dateWarning = '',
}) {
  const showPicker = !curriculumMode || changingCurriculum

  return (
    <div className="space-y-4">
      {showPicker ? (
        <div className="rounded-2xl border-2 border-card-border bg-card p-4 shadow-[0_2px_0_var(--zt-card-border)]">
          <CurriculumPicker
            embedded
            curriculumMode={curriculumMode}
            onSelect={onSelectCurriculum}
          />
          {changingCurriculum && (
            <button
              type="button"
              onClick={onKeepCurriculum}
              className="mt-3 text-[12px] font-bold text-ink-muted underline"
            >
              Keep current curriculum
            </button>
          )}
        </div>
      ) : showCurriculumRow ? (
        <CurriculumCompactField
          curriculumMode={curriculumMode}
          onChange={onChangeCurriculum}
        />
      ) : null}

      {curriculumMode && (
        <div className="rounded-2xl border-2 border-card-border bg-card p-4 shadow-[0_2px_0_var(--zt-card-border)]">
          <LessonDetailsForm
            embedded
            lessonDetails={lessonDetails}
            curriculumMode={curriculumMode}
            onChange={onChangeDetail}
            disabled={!curriculumMode}
            dateHint={dateHint}
            dateWarning={dateWarning}
          />
        </div>
      )}
    </div>
  )
}
