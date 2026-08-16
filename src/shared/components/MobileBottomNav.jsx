import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FileText, Files, Gamepad2, Home } from './icons'
import Icon from './Icon'
import useHideOnScroll from '../../hooks/useHideOnScroll'

// The prototype-v3 4-tab learner IA (Home · Papers · Notes · Games —
// 2026-08 redesign; Learn and Practice retired in step 5). This bar is
// the side door on self-chromed pages (Navbar surfaces), so it must
// match LearnerBottomNav or the retired tabs come back through it.
// Labels resolve via i18n (audit A7) — `nav.*` keys, English fallback.
const MOBILE_NAV_ITEMS = [
  { to: '/dashboard', icon: Home,     labelKey: 'nav.dashboard', end: true },
  { to: '/papers',    icon: Files,    labelKey: 'nav.papers',    end: false },
  { to: '/notes',     icon: FileText, labelKey: 'nav.notes',     end: false },
  { to: '/games',     icon: Gamepad2, labelKey: 'nav.games',     end: false },
]

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
        {MOBILE_NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-1 py-2 transition-all duration-base ease-out active:scale-95 ${
                isActive ? 'text-slate-900' : 'text-slate-700 hover:text-slate-900'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={isActive ? 'zx-nav-pill-active' : 'zx-nav-pill-idle'}>
                  <Icon as={item.icon} size="md" strokeWidth={2.2} />
                </span>
                <span className={`text-[11px] font-bold ${isActive ? 'font-black' : ''}`}>{t(item.labelKey)}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
