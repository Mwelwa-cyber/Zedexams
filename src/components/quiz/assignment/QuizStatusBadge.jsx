/**
 * Status pill shared across the quiz editor, list, and assignment
 * wizard. One source of truth for the colour + label so a quiz that
 * shows "Active" in the editor reads the same in the class list.
 *
 * Statuses (matches deriveQuizStatus() in utils/quizAssignments.js):
 *   - draft       — unpublished, never assigned
 *   - pending     — submitted for admin review
 *   - scheduled   — published but openAt is in the future
 *   - active      — published AND assigned to at least one class
 *   - published   — published but not yet assigned
 *   - completed   — closed/past due
 *   - archived    — soft-deleted
 */

const STATUS_META = {
  draft: {
    label: 'Draft',
    dotClass: 'bg-slate-400',
    pillClass: 'bg-slate-100 text-slate-700 border-slate-200',
    description: 'Not yet published.',
  },
  pending: {
    label: 'Pending review',
    dotClass: 'bg-yellow-400',
    pillClass: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    description: 'Submitted for admin approval.',
  },
  scheduled: {
    label: 'Scheduled',
    dotClass: 'bg-indigo-500',
    pillClass: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    description: 'Will release automatically at the open date.',
  },
  active: {
    label: 'Active',
    dotClass: 'bg-emerald-500',
    pillClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    description: 'Assigned to one or more classes.',
  },
  published: {
    label: 'Published',
    dotClass: 'bg-sky-500',
    pillClass: 'bg-sky-100 text-sky-800 border-sky-200',
    description: 'Live in the library; not yet assigned.',
  },
  completed: {
    label: 'Completed',
    dotClass: 'bg-slate-500',
    pillClass: 'bg-slate-100 text-slate-700 border-slate-200',
    description: 'Closed — past due date.',
  },
  archived: {
    label: 'Archived',
    dotClass: 'bg-zinc-400',
    pillClass: 'bg-zinc-100 text-zinc-700 border-zinc-200',
    description: 'No longer visible to learners.',
  },
  rejected: {
    label: 'Rejected',
    dotClass: 'bg-red-500',
    pillClass: 'bg-red-100 text-red-700 border-red-200',
    description: 'Admin sent back for changes.',
  },
}

const SIZE_CLASSES = {
  sm: 'px-2 py-0.5 text-[10px]',
  md: 'px-2.5 py-1 text-xs',
  lg: 'px-3 py-1.5 text-sm',
}

export default function QuizStatusBadge({ status, size = 'md', showDescription = false, className = '' }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft
  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES.md
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-bold ${meta.pillClass} ${sizeClass} ${className}`}
      title={showDescription ? meta.description : undefined}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  )
}

export { STATUS_META as QUIZ_STATUS_META }
