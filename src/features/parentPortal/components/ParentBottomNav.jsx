/**
 * ParentBottomNav — the parent app's four tabs: Home · Children ·
 * Reports · Account.
 *
 * It reuses the learner shell's `.lhx-nav` classes rather than defining
 * its own, so the phone bottom bar, the ≥1000px left-sidebar reflow and
 * Night mode all come for free and stay in step. The parent app is a
 * different information architecture on the same chrome, which is what
 * the prototype shows.
 *
 * There is deliberately no auto-hide here. The learner's bar folds away
 * because a learner reads long content (notes, papers) and the chrome
 * competes with it; the parent's screens are short dashboards, and a
 * navigation that disappears while somebody is deciding whether to
 * approve a payment is a navigation that looks broken.
 */
import { NavLink } from 'react-router-dom'
import { Home, Users, TrendingUp, Settings } from 'lucide-react'

const ITEMS = [
  { to: '/family', label: 'Home', Icon: Home, end: true },
  { to: '/family/children', label: 'Children', Icon: Users, end: false },
  { to: '/family/reports', label: 'Reports', Icon: TrendingUp, end: false },
  { to: '/family/account', label: 'Account', Icon: Settings, end: false },
]

export default function ParentBottomNav() {
  return (
    <nav className="lhx-nav" aria-label="Parent navigation">
      <div className="lhx-nav-brand" aria-hidden="true">
        <img src="/zedexams-logo.webp" alt="" height="30" />
      </div>
      <div className="lhx-nav-inner">
        {ITEMS.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            aria-label={label}
            className={({ isActive }) => `lhx-nav-item ${isActive ? 'is-active' : ''}`}
          >
            {/* react-router sets aria-current="page" on the active link */}
            <Icon size={23} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
