import { NavLink } from 'react-router-dom'
import { BarChart3, BookOpen, Bot, Home, PencilLine } from '../ui/icons'
import Icon from '../ui/Icon'

const MOBILE_NAV_ITEMS = [
  { to: '/dashboard', icon: Home,       label: 'Home',    end: true },
  { to: '/quizzes',   icon: PencilLine, label: 'Quizzes', end: false },
  { to: '/lessons',   icon: BookOpen,   label: 'Lessons', end: false },
  { to: '/my-results',icon: BarChart3,  label: 'Results', end: false },
  { to: '/study',     icon: Bot,        label: 'Zed',     end: false },
]

export default function MobileBottomNav({ mode = 'fixed', className = '' }) {
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
                isActive ? 'theme-accent-text' : 'theme-text-muted hover:theme-accent-text'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl border leading-none shadow-elev-sm transition-all duration-base ease-spring ${
                  isActive
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : 'border-transparent text-slate-400'
                }`}>
                  <Icon as={item.icon} size="md" strokeWidth={2.1} />
                </span>
                <span className={`text-xs font-bold ${isActive ? 'font-black' : ''}`}>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
