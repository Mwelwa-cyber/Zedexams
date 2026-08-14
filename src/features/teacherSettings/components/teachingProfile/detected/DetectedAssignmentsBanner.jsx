import Icon from '../../../../../shared/components/Icon'
import { ShieldCheck } from '../../../../../shared/components/icons'

/**
 * Soft green information banner at the top of the detected-assignments card:
 * explains where the suggestions came from and that nothing is saved until
 * the teacher continues.
 */
export default function DetectedAssignmentsBanner() {
  return (
    <div className="tset-dta-banner">
      <span className="tset-dta-banner__icon" aria-hidden="true">
        <Icon as={ShieldCheck} size="md" />
      </span>
      <div className="tset-dta-banner__body">
        <h2 className="tset-dta-banner__title">
          We found possible teaching assignments from your recent work
        </h2>
        <p className="tset-dta-banner__desc">
          Based on your recent lesson plans, schemes of work and other documents. Select the
          assignments you currently teach. You can edit or add more in the next step. Nothing is
          saved until you continue.
        </p>
      </div>
    </div>
  )
}
