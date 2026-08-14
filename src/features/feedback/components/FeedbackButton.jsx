import { useState } from 'react'
import Icon from '../../../shared/components/Icon'
import { Lightbulb } from '../../../shared/components/icons'
import FeedbackDialog from './FeedbackDialog'

// Drop-in launcher for the suggestion & request box. Renders a friendly
// full-width card button (matching the dashboard surfaces) plus the dialog
// itself, which is inert until opened. Reused on the learner and teacher
// dashboards; `source` is recorded on the submission so admins can see
// where it came from.
export default function FeedbackButton({ source = 'dashboard', className = '' }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group flex w-full items-center gap-3 rounded-2xl border-2 border-dashed theme-border theme-card px-4 py-3.5 text-left transition-colors hover:border-[color:var(--accent)] hover:theme-bg-subtle ${className}`}
      >
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
          style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-fg)' }}
        >
          <Icon as={Lightbulb} size="md" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-black theme-text">Have an idea or a request?</span>
          <span className="block text-xs theme-text-muted">
            Ask us for a subject, past paper, feature — anything you'd like to see.
          </span>
        </span>
        <span className="shrink-0 text-sm font-black theme-accent-text">Suggest →</span>
      </button>

      <FeedbackDialog open={open} onClose={() => setOpen(false)} source={source} />
    </>
  )
}
