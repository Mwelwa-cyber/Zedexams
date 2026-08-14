/**
 * FreePreviewUpsell — the post-generation upgrade prompt shown after a Free
 * teacher's limited preview succeeds (redesign §13). Value first: the
 * preview stays on screen and saveable — this banner only explains what the
 * full plan adds. Rendered by the Scheme of Work studio (2-week preview)
 * and the Test Paper create flow (5-question short test).
 */

import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../../components/ui/Icon'
import { ArrowRight } from '../../../components/ui/icons'
import { capture } from '../../../utils/analytics'

export default function FreePreviewUpsell({ context, title, text }) {
  const shownRef = useRef(false)
  useEffect(() => {
    if (shownRef.current) return
    shownRef.current = true
    capture('upgrade_prompt_displayed', { context })
  }, [context])

  return (
    <div className="teacher-preview-upsell" role="note" aria-label="Upgrade information">
      <p className="teacher-preview-upsell__title">
        <span aria-hidden="true">✨</span> {title}
      </p>
      <p className="teacher-preview-upsell__text">{text}</p>
      <div className="teacher-preview-upsell__actions">
        <Link
          to="/teacher/subscription"
          className="teacher-preview-upsell__btn teacher-preview-upsell__btn--primary"
          onClick={() => capture('upgrade_button_selected', { context, action: 'upgrade' })}
        >
          Upgrade to Pro
          <Icon as={ArrowRight} size="xs" />
        </Link>
        <Link
          to="/pricing"
          className="teacher-preview-upsell__btn teacher-preview-upsell__btn--ghost"
          onClick={() => capture('upgrade_button_selected', { context, action: 'pricing' })}
        >
          View pricing
        </Link>
      </div>
    </div>
  )
}
