/**
 * LearnerBottomNav — the persistent 5-tab learner navigation.
 * Home · Learn · Papers (enlarged centre action) · Practice · Games.
 * Profile is deliberately NOT here — it opens from the header avatar.
 */
import { NavLink } from 'react-router-dom'
import LearnerIcon from './LearnerIcon'
import useHideOnScroll from '../../../hooks/useHideOnScroll'

const ITEMS = [
  { to: '/dashboard', name: 'home', label: 'Home', end: true },
  { to: '/learn', name: 'learn', label: 'Learn', end: false },
  { to: '/papers', name: 'papers', label: 'Papers', end: false, center: true },
  { to: '/practice', name: 'practice', label: 'Practice', end: false },
  { to: '/games', name: 'games', label: 'Games', end: false },
]

export default function LearnerBottomNav() {
  // LinkedIn-style auto-hide, in step with the header's .lhx-topbar: the
  // bar folds down while the learner scrolls into the page and returns on
  // the first scroll up, so reading is full-screen but navigation is one
  // flick away.
  const hidden = useHideOnScroll()
  return (
    <nav className={`lhx-nav ${hidden ? 'lhx-nav-hidden' : ''}`} aria-label="Learner navigation">
      <div className="lhx-nav-inner">
        {ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            aria-label={item.label}
            className={({ isActive }) =>
              `lhx-nav-item ${item.center ? 'lhx-nav-center' : ''} ${isActive ? 'is-active' : ''}`
            }
          >
            {/* react-router sets aria-current="page" on the active link */}
            {item.center ? (
              <span className="lhx-nav-center-btn">
                <LearnerIcon name={item.name} size={24} />
              </span>
            ) : (
              <LearnerIcon name={item.name} size={22} />
            )}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
