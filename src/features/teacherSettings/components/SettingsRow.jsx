import { Link } from 'react-router-dom'
import Icon from '../../../components/ui/Icon'
import { ChevronRight } from '../../../components/ui/icons'

// One settings list row: circular tone badge · title + description · chevron.
// The whole row is the link (≥56px touch target on mobile).
export default function SettingsRow({ row }) {
  const { path, title, desc, icon, tone } = row
  return (
    <Link to={`/settings/${path}`} className="tset-row">
      <span className={`tset-row__badge tset-row__badge--${tone}`}>
        <Icon as={icon} size="sm" />
      </span>
      <span className="tset-row__text">
        <p className="tset-row__title">{title}</p>
        <p className="tset-row__desc">{desc}</p>
      </span>
      <ChevronRight size={16} className="tset-row__chevron" />
    </Link>
  )
}
