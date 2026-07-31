/**
 * CreatedFromLessonPlanNotice — the compact, non-blocking banner a Worksheet /
 * Homework studio shows when it was opened from a saved Lesson Plan
 * (`?sourceLessonPlanId=…`). It states the inherited context and links back to
 * the source plan. The inherited fields stay fully editable — this is
 * informational, it never locks the form.
 *
 * The label is built from the URL params the Library passed (grade/subject/
 * topic/term/schoolWeek), so no extra Firestore read is needed to render it.
 */

import { Link } from 'react-router-dom'
import { lessonPlanSourceLabel } from '../../../utils/lessonPlanInheritance'

export default function CreatedFromLessonPlanNotice({ urlDefaults }) {
  const id = urlDefaults?.sourceLessonPlanId
  if (!id) return null
  const label = lessonPlanSourceLabel({
    grade: urlDefaults.grade,
    subject: urlDefaults.subject,
    topic: urlDefaults.topic,
    term: urlDefaults.term,
    schoolWeek: urlDefaults.schoolWeek,
  })
  return (
    <div
      className="rounded-xl border-2 px-4 py-3 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1"
      style={{ borderColor: '#c7d2fe', background: '#eef2ff', color: '#3730a3' }}
      role="status"
    >
      <span aria-hidden="true">📘</span>
      <span className="font-bold">Created from Lesson Plan</span>
      {label && <span className="text-sm opacity-90">· {label}</span>}
      <Link
        to={`/teacher/library/${id}`}
        className="text-sm font-bold underline ml-auto"
        style={{ color: 'var(--info-fg)' }}
      >
        View source lesson
      </Link>
    </div>
  )
}
