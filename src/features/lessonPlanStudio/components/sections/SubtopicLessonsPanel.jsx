import { useState } from 'react'
import { ChartBarIcon } from '../../../../shared/components/icons'
import {
  subtopicProgress,
  recommendationFor,
  findLessonByNumber,
  TEACHING_STATUSES,
} from '../../../../components/teacher/studio/utils/lessonMemory.js'

/**
 * SubtopicLessonsPanel — the Lesson Plan Studio's persistent-memory section.
 *
 * When a teacher reselects a curriculum + grade + subject + topic + subtopic,
 * this shows every lesson plan they have already created for that subtopic,
 * how many are expected, which are missing, teaching progress, a smart
 * recommendation, and per-lesson Continue / Edit / Create actions. It reads the
 * teacher's saved lessons (live from Firestore via useLessonMemory) so progress
 * survives leaving and returning to the site.
 *
 * Pure presentational: the parent owns the data + handlers.
 *
 * Props:
 *   subtopicName, subtopicCode : current selection (panel hidden until a subtopic is set)
 *   lessons        : object[]  — saved lessons for THIS subtopic, sorted by lessonNumber
 *   expectedCount  : number    — how many lessons the subtopic should have
 *   loading        : boolean
 *   nextRecommendedSubtopic : string|null
 *   onSetTeachingStatus : (lessonId, statusId) => void
 *   onCreateLesson : (lessonNumber) => void   — generate this lesson
 *   onOpenLesson   : (lesson) => void         — continue/edit an existing lesson
 */

const TEACHING_PILL = {
  not_started: 'bg-[#f0ebe2] text-[#7a6d5d]',
  planned: 'bg-blue-50 text-blue-700',
  taught: 'bg-green-50 text-green-700',
  needs_revision: 'bg-amber-50 text-amber-700',
}

function statusDot(progress) {
  if (progress.created === 0) return 'bg-[#c9c0b0]'
  if (progress.taughtCount >= progress.expected && progress.expected > 0) return 'bg-green-500'
  if (progress.created >= progress.expected) return 'bg-amber-500'
  return 'bg-blue-500'
}

export function SubtopicLessonsPanel({
  subtopicName,
  subtopicCode,
  lessons = [],
  expectedCount = 1,
  loading = false,
  nextRecommendedSubtopic = null,
  onSetTeachingStatus,
  onCreateLesson,
  onOpenLesson,
}) {
  const [open, setOpen] = useState(true)

  // Hidden until a subtopic is chosen (mirrors CoveragePanel's grade/subject gate).
  if (!subtopicName) return null

  const progress = subtopicProgress(lessons, expectedCount)
  const { created, expected, taughtCount } = progress
  const taughtPct = expected ? Math.round((taughtCount / expected) * 100) : 0
  const recommendation = recommendationFor({
    lessons,
    expected,
    subtopicName,
    nextRecommendedSubtopic,
  })
  const label = [subtopicCode, subtopicName].filter(Boolean).join(' ')

  // Render one row per expected lesson slot (1..expected), plus any extra
  // lessons the teacher created beyond the expected count.
  const maxSlot = Math.max(expected, ...lessons.map((l) => Number(l.lessonNumber) || 0), created)
  const slots = []
  for (let n = 1; n <= maxSlot; n++) slots.push(n)

  return (
    <div className="border-b border-[#e5ddd0]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-[#3d3529]">
          <span className={['inline-block h-2 w-2 flex-shrink-0 rounded-full', statusDot(progress)].join(' ')} aria-hidden="true" />
          <ChartBarIcon size={15} className="text-[#a99e8b]" aria-hidden="true" />
          Saved Lessons
          <span className="rounded-full bg-[#f0ebe2] px-2 py-0.5 text-[10px] font-bold text-[#7a6d5d]">
            {created}/{expected}
          </span>
        </span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          className={['text-[#a39d8e] transition-transform', open ? 'rotate-180' : ''].join(' ')}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="lps-section-enter px-4 pb-4 space-y-3">
          {loading && created === 0 && (
            <p className="text-[12px] text-[#a39d8e]">Loading your saved lessons…</p>
          )}

          {/* Created summary (requirement #2) */}
          <p className="text-[12px] text-[#7a6d5d]">
            <span className="font-semibold text-[#3d3529]">{created} of {expected}</span>{' '}
            lesson plan{expected === 1 ? '' : 's'} created for {label}
          </p>

          {/* Teaching progress (requirement #3) */}
          <div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e5ddd0]">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${taughtPct}%` }}
                role="progressbar"
                aria-valuenow={taughtCount}
                aria-valuemin={0}
                aria-valuemax={expected}
              />
            </div>
            <p className="mt-1.5 text-[12px] text-[#7a6d5d]">{taughtCount} of {expected} lessons taught</p>
          </div>

          {/* Smart recommendation (requirement #5) */}
          {recommendation.text && (
            <div className="flex items-start gap-2 rounded-xl border-2 border-[#0F1B2D] bg-[#FFF4E8] px-3 py-2">
              <span className="mt-0.5 text-[13px] leading-none" aria-hidden="true">💡</span>
              <p className="text-[11.5px] font-medium text-[#3d3529]">{recommendation.text}</p>
            </div>
          )}

          {/* Lesson list (requirement #7) */}
          <ul className="space-y-1.5">
            {slots.map((n) => {
              const lesson = findLessonByNumber(lessons, n)
              if (lesson) {
                const ts = lesson.teachingStatus || 'planned'
                const title = lesson.title || lesson.subtopicName || `Lesson ${n}`
                return (
                  <li key={lesson.id || n} className="rounded-lg border border-[#ece5d8] bg-white px-2.5 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-semibold text-[#3d3529]">
                          Lesson {n}: {title}
                        </p>
                        <span className={['mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold', TEACHING_PILL[ts] || TEACHING_PILL.planned].join(' ')}>
                          {TEACHING_STATUSES.find((s) => s.id === ts)?.label || 'Planned'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => typeof onOpenLesson === 'function' && onOpenLesson(lesson)}
                        className="shrink-0 rounded-lg border border-[#d9cfbe] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#3d3529] transition-colors hover:bg-[#f5f0e8]"
                      >
                        {lesson.generationId ? 'Edit' : 'Continue'}
                      </button>
                    </div>
                    {/* Teaching-status control (requirement #3) */}
                    <label className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-[#a39d8e]">
                      Mark as
                      <select
                        value={ts}
                        onChange={(e) => typeof onSetTeachingStatus === 'function' && onSetTeachingStatus(lesson.id, e.target.value)}
                        aria-label={`Teaching status for lesson ${n}`}
                        className="flex-1 rounded-md border border-[#e0d7c8] bg-white px-1.5 py-1 text-[11px] text-[#3d3529]"
                      >
                        {TEACHING_STATUSES.map((s) => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                    </label>
                  </li>
                )
              }
              // Missing lesson slot → offer to create it.
              return (
                <li key={n} className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-[#e0d7c8] px-2.5 py-2">
                  <span className="flex items-center gap-2 text-[12px] text-[#a39d8e]">
                    <span className="text-[#c9c0b0]" aria-hidden="true">○</span>
                    Lesson {n}: Not started
                  </span>
                  <button
                    type="button"
                    onClick={() => typeof onCreateLesson === 'function' && onCreateLesson(n)}
                    className="shrink-0 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-blue-700"
                  >
                    Create
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
