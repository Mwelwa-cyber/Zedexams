/**
 * FreeAllowanceNotice — lightweight one-time banner telling existing Free
 * teachers their allowance improved (allowance rollout review, item 3).
 * Non-blocking, dismissible, shown once per catalogue revision: the seen
 * flag is keyed on PLAN_CATALOG_VERSION, so a future allowance change can
 * announce itself once too, and nothing repeats. Renders nothing for paid
 * plans or once dismissed.
 */

import { useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { ArrowRight, X } from '../../../components/ui/icons'
import { capture } from '../../../utils/analytics'
import { PLAN_CATALOG_VERSION } from '../../../utils/teacherPlans'

const SEEN_KEY = `zedexams:allowance-notice:${PLAN_CATALOG_VERSION}`

function alreadySeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1' } catch { return true }
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1') } catch { /* storage unavailable */ }
}

export default function FreeAllowanceNotice({ plan, onViewAllowance }) {
  const [dismissed, setDismissed] = useState(() => alreadySeen())
  if (plan !== 'free' || dismissed) return null

  function dismiss() {
    markSeen()
    setDismissed(true)
  }

  return (
    <div className="teacher-allowance-notice" role="status">
      <span className="teacher-allowance-notice__icon" aria-hidden="true">🎁</span>
      <div className="teacher-allowance-notice__body">
        <p className="teacher-allowance-notice__title">Your free teacher allowance has increased</p>
        <p className="teacher-allowance-notice__text">
          You now have more opportunities to create lesson plans and try worksheets, homework,
          short tests and scheme previews.
        </p>
      </div>
      <button
        type="button"
        className="teacher-allowance-notice__cta"
        onClick={() => {
          capture('allowance_notice_viewed', { version: PLAN_CATALOG_VERSION })
          dismiss()
          onViewAllowance?.()
        }}
      >
        View my allowance
        <Icon as={ArrowRight} size="xs" />
      </button>
      <button
        type="button"
        className="teacher-allowance-notice__close"
        aria-label="Dismiss this notice"
        onClick={dismiss}
      >
        <Icon as={X} size="xs" />
      </button>
    </div>
  )
}
