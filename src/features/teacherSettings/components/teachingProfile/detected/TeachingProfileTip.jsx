import Icon from '../../../../../components/ui/Icon'
import { Info } from '../../../../../components/ui/icons'

/** Small blue helper card shown BELOW the main detected-assignments card. */
export default function TeachingProfileTip() {
  return (
    <aside className="tset-dta-tip">
      <span className="tset-dta-tip__icon" aria-hidden="true">
        <Icon as={Info} size="sm" />
      </span>
      <p className="tset-dta-tip__text">
        <strong>Tip</strong> — You can edit your teaching assignments later from Settings.
      </p>
    </aside>
  )
}
