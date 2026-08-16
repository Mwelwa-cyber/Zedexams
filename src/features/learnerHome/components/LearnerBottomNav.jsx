/**
 * LearnerBottomNav — the persistent learner navigation, prototype-v3 IA:
 * Home · Papers · Notes · Games. On phones it is the glass bottom bar
 * with the coral active indicator; from 1000px it renders as the fixed
 * left sidebar (see learnerHome.css), where the brand row shows.
 *
 * Learn and Practice are deliberately absent (locked scope) — their
 * routes stay reachable until step 5 retires them, via Home's cards and
 * the profile sheet. Profile is NOT here — it opens from the avatar.
 */
import { NavLink } from 'react-router-dom'
import LearnerIcon from './LearnerIcon'
import useHideOnScroll from '../../../hooks/useHideOnScroll'

const ITEMS = [
  { to: '/dashboard', name: 'home', label: 'Home', end: true },
  { to: '/papers', name: 'papers', label: 'Papers', end: false },
  { to: '/notes', name: 'notes', label: 'Notes', end: false },
  { to: '/games', name: 'games', label: 'Games', end: false },
]

export default function LearnerBottomNav() {
  // LinkedIn-style auto-hide, in step with the topbar: the bar folds down
  // while the learner scrolls into the page and returns on the first
  // scroll up. Desktop's sidebar ignores the hidden class in CSS.
  const hidden = useHideOnScroll()
  return (
    <nav className={`lhx-nav ${hidden ? 'lhx-nav-hidden' : ''}`} aria-label="Learner navigation">
      <div className="lhx-nav-brand" aria-hidden="true">
        <img src="/zedexams-logo.webp" alt="" height="30" />
      </div>
      <div className="lhx-nav-inner">
        {ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            aria-label={item.label}
            className={({ isActive }) => `lhx-nav-item ${isActive ? 'is-active' : ''}`}
          >
            {/* react-router sets aria-current="page" on the active link */}
            <LearnerIcon name={item.name} size={23} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
