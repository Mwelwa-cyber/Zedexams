import { NavLink } from 'react-router-dom'
import { BookOpen, FolderOpen, Home, PencilLine, Users } from '../ui/icons'
import Icon from '../ui/Icon'

const TEACHER_NAV_ITEMS = [
  { to: '/teacher',             icon: Home,       label: 'Home',        end: true  },
  { to: '/teacher/library',     icon: FolderOpen, label: 'Library',     end: false },
  { to: '/teacher/lessons',     icon: BookOpen,   label: 'Lessons',     end: false },
  { to: '/teacher/assessments', icon: PencilLine, label: 'Assessments', end: false },
  { to: '/teacher/classes',     icon: Users,      label: 'My Classes',  end: false },
]

const PILL_STYLE = { width: 38, height: 30, borderRadius: 12 }

export default function TeacherBottomNav({ className = '' }) {
  return (
    <nav
      className={`zx-glass-bottom safe-area-bottom fixed bottom-0 left-0 right-0 z-30 lg:hidden ${className}`}
      aria-label="Primary teacher navigation"
    >
      <div className="flex">
        {TEACHER_NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 py-1.5 transition-all duration-base ease-out ${
                isActive ? 'text-slate-900' : 'text-slate-700 hover:text-slate-900'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={isActive ? 'zx-nav-pill-active' : 'zx-nav-pill-idle'}
                  style={PILL_STYLE}
                >
                  <Icon as={item.icon} size="sm" strokeWidth={2.2} />
                </span>
                <span className={`text-[10px] font-bold ${isActive ? 'font-black' : ''}`}>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
