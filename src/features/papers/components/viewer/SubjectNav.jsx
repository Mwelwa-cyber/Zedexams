/**
 * Previous/next links across the sibling subjects of the same grade and year,
 * plus the way back to the hub.
 */
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Layers } from '../../../../shared/components/icons'
import { viewPath } from '../../lib/paperNav'
import { subjectMeta } from '../../lib/paperVisuals'

/** ← Previous Subject · Back to Subjects · Next Subject → */
function SubjectNav({ prev, next, backTo }) {
  if (!prev && !next) {
    return (
      <div className="mt-6 flex justify-center">
        <Link
          to={backTo}
          className="inline-flex items-center gap-1.5 rounded-full theme-card border theme-border px-5 py-2.5 text-sm font-black hover:theme-bg-subtle transition"
        >
          <Layers size={15} strokeWidth={2.4} /> Back to Subjects
        </Link>
      </div>
    )
  }
  return (
    <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-2 items-center">
      {prev ? (
        <Link
          to={viewPath(prev)}
          className="inline-flex items-center gap-1.5 rounded-full theme-card border theme-border px-4 py-2.5 text-xs sm:text-sm font-black hover:theme-bg-subtle transition min-w-0"
        >
          <ChevronLeft size={15} strokeWidth={2.6} className="flex-shrink-0" />
          <span className="truncate">{subjectMeta(prev.subject).label}</span>
        </Link>
      ) : <span className="hidden sm:block" />}
      <Link
        to={backTo}
        className="hidden sm:inline-flex items-center justify-center gap-1.5 rounded-full theme-bg-subtle theme-text px-4 py-2.5 text-xs sm:text-sm font-black hover:theme-card transition"
      >
        <Layers size={15} strokeWidth={2.4} /> Subjects
      </Link>
      {next ? (
        <Link
          to={viewPath(next)}
          className="inline-flex items-center justify-end gap-1.5 rounded-full theme-card border theme-border px-4 py-2.5 text-xs sm:text-sm font-black hover:theme-bg-subtle transition min-w-0 col-start-2 sm:col-start-3"
        >
          <span className="truncate">{subjectMeta(next.subject).label}</span>
          <ChevronRight size={15} strokeWidth={2.6} className="flex-shrink-0" />
        </Link>
      ) : <span className="hidden sm:block" />}
    </div>
  )
}

export default SubjectNav
