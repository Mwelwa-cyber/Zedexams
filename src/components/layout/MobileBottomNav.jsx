import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BarChart3, BookOpen, FileText, Home, PencilLine } from '../ui/icons'
import Icon from '../ui/Icon'

// 5 items at ~20% width each. Notes Studio replaces the slide-builder for new
// content; Lessons stays for legacy slide-built lessons until those are gone.
// Labels resolve via i18n (audit A7) — `nav.*` keys, English fallback.
const MOBILE_NAV_ITEMS = [
  { to: '/dashboard', icon: Home,       labelKey: 'nav.dashboard', end: true },
  { to: '/notes',     icon: FileText,   labelKey: 'nav.notes',     end: false },
  { to: '/quizzes',   icon: PencilLine, labelKey: 'nav.quizzes',   end: false },
  { to: '/lessons',   icon: BookOpen,   labelKey: 'nav.lessons',   end: false },
  { to: '/my-results',icon: BarChart3,  labelKey: 'nav.results',   end: false },
]

export default function MobileBottomNav({ mode = 'fixed', className = '' }) {
  const { t } = useTranslation()
  const positionClass = mode === 'static'
    ? 'md:hidden theme-card border-t theme-border shadow-elev-lg safe-area-bottom'
    : 'md:hidden fixed bottom-0 left-0 right-0 z-30 theme-card border-t theme-border shadow-elev-lg safe-area-bottom'

  return (
    <nav className={`${positionClass} ${className}`} aria-label="Primary mobile navigation">
      <div className="flex">
        {MOBILE_NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-1 py-2 transition-all duration-base ease-out ${
                isActive ? 'theme-accent-text' : 'learner-chrome-label hover:theme-accent-text'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl border leading-none shadow-elev-sm transition-all duration-base ease-spring ${
                  isActive
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : 'border-transparent learner-chrome-icon'
                }`}>
                  <Icon as={item.icon} size="md" strokeWidth={2.1} />
                </span>
                <span className={`text-xs font-bold ${isActive ? 'font-black' : ''}`}>{t(item.labelKey)}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
