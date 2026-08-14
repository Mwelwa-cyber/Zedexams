import { useState } from 'react'
import Icon from '../../../shared/components/Icon'
import { Lightbulb } from '../../../shared/components/icons'
import { FeedbackDialog } from '../../feedback'

// Calm closing strip: reminds the teacher their settings flow into every
// studio, with a "Need help?" launcher that opens the shared feedback dialog.
export default function TipStrip() {
  const [open, setOpen] = useState(false)
  return (
    <div className="tset-tip">
      <span className="tset-tip__icon" aria-hidden="true">
        <Icon as={Lightbulb} size="sm" />
      </span>
      <p className="tset-tip__text">
        Your preferences are used across all studios to personalise lesson plans,
        papers and documents — set them once, and every tool follows.
      </p>
      <button type="button" className="tset-tip__link" onClick={() => setOpen(true)}>
        Need help?
      </button>
      <FeedbackDialog open={open} onClose={() => setOpen(false)} source="teacher-settings" />
    </div>
  )
}
