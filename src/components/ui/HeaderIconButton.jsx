import { Link } from 'react-router-dom'
import Icon from './Icon'

export function HeaderIconLink({ to, label, icon: ActionIcon }) {
  return (
    <Link to={to} className="group/tt relative flex flex-col items-center">
      <span className="zx-card theme-card theme-border learner-chrome-icon flex h-11 w-11 items-center justify-center rounded-2xl border shadow-elev-sm transition-all group-hover/tt:theme-accent-bg group-hover/tt:theme-accent-text">
        <Icon as={ActionIcon} size="md" strokeWidth={2.1} />
      </span>
      <span className="learner-chrome-label mt-1 text-[10px] font-black leading-none">{label}</span>
    </Link>
  )
}

export function HeaderIconButton({ label, icon: ActionIcon, active = false, important = false, badge, children, ...buttonProps }) {
  return (
    <div className="group/tt relative flex flex-col items-center">
      <button
        type="button"
        className={`zx-card relative flex h-11 w-11 items-center justify-center rounded-2xl border shadow-elev-sm transition-all min-h-0 ${
          active
            ? 'border-blue-200 bg-blue-50 text-blue-700'
            : important
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'theme-card theme-border learner-chrome-icon hover:theme-accent-bg hover:theme-accent-text'
        }`}
        {...buttonProps}
      >
        <Icon as={ActionIcon} size="md" strokeWidth={2.1} />
        {badge ? (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black leading-none text-white ring-2 ring-white"
          >
            {badge}
          </span>
        ) : null}
      </button>
      <span className="learner-chrome-label mt-1 text-[10px] font-black leading-none">{label}</span>
      {children}
    </div>
  )
}
