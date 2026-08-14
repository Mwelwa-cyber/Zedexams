import { Link } from 'react-router-dom'
import Icon from './Icon'

const SIZE = {
  md: {
    button: 'h-11 w-11 rounded-2xl',
    icon: 'md',
    label: 'mt-1.5 text-[10px]',
  },
  sm: {
    button: 'h-9 w-9 rounded-xl',
    icon: 'sm',
    label: 'mt-1 text-[9px]',
  },
}

export function HeaderIconLink({ to, label, icon: ActionIcon, size = 'md' }) {
  const s = SIZE[size] || SIZE.md
  return (
    <Link to={to} className="group/tt relative flex flex-col items-center">
      <span className={`zx-card theme-card theme-border learner-chrome-icon flex items-center justify-center border shadow-elev-sm transition-all group-hover/tt:theme-accent-bg group-hover/tt:theme-accent-text ${s.button}`}>
        <Icon as={ActionIcon} size={s.icon} strokeWidth={2.1} />
      </span>
      <span className={`learner-chrome-label font-semibold tracking-tight leading-none ${s.label}`}>{label}</span>
    </Link>
  )
}

export function HeaderIconButton({ label, icon: ActionIcon, active = false, important = false, badge, children, size = 'md', ...buttonProps }) {
  const s = SIZE[size] || SIZE.md
  return (
    <div className="group/tt relative flex flex-col items-center">
      <button
        type="button"
        // `active` and `important` are the semantic info/warning tokens, not
        // fixed blue-50/amber-50 pairs: those have no dark treatment, so on
        // Night the one button carrying state was a pale box in a dark header
        // — the state read as a rendering fault rather than as emphasis.
        className={`zx-card relative flex items-center justify-center border shadow-elev-sm transition-all min-h-0 ${s.button} ${
          active
            ? 'bg-info-subtle text-info theme-border'
            : important
              ? 'bg-warning-subtle text-warning theme-border'
              : 'theme-card theme-border learner-chrome-icon hover:theme-accent-bg hover:theme-accent-text'
        }`}
        {...buttonProps}
      >
        <Icon as={ActionIcon} size={s.icon} strokeWidth={2.1} />
        {badge ? (
          // The ring separates the badge from the button beneath it, so it has
          // to be the SURFACE colour, not white — a fixed white ring is a halo
          // on a dark header.
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-black leading-none text-white ring-2 ring-[color:var(--card)]"
          >
            {badge}
          </span>
        ) : null}
      </button>
      <span className={`learner-chrome-label font-semibold tracking-tight leading-none ${s.label}`}>{label}</span>
      {children}
    </div>
  )
}
