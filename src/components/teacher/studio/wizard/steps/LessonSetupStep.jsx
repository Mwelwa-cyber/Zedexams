import { useState } from 'react'
import { CurriculumPicker } from '../../sections/CurriculumPicker.jsx'
import { LessonDetailsForm } from '../../sections/LessonDetailsForm.jsx'
import { CurriculumCompactField } from '../CurriculumCompactField.jsx'

/**
 * Step 1 — Lesson Setup.
 *
 * Curriculum choice (the big cards collapse to a compact editable row once a
 * curriculum is picked) plus the lesson details: class, subject, duration,
 * date, time, teacher, school and school resources. All data logic lives in
 * the reused LessonDetailsForm (grade availability, catalogue-driven subjects,
 * stale-value clearing) — this step only arranges it.
 *
 * Props:
 *   curriculumMode      : 'cbc' | 'previous' | null
 *   onSelectCurriculum  : (mode) => void
 *   lessonDetails       : useStudioState().lessonDetails
 *   onChangeDetail      : (field, value) => void
 *   dateHint, dateWarning : strings from the Teaching Profile calendar checks
 */
export function LessonSetupStep({
  curriculumMode,
  onSelectCurriculum,
  lessonDetails,
  onChangeDetail,
  dateHint = '',
  dateWarning = '',
}) {
  // Re-opens the full curriculum cards from the compact row's "Change".
  const [changing, setChanging] = useState(false)
  const showPicker = !curriculumMode || changing

  return (
    <div className="space-y-4">
      {showPicker ? (
        <div className="rounded-2xl border-2 border-card-border bg-card p-4 shadow-[0_2px_0_var(--zt-card-border)]">
          <CurriculumPicker
            embedded
            curriculumMode={curriculumMode}
            onSelect={(mode) => {
              onSelectCurriculum(mode)
              setChanging(false)
            }}
          />
          {changing && (
            <button
              type="button"
              onClick={() => setChanging(false)}
              className="mt-3 text-[12px] font-bold text-ink-muted underline"
            >
              Keep current curriculum
            </button>
          )}
        </div>
      ) : (
        <CurriculumCompactField
          curriculumMode={curriculumMode}
          onChange={() => setChanging(true)}
        />
      )}

      {curriculumMode && !showPicker && (
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
