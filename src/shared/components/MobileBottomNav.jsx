import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FileText, Files, Gamepad2, Home } from './icons'
import Icon from './Icon'
import useHideOnScroll from '../../hooks/useHideOnScroll'
import { LEARNER_TABS } from '../constants/learnerTabs.js'

// This bar is the side door on the pages still carrying the legacy
// `Navbar` chrome, so its destinations must match the learner shell's or
// the retired IA comes back through it. They no longer CAN differ: both
// bars read `LEARNER_TABS`, and this file only decides how a tab looks in
// the older Tailwind system. See that module's header for why the two
// renderings are still separate.
const TAB_ICONS = { home: Home, papers: Files, notes: FileText, games: Gamepad2 }

export default function MobileBottomNav({ mode = 'fixed', className = '' }) {
  const { t } = useTranslation()
  // Auto-hide only applies to the floating (fixed) bar; a `static` inline bar
  // scrolls with the page and shouldn't slide away.
  const hidden = useHideOnScroll()
  const autoHide = mode === 'static'
    ? ''
    : `zx-nav-autohide ${hidden ? 'zx-nav-hidden-bottom' : ''}`
  const positionClass = mode === 'static'
    ? 'lg:hidden zx-glass-bottom safe-area-bottom'
    : 'lg:hidden fixed bottom-0 left-0 right-0 z-30 zx-glass-bottom safe-area-bottom'

  return (
    <nav className={`${positionClass} ${autoHide} ${className}`} aria-label="Primary mobile navigation">
      <div className="flex">
        {LEARNER_TABS.map(tab => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-1 py-2 transition-all duration-base ease-out active:scale-95 ${
                isActive ? 'text-slate-900' : 'text-slate-700 hover:text-slate-900'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={isActive ? 'zx-nav-pill-active' : 'zx-nav-pill-idle'}>
                  <Icon as={TAB_ICONS[tab.id]} size="md" strokeWidth={2.2} />
                </span>
                <span className={`text-xs font-bold ${isActive ? 'font-black' : ''}`}>{t(tab.labelKey, tab.label)}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
