import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, FileText, Files, Home, PencilLine } from '../ui/icons'
import Icon from '../ui/Icon'
import useHideOnScroll from '../../hooks/useHideOnScroll'

// 5 items at 20% width each. Labels resolve via i18n (audit A7) — `nav.*`
// keys, English fallback.
const MOBILE_NAV_ITEMS = [
  { to: '/dashboard',  icon: Home,         labelKey: 'nav.dashboard', end: true },
  { to: '/study-plan', icon: CalendarDays, labelKey: 'nav.studyPlan', end: false },
  { to: '/notes',      icon: FileText,     labelKey: 'nav.notes',     end: false },
  { to: '/quizzes',    icon: PencilLine,   labelKey: 'nav.quizzes',   end: false },
  { to: '/papers',     icon: Files,        labelKey: 'nav.papers',    end: false },
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
