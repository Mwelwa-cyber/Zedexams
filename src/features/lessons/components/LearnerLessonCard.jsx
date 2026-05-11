// src/features/lessons/components/LearnerLessonCard.jsx
//
// Card on the learner's /lessons list. Mirrors LearnerNoteCard but
// surfaces slide count + a "Watch / Play" affordance to make it clear
// this opens an interactive slide deck rather than a reading page.

import { ArrowRight, Sparkles, BookOpen } from '../../../components/ui/icons'
import { formatDate } from '../../notes/lib/format'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

const isNewThisWeek = (publishedAt) => {
  if (!publishedAt) return false
  const d = typeof publishedAt?.toDate === 'function' ? publishedAt.toDate() : new Date(publishedAt)
  return Date.now() - d.getTime() < SEVEN_DAYS_MS
}

export function LearnerLessonCard({ lesson, onClick }) {
  const isNew = isNewThisWeek(lesson.publishedAt)
  const slideCount = Array.isArray(lesson.slides) ? lesson.slides.length : 0

  return (
    <button
      onClick={() => onClick?.(lesson)}
      className="group text-left bg-white rounded-xl border border-neutral-200 p-5 hover:border-neutral-400 transition-all w-full"
    >
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded-full">
          Grade {lesson.grade}
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500">
          <BookOpen size={11} /> {slideCount} slide{slideCount === 1 ? '' : 's'}
        </span>
        {isNew && (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
          >
            <Sparkles size={10} /> New
          </span>
        )}
      </div>

      <h3 className="font-display text-2xl leading-tight mb-2 tracking-tight text-neutral-900 group-hover:text-emerald-700 transition-colors">
        {lesson.title}
      </h3>

      {lesson.topic && (
        <p className="text-sm text-neutral-600 line-clamp-2 mb-4 min-h-[2.5em]">
          {lesson.topic}
        </p>
      )}

      <div className="flex items-center justify-between text-[11px] text-neutral-500">
        <span>Published {formatDate(lesson.publishedAt)}</span>
        <span className="inline-flex items-center gap-1 group-hover:gap-2 transition-all" style={{ color: '#047857' }}>
          Start <ArrowRight size={12} />
        </span>
      </div>
    </button>
  )
}
